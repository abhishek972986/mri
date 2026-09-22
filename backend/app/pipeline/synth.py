"""Synthetic brain MRI phantoms with tuberculoma-like lesions.

There is no public labeled neuro-TB MRI dataset, so this module exists for two
reasons: it lets the whole product loop be demonstrated and regression-tested
without any patient data, and it provides pretraining/ sanity-check data for the
segmentation model before real data arrives.

A phantom is not training data for a deployable model. It reproduces the geometry
of the problem -- small round hyperintense foci scattered through a brain-shaped
volume, sometimes ring-enhancing -- but none of the tissue heterogeneity that
makes real segmentation hard. Use it to verify plumbing, not to claim accuracy.

`make_longitudinal_pair` produces a baseline and a follow-up of the "same
patient", with lesions evolved by a chosen response and the head rotated and
shifted, which is what exercises the registration and comparison path end to end.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from .volume import Volume

DEFAULT_SHAPE = (128, 152, 128)
DEFAULT_SPACING = (1.5, 1.5, 1.5)


@dataclass
class PhantomLesion:
    centre: tuple[float, float, float]       # in voxels
    radius: float                            # in voxels
    ring: bool = False


@dataclass
class Phantom:
    volume: Volume
    lesion_mask: np.ndarray
    brain_mask: np.ndarray
    lesions: list[PhantomLesion]


def make_phantom(
    shape: tuple[int, int, int] = DEFAULT_SHAPE,
    spacing: tuple[float, float, float] = DEFAULT_SPACING,
    n_lesions: int = 4,
    sequence: str = "T1C",
    lesions: list[PhantomLesion] | None = None,
    noise: float = 0.035,
    bias_strength: float = 0.25,
    seed: int | None = None,
) -> Phantom:
    """Build one synthetic study. Pass `lesions` to control them exactly."""
    rng = np.random.default_rng(seed)
    affine = np.diag([*spacing, 1.0])
    affine[:3, 3] = -np.asarray(shape) * np.asarray(spacing) / 2.0   # roughly centre on origin

    coords = _normalized_coords(shape)
    brain, tissue = _build_anatomy(coords, rng)

    if lesions is None:
        lesions = _random_lesions(shape, brain, n_lesions, rng)

    lesion_mask = np.zeros(shape, dtype=bool)
    image = tissue.copy()
    for lesion in lesions:
        core, rim = _lesion_fields(shape, lesion)
        lesion_mask |= core
        # Tuberculomas are T1-hypointense centrally with an enhancing rim on
        # post-contrast imaging; on T2/FLAIR the core itself is bright.
        if lesion.ring and sequence in ("T1C", "T1"):
            image = np.where(rim, 1.35, image)
            image = np.where(core & ~rim, 0.72, image)
        else:
            image = np.where(core, 1.25, image)

    image = image * _bias_field(shape, bias_strength, rng)
    image = image + rng.normal(0, noise, size=shape).astype(np.float32)
    image = np.clip(image, 0, None) * brain
    image = ndimage.gaussian_filter(image, sigma=0.6).astype(np.float32)

    # Rician-like background so skull stripping has something to strip.
    skull = _skull_shell(coords)
    image = np.where(skull & (brain <= 0), 0.55 + rng.normal(0, 0.05, size=shape), image).astype(np.float32)

    return Phantom(
        volume=Volume(image * 400.0, affine, sequence),   # scale into a plausible MR range
        lesion_mask=lesion_mask,
        brain_mask=brain.astype(bool),
        lesions=lesions,
    )


def make_longitudinal_pair(
    response: str = "improving",
    n_lesions: int = 5,
    shape: tuple[int, int, int] = DEFAULT_SHAPE,
    spacing: tuple[float, float, float] = DEFAULT_SPACING,
    sequence: str = "T1C",
    seed: int = 7,
) -> tuple[Phantom, Phantom]:
    """Baseline plus follow-up of the same synthetic patient.

    response: improving | worsening | stable | mixed
    """
    rng = np.random.default_rng(seed)
    base_phantom = make_phantom(shape, spacing, n_lesions, sequence, seed=seed)
    followup_lesions = _evolve(base_phantom.lesions, response, shape, base_phantom.brain_mask, rng)

    follow_phantom = make_phantom(
        shape, spacing, sequence=sequence, lesions=followup_lesions, seed=seed + 1
    )

    # Reposition the head: this is the misalignment registration has to undo.
    follow_phantom = _reposition(follow_phantom, rng)
    return base_phantom, follow_phantom


def _evolve(
    lesions: list[PhantomLesion],
    response: str,
    shape: tuple[int, int, int],
    brain: np.ndarray,
    rng: np.random.Generator,
) -> list[PhantomLesion]:
    out: list[PhantomLesion] = []

    if response == "improving":
        # Most shrink, the smallest resolve entirely.
        for i, lesion in enumerate(sorted(lesions, key=lambda l: -l.radius)):
            if i >= len(lesions) - 2:
                continue                                  # resolved
            out.append(PhantomLesion(lesion.centre, lesion.radius * rng.uniform(0.55, 0.75), lesion.ring))

    elif response == "worsening":
        for lesion in lesions:
            out.append(PhantomLesion(lesion.centre, lesion.radius * rng.uniform(1.2, 1.5), lesion.ring))
        out.extend(_random_lesions(shape, brain, 2, rng))  # new lesions

    elif response == "mixed":
        for i, lesion in enumerate(lesions):
            factor = rng.uniform(0.5, 0.7) if i % 2 == 0 else rng.uniform(1.25, 1.6)
            out.append(PhantomLesion(lesion.centre, lesion.radius * factor, lesion.ring))
        out.extend(_random_lesions(shape, brain, 1, rng))

    else:                                                  # stable
        for lesion in lesions:
            out.append(PhantomLesion(lesion.centre, lesion.radius * rng.uniform(0.94, 1.06), lesion.ring))

    return [l for l in out if l.radius >= 1.6]


def _reposition(phantom: Phantom, rng: np.random.Generator) -> Phantom:
    """Apply a small rigid transform to image and masks alike."""
    angles = rng.uniform(-0.12, 0.12, size=3)              # up to ~7 degrees
    shift = rng.uniform(-4, 4, size=3)

    rot = _rotation(angles)
    centre = (np.asarray(phantom.volume.data.shape) - 1) / 2.0
    offset = centre - rot @ centre - shift

    def warp(data, order):
        return ndimage.affine_transform(
            data.astype(np.float32), rot, offset=offset, order=order, mode="constant", cval=0.0
        )

    return Phantom(
        volume=phantom.volume.with_data(warp(phantom.volume.data, 1)),
        lesion_mask=warp(phantom.lesion_mask, 0) > 0.5,
        brain_mask=warp(phantom.brain_mask, 0) > 0.5,
        lesions=phantom.lesions,
    )


# --- anatomy ---------------------------------------------------------------

def _normalized_coords(shape: tuple[int, int, int]) -> np.ndarray:
    """Coordinates in [-1, 1] per axis, centred on the volume."""
    axes = [np.linspace(-1, 1, s) for s in shape]
    return np.stack(np.meshgrid(*axes, indexing="ij"), axis=0)


def _build_anatomy(coords: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    x, y, z = coords
    shape = x.shape

    # Brain: an ellipsoid, flattened inferiorly and widened temporally.
    brain_field = (x / 0.60) ** 2 + (y / 0.74) ** 2 + (z / 0.62) ** 2
    brain = (brain_field < 1.0).astype(np.float32)
    brain = ndimage.gaussian_filter(brain, 1.2)
    brain = (brain > 0.5).astype(np.float32)

    # White matter core, grey matter as the shell between brain and WM.
    wm = ((x / 0.44) ** 2 + (y / 0.56) ** 2 + (z / 0.45) ** 2) < 1.0
    tissue = np.where(brain > 0, 0.72, 0.0).astype(np.float32)    # grey matter
    tissue[wm] = 0.92                                             # white matter

    # Lateral ventricles: two CSF-dark curved cavities near the midline.
    for sign in (-1, 1):
        vent = (((x - sign * 0.11) / 0.07) ** 2 + (y / 0.36) ** 2 + ((z - 0.05) / 0.13) ** 2) < 1.0
        tissue[vent] = 0.18

    # Cerebellum: a separate posterior-inferior mass.
    cereb = ((x / 0.35) ** 2 + ((y + 0.52) / 0.24) ** 2 + ((z + 0.42) / 0.20) ** 2) < 1.0
    tissue[cereb & (brain > 0)] = 0.80

    # Brainstem column.
    stem = ((x / 0.085) ** 2 + ((y + 0.26) / 0.14) ** 2) < 1.0
    tissue[stem & (z < 0.0) & (brain > 0)] = 0.85

    # Cortical texture, so the volume is not piecewise-constant.
    texture = ndimage.gaussian_filter(rng.normal(0, 1, size=shape).astype(np.float32), 2.2)
    texture = texture / (np.abs(texture).max() + 1e-6)
    tissue = tissue * (1.0 + 0.07 * texture)

    return brain, (tissue * brain).astype(np.float32)


def _skull_shell(coords: np.ndarray) -> np.ndarray:
    x, y, z = coords
    field = (x / 0.76) ** 2 + (y / 0.90) ** 2 + (z / 0.78) ** 2
    return (field < 1.0) & (field > 0.84)


def _random_lesions(
    shape: tuple[int, int, int], brain: np.ndarray, count: int, rng: np.random.Generator
) -> list[PhantomLesion]:
    """Place lesions at random interior positions, biased toward TB-typical depth."""
    interior = ndimage.binary_erosion(brain > 0, iterations=6)
    candidates = np.argwhere(interior)
    if candidates.size == 0:
        candidates = np.argwhere(brain > 0)
    if candidates.size == 0:
        return []

    lesions: list[PhantomLesion] = []
    placed: list[np.ndarray] = []
    attempts = 0
    while len(lesions) < count and attempts < count * 60:
        attempts += 1
        centre = candidates[rng.integers(len(candidates))].astype(np.float64)
        if any(np.linalg.norm(centre - p) < 14 for p in placed):
            continue                                       # keep lesions separable
        radius = float(rng.uniform(2.2, 5.5))              # ~6-16 mm diameter at 1.5 mm
        lesions.append(PhantomLesion(tuple(centre), radius, ring=bool(rng.random() < 0.6)))
        placed.append(centre)

    return lesions


def _lesion_fields(shape: tuple[int, int, int], lesion: PhantomLesion) -> tuple[np.ndarray, np.ndarray]:
    """Return (core mask, enhancing rim mask) for one lesion."""
    grids = np.ogrid[tuple(slice(0, s) for s in shape)]
    dist_sq = sum((g - c) ** 2 for g, c in zip(grids, lesion.centre))
    core = dist_sq <= lesion.radius ** 2
    inner = dist_sq <= max(lesion.radius - 1.4, 0.4) ** 2
    return core, core & ~inner


def _bias_field(shape: tuple[int, int, int], strength: float, rng: np.random.Generator) -> np.ndarray:
    """Smooth multiplicative intensity drift, as produced by coil sensitivity."""
    if strength <= 0:
        return np.ones(shape, dtype=np.float32)
    low = rng.normal(0, 1, size=tuple(max(s // 16, 2) for s in shape)).astype(np.float32)
    field = ndimage.zoom(low, [s / l for s, l in zip(shape, low.shape)], order=3)
    field = field[tuple(slice(0, s) for s in shape)]
    field = field / (np.abs(field).max() + 1e-6)
    return (1.0 + strength * field).astype(np.float32)


def _rotation(angles: np.ndarray) -> np.ndarray:
    rx, ry, rz = angles
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx
