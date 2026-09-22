"""2D slice rendering for the MRI viewer panel.

Radiologists read slices, not surfaces. The 3D view answers "where and how much";
the slice view is where anyone actually checks whether a segmentation is right.
So each analysis ships greyscale slices in all three planes with two overlays:
the segmentation contour, and the probability heatmap that explains it.

PNGs are encoded with zlib and struct directly -- Pillow is not a dependency, and
what is needed here is a fraction of what it does.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np
from scipy import ndimage

from .volume import Volume

PLANES = ("axial", "coronal", "sagittal")

# Axis indices per plane depend on orientation; resolved from the affine at call
# time via the anatomical frame, so oddly-oriented scans still display correctly.
_HEATMAP_STOPS = np.array([
    [0.00, 0, 0, 0],
    [0.35, 40, 10, 90],
    [0.55, 160, 30, 90],
    [0.75, 240, 110, 30],
    [1.00, 255, 245, 160],
], dtype=np.float64)


def render_study_slices(
    vol: Volume,
    probability: np.ndarray,
    mask: np.ndarray,
    brain_mask: np.ndarray,
    out_dir: Path,
    count_per_plane: int = 9,
) -> dict:
    """Render slice sets for all three planes. Returns a manifest of relative paths."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    from .atlas import build_frame
    frame = build_frame(vol.affine, brain_mask)
    axis_for = {
        "axial": frame.axis_of["z"],
        "coronal": frame.axis_of["y"],
        "sagittal": frame.axis_of["x"],
    }

    manifest: dict[str, list[dict]] = {}
    for plane in PLANES:
        axis = axis_for[plane]
        indices = _pick_slices(mask, brain_mask, axis, count_per_plane)
        entries = []
        for index in indices:
            base = f"{plane}_{index:03d}"
            grey = _take(vol.data, axis, index)
            prob = _take(probability, axis, index)
            seg = _take(mask, axis, index)

            _write_png(out_dir / f"{base}.png", _to_rgb(_window(grey)))
            _write_png(out_dir / f"{base}_overlay.png", _overlay_contour(_window(grey), seg))
            _write_png(out_dir / f"{base}_heatmap.png", _overlay_heatmap(_window(grey), prob))

            entries.append({
                "index": int(index),
                "image": f"{base}.png",
                "overlay": f"{base}_overlay.png",
                "heatmap": f"{base}_heatmap.png",
                "has_lesion": bool(seg.any()),
                "lesion_area_mm2": round(float(seg.sum() * _in_plane_area(vol, axis)), 2),
            })
        manifest[plane] = entries

    return manifest


def _pick_slices(mask: np.ndarray, brain_mask: np.ndarray, axis: int, count: int) -> list[int]:
    """Prefer slices that contain lesion; fall back to spreading across the brain.

    Showing nine empty slices when the finding is on slice 62 would be useless,
    so lesion-bearing slices are always included first.
    """
    other = tuple(a for a in range(3) if a != axis)
    lesion_per_slice = mask.sum(axis=other)
    brain_per_slice = brain_mask.sum(axis=other)

    lesion_slices = np.flatnonzero(lesion_per_slice > 0)
    if lesion_slices.size:
        ranked = lesion_slices[np.argsort(-lesion_per_slice[lesion_slices])]
        chosen = set(int(i) for i in ranked[:count])
    else:
        chosen = set()

    if len(chosen) < count:
        valid = np.flatnonzero(brain_per_slice > brain_per_slice.max() * 0.15) \
            if brain_per_slice.max() > 0 else np.arange(mask.shape[axis])
        if valid.size:
            spread = np.linspace(valid[0], valid[-1], count - len(chosen) + 2)[1:-1]
            chosen.update(int(round(s)) for s in spread)

    return sorted(chosen)[:count] or [mask.shape[axis] // 2]


def _take(data: np.ndarray, axis: int, index: int) -> np.ndarray:
    """Extract a slice and orient it for display (radiological convention-ish)."""
    index = int(np.clip(index, 0, data.shape[axis] - 1))
    sl = np.take(data, index, axis=axis)
    return np.flipud(sl.T)


def _in_plane_area(vol: Volume, axis: int) -> float:
    spacing = vol.spacing
    other = [a for a in range(3) if a != axis]
    return float(spacing[other[0]] * spacing[other[1]])


def _window(slice_2d: np.ndarray) -> np.ndarray:
    """Window to the 1st-99th percentile of non-background, as uint8."""
    data = np.nan_to_num(slice_2d.astype(np.float32))
    signal = data[data != 0]
    if signal.size < 4:
        return np.zeros(data.shape, dtype=np.uint8)
    lo, hi = np.percentile(signal, [1, 99])
    if hi - lo < 1e-6:
        return np.zeros(data.shape, dtype=np.uint8)
    return (np.clip((data - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)


def _to_rgb(grey: np.ndarray) -> np.ndarray:
    return np.repeat(grey[:, :, None], 3, axis=2)


def _overlay_contour(grey: np.ndarray, seg: np.ndarray) -> np.ndarray:
    """Draw the segmentation boundary rather than a filled blob.

    A filled overlay hides the very pixels the reader needs to judge the contour.
    """
    rgb = _to_rgb(grey).astype(np.float32)
    if not seg.any():
        return rgb.astype(np.uint8)

    seg = seg.astype(bool)
    boundary = seg & ~ndimage.binary_erosion(seg, structure=np.ones((3, 3)))
    boundary = ndimage.binary_dilation(boundary, structure=np.ones((2, 2)))

    rgb[seg] = rgb[seg] * 0.75 + np.array([64.0, 12.0, 12.0])   # faint interior tint
    rgb[boundary] = np.array([255.0, 82.0, 82.0])
    return np.clip(rgb, 0, 255).astype(np.uint8)


def _overlay_heatmap(grey: np.ndarray, prob: np.ndarray, floor: float = 0.15) -> np.ndarray:
    """Blend the probability map over the greyscale as an explainability layer."""
    rgb = _to_rgb(grey).astype(np.float32)
    p = np.clip(np.nan_to_num(prob.astype(np.float32)), 0, 1)
    visible = p > floor
    if not visible.any():
        return rgb.astype(np.uint8)

    colour = _colormap(p)
    alpha = np.clip((p - floor) / (1 - floor), 0, 1)[:, :, None] * 0.8
    blended = rgb * (1 - alpha) + colour * alpha
    return np.clip(blended, 0, 255).astype(np.uint8)


def _colormap(values: np.ndarray) -> np.ndarray:
    """Perceptually-ordered dark-to-bright ramp, interpolated from the stop table."""
    stops = _HEATMAP_STOPS
    out = np.zeros(values.shape + (3,), dtype=np.float32)
    for channel in range(3):
        out[:, :, channel] = np.interp(values, stops[:, 0], stops[:, channel + 1])
    return out


def _write_png(path: Path, rgb: np.ndarray) -> Path:
    """Minimal PNG encoder (8-bit RGB, no interlace)."""
    height, width = rgb.shape[:2]
    raw = b"".join(
        b"\x00" + rgb[row].astype(np.uint8).tobytes() for row in range(height)
    )

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return path
