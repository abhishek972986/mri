"""Pipeline tests.

These run on synthetic phantoms, where ground truth is known exactly. That makes
them regression tests for the *plumbing and the physics* -- volumes in cm3,
alignment, change direction -- not evidence of clinical accuracy. Nothing here
says anything about performance on real MRI.

Several tests pin numbers that were measured, not guessed (the segmentation
operating point, the registration tolerance). The bounds are loose enough to
survive noise and tight enough to catch a real regression.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy import ndimage

from app.pipeline import (
    atlas,
    compare,
    mesh,
    preprocess,
    quantify,
    registration,
    report,
    segmentation,
    synth,
)
from app.pipeline.volume import Volume


@pytest.fixture(scope="module")
def phantom():
    return synth.make_phantom(n_lesions=5, seed=7)


@pytest.fixture(scope="module")
def processed(phantom):
    return preprocess.preprocess(phantom.volume)


def resample_mask_like(mask, target_shape):
    zoom = [a / b for a, b in zip(target_shape, mask.shape)]
    return ndimage.zoom(mask.astype(np.float32), zoom, order=0) > 0.5


# --- preprocessing ---------------------------------------------------------

def test_resampling_preserves_physical_size(phantom):
    original = phantom.volume
    resampled = preprocess.resample_to_spacing(original, (1.0, 1.0, 1.0))

    assert np.allclose(resampled.spacing, 1.0, atol=1e-6)
    original_mm = np.array(original.shape) * original.spacing
    resampled_mm = np.array(resampled.shape) * resampled.spacing
    # Physical extent must survive resampling; a drift here silently rescales
    # every lesion volume the system reports.
    assert np.allclose(original_mm, resampled_mm, rtol=0.02)


def test_skull_strip_recovers_brain_volume(phantom, processed):
    _, brain_mask = processed
    truth_cm3 = phantom.brain_mask.sum() * phantom.volume.voxel_volume_mm3 / 1000
    measured_cm3 = brain_mask.sum() / 1000        # 1 mm isotropic after preprocessing

    assert measured_cm3 == pytest.approx(truth_cm3, rel=0.15)
    assert 900 < measured_cm3 < 1700, "Brain volume outside the physiological range"


def test_bias_correction_does_not_create_an_edge_halo(phantom):
    """Regression: a plain Gaussian blur of the log image produced a bright rim
    at the brain boundary, which the lesion detector then fired on."""
    resampled = preprocess.resample_to_spacing(phantom.volume)
    corrected = preprocess.correct_bias_field(resampled)
    _, brain = preprocess.skull_strip(corrected)

    surface = brain & ~ndimage.binary_erosion(brain, iterations=3)
    interior = ndimage.binary_erosion(brain, iterations=8)
    assert surface.any() and interior.any()

    rim_median = float(np.median(corrected.data[surface]))
    core_median = float(np.median(corrected.data[interior]))
    assert rim_median < core_median * 1.15, "Bias correction is brightening the brain rim"


def test_normalization_is_zero_mean_in_brain(processed):
    volume, brain_mask = processed
    values = volume.data[brain_mask]
    assert abs(float(values.mean())) < 0.5
    assert 0.5 < float(values.std()) < 2.0


# --- segmentation ----------------------------------------------------------

def test_segmentation_finds_most_lesions(phantom, processed):
    volume, brain_mask = processed
    truth = resample_mask_like(phantom.lesion_mask, volume.shape)

    result = segmentation.segment(volume, brain_mask)
    assert result.method == "classical"

    labels, count = ndimage.label(truth, structure=np.ones((3, 3, 3)))
    detected = sum(1 for i in range(1, count + 1) if (result.mask & (labels == i)).any())
    assert detected >= count - 1, f"Detected only {detected}/{count} phantom lesions"


def test_segmentation_declares_itself_as_a_fallback(processed):
    volume, brain_mask = processed
    result = segmentation.segment(volume, brain_mask)

    assert result.calibrated is False
    assert any("not a trained" in note.lower() for note in result.notes)


def test_segmentation_returns_nothing_on_a_blank_volume():
    blank = Volume(np.zeros((48, 48, 48), dtype=np.float32), np.eye(4))
    result = segmentation.segment(blank, np.zeros((48, 48, 48), dtype=bool))
    assert result.mask.sum() == 0


def test_threshold_operating_point(processed):
    """A higher threshold must trade recall for precision, monotonically.

    This is the measurement behind the DEFAULT_THRESHOLD comment; if the score
    stops being monotonic in the threshold, the tuning no longer means anything.
    """
    volume, brain_mask = processed
    sizes = [
        segmentation.segment(volume, brain_mask, threshold=t).mask.sum()
        for t in (0.4, 0.6, 0.8)
    ]
    assert sizes[0] >= sizes[1] >= sizes[2]


# --- quantification --------------------------------------------------------

def test_lesion_volume_matches_a_known_sphere():
    """A synthetic sphere of known radius must measure its analytic volume."""
    shape = (64, 64, 64)
    radius_vox = 6.0
    grids = np.ogrid[:shape[0], :shape[1], :shape[2]]
    dist_sq = sum((g - 32) ** 2 for g in grids)
    sphere = dist_sq <= radius_vox ** 2

    volume = Volume(sphere.astype(np.float32), np.diag([1.0, 1.0, 1.0, 1.0]))
    lesions, burden = quantify.quantify(volume, sphere, sphere.astype(np.float32), np.ones(shape, bool))

    assert burden.lesion_count == 1
    analytic_mm3 = 4 / 3 * np.pi * radius_vox ** 3
    assert lesions[0].volume_mm3 == pytest.approx(analytic_mm3, rel=0.06)
    assert lesions[0].max_diameter_mm == pytest.approx(2 * radius_vox, rel=0.15)
    assert lesions[0].sphericity > 0.85


def test_quantification_scales_with_voxel_size():
    """The same mask on a coarser grid must report a proportionally larger volume."""
    shape = (40, 40, 40)
    mask = np.zeros(shape, dtype=bool)
    mask[18:23, 18:23, 18:23] = True

    fine = Volume(mask.astype(np.float32), np.diag([1.0, 1.0, 1.0, 1.0]))
    coarse = Volume(mask.astype(np.float32), np.diag([2.0, 2.0, 2.0, 1.0]))

    _, fine_burden = quantify.quantify(fine, mask, None, np.ones(shape, bool))
    _, coarse_burden = quantify.quantify(coarse, mask, None, np.ones(shape, bool))

    assert coarse_burden.total_volume_mm3 == pytest.approx(fine_burden.total_volume_mm3 * 8, rel=1e-6)


def test_touching_lesions_are_one_component():
    shape = (40, 40, 40)
    mask = np.zeros(shape, dtype=bool)
    mask[10:16, 10:16, 10:16] = True
    mask[16:22, 16:22, 16:22] = True       # touches the first only at a corner

    volume = Volume(mask.astype(np.float32), np.eye(4))
    _, burden = quantify.quantify(volume, mask, None, np.ones(shape, bool))
    assert burden.lesion_count == 1, "26-connectivity should merge corner-touching blobs"


# --- anatomical labelling --------------------------------------------------

def test_atlas_assigns_laterality_consistently():
    brain = np.zeros((100, 100, 100), dtype=bool)
    brain[10:90, 10:90, 10:90] = True
    frame = atlas.build_frame(np.diag([1.0, 1.0, 1.0, 1.0]), brain)

    left = atlas.label_lesion(frame, np.array([20.0, 50.0, 50.0]))
    right = atlas.label_lesion(frame, np.array([80.0, 50.0, 50.0]))
    middle = atlas.label_lesion(frame, np.array([50.0, 50.0, 50.0]))

    assert left["side"] == "left"
    assert right["side"] == "right"
    assert middle["side"] == "midline"


def test_atlas_respects_flipped_orientation():
    """An LAS affine must not silently mirror left and right."""
    brain = np.zeros((100, 100, 100), dtype=bool)
    brain[10:90, 10:90, 10:90] = True

    ras = atlas.build_frame(np.diag([1.0, 1.0, 1.0, 1.0]), brain)
    las = atlas.build_frame(np.diag([-1.0, 1.0, 1.0, 1.0]), brain)

    point = np.array([20.0, 50.0, 50.0])
    assert ras.normalize(point)[0][0] != pytest.approx(las.normalize(point)[0][0])


# --- registration ----------------------------------------------------------

def test_registration_recovers_a_known_transform(processed):
    volume, brain_mask = processed

    angles = np.array([0.08, -0.05, 0.06])
    shift = np.array([4.0, -3.0, 3.0])
    rotation = synth._rotation(angles)
    centre = (np.asarray(volume.shape) - 1) / 2.0
    offset = centre - rotation @ centre - shift

    moved = ndimage.affine_transform(volume.data, rotation, offset=offset, order=1)
    moved_brain = ndimage.affine_transform(
        brain_mask.astype(np.float32), rotation, offset=offset, order=0
    ) > 0.5

    result = registration.register_rigid(
        volume, Volume(moved.astype(np.float32), volume.affine),
        moving_masks={"brain": moved_brain}, use_sitk=False,
    )

    def dice(a, b):
        return 2 * np.logical_and(a, b).sum() / max(a.sum() + b.sum(), 1)

    before = dice(brain_mask, moved_brain)
    after = dice(brain_mask, result.registered_masks["brain"])
    assert after > before, "Registration made the alignment worse"
    assert after > 0.97, f"Post-registration Dice only {after:.3f}"


def test_registration_warps_masks_and_images_consistently(processed):
    """The mask path and the image path must apply the same transform.

    They run different code (nearest-neighbour vs linear interpolation), so a
    sign error in one would displace lesions relative to the anatomy with no
    error raised anywhere. The same array is sent down both paths and the
    results must agree; sending the *image* down both would prove nothing,
    because a z-scored volume straddles zero and no threshold on it recovers
    the brain.
    """
    volume, brain_mask = processed
    shifted = np.roll(volume.data, 5, axis=0)
    shifted_mask = np.roll(brain_mask, 5, axis=0)

    result = registration.register_rigid(
        volume, Volume(shifted, volume.affine),
        moving_masks={"brain": shifted_mask},
        moving_images={"brain_as_image": shifted_mask.astype(np.float32)},
        use_sitk=False,
    )

    via_image = result.registered_images["brain_as_image"] > 0.5
    via_mask = result.registered_masks["brain"]

    overlap = 2 * np.logical_and(via_image, via_mask).sum() / max(
        via_image.sum() + via_mask.sum(), 1
    )
    assert overlap > 0.99, f"Mask and image paths diverged (Dice {overlap:.4f})"


# --- comparison ------------------------------------------------------------

def _lesion_at(centre, radius, shape=(64, 64, 64)):
    grids = np.ogrid[:shape[0], :shape[1], :shape[2]]
    dist_sq = sum((g - c) ** 2 for g, c in zip(grids, centre))
    return dist_sq <= radius ** 2


def test_comparison_detects_shrinkage():
    shape = (64, 64, 64)
    brain = np.ones(shape, dtype=bool)
    volume = Volume(np.ones(shape, dtype=np.float32), np.eye(4))

    before = _lesion_at((32, 32, 32), 8)
    after = _lesion_at((32, 32, 32), 5)

    base_lesions, base_burden = quantify.quantify(volume, before, None, brain)
    follow_lesions, follow_burden = quantify.quantify(volume, after, None, brain)

    result = compare.compare_studies(
        base_lesions, base_burden, follow_lesions, follow_burden, before, after
    )

    assert result.trend == "improving"
    assert len(result.lesion_changes) == 1
    assert result.lesion_changes[0]["status"] == "decreased"
    assert result.lesion_changes[0]["volume_change_percent"] < -40


def test_comparison_flags_a_new_lesion():
    shape = (64, 64, 64)
    brain = np.ones(shape, dtype=bool)
    volume = Volume(np.ones(shape, dtype=np.float32), np.eye(4))

    before = _lesion_at((20, 20, 20), 6)
    after = before | _lesion_at((45, 45, 45), 6)

    base_lesions, base_burden = quantify.quantify(volume, before, None, brain)
    follow_lesions, follow_burden = quantify.quantify(volume, after, None, brain)

    result = compare.compare_studies(
        base_lesions, base_burden, follow_lesions, follow_burden, before, after
    )

    statuses = [c["status"] for c in result.lesion_changes]
    assert "new" in statuses
    assert any(a["type"] == "new_lesion" and a["severity"] == "high" for a in result.alerts)


def test_small_change_reads_as_stable():
    """Measurement noise must not be reported as treatment response."""
    shape = (64, 64, 64)
    brain = np.ones(shape, dtype=bool)
    volume = Volume(np.ones(shape, dtype=np.float32), np.eye(4))

    before = _lesion_at((32, 32, 32), 8.0)
    after = _lesion_at((32, 32, 32), 8.2)

    base_lesions, base_burden = quantify.quantify(volume, before, None, brain)
    follow_lesions, follow_burden = quantify.quantify(volume, after, None, brain)

    result = compare.compare_studies(
        base_lesions, base_burden, follow_lesions, follow_burden, before, after
    )
    assert result.lesion_changes[0]["status"] == "stable"


# --- reporting -------------------------------------------------------------

def test_report_always_carries_the_disclaimer(processed):
    volume, brain_mask = processed
    seg = segmentation.segment(volume, brain_mask)
    lesions, burden = quantify.quantify(volume, seg.mask, seg.probability, brain_mask)

    built = report.build_report(lesions, burden, seg.method, ["FLAIR"], seg.calibrated)

    assert "NOT A DIAGNOSIS" in built.disclaimer
    assert built.status == "draft"
    assert built.confidence["calibrated"] is False
    assert any("classical" in lim.lower() for lim in built.limitations)
    assert any("single sequence" in lim.lower() for lim in built.limitations)


def test_report_on_a_negative_study_does_not_claim_exclusion():
    """A negative result must not be phrased as ruling TB out."""
    empty_burden = quantify.summarize([], np.ones((32, 32, 32), bool), 1.0)
    built = report.build_report([], empty_burden, "unet", ["FLAIR", "T1C"], calibrated=True)

    assert "does not exclude" in built.impression
    assert built.confidence["tb_pattern_score"] == 0.0


def test_tb_pattern_score_rewards_typical_sites():
    """Lesions in TB-predilection sites should score above lesions elsewhere."""
    shape = (100, 100, 100)
    brain = np.ones(shape, dtype=bool)
    volume = Volume(np.ones(shape, dtype=np.float32), np.eye(4))

    def score_for(mask):
        lesions, burden = quantify.quantify(volume, mask, None, brain)
        return report.build_report(lesions, burden, "unet", ["T1C"]).confidence["tb_pattern_score"]

    # Two lesions low and posterior (cerebellum/brainstem zone) versus two high
    # and anterior (frontal convexity).
    typical = _lesion_at((40, 25, 20), 5, shape) | _lesion_at((60, 25, 20), 5, shape)
    atypical = _lesion_at((30, 85, 80), 5, shape) | _lesion_at((70, 85, 80), 5, shape)

    assert score_for(typical) > score_for(atypical)


# --- meshing ---------------------------------------------------------------

def test_mesh_is_watertight_enough_to_render():
    sphere = _lesion_at((32, 32, 32), 9)
    surface = mesh.extract_surface(sphere, np.eye(4))

    assert surface is not None
    assert surface["triangle_count"] > 100
    assert len(surface["positions"]) == surface["vertex_count"] * 3
    assert len(surface["normals"]) == len(surface["positions"])
    assert max(surface["indices"]) < surface["vertex_count"], "Index out of range would crash WebGL"


def test_mesh_is_centred_on_the_brain():
    brain = np.zeros((64, 64, 64), dtype=bool)
    brain[16:48, 16:48, 16:48] = True
    lesion = _lesion_at((32, 32, 32), 5)

    scene = mesh.build_scene(brain, lesion, np.eye(4), [])
    positions = np.array(scene["brain"]["positions"]).reshape(-1, 3)
    assert np.allclose(positions.mean(axis=0), 0, atol=3.0)


def test_empty_mask_produces_no_surface():
    assert mesh.extract_surface(np.zeros((32, 32, 32), dtype=bool), np.eye(4)) is None
