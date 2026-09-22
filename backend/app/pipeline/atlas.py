"""Approximate anatomical localization.

A real deployment should register the scan to MNI152 and read labels out of the
Harvard-Oxford or AAL atlas. That needs atlas files and a nonlinear registration
step, so this module instead divides the brain's own bounding box into anatomical
zones using normalized left-right / posterior-anterior / inferior-superior
coordinates derived from the affine.

It is approximate by construction, and every label it produces is marked as such
so the report never overstates what it knows. `label_lesion` is the seam to
replace: give it a real atlas lookup and the rest of the system is unchanged.

TB has characteristic sites -- basal meninges, corticomedullary junction, and the
cerebellum -- so the zone set is chosen to make those distinguishable.
"""

from __future__ import annotations

from dataclasses import dataclass

import nibabel as nib
import numpy as np

ATLAS_NAME = "geometric-zones-v1 (approximate)"


@dataclass
class AnatomicalFrame:
    """Maps voxel indices to normalized anatomical coordinates in [0, 1].

    x: left (0) -> right (1)
    y: posterior (0) -> anterior (1)
    z: inferior (0) -> superior (1)
    """

    axis_of: dict[str, int]
    flip: dict[str, bool]
    lower: np.ndarray
    extent: np.ndarray

    def normalize(self, ijk: np.ndarray) -> np.ndarray:
        ijk = np.atleast_2d(np.asarray(ijk, dtype=np.float64))
        out = np.zeros((ijk.shape[0], 3))
        for k, key in enumerate("xyz"):
            axis = self.axis_of[key]
            value = (ijk[:, axis] - self.lower[axis]) / self.extent[axis]
            out[:, k] = 1.0 - value if self.flip[key] else value
        return np.clip(out, 0.0, 1.0)


def build_frame(affine: np.ndarray, brain_mask: np.ndarray) -> AnatomicalFrame:
    """Derive the anatomical frame from the affine plus the brain's bounding box."""
    codes = nib.aff2axcodes(affine)          # e.g. ("R", "A", "S") or ("L", "P", "S")

    axis_of: dict[str, int] = {}
    flip: dict[str, bool] = {}
    for axis, code in enumerate(codes):
        if code in ("R", "L"):
            axis_of["x"], flip["x"] = axis, code == "L"
        elif code in ("A", "P"):
            axis_of["y"], flip["y"] = axis, code == "P"
        elif code in ("S", "I"):
            axis_of["z"], flip["z"] = axis, code == "I"

    # Degenerate/oblique affine: fall back to the common radiological ordering.
    for key, default in (("x", 0), ("y", 1), ("z", 2)):
        axis_of.setdefault(key, default)
        flip.setdefault(key, False)

    if brain_mask.any():
        coords = np.argwhere(brain_mask)
        lower = coords.min(axis=0).astype(np.float64)
        upper = coords.max(axis=0).astype(np.float64)
    else:
        lower = np.zeros(3)
        upper = np.asarray(brain_mask.shape, dtype=np.float64) - 1

    extent = np.maximum(upper - lower, 1.0)
    return AnatomicalFrame(axis_of=axis_of, flip=flip, lower=lower, extent=extent)


def label_lesion(frame: AnatomicalFrame, centroid_ijk: np.ndarray) -> dict[str, str]:
    """Return region, lobe, and side for a lesion centroid."""
    x, y, z = frame.normalize(centroid_ijk)[0]

    if x < 0.45:
        side = "left"
    elif x > 0.55:
        side = "right"
    else:
        side = "midline"

    region = _zone(x, y, z)
    return {
        "region": region,
        "side": side,
        "lobe": _LOBE_OF.get(region, "unspecified"),
        "atlas": ATLAS_NAME,
        "normalized_coords": f"({x:.2f}, {y:.2f}, {z:.2f})",
    }


def _zone(x: float, y: float, z: float) -> str:
    """Assign one anatomical zone from normalized coordinates.

    Order matters: infratentorial and deep structures are tested before the
    cortical lobes, because a cerebellar lesion also sits inside the posterior
    part of the bounding box.
    """
    midline_dist = abs(x - 0.5)

    # Infratentorial: posterior and low.
    if z < 0.32 and y < 0.42:
        return "brainstem" if midline_dist < 0.10 else "cerebellum"

    # Deep grey nuclei: central in all three axes.
    if midline_dist < 0.22 and 0.35 < y < 0.62 and 0.35 < z < 0.62:
        return "thalamus" if y < 0.48 else "basal ganglia"

    # Basal cisterns, the classic site of tuberculous meningitis.
    if z < 0.30 and y >= 0.42:
        return "basal cisterns / suprasellar region"

    if y > 0.68:
        return "frontal lobe"
    if y < 0.30:
        return "occipital lobe"
    if z > 0.62:
        return "parietal lobe" if y < 0.55 else "frontal lobe"
    if z < 0.45:
        return "temporal lobe"
    return "parietal lobe" if y < 0.5 else "frontal lobe"


_LOBE_OF = {
    "frontal lobe": "frontal",
    "parietal lobe": "parietal",
    "temporal lobe": "temporal",
    "occipital lobe": "occipital",
    "cerebellum": "infratentorial",
    "brainstem": "infratentorial",
    "thalamus": "deep grey matter",
    "basal ganglia": "deep grey matter",
    "basal cisterns / suprasellar region": "basal",
}

# Sites where TB has a recognised predilection. Used to add context to the
# report, never to change the detection itself.
TB_TYPICAL_SITES = {
    "basal cisterns / suprasellar region",
    "cerebellum",
    "brainstem",
    "basal ganglia",
    "thalamus",
}


def is_tb_typical_site(region: str) -> bool:
    return region in TB_TYPICAL_SITES
