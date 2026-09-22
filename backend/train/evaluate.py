"""Evaluate a trained checkpoint: tune on validation, report on test.

    python backend/train/evaluate.py --tune          # the honest full protocol
    python backend/train/evaluate.py --split val     # sweep validation only
    python backend/train/evaluate.py --threshold 0.5 # fixed threshold on test

PROTOCOL
--------
`--tune` does the only defensible thing:

  1. sweep thresholds on the VALIDATION cases
  2. pick one by validation Dice
  3. apply that single fixed threshold to the TEST cases, once

Sweeping on test and reporting the best result is a leak. It tunes a
hyperparameter on the data used to report the result, and the number that comes
out is optimistic by an amount nobody can quantify afterwards. The test cases
are read from the checkpoint, which recorded them before training began.

Everything here is whole-volume. Patch-level Dice during training is measured on
foreground-biased crops, so the model is never asked to leave an entire brain of
healthy tissue alone: that number is always optimistic and is only fit for
choosing an epoch.

METRICS, AND WHY THESE ONES
---------------------------
Dice is the field's default and is reported for comparability, but on sparse
focal lesions it is dominated by the largest lesion in each case. The numbers
that decide whether a tool is usable in a clinic are:

  per-lesion sensitivity   did it find each lesion, at any overlap
  false positives / case   how often it cries wolf; this is what makes a
                           radiologist switch a tool off
  HD95                     boundary agreement, robust to a single stray voxel
  volume error             whether the cm3 a report prints can be trusted

All are reported, split into small / medium / large, because a model that finds
every 30 mm mass and misses every 5 mm one has a respectable mean Dice and is
useless for miliary disease.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Lesion size bands in mm3. On the 1 mm isotropic cache these are also voxel
# counts. 0.5 cm3 is roughly a 10 mm sphere, 4 cm3 roughly a 20 mm one.
SIZE_BANDS = [
    ("small", "< 0.5 cm3", 0, 500),
    ("medium", "0.5 - 4 cm3", 500, 4000),
    ("large", "> 4 cm3", 4000, 10 ** 9),
]

SWEEP_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, default=BACKEND / "checkpoints" / "unet3d_brats.pt")
    parser.add_argument("--cache", type=Path, default=Path("data/cache/brats_flair"))
    parser.add_argument("--tune", action="store_true",
                        help="Sweep on validation, then apply the chosen threshold once to test")
    parser.add_argument("--split", choices=["val", "test"], default="test")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--no-hd95", action="store_true", help="Skip HD95, the slowest metric")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--min-lesion-mm3", type=float, default=30.0)
    return parser.parse_args()


def connected(mask: np.ndarray):
    return ndimage.label(mask, structure=np.ones((3, 3, 3)))


def surface(mask: np.ndarray) -> np.ndarray:
    """Boundary voxels: inside the mask, with at least one neighbour outside."""
    if not mask.any():
        return mask
    return mask & ~ndimage.binary_erosion(mask, structure=np.ones((3, 3, 3)))


def hd95(pred: np.ndarray, truth: np.ndarray, spacing=(1.0, 1.0, 1.0)) -> float | None:
    """Symmetric 95th-percentile Hausdorff distance, in millimetres.

    From Euclidean distance transforms rather than pairwise point distances: a
    lesion surface runs to tens of thousands of voxels and the O(n*m) form is
    unusable at that size.

    The 95th percentile rather than the maximum, because one stray voxel would
    otherwise dominate the score - which is what makes raw Hausdorff distance
    useless for reporting.

    Undefined when either mask is empty; returns None rather than a number that
    would quietly average in as zero.
    """
    if not pred.any() or not truth.any():
        return None

    pred_surface = surface(pred)
    truth_surface = surface(truth)
    if not pred_surface.any() or not truth_surface.any():
        return None

    # distance_transform_edt measures distance to the nearest ZERO, so each
    # transform runs on the complement of the mask being measured to.
    dt_to_truth = ndimage.distance_transform_edt(~truth, sampling=spacing)
    dt_to_pred = ndimage.distance_transform_edt(~pred, sampling=spacing)

    forward = dt_to_truth[pred_surface]
    backward = dt_to_pred[truth_surface]
    if forward.size == 0 or backward.size == 0:
        return None

    return float(max(np.percentile(forward, 95), np.percentile(backward, 95)))


def band_of(size: int) -> str:
    for key, _, lo, hi in SIZE_BANDS:
        if lo <= size < hi:
            return key
    return SIZE_BANDS[-1][0]


def threshold_mask(prob: np.ndarray, threshold: float, min_voxels: int) -> np.ndarray:
    pred = prob >= threshold
    if not pred.any():
        return pred
    labels, count = connected(pred)
    if not count:
        return np.zeros_like(pred)
    sizes = np.bincount(labels.ravel())
    keep = np.zeros(sizes.shape, dtype=bool)
    keep[1:] = sizes[1:] >= min_voxels
    return keep[labels]


def evaluate_case(prob: np.ndarray, truth: np.ndarray, threshold: float,
                  min_voxels: int, want_hd95: bool = True) -> dict:
    pred = threshold_mask(prob, threshold, min_voxels)

    tp = float(np.logical_and(pred, truth).sum())
    fp = float(np.logical_and(pred, ~truth).sum())
    fn = float(np.logical_and(~pred, truth).sum())

    dice = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) > 0 else 1.0
    iou = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 1.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0

    # Per-lesion detection at any overlap, with a per-lesion Dice so the size
    # bands can report overlap quality and not only whether it was spotted.
    truth_labels, truth_count = connected(truth)
    lesions = []
    for i in range(1, truth_count + 1):
        component = truth_labels == i
        size = int(component.sum())
        overlap = float(np.logical_and(component, pred).sum())
        # Dice of this lesion against whatever the model put on top of it.
        # Denominator uses the lesion plus its overlap only, so a huge false
        # component elsewhere in the brain cannot drag one lesion's score down.
        lesion_dice = 2 * overlap / (size + overlap) if (size + overlap) > 0 else 0.0
        lesions.append({
            "size": size,
            "band": band_of(size),
            "detected": overlap > 0,
            "dice": lesion_dice,
        })

    # Predicted components touching no true lesion at all, bucketed by their own
    # size: a clinician cares whether the spurious calls are specks or masses.
    pred_labels, pred_count = connected(pred)
    false_components = []
    for i in range(1, pred_count + 1):
        component = pred_labels == i
        if not np.logical_and(component, truth).any():
            size = int(component.sum())
            false_components.append({"size": size, "band": band_of(size)})

    return {
        "dice": dice, "iou": iou, "precision": precision, "recall": recall,
        "hd95_mm": hd95(pred, truth) if want_hd95 else None,
        "true_lesions": truth_count,
        "detected_lesions": sum(1 for l in lesions if l["detected"]),
        "false_components": len(false_components),
        "pred_volume_mm3": float(pred.sum()),       # 1 mm isotropic cache
        "true_volume_mm3": float(truth.sum()),
        "lesions": lesions,
        "false_list": false_components,
    }


def summarize(results: list[dict]) -> dict:
    if not results:
        return {}

    dices = np.array([r["dice"] for r in results])
    true_lesions = sum(r["true_lesions"] for r in results)
    detected = sum(r["detected_lesions"] for r in results)
    false_components = sum(r["false_components"] for r in results)
    hd_values = [r["hd95_mm"] for r in results if r.get("hd95_mm") is not None]

    pred_v = np.array([r["pred_volume_mm3"] for r in results])
    true_v = np.array([r["true_volume_mm3"] for r in results])
    valid = true_v > 0
    volume_error = np.abs(pred_v[valid] - true_v[valid]) / true_v[valid]

    return {
        "cases": len(results),
        "dice_mean": round(float(dices.mean()), 4),
        "dice_median": round(float(np.median(dices)), 4),
        "dice_std": round(float(dices.std()), 4),
        "dice_p25": round(float(np.percentile(dices, 25)), 4),
        "dice_p75": round(float(np.percentile(dices, 75)), 4),
        "iou_mean": round(float(np.mean([r["iou"] for r in results])), 4),
        "precision_mean": round(float(np.mean([r["precision"] for r in results])), 4),
        "recall_mean": round(float(np.mean([r["recall"] for r in results])), 4),
        "hd95_mm_median": round(float(np.median(hd_values)), 2) if hd_values else None,
        "hd95_mm_mean": round(float(np.mean(hd_values)), 2) if hd_values else None,
        "hd95_cases_measured": len(hd_values),
        "lesion_sensitivity": round(detected / max(true_lesions, 1), 4),
        "lesions_found": f"{detected}/{true_lesions}",
        "false_components_per_case": round(false_components / max(len(results), 1), 2),
        "volume_error_median": round(float(np.median(volume_error)), 4) if valid.any() else None,
    }


def size_band_table(results: list[dict]) -> dict:
    """Dice, sensitivity and false positives per case, within each size band."""
    bands = {}
    n_cases = max(len(results), 1)

    for key, label, _, _ in SIZE_BANDS:
        lesions = [l for r in results for l in r["lesions"] if l["band"] == key]
        false_in_band = sum(
            1 for r in results for f in r["false_list"] if f["band"] == key
        )
        detected = sum(1 for l in lesions if l["detected"])
        bands[key] = {
            "range": label,
            "lesions": len(lesions),
            "detected": detected,
            "sensitivity": round(detected / len(lesions), 4) if lesions else None,
            # Mean per-lesion Dice over lesions in this band, including missed
            # ones (which score 0) - excluding them would report the quality of
            # the detections while hiding the misses.
            "dice": round(float(np.mean([l["dice"] for l in lesions])), 4) if lesions else None,
            "false_positives_per_case": round(false_in_band / n_cases, 2),
        }
    return bands


def main() -> int:
    args = parse_args()

    try:
        import torch
    except ImportError:
        print("PyTorch is not installed.")
        return 1

    from app.pipeline.nets import UNet3D
    from app.pipeline.segmentation import _gaussian_window, _tile_starts

    if not args.checkpoint.exists():
        print(f"No checkpoint at {args.checkpoint}")
        return 1

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    # Always deserialise to CPU, then move the model; loading straight to a
    # CUDA device fails when the saved tensors name a device this host lacks.
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    config = state["config"]

    model = UNet3D(
        in_channels=config.get("in_channels", 1), out_channels=1,
        base_channels=config.get("base_channels", 16),
        depth=config.get("depth", 4), attention=config.get("attention", False),
    ).to(device)
    model.load_state_dict(state["model"])
    model.eval()

    patch = tuple(config.get("patch_size", (96, 96, 96)))
    min_voxels = max(int(args.min_lesion_mm3), 3)

    print(f"Checkpoint : {args.checkpoint.name}  (epoch {config.get('epochs')})")
    print(f"Trained on : {config.get('pathology', config.get('trained_on'))}")
    print(f"Device     : {device}   patch {patch}\n")

    def infer(volume: np.ndarray) -> np.ndarray:
        """Sliding window, Gaussian blending, 3-flip test-time augmentation.

        Identical to the inference the API runs, so these numbers describe the
        deployed path and not a friendlier evaluation-only variant.
        """
        accum = np.zeros(volume.shape, dtype=np.float32)
        weights = np.zeros(volume.shape, dtype=np.float32)
        window = _gaussian_window(patch)
        strides = [max(int(p * 0.5), 1) for p in patch]
        starts = [_tile_starts(d, p, s) for d, p, s in zip(volume.shape, patch, strides)]

        with torch.no_grad():
            for x in starts[0]:
                for y in starts[1]:
                    for z in starts[2]:
                        sl = (slice(x, x + patch[0]), slice(y, y + patch[1]), slice(z, z + patch[2]))
                        chunk = volume[sl]
                        padded = np.zeros(patch, dtype=np.float32)
                        padded[:chunk.shape[0], :chunk.shape[1], :chunk.shape[2]] = chunk

                        tensor = torch.from_numpy(padded)[None, None].to(device)
                        logits = model(tensor)
                        for axis in (2, 3, 4):
                            logits = logits + torch.flip(model(torch.flip(tensor, [axis])), [axis])
                        pred = torch.sigmoid(logits / 4.0)[0, 0].cpu().numpy()

                        region = tuple(slice(0, d) for d in chunk.shape)
                        accum[sl] += (pred * window)[region]
                        weights[sl] += window[region]

        return np.divide(accum, weights, out=np.zeros_like(accum), where=weights > 0)

    def probabilities_for(case_names: list[str], label: str) -> list[tuple[str, np.ndarray, np.ndarray]]:
        """Run inference once per case; thresholds are applied afterwards.

        Inference is the expensive part, so the probability map is computed once
        and every threshold in the sweep reuses it.
        """
        out = []
        started = time.perf_counter()
        for i, case in enumerate(case_names, 1):
            path = args.cache / f"{case}_image.npy"
            if not path.exists():
                continue
            volume = np.load(path).astype(np.float32)
            truth = np.load(args.cache / f"{case}_label.npy").astype(bool)
            brain = np.load(args.cache / f"{case}_brain.npy").astype(bool)

            prob = infer(volume)
            prob[~brain] = 0.0
            out.append((case, prob, truth))

            if i % 10 == 0 or i == len(case_names):
                elapsed = time.perf_counter() - started
                print(f"    {label}: {i}/{len(case_names)}  "
                      f"({elapsed:.0f}s, {elapsed / i:.1f}s/case)")
        return out

    def sweep(cases_probs, want_hd95: bool = False) -> dict[float, dict]:
        table = {}
        for t in SWEEP_THRESHOLDS:
            results = [
                {"case": case, **evaluate_case(prob, truth, t, min_voxels, want_hd95)}
                for case, prob, truth in cases_probs
            ]
            table[t] = {"summary": summarize(results), "results": results}
        return table

    def print_sweep(table: dict[float, dict], title: str) -> None:
        print(f"\n  {title}")
        print(f"    {'thr':>5}  {'Dice':>7}  {'Sens':>7}  {'Prec':>7}  {'FP/case':>8}")
        print(f"    {'-' * 5}  {'-' * 7}  {'-' * 7}  {'-' * 7}  {'-' * 8}")
        for t in SWEEP_THRESHOLDS:
            s = table[t]["summary"]
            print(f"    {t:>5.1f}  {s['dice_mean']:>7.4f}  {s['lesion_sensitivity']:>7.4f}  "
                  f"{s['precision_mean']:>7.4f}  {s['false_components_per_case']:>8.2f}")

    # ---------------------------------------------------------------- protocol
    chosen_threshold = args.threshold
    val_sweep_json = None

    if args.tune:
        val_cases = config.get("val_cases", [])
        if args.limit:
            val_cases = val_cases[: args.limit]

        print(f"STEP 1 - threshold sweep on {len(val_cases)} VALIDATION cases")
        print("         (the test set is not touched here)\n")
        val_probs = probabilities_for(val_cases, "val")
        if not val_probs:
            print("No validation cases found in the cache.")
            return 1

        val_table = sweep(val_probs)
        print_sweep(val_table, f"Validation sweep ({len(val_probs)} cases)")

        chosen_threshold = max(
            SWEEP_THRESHOLDS, key=lambda t: val_table[t]["summary"]["dice_mean"]
        )
        best = val_table[chosen_threshold]["summary"]
        print(f"\n  Chosen threshold: {chosen_threshold}  "
              f"(validation Dice {best['dice_mean']:.4f}, "
              f"sens {best['lesion_sensitivity']:.4f}, "
              f"FP/case {best['false_components_per_case']:.2f})")

        val_sweep_json = {str(t): val_table[t]["summary"] for t in SWEEP_THRESHOLDS}

        # Write the operating point into the checkpoint so inference uses it
        # without anyone having to remember to pass --threshold. Only the
        # config is touched; the weights are rewritten byte-identical.
        state["config"]["operating_threshold"] = float(chosen_threshold)
        state["config"]["threshold_tuned_on"] = (
            f"{len(val_probs)} validation cases (Dice-optimal of "
            f"{SWEEP_THRESHOLDS[0]}-{SWEEP_THRESHOLDS[-1]})"
        )
        torch.save(state, args.checkpoint)
        print(f"  Wrote operating_threshold={chosen_threshold} into {args.checkpoint.name}")

        del val_probs, val_table

    test_cases = config.get("test_cases", []) if args.split == "test" or args.tune \
        else config.get("val_cases", [])
    if args.limit:
        test_cases = test_cases[: args.limit]

    header = "STEP 2 - " if args.tune else ""
    split_name = "TEST" if (args.tune or args.split == "test") else "VALIDATION"
    print(f"\n{header}final evaluation on {len(test_cases)} {split_name} cases "
          f"at the single fixed threshold {chosen_threshold}\n")

    test_probs = probabilities_for(test_cases, split_name.lower())
    if not test_probs:
        print("No cases found in the cache.")
        return 1

    main_results = [
        {"case": case, **evaluate_case(prob, truth, chosen_threshold, min_voxels,
                                       want_hd95=not args.no_hd95)}
        for case, prob, truth in test_probs
    ]

    summary = summarize(main_results)
    bands = size_band_table(main_results)

    print(f"\n{'=' * 66}")
    print(f"{split_name} RESULTS - {summary['cases']} unseen patients, threshold {chosen_threshold}")
    print("=" * 66)
    print(f"  {'Metric':<26} {'Result':>14}")
    print(f"  {'-' * 26} {'-' * 14}")
    print(f"  {'Dice':<26} {summary['dice_mean']:>14.4f}   +/- {summary['dice_std']:.4f}")
    print(f"  {'IoU':<26} {summary['iou_mean']:>14.4f}")
    print(f"  {'Lesion sensitivity':<26} {summary['lesion_sensitivity']:>14.4f}   ({summary['lesions_found']})")
    print(f"  {'False positives / case':<26} {summary['false_components_per_case']:>14.2f}")
    if summary["hd95_mm_median"] is not None:
        print(f"  {'HD95 (mm)':<26} {summary['hd95_mm_median']:>14.2f}   "
              f"({summary['hd95_cases_measured']}/{summary['cases']} measurable)")
    else:
        print(f"  {'HD95 (mm)':<26} {'n/a':>14}")
    print(f"  {'Voxel precision':<26} {summary['precision_mean']:>14.4f}")
    print(f"  {'Voxel recall':<26} {summary['recall_mean']:>14.4f}")
    print(f"  {'Dice median':<26} {summary['dice_median']:>14.4f}   "
          f"(IQR {summary['dice_p25']:.3f}-{summary['dice_p75']:.3f})")
    if summary["volume_error_median"] is not None:
        print(f"  {'Median volume error':<26} {summary['volume_error_median'] * 100:>13.1f}%")

    print(f"\n  Lesion size analysis")
    print(f"    {'band':<20} {'Dice':>7}  {'Sens':>7}  {'FP/case':>8}  {'lesions':>8}")
    print(f"    {'-' * 20} {'-' * 7}  {'-' * 7}  {'-' * 8}  {'-' * 8}")
    for key, label, _, _ in SIZE_BANDS:
        b = bands[key]
        dice_s = f"{b['dice']:.4f}" if b["dice"] is not None else "-"
        sens_s = f"{b['sensitivity']:.4f}" if b["sensitivity"] is not None else "-"
        count_s = f"{b['detected']}/{b['lesions']}" if b["lesions"] else "none"
        print(f"    {key + ' ' + label:<20} {dice_s:>7}  {sens_s:>7}  "
              f"{b['false_positives_per_case']:>8.2f}  {count_s:>8}")

    report = {
        "checkpoint": str(args.checkpoint),
        "epoch": config.get("epochs"),
        "trained_on": config.get("trained_on"),
        "pathology": config.get("pathology"),
        "not_tuberculosis": config.get("not_tuberculosis", True),
        "protocol": (
            "threshold tuned on validation, applied once to test"
            if args.tune else f"fixed threshold on {split_name.lower()}"
        ),
        "threshold": chosen_threshold,
        "validation_sweep": val_sweep_json,
        "summary": summary,
        "size_bands": bands,
        "per_case": [
            {k: v for k, v in r.items() if k not in ("lesions", "false_list")}
            for r in main_results
        ],
        "caveat": (
            "Measured on held-out glioma cases from BraTS 2024. These numbers describe "
            "performance on glioma, not on tuberculosis. Good small-lesion performance "
            "here is NOT evidence that the model detects tuberculomas: it has never "
            "seen one."
        ),
    }
    out_path = args.out or args.checkpoint.with_suffix(".eval.json")
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nReport: {out_path}")
    print("\nThese are GLIOMA numbers. They say nothing about tuberculosis.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
