"""Rigid registration for longitudinal comparison.

Two scans of the same head taken months apart differ by a rigid-body transform
(the patient lay differently). Aligning them is what makes "this lesion shrank"
a statement about biology rather than about positioning.

Optimization is multi-resolution Powell on normalized mutual information, which
tolerates the intensity differences between sessions and sequences. If SimpleITK
is installed it is used instead: faster, and better tested.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage, optimize

from .volume import Volume


@dataclass
class RegistrationResult:
    moving_registered: Volume
    matrix: np.ndarray                      # 4x4 transform, moving -> fixed, in voxel space
    final_metric: float
    method: str
    translation_mm: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0)
    warnings: list[str] = field(default_factory=list)
    registered_masks: dict[str, np.ndarray] = field(default_factory=dict)
    registered_images: dict[str, np.ndarray] = field(default_factory=dict)

    def summary(self) -> dict:
        """JSON-safe description, for the report's technique section."""
        return {
            "method": self.method,
            "similarity": round(self.final_metric, 4),
            "translation_mm": [round(t, 2) for t in self.translation_mm],
            "rotation_deg": [round(r, 2) for r in self.rotation_deg],
            "warnings": list(self.warnings),
        }


def register_rigid(
    fixed: Volume,
    moving: Volume,
    moving_masks: dict[str, np.ndarray] | None = None,
    moving_images: dict[str, np.ndarray] | None = None,
    use_sitk: bool = True,
) -> RegistrationResult:
    """Align the moving volume onto the fixed volume with a 6-DOF rigid transform.

    Any masks passed in `moving_masks` (brain mask, lesion mask) are warped by the
    same recovered transform and returned in `registered_masks`; continuous data
    in `moving_images` (a probability map, another sequence) is warped the same
    way with linear rather than nearest-neighbour interpolation. Carrying them
    through here rather than exposing the matrix is deliberate: the two backends
    express their transform in different coordinate systems -- voxel-space pull
    matrix for numpy, physical-space Euler transform for SimpleITK -- and a caller
    applying the wrong one would silently displace every lesion.
    """
    if use_sitk:
        try:
            return _register_sitk(fixed, moving, moving_masks, moving_images)
        except ImportError:
            pass
    return _register_numpy(fixed, moving, moving_masks, moving_images)


def _register_numpy(
    fixed: Volume,
    moving: Volume,
    moving_masks: dict[str, np.ndarray] | None = None,
    moving_images: dict[str, np.ndarray] | None = None,
    working_size: int = 64,
) -> RegistrationResult:
    """Solve the transform on a downsampled copy, then apply it at full resolution.

    A rigid transform has six parameters. Recovering them does not need full
    resolution -- sub-voxel accuracy at the working scale is already far below
    the size of anything being measured -- and optimizing on the full grid costs
    roughly `working_size`-cubed more per metric evaluation for no real gain.
    """
    warnings: list[str] = []

    # Put the moving scan on the fixed grid first, so the only difference left
    # is the rigid misalignment we are about to solve for.
    moving_on_grid = resample_like(moving, fixed)

    f_full = _prep(fixed.data)
    m_full = _prep(moving_on_grid.data)

    # Downsample once to the working grid; the pyramid then runs on top of that.
    base = max(1, int(round(max(f_full.shape) / working_size)))
    f_work = _downsample(f_full, base)
    m_work = _downsample(m_full, base)

    params = np.zeros(6)                     # [tx, ty, tz] in voxels, [rx, ry, rz] in radians
    metric = 0.0

    # Coarse-to-fine: solve big misalignments cheaply, then refine.
    for factor, maxiter in ((4, 30), (2, 20), (1, 12)):
        f_s = _downsample(f_work, factor)
        m_s = _downsample(m_work, factor)
        if min(f_s.shape) < 8:
            continue

        scaled = params.copy()
        scaled[:3] /= factor

        def cost(p, _f=f_s, _m=m_s):
            return -_normalized_mutual_information(_f, _apply(_m, p, order=1))

        res = optimize.minimize(
            cost, scaled, method="Powell",
            options={"xtol": 0.02, "ftol": 1e-4, "maxiter": maxiter},
        )
        params = np.asarray(res.x, dtype=np.float64).copy()
        params[:3] *= factor
        metric = -float(res.fun)

    # Translations were solved in working-grid voxels; rescale to full-grid voxels.
    params[:3] *= base

    registered = _apply(moving_on_grid.data, params, order=1)
    matrix = _params_to_matrix(params, moving_on_grid.data.shape)

    registered_masks: dict[str, np.ndarray] = {}
    for name, mask in (moving_masks or {}).items():
        on_grid = resample_like(Volume(mask.astype(np.float32), moving.affine), fixed, order=0)
        registered_masks[name] = _apply(on_grid.data, params, order=0) > 0.5

    registered_images: dict[str, np.ndarray] = {}
    for name, image in (moving_images or {}).items():
        on_grid = resample_like(Volume(image.astype(np.float32), moving.affine), fixed, order=1)
        registered_images[name] = _apply(on_grid.data, params, order=1)

    spacing = fixed.spacing
    translation_mm = tuple(float(t * s) for t, s in zip(params[:3], spacing))
    rotation_deg = tuple(float(np.degrees(r)) for r in params[3:])

    if metric < 0.05:
        warnings.append(
            "Low registration similarity. The scans may be from different subjects, "
            "different sequences, or badly corrupted. Review before trusting the comparison."
        )
    if max(abs(r) for r in rotation_deg) > 25.0:
        warnings.append("Large rotation recovered (over 25 deg); verify alignment visually.")

    return RegistrationResult(
        moving_registered=Volume(registered.astype(np.float32), fixed.affine, moving.sequence),
        matrix=matrix,
        final_metric=metric,
        method="numpy-powell-nmi",
        translation_mm=translation_mm,
        rotation_deg=rotation_deg,
        warnings=warnings,
        registered_masks=registered_masks,
        registered_images=registered_images,
    )


def _register_sitk(
    fixed: Volume,
    moving: Volume,
    moving_masks: dict[str, np.ndarray] | None = None,
    moving_images: dict[str, np.ndarray] | None = None,
) -> RegistrationResult:
    import SimpleITK as sitk  # optional dependency

    f_img = _to_sitk(fixed, sitk)
    m_img = _to_sitk(moving, sitk)

    reg = sitk.ImageRegistrationMethod()
    reg.SetMetricAsMattesMutualInformation(numberOfHistogramBins=50)
    reg.SetMetricSamplingStrategy(reg.RANDOM)
    reg.SetMetricSamplingPercentage(0.1, seed=1234)
    reg.SetInterpolator(sitk.sitkLinear)
    reg.SetOptimizerAsRegularStepGradientDescent(
        learningRate=2.0, minStep=1e-4, numberOfIterations=200
    )
    reg.SetOptimizerScalesFromPhysicalShift()
    reg.SetShrinkFactorsPerLevel([4, 2, 1])
    reg.SetSmoothingSigmasPerLevel([2, 1, 0])
    reg.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    reg.SetInitialTransform(
        sitk.CenteredTransformInitializer(
            f_img, m_img, sitk.Euler3DTransform(),
            sitk.CenteredTransformInitializerFilter.GEOMETRY,
        ),
        inPlace=False,
    )

    transform = reg.Execute(f_img, m_img)
    resampled = sitk.Resample(m_img, f_img, transform, sitk.sitkLinear, 0.0, m_img.GetPixelID())
    data = sitk.GetArrayFromImage(resampled).transpose(2, 1, 0).astype(np.float32)

    registered_masks: dict[str, np.ndarray] = {}
    for name, mask in (moving_masks or {}).items():
        mask_img = _to_sitk(Volume(mask.astype(np.float32), moving.affine), sitk)
        warped = sitk.Resample(
            mask_img, f_img, transform, sitk.sitkNearestNeighbor, 0.0, mask_img.GetPixelID()
        )
        registered_masks[name] = sitk.GetArrayFromImage(warped).transpose(2, 1, 0) > 0.5

    registered_images: dict[str, np.ndarray] = {}
    for name, image in (moving_images or {}).items():
        img = _to_sitk(Volume(image.astype(np.float32), moving.affine), sitk)
        warped = sitk.Resample(img, f_img, transform, sitk.sitkLinear, 0.0, img.GetPixelID())
        registered_images[name] = sitk.GetArrayFromImage(warped).transpose(2, 1, 0).astype(np.float32)

    euler = sitk.Euler3DTransform(transform)
    matrix = np.eye(4)
    matrix[:3, :3] = np.asarray(euler.GetMatrix()).reshape(3, 3)
    matrix[:3, 3] = np.asarray(euler.GetTranslation())

    return RegistrationResult(
        moving_registered=Volume(data, fixed.affine, moving.sequence),
        matrix=matrix,
        final_metric=float(-reg.GetMetricValue()),
        method="simpleitk-mattes-mi",
        translation_mm=tuple(float(t) for t in euler.GetTranslation()),
        rotation_deg=(
            float(np.degrees(euler.GetAngleX())),
            float(np.degrees(euler.GetAngleY())),
            float(np.degrees(euler.GetAngleZ())),
        ),
        registered_masks=registered_masks,
        registered_images=registered_images,
    )


def resample_like(vol: Volume, reference: Volume, order: int = 1) -> Volume:
    """Resample a volume onto the reference voxel grid, using both affines."""
    same_grid = (
        vol.data.shape == reference.data.shape
        and np.allclose(vol.affine, reference.affine, atol=1e-4)
    )
    if same_grid:
        return Volume(vol.data.copy(), reference.affine, vol.sequence)

    # reference voxel -> world -> moving voxel
    transform = np.linalg.inv(vol.affine) @ reference.affine
    coords = np.indices(reference.data.shape, dtype=np.float32).reshape(3, -1)
    mapped = transform[:3, :3] @ coords + transform[:3, 3:4]
    out = ndimage.map_coordinates(
        vol.data, mapped, order=order, mode="constant", cval=0.0
    ).reshape(reference.data.shape)
    return Volume(out.astype(np.float32), reference.affine, vol.sequence)


# --- helpers ---------------------------------------------------------------

def _prep(data: np.ndarray) -> np.ndarray:
    d = np.nan_to_num(data.astype(np.float32))
    lo, hi = np.percentile(d, [1, 99])
    if hi - lo < 1e-6:
        return np.zeros_like(d)
    return np.clip((d - lo) / (hi - lo), 0, 1)


def _downsample(data: np.ndarray, factor: int) -> np.ndarray:
    if factor == 1:
        return data
    smoothed = ndimage.gaussian_filter(data, sigma=factor / 2.0)
    return smoothed[::factor, ::factor, ::factor]


def _apply(data: np.ndarray, params: np.ndarray, order: int = 1) -> np.ndarray:
    matrix = _rotation_matrix(params[3:])
    center = (np.asarray(data.shape) - 1) / 2.0
    offset = center - matrix @ center - params[:3]
    return ndimage.affine_transform(
        data, matrix, offset=offset, order=order, mode="constant", cval=0.0, prefilter=False
    )


def _rotation_matrix(angles: np.ndarray) -> np.ndarray:
    rx, ry, rz = angles
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx


def _params_to_matrix(params: np.ndarray, shape: tuple[int, ...]) -> np.ndarray:
    """Build the same pull transform `_apply` hands to ndimage.affine_transform.

    Must stay byte-for-byte consistent with `_apply`'s offset, since masks are
    warped through this matrix while the image is warped through `_apply`; a sign
    difference between them would shift every lesion by twice the translation.
    """
    rot = _rotation_matrix(params[3:])
    center = (np.asarray(shape) - 1) / 2.0
    matrix = np.eye(4)
    matrix[:3, :3] = rot
    matrix[:3, 3] = center - rot @ center - params[:3]
    return matrix


def _normalized_mutual_information(a: np.ndarray, b: np.ndarray, bins: int = 48) -> float:
    """NMI over voxels where either image has signal. Robust to contrast differences."""
    valid = (a > 0.02) | (b > 0.02)
    if valid.sum() < 256:
        return 0.0

    joint, _, _ = np.histogram2d(a[valid], b[valid], bins=bins, range=[[0, 1], [0, 1]])
    total = joint.sum()
    if total <= 0:
        return 0.0
    joint = joint / total

    px = joint.sum(axis=1)
    py = joint.sum(axis=0)
    hx = -np.sum(px[px > 0] * np.log(px[px > 0]))
    hy = -np.sum(py[py > 0] * np.log(py[py > 0]))
    hxy = -np.sum(joint[joint > 0] * np.log(joint[joint > 0]))
    if hxy < 1e-9:
        return 0.0
    return float((hx + hy) / hxy - 1.0)


def _to_sitk(vol: Volume, sitk):
    img = sitk.GetImageFromArray(vol.data.transpose(2, 1, 0).astype(np.float32))
    img.SetSpacing([float(s) for s in vol.spacing])
    img.SetOrigin([float(o) for o in vol.affine[:3, 3]])
    direction = vol.affine[:3, :3] / vol.spacing
    img.SetDirection([float(x) for x in direction.flatten()])
    return img
