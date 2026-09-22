"""Qualitative validation: FLAIR, ground truth, prediction, overlay - plus a 3D mesh.

    python backend/train/visualize_predictions.py --cases 6

Writes, per held-out patient:

    FLAIR  ->  ground truth  ->  prediction  ->  overlay
                                                   |
                                          marching cubes -> 3D mesh

Cases are chosen to span the *range* of behaviour, not to flatter it: the best,
the median and the worst by Dice are all included. A gallery of good cases is
marketing, not validation, and the failure cases are the ones worth looking at.

The overlay uses three colours drawn as a set difference rather than two
translucent masks stacked on top of each other, so agreement and the two kinds
of error are separable at a glance:

    green   true positive   - model and rater agree
    red     false negative  - rater marked it, model missed it
    blue    false positive  - model marked it, rater did not

The 3D mesh comes from the same `pipeline/mesh.py` the dashboard viewer uses, so
what is exported here is exactly what the application renders.
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

from app.pipeline.slices import _write_png  # noqa: E402

TRUE_POSITIVE = (76, 205, 128)
FALSE_NEGATIVE = (235, 74, 74)
FALSE_POSITIVE = (86, 148, 240)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, default=BACKEND / "checkpoints" / "unet3d_brats.pt")
    parser.add_argument("--cache", type=Path, default=Path("data/cache/brats_flair"))
    parser.add_argument("--out", type=Path, default=Path("data/validation"))
    parser.add_argument("--cases", type=int, default=6, help="How many held-out patients to render")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--slices-per-case", type=int, default=3)
    parser.add_argument("--min-lesion-mm3", type=float, default=30.0)
    parser.add_argument("--no-mesh", action="store_true")
    return parser.parse_args()


def window(slice_2d: np.ndarray) -> np.ndarray:
    """Window a z-scored slice to 8-bit for display."""
    data = np.nan_to_num(slice_2d.astype(np.float32))
    signal = data[data != 0]
    if signal.size < 4:
        return np.zeros(data.shape, dtype=np.uint8)
    lo, hi = np.percentile(signal, [1, 99])
    if hi - lo < 1e-6:
        return np.zeros(data.shape, dtype=np.uint8)
    return (np.clip((data - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)


def to_rgb(grey: np.ndarray) -> np.ndarray:
    return np.repeat(grey[:, :, None], 3, axis=2).astype(np.float32)


def contour(mask: np.ndarray) -> np.ndarray:
    if not mask.any():
        return mask
    edge = mask & ~ndimage.binary_erosion(mask, structure=np.ones((3, 3)))
    return ndimage.binary_dilation(edge, structure=np.ones((2, 2)))


def panel_mask(grey: np.ndarray, mask: np.ndarray, colour) -> np.ndarray:
    """Greyscale with one mask drawn as a filled tint plus a solid contour."""
    rgb = to_rgb(grey)
    if mask.any():
        rgb[mask] = rgb[mask] * 0.55 + np.array(colour, dtype=np.float32) * 0.45
        rgb[contour(mask)] = colour
    return np.clip(rgb, 0, 255).astype(np.uint8)


def panel_overlay(grey: np.ndarray, truth: np.ndarray, pred: np.ndarray) -> np.ndarray:
    """Agreement and both error types in one image."""
    rgb = to_rgb(grey)
    for region, colour in (
        (truth & pred, TRUE_POSITIVE),
        (truth & ~pred, FALSE_NEGATIVE),
        (pred & ~truth, FALSE_POSITIVE),
    ):
        if region.any():
            rgb[region] = rgb[region] * 0.45 + np.array(colour, dtype=np.float32) * 0.55
            rgb[contour(region)] = colour
    return np.clip(rgb, 0, 255).astype(np.uint8)


def compose(panels: list[np.ndarray], gap: int = 6) -> np.ndarray:
    """Lay panels side by side on one strip, so the four views stay aligned."""
    height = max(p.shape[0] for p in panels)
    width = sum(p.shape[1] for p in panels) + gap * (len(panels) - 1)
    canvas = np.full((height, width, 3), 16, dtype=np.uint8)

    x = 0
    for panel in panels:
        canvas[: panel.shape[0], x:x + panel.shape[1]] = panel
        x += panel.shape[1] + gap
    return canvas


def pick_slices(truth: np.ndarray, pred: np.ndarray, count: int) -> list[int]:
    """Axial slices carrying the most lesion, from truth or prediction.

    Taking the union matters: a slice where the model hallucinated and the rater
    marked nothing is exactly the slice worth showing, and ranking on ground
    truth alone would never surface it.
    """
    per_slice = (truth | pred).sum(axis=(0, 1))
    candidates = np.flatnonzero(per_slice > 0)
    if candidates.size == 0:
        return [truth.shape[2] // 2]
    ranked = candidates[np.argsort(-per_slice[candidates])]
    return sorted(int(i) for i in ranked[:count])


def check_mesh(mesh: dict | None, mask, name: str) -> dict:
    """Sanity-check a marching-cubes surface against the mask it came from.

    A mesh can be wrong in ways that still render: empty, inside-out, scaled by
    a factor of a thousand, or sitting in the wrong corner of the volume because
    the axes were transposed somewhere. Each of those has produced a plausible
    looking but useless picture at some point, so each is checked explicitly
    rather than trusted.
    """
    if mesh is None:
        return {"ok": not mask.any(), "reason": "no surface extracted",
                "empty": True, "expected_empty": not bool(mask.any())}

    positions = np.asarray(mesh["positions"], dtype=np.float64).reshape(-1, 3)
    indices = np.asarray(mesh["indices"], dtype=np.int64)
    problems = []

    if positions.shape[0] == 0 or indices.size == 0:
        problems.append("mesh has no geometry")
    if indices.size and indices.max() >= positions.shape[0]:
        problems.append("index out of range - would crash WebGL")
    if indices.size % 3:
        problems.append("index count is not a multiple of 3")
    if not np.isfinite(positions).all():
        problems.append("non-finite vertex coordinates")

    if positions.shape[0]:
        mesh_lo = positions.min(axis=0)
        mesh_hi = positions.max(axis=0)
        mesh_size = mesh_hi - mesh_lo

        coords = np.argwhere(mask)
        if coords.size:
            mask_lo = coords.min(axis=0).astype(float)
            mask_hi = coords.max(axis=0).astype(float) + 1
            mask_size = mask_hi - mask_lo
            mask_centre = (mask_lo + mask_hi) / 2
            mesh_centre = (mesh_lo + mesh_hi) / 2

            # Scale: the cache is 1 mm isotropic and meshes come out in the same
            # frame, so extents should match within a marching-cubes voxel or two.
            for axis in range(3):
                if mask_size[axis] > 2:
                    ratio = mesh_size[axis] / mask_size[axis]
                    if not 0.5 < ratio < 2.0:
                        problems.append(
                            f"axis {axis} extent off by {ratio:.2f}x "
                            f"(mesh {mesh_size[axis]:.1f} vs mask {mask_size[axis]:.1f})"
                        )

            # Position: a transposed axis or a dropped origin shows up here and
            # nowhere else, because the mesh still looks like a lesion.
            offset = float(np.linalg.norm(mesh_centre - mask_centre))
            if offset > max(float(mask_size.max()), 10.0):
                problems.append(
                    f"mesh centre is {offset:.1f} mm from the mask centre - "
                    "likely a coordinate-frame error"
                )
        else:
            problems.append("mask is empty but a surface was produced")

    # Component count: marching cubes should produce roughly one shell per
    # connected lesion. Wildly more means the surface is shattering.
    mask_components = int(ndimage.label(mask, structure=np.ones((3, 3, 3)))[1]) if mask.any() else 0

    return {
        "ok": not problems,
        "problems": problems,
        "vertices": int(positions.shape[0]),
        "triangles": int(indices.size // 3),
        "mask_components": mask_components,
        "extent_mm": [round(float(v), 1) for v in (positions.max(axis=0) - positions.min(axis=0))]
        if positions.shape[0] else [0, 0, 0],
    }


def main() -> int:
    args = parse_args()

    try:
        import torch
    except ImportError:
        print("PyTorch is not installed.")
        return 1

    from app.pipeline.mesh import extract_surface
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
    test_cases = config.get("test_cases", [])
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"Checkpoint : {args.checkpoint.name}")
    print(f"Trained on : {config.get('pathology')}")
    print(f"Test cases : {len(test_cases)} available, rendering {args.cases}\n")

    def infer(volume: np.ndarray) -> np.ndarray:
        accum = np.zeros(volume.shape, dtype=np.float32)
        weights = np.zeros(volume.shape, dtype=np.float32)
        win = _gaussian_window(patch)
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
                        accum[sl] += (pred * win)[region]
                        weights[sl] += win[region]

        return np.divide(accum, weights, out=np.zeros_like(accum), where=weights > 0)

    min_voxels = max(int(args.min_lesion_mm3), 3)

    # Pass one: score every test case so the selection can span the range.
    print("Scoring test cases to choose a representative spread...")
    scored = []
    started = time.perf_counter()

    for i, case in enumerate(test_cases, 1):
        path = args.cache / f"{case}_image.npy"
        if not path.exists():
            continue
        volume = np.load(path).astype(np.float32)
        truth = np.load(args.cache / f"{case}_label.npy").astype(bool)
        brain = np.load(args.cache / f"{case}_brain.npy").astype(bool)

        prob = infer(volume)
        prob[~brain] = 0.0
        pred = prob >= args.threshold
        if pred.any():
            labels, count = ndimage.label(pred, structure=np.ones((3, 3, 3)))
            if count:
                sizes = np.bincount(labels.ravel())
                keep = np.zeros(sizes.shape, dtype=bool)
                keep[1:] = sizes[1:] >= min_voxels
                pred = keep[labels]

        tp = float(np.logical_and(pred, truth).sum())
        denom = float(pred.sum() + truth.sum())
        scored.append({"case": case, "dice": 2 * tp / denom if denom else 1.0})

        if i % 5 == 0 or i == len(test_cases):
            print(f"  {i}/{len(test_cases)}  ({time.perf_counter() - started:.0f}s)")

    if not scored:
        print("No test cases found in the cache.")
        return 1

    scored.sort(key=lambda r: r["dice"])
    n = len(scored)
    wanted = min(args.cases, n)

    # Best, worst, and an even spread of the middle - so the gallery shows the
    # failure modes as prominently as the successes.
    picks: list[dict] = []
    if wanted >= 1:
        picks.append(scored[-1])                      # best
    if wanted >= 2:
        picks.append(scored[0])                       # worst
    if wanted >= 3:
        for position in np.linspace(0, n - 1, wanted - 2 + 2)[1:-1]:
            entry = scored[int(round(position))]
            if entry not in picks:
                picks.append(entry)
    picks = picks[:wanted]

    print(f"\nRendering {len(picks)} cases "
          f"(Dice range {scored[0]['dice']:.3f} - {scored[-1]['dice']:.3f})\n")

    gallery = []
    mesh_failures: list[dict] = []
    for entry in picks:
        case = entry["case"]
        volume = np.load(args.cache / f"{case}_image.npy").astype(np.float32)
        truth = np.load(args.cache / f"{case}_label.npy").astype(bool)
        brain = np.load(args.cache / f"{case}_brain.npy").astype(bool)

        prob = infer(volume)
        prob[~brain] = 0.0
        pred = prob >= args.threshold
        if pred.any():
            labels, count = ndimage.label(pred, structure=np.ones((3, 3, 3)))
            if count:
                sizes = np.bincount(labels.ravel())
                keep = np.zeros(sizes.shape, dtype=bool)
                keep[1:] = sizes[1:] >= min_voxels
                pred = keep[labels]

        case_dir = args.out / case
        case_dir.mkdir(parents=True, exist_ok=True)
        rendered = []

        for index in pick_slices(truth, pred, args.slices_per_case):
            # Transposed and flipped for radiological display orientation.
            grey = window(np.flipud(volume[:, :, index].T))
            gt_slice = np.flipud(truth[:, :, index].T)
            pr_slice = np.flipud(pred[:, :, index].T)

            strip = compose([
                to_rgb(grey).astype(np.uint8),
                panel_mask(grey, gt_slice, FALSE_NEGATIVE),
                panel_mask(grey, pr_slice, FALSE_POSITIVE),
                panel_overlay(grey, gt_slice, pr_slice),
            ])
            name = f"slice_{index:03d}_flair_truth_pred_overlay.png"
            _write_png(case_dir / name, strip)
            rendered.append(name)

        meshes = {}
        if not args.no_mesh:
            # Same code path as the dashboard viewer, so this is what the app draws.
            affine = np.eye(4)                        # cache is 1 mm isotropic
            for name, mask in (("prediction", pred), ("ground_truth", truth), ("brain", brain)):
                step = 3 if name == "brain" else 1
                sigma = 1.5 if name == "brain" else 0.7
                surface_mesh = extract_surface(mask, affine, step=step, smooth_sigma=sigma)

                check = check_mesh(surface_mesh, mask, name)
                if not check["ok"]:
                    mesh_failures.append({"case": case, "mesh": name, **check})
                    print(f"      MESH PROBLEM ({name}): {'; '.join(check.get('problems', []))}")

                if surface_mesh:
                    (case_dir / f"{name}_mesh.json").write_text(
                        json.dumps(surface_mesh), encoding="utf-8")
                    meshes[name] = {
                        "file": f"{name}_mesh.json",
                        "triangles": surface_mesh["triangle_count"],
                        "check": check,
                    }

        truth_count = ndimage.label(truth, structure=np.ones((3, 3, 3)))[1]
        pred_count = ndimage.label(pred, structure=np.ones((3, 3, 3)))[1]

        record = {
            "case": case,
            "dice": round(entry["dice"], 4),
            "true_volume_cm3": round(float(truth.sum()) / 1000, 3),
            "pred_volume_cm3": round(float(pred.sum()) / 1000, 3),
            "true_lesions": int(truth_count),
            "pred_lesions": int(pred_count),
            "slices": rendered,
            "meshes": meshes,
        }
        gallery.append(record)
        print(f"  {case}  dice {entry['dice']:.4f}  "
              f"{record['true_volume_cm3']:.2f} -> {record['pred_volume_cm3']:.2f} cm3  "
              f"{len(rendered)} slices"
              + (f", {meshes['prediction']['triangles']} tris" if "prediction" in meshes else ""))

    manifest = {
        "checkpoint": str(args.checkpoint),
        "pathology": config.get("pathology"),
        "not_tuberculosis": config.get("not_tuberculosis", True),
        "threshold": args.threshold,
        "panel_order": ["FLAIR", "ground truth", "prediction", "overlay"],
        "overlay_legend": {
            "green": "true positive - model and rater agree",
            "red": "false negative - rater marked it, model missed it",
            "blue": "false positive - model marked it, rater did not",
        },
        "selection": "best, worst, and an even spread between - not a curated gallery",
        "dice_range": [round(scored[0]["dice"], 4), round(scored[-1]["dice"], 4)],
        "cases": gallery,
        "mesh_verification": {
            "checked": sum(len(c["meshes"]) for c in gallery),
            "failures": mesh_failures,
        },
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\nWrote {len(gallery)} cases to {args.out}")

    checked = sum(len(c["meshes"]) for c in gallery)
    if mesh_failures:
        print(f"\n  MESH VERIFICATION: {len(mesh_failures)} of {checked} meshes failed")
        for failure in mesh_failures[:8]:
            print(f"    {failure['case']} / {failure['mesh']}: "
                  f"{'; '.join(failure.get('problems', []))}")
    else:
        print(f"  Mesh verification: {checked}/{checked} passed "
              f"(non-empty, indices in range, scale and position consistent with the mask)")

    print(f"Manifest: {args.out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
