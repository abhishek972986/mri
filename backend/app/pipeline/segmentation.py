"""Lesion segmentation: trained-model inference, with a classical fallback.

The system is designed so the whole product loop -- upload, analyse, quantify,
compare, visualise, report -- works before a trained model exists. Two backends:

  "unet"      A trained 3D U-Net, run with sliding-window inference and
              test-time augmentation. Used whenever a checkpoint is present.

  "classical" Multi-scale Laplacian-of-Gaussian blob detection combined with an
              intensity-outlier score. This is NOT a diagnostic model. It finds
              focal hyperintense foci of plausible size, which is enough to
              exercise and demo the pipeline, and it is honest about what it is.

`SegmentationOutput.probability` doubles as the explainability heatmap for the
viewer, so the UI has something meaningful to show under either backend.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import ndimage

from .volume import Volume

logger = logging.getLogger(__name__)

# Tuberculomas are typically 3-25 mm. Anything far outside that is more likely
# to be a vessel, an artifact, or a large non-TB process.
MIN_LESION_MM3 = 30.0
# Operating point chosen on synthetic phantoms (backend/tests/test_pipeline.py::
# test_threshold_operating_point): 0.6 keeps ~84% per-lesion detection at ~1.8
# false components per scan, where 0.5 roughly doubles the false calls for four
# more points of recall. Re-derive this on real data before any clinical claim.
DEFAULT_THRESHOLD = 0.6

# A lesion must stand this many standard deviations of brain intensity above its
# local background before the classical detector treats it as focal. Fixed rather
# than percentile-derived so a clean scan does not have its own noise promoted.
CONTRAST_SD = 1.6

# Detection is restricted to voxels at least this far inside the brain surface.
# See the Step 0 comment in _segment_classical for why, and note the sensitivity
# cost it carries near the cortex.
DETECTION_MARGIN_MM = 5.0

# Shape priors for the classical detector's component filter.
MAX_LESION_DIAMETER_MM = 40.0
MIN_FILL_FRACTION = 0.22


@dataclass
class SegmentationOutput:
    probability: np.ndarray                 # float32 in [0, 1], per-voxel lesion likelihood
    mask: np.ndarray                        # bool, thresholded + size-filtered
    method: str
    threshold: float = DEFAULT_THRESHOLD
    model_confidence: float = 0.0           # mean probability inside the predicted mask
    calibrated: bool = False                # True only for a model with a validated calibration curve
    notes: list[str] = field(default_factory=list)
    # What the weights were actually trained on. Empty for the classical
    # detector. Carried all the way into the report, because a model trained on
    # one pathology must not be presented as evidence about another.
    provenance: dict = field(default_factory=dict)


def segment(
    vol: Volume,
    brain_mask: np.ndarray | None = None,
    checkpoint: str | Path | None = None,
    threshold: float | None = None,
) -> SegmentationOutput:
    """Segment lesions, preferring a trained checkpoint when one is available.

    `threshold=None` means "use the right one for whichever backend runs". A
    trained checkpoint carries its own operating point, tuned on validation;
    DEFAULT_THRESHOLD is only correct for the classical detector it was measured
    against. Passing one phantom-derived constant to every backend cost about
    half the achievable precision on the first real case it met.
    """
    if brain_mask is None:
        brain_mask = vol.data != 0

    if checkpoint is not None and Path(checkpoint).exists():
        try:
            return _segment_unet(vol, brain_mask, Path(checkpoint), threshold)
        except Exception as exc:  # a broken checkpoint must not take the API down
            logger.warning("U-Net inference failed (%s); falling back to classical detector", exc)

    return _segment_classical(
        vol, brain_mask, DEFAULT_THRESHOLD if threshold is None else threshold
    )


# --- trained model ---------------------------------------------------------

def _segment_unet(
    vol: Volume, brain_mask: np.ndarray, checkpoint: Path, threshold: float | None
) -> SegmentationOutput:
    import torch

    from .nets import UNet3D

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    # Always deserialise to CPU, then move the model. Loading straight to a
    # CUDA device fails whenever the saved tensors name a device this host
    # does not have - a CPU-only machine, or CUDA_VISIBLE_DEVICES set empty.
    state = torch.load(checkpoint, map_location="cpu", weights_only=False)
    config = state.get("config", {})

    model = UNet3D(
        in_channels=config.get("in_channels", 1),
        out_channels=1,
        base_channels=config.get("base_channels", 16),
        depth=config.get("depth", 4),
        attention=config.get("attention", False),
    ).to(device)
    model.load_state_dict(state["model"])
    model.eval()

    patch = tuple(config.get("patch_size", (96, 96, 96)))

    # The checkpoint's own operating point, written by evaluate.py --tune after
    # sweeping the validation set. Falls back to the module default only when a
    # checkpoint has never been tuned.
    if threshold is None:
        threshold = float(config.get("operating_threshold") or DEFAULT_THRESHOLD)

    prob = _sliding_window_inference(model, vol.data, patch, device)
    prob[~brain_mask] = 0.0

    mask = _postprocess(
        prob, threshold, vol.voxel_volume_mm3, vol.spacing, shape_filter=False
    )
    confidence = float(prob[mask].mean()) if mask.any() else 0.0

    provenance = {
        "checkpoint": checkpoint.name,
        "trained_on": config.get("trained_on"),
        "pathology": config.get("pathology"),
        "not_tuberculosis": bool(config.get("not_tuberculosis", False)),
        "train_case_count": config.get("train_case_count"),
        "val_dice": config.get("val_patch_dice") or config.get("val_dice"),
        "held_out_dice": config.get("test_dice"),
        "operating_threshold": config.get("operating_threshold"),
        "threshold_tuned_on": config.get("threshold_tuned_on"),
    }

    notes = [f"Checkpoint: {checkpoint.name}", f"Device: {device.type}"]
    if config.get("operating_threshold"):
        notes.append(
            f"Threshold {threshold} tuned on "
            f"{config.get('threshold_tuned_on', 'validation')}"
        )
    else:
        notes.append(
            f"Threshold {threshold} is the module default and has NOT been tuned "
            "for these weights; run evaluate.py --tune."
        )
    if provenance["pathology"]:
        notes.append(f"Model trained on: {provenance['pathology']}")
    if provenance["not_tuberculosis"]:
        notes.append(
            "These weights have never seen a tuberculoma. They segment focal "
            "brain lesions learned from a different disease."
        )

    return SegmentationOutput(
        probability=prob,
        mask=mask,
        method="unet",
        threshold=threshold,
        model_confidence=confidence,
        calibrated=bool(config.get("calibrated", False)),
        notes=notes,
        provenance=provenance,
    )


def _sliding_window_inference(
    model, data: np.ndarray, patch: tuple[int, int, int], device, overlap: float = 0.5
) -> np.ndarray:
    """Tile the volume, average overlapping predictions with a Gaussian window.

    Gaussian rather than uniform weighting because patch-edge predictions are
    unreliable -- the network has no context beyond the border there.
    """
    import torch

    accum = np.zeros(data.shape, dtype=np.float32)
    weights = np.zeros(data.shape, dtype=np.float32)
    window = _gaussian_window(patch)

    strides = [max(int(p * (1 - overlap)), 1) for p in patch]
    starts = [
        _tile_starts(dim, p, s) for dim, p, s in zip(data.shape, patch, strides)
    ]

    with torch.no_grad():
        for x in starts[0]:
            for y in starts[1]:
                for z in starts[2]:
                    sl = (
                        slice(x, x + patch[0]),
                        slice(y, y + patch[1]),
                        slice(z, z + patch[2]),
                    )
                    chunk = data[sl]
                    padded = np.zeros(patch, dtype=np.float32)
                    padded[: chunk.shape[0], : chunk.shape[1], : chunk.shape[2]] = chunk

                    tensor = torch.from_numpy(padded)[None, None].to(device)
                    logits = model(tensor)
                    # Test-time augmentation: average over the 3 axis flips.
                    for axis in (2, 3, 4):
                        logits = logits + torch.flip(model(torch.flip(tensor, [axis])), [axis])
                    pred = torch.sigmoid(logits / 4.0)[0, 0].cpu().numpy()

                    accum[sl] += (pred * window)[: chunk.shape[0], : chunk.shape[1], : chunk.shape[2]]
                    weights[sl] += window[: chunk.shape[0], : chunk.shape[1], : chunk.shape[2]]

    return np.divide(accum, weights, out=np.zeros_like(accum), where=weights > 0)


def _tile_starts(dim: int, patch: int, stride: int) -> list[int]:
    if dim <= patch:
        return [0]
    starts = list(range(0, dim - patch + 1, stride))
    if starts[-1] != dim - patch:
        starts.append(dim - patch)
    return starts


def _gaussian_window(patch: tuple[int, int, int], sigma_scale: float = 0.125) -> np.ndarray:
    axes = []
    for size in patch:
        coords = np.arange(size) - (size - 1) / 2.0
        sigma = max(size * sigma_scale, 1e-3)
        axes.append(np.exp(-(coords ** 2) / (2 * sigma ** 2)))
    window = axes[0][:, None, None] * axes[1][None, :, None] * axes[2][None, None, :]
    return (window / window.max()).astype(np.float32) + 1e-3


# --- classical fallback ----------------------------------------------------

def _segment_classical(vol: Volume, brain_mask: np.ndarray, threshold: float) -> SegmentationOutput:
    """Multi-scale blob detection for focal hyperintense lesions.

    Scale-normalized Laplacian of Gaussian gives a strong negative response at the
    centre of a bright blob whose size matches the kernel scale. Sweeping the scale
    across the tuberculoma size range and keeping the strongest response per voxel
    yields a size-agnostic focal-lesion detector.
    """
    data = np.nan_to_num(vol.data.astype(np.float32))
    spacing = float(np.mean(vol.spacing))
    if not brain_mask.any():
        empty = np.zeros(data.shape, dtype=np.float32)
        return SegmentationOutput(
            probability=empty, mask=empty.astype(bool), method="classical",
            threshold=threshold, notes=["Empty brain mask; nothing to segment."],
        )

    # Step 0. Work inside an eroded brain mask.
    #
    # The outermost shell of any brain mask contains partial-volume voxels -- part
    # brain, part CSF or inner skull table -- which are darker than real brain.
    # Left in, they drag the local background estimate down along the whole
    # surface, so the normal cortex just inside reads as focally bright and the
    # detector returns the entire cortical ribbon as one enormous lesion.
    #
    # The cost is real and is declared in the report: lesions whose centre lies
    # within DETECTION_MARGIN_MM of the brain surface will be missed, and the
    # corticomedullary junction is a site TB favours.
    erode_voxels = max(int(round(DETECTION_MARGIN_MM / spacing)), 1)
    detect_mask = ndimage.binary_erosion(brain_mask, structure=_ball(erode_voxels))
    if not detect_mask.any():
        detect_mask = brain_mask

    # Step 1. Ring-enhancing tuberculomas have a bright rim around a dark
    # caseating centre, so a plain blob detector sees a hollow shell and scores
    # the lesion centre as background. Greyscale closing fills any dark region
    # enclosed by a brighter one, turning a ring into the solid blob the
    # detector expects, and leaving genuinely solid lesions unchanged.
    filled = data
    for radius_mm in (3.0, 6.0, 10.0):
        size = max(int(round(2 * radius_mm / spacing)) | 1, 3)
        filled = np.maximum(filled, ndimage.grey_closing(data, size=size))

    # Step 2. Local contrast: subtract a smooth background estimate taken at a
    # scale well above lesion size. What survives is structure that is bright
    # *for its neighbourhood*, which is what "focal" means -- without this, all
    # white matter looks bright and the detector fires across the hemisphere.
    #
    # The background is a mask-normalized Gaussian, not a morphological opening.
    # An opening is a min-based operator, so ventricles and the brain edge drag
    # it to zero and it subtracts nothing at all.
    background = _masked_blur(filled, detect_mask, sigma=12.0 / spacing)
    local_contrast = (filled - background) * detect_mask

    # Absolute scale: the volume is z-scored, so contrast is in standard
    # deviations of brain intensity and CONTRAST_SD is a fixed, interpretable
    # criterion rather than a percentile that drifts with each scan.
    focal_score = np.clip(local_contrast / CONTRAST_SD, 0, 1)

    # Step 3. Scale-normalized Laplacian of Gaussian, for shape rather than
    # brightness: a strong response means "round object of about this size".
    radii_mm = np.array([2.0, 3.0, 4.5, 6.0, 8.0, 10.0])
    sigmas = np.clip(radii_mm / spacing / np.sqrt(3.0), 0.8, 12.0)

    blob_response = np.zeros(data.shape, dtype=np.float32)
    for sigma in sigmas:
        log = ndimage.gaussian_laplace(filled, sigma=sigma)
        blob_response = np.maximum(blob_response, (-log * sigma ** 2).astype(np.float32))

    resp_inside = blob_response[detect_mask]
    resp_scale = float(np.percentile(resp_inside, 99.5)) or 1.0
    blob_score = np.clip(blob_response / resp_scale, 0, 1)

    # A lesion must be both focally bright and blob-shaped; the geometric mean
    # requires agreement rather than letting either signal carry alone.
    probability = np.sqrt(focal_score * blob_score).astype(np.float32)
    probability = ndimage.gaussian_filter(probability, sigma=0.8)
    probability[~detect_mask] = 0.0

    mask = _postprocess(
        probability, threshold, vol.voxel_volume_mm3, vol.spacing, shape_filter=True
    )
    confidence = float(probability[mask].mean()) if mask.any() else 0.0

    return SegmentationOutput(
        probability=probability,
        mask=mask,
        method="classical",
        threshold=threshold,
        model_confidence=confidence,
        calibrated=False,
        notes=[
            "Classical blob detector, not a trained diagnostic model. It flags focal "
            "hyperintense foci of plausible size and cannot distinguish tuberculomas "
            "from other focal lesions. Train a model and pass a checkpoint for real use.",
            f"Detection restricted to voxels more than {DETECTION_MARGIN_MM:.0f} mm inside "
            "the brain surface; superficial and juxtacortical lesions will be missed.",
        ],
    )


# --- shared ----------------------------------------------------------------

def _ball(radius: int) -> np.ndarray:
    r = int(radius)
    grid = np.ogrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (grid[0] ** 2 + grid[1] ** 2 + grid[2] ** 2) <= r * r


def _masked_blur(data: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur that only averages over masked voxels (normalized convolution).

    A plain blur would mix in the zeros outside the brain and bias the background
    estimate downward near the surface, producing a false bright rim.
    """
    weight = mask.astype(np.float32)
    num = ndimage.gaussian_filter(data * weight, sigma=sigma)
    den = ndimage.gaussian_filter(weight, sigma=sigma)
    return np.divide(num, den, out=np.zeros_like(num), where=den > 1e-3)


def _postprocess(
    probability: np.ndarray,
    threshold: float,
    voxel_mm3: float,
    spacing: np.ndarray | None = None,
    shape_filter: bool = True,
) -> np.ndarray:
    """Threshold, then reject components that cannot plausibly be tuberculomas.

    Three criteria, all from the known morphology of the lesion being looked for:
    a minimum volume, a maximum extent, and a minimum compactness. The last is
    what removes the sheet- and shell-shaped false positives that thresholding a
    contrast map inevitably produces along tissue boundaries -- those hug an
    interface and are nothing like the round mass a tuberculoma forms.

    The shape filter applies only to the classical detector. A trained model has
    learned shape from data, and imposing a hand-written prior on top of it would
    silently discard exactly the atypical lesions it was trained to find.
    """
    mask = probability >= threshold
    if not mask.any():
        return mask

    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3, 3)))
    labels, n = ndimage.label(mask, structure=np.ones((3, 3, 3)))
    if n == 0:
        return np.zeros_like(mask)

    if spacing is None:
        spacing = np.full(3, float(np.cbrt(max(voxel_mm3, 1e-6))))

    min_voxels = max(int(MIN_LESION_MM3 / max(voxel_mm3, 1e-6)), 3)
    sizes = np.bincount(labels.ravel())
    keep = np.zeros(sizes.shape, dtype=bool)
    keep[1:] = sizes[1:] >= min_voxels

    if shape_filter:
        for index in np.flatnonzero(keep):
            component = labels == index
            coords = np.argwhere(component)
            extent_mm = (coords.max(axis=0) - coords.min(axis=0) + 1) * spacing

            if extent_mm.max() > MAX_LESION_DIAMETER_MM:
                keep[index] = False
                continue

            # Compactness: actual volume against its bounding-box volume. A round
            # mass fills roughly half its box; a sheet or shell fills very little.
            fill_fraction = sizes[index] * voxel_mm3 / float(np.prod(extent_mm))
            if fill_fraction < MIN_FILL_FRACTION:
                keep[index] = False

    return keep[labels]
