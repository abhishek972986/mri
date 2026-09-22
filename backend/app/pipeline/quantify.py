"""Turn a binary lesion mask into measured, located, per-lesion findings.

Everything the report and the 3D viewer show about a lesion comes from here:
volume in cm3, extent in mm, anatomical zone, mean lesion probability, and the
inter-lesion distances used to describe lesion clustering.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import ndimage

from . import atlas
from .volume import Volume


@dataclass
class Lesion:
    id: int
    volume_mm3: float
    volume_cm3: float
    voxel_count: int
    centroid_voxel: list[float]
    centroid_world_mm: list[float]
    bbox_voxel: list[int]                    # [i0, j0, k0, i1, j1, k1], upper bound exclusive
    max_diameter_mm: float
    dimensions_mm: list[float]
    sphericity: float
    mean_probability: float
    max_probability: float
    region: str = "unspecified"
    side: str = "unspecified"
    lobe: str = "unspecified"
    tb_typical_site: bool = False
    normalized_coords: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class LesionBurden:
    lesion_count: int
    total_volume_mm3: float
    total_volume_cm3: float
    largest_volume_cm3: float
    mean_volume_cm3: float
    brain_volume_cm3: float
    lesion_load_percent: float
    regions_involved: list[str] = field(default_factory=list)
    mean_probability: float = 0.0
    min_inter_lesion_distance_mm: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def quantify(
    vol: Volume,
    mask: np.ndarray,
    probability: np.ndarray | None = None,
    brain_mask: np.ndarray | None = None,
) -> tuple[list[Lesion], LesionBurden]:
    """Measure every connected component in the mask and summarise the burden."""
    if probability is None:
        probability = mask.astype(np.float32)
    if brain_mask is None:
        brain_mask = vol.data != 0

    voxel_mm3 = vol.voxel_volume_mm3
    spacing = vol.spacing
    frame = atlas.build_frame(vol.affine, brain_mask)

    # 26-connectivity: lesions touching only at a corner are one lesion.
    labels, count = ndimage.label(mask, structure=np.ones((3, 3, 3)))

    lesions: list[Lesion] = []
    for index in range(1, count + 1):
        component = labels == index
        coords = np.argwhere(component)
        if coords.size == 0:
            continue

        voxel_count = int(coords.shape[0])
        centroid = coords.mean(axis=0)
        lo = coords.min(axis=0)
        hi = coords.max(axis=0) + 1
        dims_mm = (hi - lo) * spacing

        volume_mm3 = voxel_count * voxel_mm3
        probs = probability[component]
        location = atlas.label_lesion(frame, centroid)

        lesions.append(
            Lesion(
                id=index,
                volume_mm3=round(volume_mm3, 2),
                volume_cm3=round(volume_mm3 / 1000.0, 4),
                voxel_count=voxel_count,
                centroid_voxel=[round(float(c), 2) for c in centroid],
                centroid_world_mm=[round(float(c), 2) for c in vol.voxel_to_world(centroid)[0]],
                bbox_voxel=[int(v) for v in np.concatenate([lo, hi])],
                max_diameter_mm=round(_max_diameter_mm(coords, spacing), 2),
                dimensions_mm=[round(float(d), 2) for d in dims_mm],
                sphericity=round(_sphericity(component, volume_mm3, spacing), 3),
                mean_probability=round(float(probs.mean()), 4),
                max_probability=round(float(probs.max()), 4),
                region=location["region"],
                side=location["side"],
                lobe=location["lobe"],
                tb_typical_site=atlas.is_tb_typical_site(location["region"]),
                normalized_coords=location["normalized_coords"],
            )
        )

    lesions.sort(key=lambda l: l.volume_mm3, reverse=True)
    return lesions, summarize(lesions, brain_mask, voxel_mm3)


def summarize(lesions: list[Lesion], brain_mask: np.ndarray, voxel_mm3: float) -> LesionBurden:
    brain_cm3 = float(brain_mask.sum() * voxel_mm3 / 1000.0)
    total_mm3 = float(sum(l.volume_mm3 for l in lesions))

    if lesions:
        regions = sorted({f"{l.side} {l.region}".strip() for l in lesions})
        mean_prob = float(np.mean([l.mean_probability for l in lesions]))
        largest = max(l.volume_cm3 for l in lesions)
        mean_vol = total_mm3 / len(lesions) / 1000.0
    else:
        regions, mean_prob, largest, mean_vol = [], 0.0, 0.0, 0.0

    return LesionBurden(
        lesion_count=len(lesions),
        total_volume_mm3=round(total_mm3, 2),
        total_volume_cm3=round(total_mm3 / 1000.0, 4),
        largest_volume_cm3=round(largest, 4),
        mean_volume_cm3=round(mean_vol, 4),
        brain_volume_cm3=round(brain_cm3, 2),
        lesion_load_percent=round(100.0 * total_mm3 / 1000.0 / brain_cm3, 4) if brain_cm3 > 0 else 0.0,
        regions_involved=regions,
        mean_probability=round(mean_prob, 4),
        min_inter_lesion_distance_mm=_min_pairwise_distance(lesions),
    )


def region_breakdown(lesions: list[Lesion]) -> list[dict]:
    """Per-region totals, for the dashboard's regional bar chart."""
    grouped: dict[tuple[str, str], dict] = {}
    for lesion in lesions:
        key = (lesion.side, lesion.region)
        entry = grouped.setdefault(
            key,
            {"side": lesion.side, "region": lesion.region, "lesion_count": 0, "volume_cm3": 0.0},
        )
        entry["lesion_count"] += 1
        entry["volume_cm3"] = round(entry["volume_cm3"] + lesion.volume_cm3, 4)

    return sorted(grouped.values(), key=lambda e: e["volume_cm3"], reverse=True)


# --- helpers ---------------------------------------------------------------

def _max_diameter_mm(coords: np.ndarray, spacing: np.ndarray) -> float:
    """Longest straight-line distance across the lesion (Feret diameter).

    Computed on the convex-hull candidates when the component is large, since an
    exhaustive pairwise search is O(n^2) and lesions can run to 10^5 voxels.
    """
    points = coords * spacing
    if points.shape[0] <= 1:
        return float(np.mean(spacing))

    if points.shape[0] > 2000:
        try:
            from scipy.spatial import ConvexHull
            points = points[ConvexHull(points).vertices]
        except Exception:
            # Degenerate (coplanar) component or no qhull: subsample instead.
            step = points.shape[0] // 2000 + 1
            points = points[::step]

    deltas = points[:, None, :] - points[None, :, :]
    return float(np.sqrt((deltas ** 2).sum(axis=2)).max())


def _sphericity(component: np.ndarray, volume_mm3: float, spacing: np.ndarray) -> float:
    """Ratio of the equivalent-sphere surface area to the actual surface area.

    1.0 is a perfect sphere. Tuberculomas tend to be roundish; a very low value
    suggests a confluent or infiltrative process, which is worth surfacing.
    """
    eroded = ndimage.binary_erosion(component, structure=np.ones((3, 3, 3)))
    surface_voxels = int(np.count_nonzero(component & ~eroded))
    if surface_voxels == 0 or volume_mm3 <= 0:
        return 0.0

    face_area = float(np.mean([spacing[1] * spacing[2], spacing[0] * spacing[2], spacing[0] * spacing[1]]))
    surface_area = surface_voxels * face_area
    equivalent = np.pi ** (1 / 3) * (6 * volume_mm3) ** (2 / 3)
    return float(np.clip(equivalent / surface_area, 0.0, 1.0))


def _min_pairwise_distance(lesions: list[Lesion]) -> float | None:
    if len(lesions) < 2:
        return None
    centres = np.array([l.centroid_world_mm for l in lesions])
    deltas = centres[:, None, :] - centres[None, :, :]
    distances = np.sqrt((deltas ** 2).sum(axis=2))
    np.fill_diagonal(distances, np.inf)
    return round(float(distances.min()), 2)
