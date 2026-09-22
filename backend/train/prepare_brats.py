"""Turn the downloaded BraTS cases into a compact training cache.

    python backend/train/download_brats.py --cases 300
    python backend/train/prepare_brats.py

Each case becomes one npz holding the FLAIR volume, a binary lesion mask and a
brain mask, cropped to the brain and z-scored. The raw volumes are
182x218x182 float32 (~28 MB each); the cache is float16 and cropped, so the set
fits comfortably and the training loop can read a patch without decompressing a
whole study.

The preprocessing here is deliberately lighter than the clinical pipeline in
`app/pipeline/preprocess.py`. BraTS data arrives already skull-stripped,
co-registered and resampled to 1 mm isotropic; running this project's
lightweight stand-ins for bias correction and brain extraction over it could
only degrade work that has already been done properly upstream.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import nibabel as nib  # noqa: E402

# Context kept around the brain, in voxels, so patches near the surface still
# see some background rather than a hard crop edge.
CROP_MARGIN = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=Path("data/raw/brats2024_gli"))
    parser.add_argument("--out", type=Path, default=Path("data/cache/brats_flair"))
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def prepare_case(case_dir: Path, out_path: Path) -> dict | None:
    image_nii = nib.load(str(case_dir / "flair.nii.gz"))
    volume = np.asanyarray(image_nii.dataobj).astype(np.float32)
    label = np.asanyarray(nib.load(str(case_dir / "seg.nii.gz")).dataobj)

    while volume.ndim > 3:
        volume = volume[..., 0]
    while label.ndim > 3:
        label = label[..., 0]
    if volume.shape != label.shape:
        return None

    # BraTS labels are 1 = necrotic core, 2 = peritumoural oedema,
    # 4 = enhancing tumour. This pipeline segments "lesion", so every abnormal
    # label collapses to one foreground class ("whole tumour" in BraTS terms).
    label = (label > 0).astype(np.uint8)

    # Already skull-stripped: background is exactly zero.
    brain = volume > 0
    if brain.sum() < 1000 or label.sum() == 0:
        return None

    coords = np.argwhere(brain)
    lo = np.maximum(coords.min(axis=0) - CROP_MARGIN, 0)
    hi = np.minimum(coords.max(axis=0) + CROP_MARGIN + 1, volume.shape)
    slicer = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))

    volume, label, brain = volume[slicer], label[slicer], brain[slicer]

    # Z-score inside the brain only. Including the zero background would make the
    # normalisation depend on how much air happened to be cropped.
    values = volume[brain]
    mean, std = float(values.mean()), float(values.std())
    if std < 1e-6:
        return None
    volume = ((volume - mean) / std).astype(np.float32)
    volume[~brain] = 0.0

    # Uncompressed .npy, one array per file, so training can memory-map a single
    # patch instead of decompressing the whole volume. A compressed npz forces a
    # full decode for every 96-cubed crop, which made data loading cost more than
    # the convolutions it was feeding.
    out_path.parent.mkdir(parents=True, exist_ok=True)
    stem = out_path.with_suffix("")
    np.save(stem.with_name(stem.name + "_image.npy"), volume.astype(np.float16))
    np.save(stem.with_name(stem.name + "_label.npy"), label)
    np.save(stem.with_name(stem.name + "_brain.npy"), brain)

    return {
        "case": case_dir.name,
        "file": case_dir.name,
        "shape": [int(s) for s in volume.shape],
        "spacing_mm": [float(z) for z in image_nii.header.get_zooms()[:3]],
        "lesion_voxels": int(label.sum()),
        "brain_voxels": int(brain.sum()),
        "lesion_fraction": round(float(label.sum() / max(brain.sum(), 1)), 6),
    }


def main() -> int:
    args = parse_args()

    manifest_path = args.raw / "manifest.json"
    if not manifest_path.exists():
        print(f"No manifest at {manifest_path}. Run download_brats.py first.")
        return 1
    source = json.loads(manifest_path.read_text(encoding="utf-8"))

    case_dirs = sorted(
        p for p in args.raw.iterdir()
        if p.is_dir() and (p / "flair.nii.gz").exists() and (p / "seg.nii.gz").exists()
    )
    if args.limit:
        case_dirs = case_dirs[: args.limit]

    print(f"Source  : {source['upstream']}")
    print(f"Pathology: {source['pathology']}  (NOT tuberculosis)")
    print(f"Modality: {source['modality']}")
    print(f"Cases   : {len(case_dirs)}\n")

    args.out.mkdir(parents=True, exist_ok=True)
    index = []
    started = time.perf_counter()

    for i, case_dir in enumerate(case_dirs, 1):
        out_path = args.out / f"{case_dir.name}.npz"
        stem = out_path.with_suffix("")
        image_file = stem.with_name(stem.name + "_image.npy")
        if image_file.exists():
            label = np.asarray(np.load(stem.with_name(stem.name + "_label.npy"), mmap_mode="r"))
            brain = np.asarray(np.load(stem.with_name(stem.name + "_brain.npy"), mmap_mode="r"))
            index.append({
                "case": case_dir.name, "file": case_dir.name,
                "shape": list(np.load(image_file, mmap_mode="r").shape),
                "spacing_mm": [1.0, 1.0, 1.0],
                "lesion_voxels": int(label.sum()),
                "brain_voxels": int(brain.sum()),
                "lesion_fraction": round(float(label.sum() / max(brain.sum(), 1)), 6),
            })
        else:
            entry = prepare_case(case_dir, out_path)
            if entry is None:
                print(f"  skipped {case_dir.name}")
                continue
            index.append(entry)

        if i % 25 == 0 or i == len(case_dirs):
            elapsed = time.perf_counter() - started
            rate = i / max(elapsed, 1e-6)
            print(f"  {i}/{len(case_dirs)}  {elapsed:.0f}s  "
                  f"eta {(len(case_dirs) - i) / max(rate, 1e-6):.0f}s")

    out_manifest = {
        **{k: v for k, v in source.items() if k != "cases"},
        "label_mapping": "BraTS labels {1,2,4} -> 1 (whole tumour)",
        "preprocessing": "crop to brain bbox + 8 vox, z-score inside brain, float16",
        "storage": "uncompressed .npy per array, memory-mapped during training",
        "case_count": len(index),
        "cases": index,
    }
    (args.out / "index.json").write_text(json.dumps(out_manifest, indent=2), encoding="utf-8")

    fractions = np.array([c["lesion_fraction"] for c in index])
    total_gb = sum(f.stat().st_size for f in args.out.glob("*.npy")) / 1e9

    print(f"\nCached {len(index)} cases to {args.out}  ({total_gb:.2f} GB)")
    print(f"Lesion fraction of brain: median {np.median(fractions) * 100:.2f}%, "
          f"min {fractions.min() * 100:.3f}%, max {fractions.max() * 100:.2f}%")
    print(f"Index: {args.out / 'index.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
