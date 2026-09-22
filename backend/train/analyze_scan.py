"""Run one MRI scan through the full pipeline and print the result.

    python backend/train/analyze_scan.py path/to/scan.nii.gz
    python backend/train/analyze_scan.py scan.nii.gz --device cpu --threshold 0.6

    NIfTI -> preprocess -> 3D U-Net -> mask -> measurements -> 3D mesh -> report

This is the command-line twin of what POST /api/studies/{id}/analyze does in the
API, using the same pipeline modules, so a result here and a result in the
dashboard cannot disagree.

WHAT IT ACCEPTS
---------------
3D NIfTI (.nii / .nii.gz). That is the only format the pipeline reads.

  DICOM series   convert first:  dcm2niix -z y -o out_dir dicom_dir
  JPG / PNG      not usable as-is. A 2D screenshot of one slice has no voxel
                 spacing and no third dimension, so no volume in cm3 can be
                 computed from it and a 3D model cannot be built. If that is all
                 you have, --stack-2d will assemble a folder of slices into a
                 volume, but the spacing is then a guess and every measurement
                 it produces is a guess with it.

WHAT THE NUMBERS MEAN
---------------------
The model was trained on BraTS glioma. It segments focal brain lesions on FLAIR.
It has never seen a tuberculoma, so a detection here is evidence of a focal
lesion and nothing more specific than that.
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scan", type=Path, help="NIfTI file, or a folder of 2D slices with --stack-2d")
    parser.add_argument("--checkpoint", type=Path, default=BACKEND / "checkpoints" / "unet3d_brats.pt")
    parser.add_argument("--out", type=Path, default=Path("data/analysis"))
    parser.add_argument("--sequence", default="FLAIR")
    parser.add_argument("--threshold", type=float, default=None,
                        help="Defaults to the checkpoint's validation-tuned threshold if present")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto",
                        help="cpu keeps out of the way of a training run holding the GPU")
    parser.add_argument("--stack-2d", action="store_true",
                        help="Treat `scan` as a folder of 2D slices; spacing will be assumed")
    parser.add_argument("--slice-thickness", type=float, default=1.0,
                        help="Assumed mm between slices when using --stack-2d")
    parser.add_argument("--no-mesh", action="store_true")
    return parser.parse_args()


def stack_2d_folder(folder: Path, thickness: float):
    """Assemble a folder of 2D slice images into a volume.

    A deliberate last resort. Ordinary image files carry no voxel spacing, no
    slice order beyond the filename, and no orientation, so everything this
    produces rests on assumptions the file cannot confirm. Volumes derived from
    it are indicative at best.
    """
    try:
        from PIL import Image
    except ImportError:
        print("Stacking 2D slices needs Pillow:  pip install pillow")
        return None, None

    patterns = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.tif", "*.tiff")
    files = sorted({f for pattern in patterns for f in folder.glob(pattern)})
    if not files:
        print(f"No image files in {folder}")
        return None, None

    print(f"  stacking {len(files)} slices from {folder.name}")
    slices = []
    for path in files:
        image = Image.open(path).convert("L")
        slices.append(np.asarray(image, dtype=np.float32))

    shapes = {s.shape for s in slices}
    if len(shapes) != 1:
        print(f"  slices have differing sizes {shapes}; cannot stack")
        return None, None

    volume = np.stack(slices, axis=-1)
    affine = np.diag([1.0, 1.0, float(thickness), 1.0])
    return volume, affine


def main() -> int:
    args = parse_args()

    # CUDA_VISIBLE_DEVICES has to be set before torch initialises its CUDA
    # context; setting it after the import is silently ignored and the run lands
    # on the GPU anyway - which is exactly what must not happen while a training
    # job holds it.
    if args.device == "cpu":
        import os
        os.environ["CUDA_VISIBLE_DEVICES"] = ""

    try:
        import torch
    except ImportError:
        print("PyTorch is not installed.")
        return 1

    from app.pipeline import mesh as mesh_mod
    from app.pipeline import preprocess, quantify, report as report_mod, segmentation, slices
    from app.pipeline.volume import Volume, load_volume, save_mask, save_volume

    if not args.scan.exists():
        print(f"No such file: {args.scan}")
        return 1
    if not args.checkpoint.exists():
        print(f"No checkpoint at {args.checkpoint} - the classical fallback would be used instead.")

    started = time.perf_counter()
    print(f"Scan      : {args.scan}")

    # --- load ---------------------------------------------------------------
    if args.stack_2d:
        data, affine = stack_2d_folder(args.scan, args.slice_thickness)
        if data is None:
            return 1
        volume = Volume(data, affine, args.sequence)
        print("  WARNING: stacked from 2D images. Voxel spacing is assumed, so every")
        print("           volume and distance below is indicative only.")
    else:
        try:
            volume = load_volume(args.scan, sequence=args.sequence)
        except Exception as exc:
            print(f"Could not read as NIfTI: {exc}")
            print("If this is DICOM, convert first:  dcm2niix -z y -o out_dir dicom_dir")
            return 1

    print(f"  shape {volume.shape}, spacing {tuple(round(float(s), 2) for s in volume.spacing)} mm")

    # --- preprocess ---------------------------------------------------------
    print("\nPreprocessing (resample, bias correct, skull strip, normalise)...")
    processed, brain_mask = preprocess.preprocess(volume)
    brain_cm3 = brain_mask.sum() * processed.voxel_volume_mm3 / 1000
    print(f"  brain volume {brain_cm3:.0f} cm3, grid {processed.shape}")
    if not brain_mask.any():
        print("  brain extraction produced an empty mask - is this a brain MRI?")
        return 1
    if not 700 < brain_cm3 < 2200:
        print(f"  WARNING: {brain_cm3:.0f} cm3 is outside the usual adult range (~1100-1500).")
        print("           Brain extraction may have failed; treat the numbers with caution.")

    # --- threshold ----------------------------------------------------------
    threshold = args.threshold
    if threshold is None:
        eval_path = args.checkpoint.with_suffix(".eval.json")
        if eval_path.exists():
            try:
                threshold = json.loads(eval_path.read_text(encoding="utf-8")).get("threshold")
                print(f"\nUsing validation-tuned threshold {threshold} from {eval_path.name}")
            except Exception:
                threshold = None
    if threshold is None:
        threshold = segmentation.DEFAULT_THRESHOLD
        print(f"\nUsing default threshold {threshold} "
              f"(run evaluate.py --tune to derive one from validation)")

    # --- segment ------------------------------------------------------------
    print("Running the model...")
    seg = segmentation.segment(
        processed, brain_mask,
        checkpoint=args.checkpoint if args.checkpoint.exists() else None,
        threshold=threshold,
    )
    print(f"  backend: {seg.method}")
    for note in seg.notes:
        print(f"    {note}")
    if seg.method != "unet":
        print("  NOTE: this is the classical fallback, NOT the trained model.")

    # --- quantify -----------------------------------------------------------
    lesions, burden = quantify.quantify(processed, seg.mask, seg.probability, brain_mask)

    print(f"\n{'=' * 64}")
    print("RESULT")
    print("=" * 64)
    print(f"  Lesions detected       {burden.lesion_count}")
    print(f"  Total lesion volume    {burden.total_volume_cm3:.3f} cm3")
    print(f"  Largest lesion         {burden.largest_volume_cm3:.3f} cm3")
    print(f"  Lesion load            {burden.lesion_load_percent:.3f}% of {burden.brain_volume_cm3:.0f} cm3 brain")
    print(f"  Mean confidence        {burden.mean_probability:.3f}  (UNCALIBRATED)")

    if lesions:
        print(f"\n  {'#':>3}  {'volume cm3':>10}  {'max mm':>7}  {'spher':>6}  {'conf':>5}  location")
        print(f"  {'-' * 3}  {'-' * 10}  {'-' * 7}  {'-' * 6}  {'-' * 5}  {'-' * 32}")
        for l in lesions[:15]:
            flag = " *" if l.tb_typical_site else ""
            print(f"  {l.id:>3}  {l.volume_cm3:>10.3f}  {l.max_diameter_mm:>7.1f}  "
                  f"{l.sphericity:>6.2f}  {l.mean_probability:>5.2f}  {l.side} {l.region}{flag}")
        if len(lesions) > 15:
            print(f"  ... and {len(lesions) - 15} more")
        if any(l.tb_typical_site for l in lesions):
            print("  * site with a recognised TB predilection (location only - not a diagnosis)")
    else:
        print("\n  No lesion met the detection criteria.")

    # --- artifacts ----------------------------------------------------------
    out_dir = args.out / args.scan.stem.replace(".nii", "")
    out_dir.mkdir(parents=True, exist_ok=True)

    save_volume(processed, out_dir / "preprocessed.nii.gz")
    save_mask(brain_mask, processed.affine, out_dir / "brain_mask.nii.gz")
    save_mask(seg.mask, processed.affine, out_dir / "lesion_mask.nii.gz")
    save_volume(processed.with_data(seg.probability), out_dir / "probability.nii.gz")

    slice_manifest = slices.render_study_slices(
        processed, seg.probability, seg.mask, brain_mask, out_dir / "slices"
    )
    slice_count = sum(len(v) for v in slice_manifest.values())

    scene = None
    if not args.no_mesh:
        scene = mesh_mod.build_scene(brain_mask, seg.mask, processed.affine, lesions)
        (out_dir / "scene.json").write_text(json.dumps(scene), encoding="utf-8")

    built = report_mod.build_report(
        lesions=lesions, burden=burden, segmentation_method=seg.method,
        sequences=[args.sequence], calibrated=seg.calibrated,
        provenance=seg.provenance,
        preprocessing={
            "original_shape": list(volume.shape),
            "original_spacing_mm": [round(float(s), 3) for s in volume.spacing],
            "processed_shape": list(processed.shape),
            "segmentation_threshold": threshold,
            "segmentation_notes": seg.notes,
        },
    )
    (out_dir / "report.json").write_text(json.dumps(built.to_dict(), indent=2), encoding="utf-8")

    print(f"\n  Impression: {built.impression}")
    print(f"\n  Confidence: detection {built.confidence['detection_confidence']:.3f} "
          f"({built.confidence['detection_confidence_label']}), "
          f"TB pattern {built.confidence['tb_pattern_score']:.3f} "
          f"({built.confidence['tb_pattern_label']})")

    print(f"\n  Limitations:")
    for line in built.limitations[:3]:
        print(f"    - {line}")

    print(f"\n  Written to {out_dir}:")
    print(f"    lesion_mask.nii.gz, probability.nii.gz, brain_mask.nii.gz, preprocessed.nii.gz")
    print(f"    slices/  ({slice_count} PNGs across 3 planes)")
    if scene:
        tris = scene["brain"]["triangle_count"] if scene.get("brain") else 0
        print(f"    scene.json  (brain {tris} triangles, {len(scene['lesions'])} lesion meshes)")
    print(f"    report.json")
    print(f"\n  {time.perf_counter() - started:.0f}s total")
    print("\n  NOT A DIAGNOSIS. Requires review by a qualified clinician.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
