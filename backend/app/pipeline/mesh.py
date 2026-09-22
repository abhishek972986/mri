"""Surface extraction for the 3D viewer.

Marching cubes turns the binary masks into triangle meshes, which are emitted as
plain JSON buffers (flat Float32/Uint32 arrays) that map directly onto a
THREE.BufferGeometry with no glTF tooling in between.

Meshes are emitted in world millimetres and centred on the brain's centroid, so
the viewer can drop them into a scene without knowing anything about affines.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage
from skimage import measure

# Lesion meshes are extracted at full resolution; the brain hull is decimated,
# since it is only ever drawn as a translucent reference shell.
BRAIN_STEP = 3
LESION_STEP = 1


def extract_surface(
    mask: np.ndarray,
    affine: np.ndarray,
    step: int = 1,
    smooth_sigma: float = 1.0,
    origin_offset: np.ndarray | None = None,
) -> dict | None:
    """Marching-cubes a binary mask into a world-space triangle mesh.

    The mask is blurred before thresholding: marching cubes on a raw binary
    volume produces hard voxel staircasing, which reads as noise on screen.
    """
    if mask is None or not mask.any():
        return None

    field = mask.astype(np.float32)
    if smooth_sigma > 0:
        field = ndimage.gaussian_filter(field, sigma=smooth_sigma)

    # Pad so components touching the volume edge still close into a solid.
    field = np.pad(field, 1, mode="constant", constant_values=0.0)

    try:
        verts, faces, normals, _ = measure.marching_cubes(field, level=0.5, step_size=step)
    except (ValueError, RuntimeError):
        return None

    if verts.size == 0 or faces.size == 0:
        return None

    verts -= 1.0                                        # undo the pad
    world = verts @ affine[:3, :3].T + affine[:3, 3]    # voxel -> world mm
    if origin_offset is not None:
        world = world - origin_offset

    # Marching-cubes normals point into the surface; flip for outward lighting.
    world_normals = -(normals @ affine[:3, :3].T)
    lengths = np.linalg.norm(world_normals, axis=1, keepdims=True)
    world_normals = np.divide(
        world_normals, lengths, out=np.zeros_like(world_normals), where=lengths > 1e-8
    )

    return {
        "positions": [round(float(v), 3) for v in world.ravel()],
        "normals": [round(float(v), 4) for v in world_normals.ravel()],
        "indices": [int(i) for i in faces.ravel()],
        "vertex_count": int(verts.shape[0]),
        "triangle_count": int(faces.shape[0]),
    }


def build_scene(
    brain_mask: np.ndarray,
    lesion_mask: np.ndarray,
    affine: np.ndarray,
    lesions: list,
) -> dict:
    """Assemble everything the Three.js viewer needs for one study."""
    origin = brain_centre_world(brain_mask, affine)

    brain = extract_surface(
        brain_mask, affine, step=BRAIN_STEP, smooth_sigma=1.5, origin_offset=origin
    )

    labels, _ = ndimage.label(lesion_mask, structure=np.ones((3, 3, 3)))
    lesion_meshes = []
    for lesion in lesions:
        component = labels == lesion.id
        surface = extract_surface(
            component, affine, step=LESION_STEP, smooth_sigma=0.7, origin_offset=origin
        )
        if surface is None:
            continue
        centroid = np.asarray(lesion.centroid_world_mm) - origin
        lesion_meshes.append({
            "lesion_id": lesion.id,
            "region": lesion.region,
            "side": lesion.side,
            "volume_cm3": lesion.volume_cm3,
            "max_diameter_mm": lesion.max_diameter_mm,
            "mean_probability": lesion.mean_probability,
            "tb_typical_site": lesion.tb_typical_site,
            "centroid": [round(float(c), 2) for c in centroid],
            "mesh": surface,
        })

    return {
        "units": "millimetres",
        "origin_world_mm": [round(float(o), 2) for o in origin],
        "brain": brain,
        "lesions": lesion_meshes,
        "bounds_mm": bounds(brain_mask, affine, origin),
    }


def brain_centre_world(brain_mask: np.ndarray, affine: np.ndarray) -> np.ndarray:
    if not brain_mask.any():
        centre = (np.asarray(brain_mask.shape) - 1) / 2.0
    else:
        centre = np.argwhere(brain_mask).mean(axis=0)
    return centre @ affine[:3, :3].T + affine[:3, 3]


def bounds(brain_mask: np.ndarray, affine: np.ndarray, origin: np.ndarray) -> dict:
    if not brain_mask.any():
        return {"min": [0, 0, 0], "max": [0, 0, 0], "radius": 100.0}

    coords = np.argwhere(brain_mask)
    corners = np.array([coords.min(axis=0), coords.max(axis=0)])
    world = corners @ affine[:3, :3].T + affine[:3, 3] - origin
    lo = world.min(axis=0)
    hi = world.max(axis=0)
    return {
        "min": [round(float(v), 2) for v in lo],
        "max": [round(float(v), 2) for v in hi],
        "radius": round(float(np.linalg.norm(hi - lo) / 2.0), 2),
    }
