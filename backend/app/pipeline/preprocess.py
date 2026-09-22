"""MRI preprocessing: resampling, bias correction, skull stripping, normalization.

These are deliberately dependency-light implementations so the pipeline runs on a
clean install. Each function names the production-grade tool it stands in for --
swap them in when you have the environment for it (see docs/PIPELINE.md).
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from .volume import Volume

TARGET_SPACING = (1.0, 1.0, 1.0)


def resample_to_spacing(vol: Volume, spacing: tuple[float, float, float] = TARGET_SPACING) -> Volume:
    """Resample to isotropic voxels so volumes and distances are comparable across scans."""
    current = vol.spacing
    target = np.asarray(spacing, dtype=np.float64)
    zoom = current / target
    if np.allclose(zoom, 1.0, atol=1e-3):
        return vol

    data = ndimage.zoom(vol.data, zoom, order=1, prefilter=False)
    # Rebuild the affine: the direction/rotation is preserved, only the step changes.
    direction = vol.affine[:3, :3] / current
    affine = np.eye(4)
    affine[:3, :3] = direction * target
    affine[:3, 3] = vol.affine[:3, 3]
    return Volume(data=data.astype(np.float32), affine=affine, sequence=vol.sequence)


def correct_bias_field(vol: Volume, sigma: float = 18.0) -> Volume:
    """Remove the smooth low-frequency intensity drift typical of surface coils.

    A homomorphic approximation of N4ITK: estimate the bias as a heavily blurred
    version of the log-intensity image and subtract it. N4 (SimpleITK) is better;
    this keeps thresholding stable without the dependency.

    The blur is a *normalized* convolution -- blurred signal divided by blurred
    mask -- so the estimate is formed only from voxels that contain tissue. A
    plain Gaussian would average in the zeros outside the head, driving the
    estimated bias down near the boundary and leaving a bright halo around the
    brain after division. That halo is focal, bright, and roughly lesion-sized,
    which makes it exactly the artifact a lesion detector will fire on.
    """
    data = vol.data.astype(np.float32)
    if not np.any(data > 0):
        return vol

    fg = data > np.percentile(data[data > 0], 5)
    if fg.sum() < 100:
        return vol

    log_img = np.zeros_like(data)
    np.log(data, out=log_img, where=fg)

    weight = fg.astype(np.float32)
    blurred = ndimage.gaussian_filter(log_img * weight, sigma=sigma)
    norm = ndimage.gaussian_filter(weight, sigma=sigma)
    bias = np.divide(blurred, norm, out=np.zeros_like(blurred), where=norm > 1e-3)
    bias -= bias[fg].mean()

    corrected = np.exp(log_img - bias, where=fg, out=np.zeros_like(data))
    corrected[~fg] = 0.0
    return vol.with_data(corrected.astype(np.float32))


def skull_strip(vol: Volume, erosion_radius: int = 4) -> tuple[Volume, np.ndarray]:
    """Produce a brain mask and the masked volume.

    A BET-style intensity threshold (10% into the robust intensity range) first
    separates head from air. That mask still contains skull and scalp, which are
    connected to the brain only through thin bridges, so the brain is isolated by
    eroding until those bridges break, keeping the largest component, and
    dilating back -- morphological opening by reconstruction.

    Do NOT use Otsu here: on a brain volume the dominant intensity split is grey
    matter against white matter, not head against air, so Otsu carves out a
    hollow shell that hole-filling then floods.

    This is a stand-in for HD-BET or FSL BET and is the first thing to replace
    when you move to clinical data.
    """
    data = np.nan_to_num(vol.data)
    if not np.any(data > 0):
        return vol, np.zeros(data.shape, dtype=bool)

    # Robust range, ignoring air and the brightest outliers (fat, flow artifact).
    lo, hi = np.percentile(data[data > 0], [2, 98])
    threshold = lo + 0.10 * (hi - lo)
    head = data > threshold
    if not head.any():
        return vol, np.zeros(data.shape, dtype=bool)

    # Erode to sever skull/scalp from brain, keep the brain, then restore size.
    eroded = ndimage.binary_erosion(head, structure=_ball(erosion_radius))
    if not eroded.any():
        eroded = head

    labels, n = ndimage.label(eroded)
    if n == 0:
        return vol, np.zeros(data.shape, dtype=bool)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    core = labels == int(np.argmax(sizes))

    mask = ndimage.binary_dilation(core, structure=_ball(erosion_radius))
    mask &= head                              # never grow past the head boundary
    mask = ndimage.binary_closing(mask, structure=_ball(2))
    mask = ndimage.binary_fill_holes(mask)

    stripped = vol.with_data(np.where(mask, data, 0.0).astype(np.float32))
    return stripped, mask


def normalize_intensity(vol: Volume, mask: np.ndarray | None = None) -> Volume:
    """Z-score inside the brain, then clip to +/-5 sigma.

    MRI intensities have no absolute units, so every scan must be put on a common
    scale before a model -- or a threshold -- can be applied across studies.
    """
    data = vol.data.astype(np.float32)
    roi = data[mask] if mask is not None and mask.any() else data[data > 0]
    if roi.size == 0:
        return vol

    mean, std = float(roi.mean()), float(roi.std())
    if std < 1e-6:
        std = 1.0
    out = (data - mean) / std
    out = np.clip(out, -5.0, 5.0)
    if mask is not None:
        out[~mask] = 0.0
    return vol.with_data(out.astype(np.float32))


def preprocess(vol: Volume, do_bias: bool = True) -> tuple[Volume, np.ndarray]:
    """Full preprocessing chain. Returns the normalized volume and brain mask."""
    vol = resample_to_spacing(vol)
    if do_bias:
        vol = correct_bias_field(vol)
    vol, brain_mask = skull_strip(vol)
    vol = normalize_intensity(vol, brain_mask)
    return vol, brain_mask


# --- helpers ---------------------------------------------------------------

def _ball(radius: int) -> np.ndarray:
    r = int(radius)
    grid = np.ogrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (grid[0] ** 2 + grid[1] ** 2 + grid[2] ** 2) <= r * r
