"""Integrity check over the downloaded BraTS cases, before any preprocessing.

    python backend/train/verify_data.py

Runs before `prepare_brats.py`. A download over a slow link produces truncated
gzip members, half-written files and silent HTTP error pages saved with a
.nii.gz name; every one of those fails in a different and confusing place
several stages later. Checking here turns all of them into one clear message.

Each case is checked for:
  - both files present and non-trivially sized
  - the gzip stream decompresses fully (catches truncation)
  - a readable NIfTI header
  - image and mask on the same voxel grid and affine
  - plausible geometry: 3D, isotropic-ish spacing, sane dimensions
  - non-degenerate intensities, and a brain that is actually present
  - mask labels drawn from the expected BraTS set
  - the lesion lying inside the brain rather than in background air
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import nibabel as nib
import numpy as np

# BraTS: 0 background, 1 necrotic core, 2 peritumoural oedema, 4 enhancing.
# Some releases renumber enhancing to 3, so both are accepted.
EXPECTED_LABELS = {0, 1, 2, 3, 4}

MIN_BRAIN_VOXELS = 200_000          # a 1 mm adult brain is ~1.2M voxels
MAX_LESION_FRACTION = 0.6           # a mask covering most of the brain is a labelling error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=Path("data/raw/brats2024_gli"))
    parser.add_argument("--delete-bad", action="store_true",
                        help="Remove failing cases so a re-run of download_brats.py refetches them")
    parser.add_argument("--quick", action="store_true",
                        help="Skip the full gzip decompression pass")
    return parser.parse_args()


def gzip_intact(path: Path) -> tuple[bool, str]:
    """Read the whole gzip stream. A truncated download only shows up here."""
    try:
        with gzip.open(path, "rb") as handle:
            while handle.read(1 << 20):
                pass
        return True, ""
    except (OSError, EOFError, gzip.BadGzipFile) as exc:
        return False, f"corrupt gzip ({type(exc).__name__}: {exc})"


def check_case(case_dir: Path, quick: bool) -> list[str]:
    problems: list[str] = []
    image_path = case_dir / "flair.nii.gz"
    label_path = case_dir / "seg.nii.gz"

    for path, minimum in ((image_path, 100_000), (label_path, 1_000)):
        if not path.exists():
            problems.append(f"missing {path.name}")
        elif path.stat().st_size < minimum:
            problems.append(f"{path.name} is only {path.stat().st_size} bytes")
    if problems:
        return problems

    if not quick:
        for path in (image_path, label_path):
            ok, message = gzip_intact(path)
            if not ok:
                problems.append(f"{path.name}: {message}")
        if problems:
            return problems

    try:
        image_nii = nib.load(str(image_path))
        label_nii = nib.load(str(label_path))
        image = np.asanyarray(image_nii.dataobj)
        label = np.asanyarray(label_nii.dataobj)
    except Exception as exc:
        return [f"unreadable NIfTI ({type(exc).__name__}: {exc})"]

    if image.ndim != 3:
        problems.append(f"image is {image.ndim}D, expected 3D")
    if image.shape != label.shape:
        problems.append(f"shape mismatch: image {image.shape} vs mask {label.shape}")
    if not np.allclose(image_nii.affine, label_nii.affine, atol=1e-3):
        problems.append("image and mask affines differ; they are not on the same grid")

    spacing = np.array(image_nii.header.get_zooms()[:3], dtype=float)
    if np.any(spacing <= 0) or np.any(spacing > 5):
        problems.append(f"implausible voxel spacing {tuple(spacing.round(2))} mm")
    elif spacing.max() / max(spacing.min(), 1e-6) > 1.5:
        problems.append(f"strongly anisotropic spacing {tuple(spacing.round(2))} mm")

    if problems:
        return problems

    image = image.astype(np.float32)
    if not np.isfinite(image).all():
        problems.append("image contains NaN or Inf")
    if float(image.std()) < 1e-6:
        problems.append("image is constant")

    brain = image > 0
    brain_voxels = int(brain.sum())
    if brain_voxels < MIN_BRAIN_VOXELS:
        problems.append(f"only {brain_voxels} non-zero voxels; brain may be missing")

    labels_present = set(np.unique(label).astype(int).tolist())
    unexpected = labels_present - EXPECTED_LABELS
    if unexpected:
        problems.append(f"unexpected mask labels {sorted(unexpected)}")

    lesion = label > 0
    lesion_voxels = int(lesion.sum())
    if lesion_voxels == 0:
        problems.append("mask is empty; nothing to learn from this case")
    elif brain_voxels:
        fraction = lesion_voxels / brain_voxels
        if fraction > MAX_LESION_FRACTION:
            problems.append(f"lesion covers {fraction:.0%} of the brain; likely a labelling error")

        # A mask sitting in background air means image and mask are misaligned,
        # which a shape check alone will not catch.
        outside = int(np.logical_and(lesion, ~brain).sum())
        if lesion_voxels and outside / lesion_voxels > 0.25:
            problems.append(
                f"{outside / lesion_voxels:.0%} of the mask lies outside the brain; "
                "image and mask look misaligned"
            )

    return problems


def main() -> int:
    args = parse_args()

    if not args.raw.is_dir():
        print(f"No data at {args.raw}. Run download_brats.py first.")
        return 1

    case_dirs = sorted(p for p in args.raw.iterdir() if p.is_dir())
    if not case_dirs:
        print(f"No case directories under {args.raw}")
        return 1

    print(f"Verifying {len(case_dirs)} cases in {args.raw}")
    print(f"Mode: {'quick (header only)' if args.quick else 'full (decompresses every file)'}\n")

    good: list[str] = []
    bad: dict[str, list[str]] = {}

    for i, case_dir in enumerate(case_dirs, 1):
        problems = check_case(case_dir, args.quick)
        if problems:
            bad[case_dir.name] = problems
            print(f"  FAIL {case_dir.name}: {problems[0]}")
            for extra in problems[1:]:
                print(f"       {extra}")
        else:
            good.append(case_dir.name)

        if i % 50 == 0:
            print(f"  ... {i}/{len(case_dirs)}  ({len(good)} ok, {len(bad)} failing)")

    print(f"\n{'=' * 58}")
    print(f"  passed : {len(good)}")
    print(f"  failed : {len(bad)}")
    print("=" * 58)

    if bad and args.delete_bad:
        for name in bad:
            for path in (args.raw / name).glob("*"):
                path.unlink(missing_ok=True)
            (args.raw / name).rmdir()
        print(f"\nDeleted {len(bad)} failing cases. Re-run download_brats.py to refetch them.")
    elif bad:
        print("\nRe-run with --delete-bad to remove them, then download_brats.py to refetch.")

    report = {
        "checked": len(case_dirs),
        "passed": len(good),
        "failed": len(bad),
        "failures": bad,
        "verified_cases": good,
    }
    (args.raw / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Report: {args.raw / 'verification.json'}")

    return 0 if not bad else 2


if __name__ == "__main__":
    raise SystemExit(main())
