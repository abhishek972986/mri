"""Orchestration: run the pipeline over a stored study and persist the artifacts.

Split of responsibility -- the modules under `pipeline/` are pure functions over
arrays and know nothing about the database or the filesystem layout. This layer
owns that mapping, so the science stays testable without a running server.

Derived artifacts per analysis:

    derived/analysis_<id>/
        preprocessed.nii.gz     normalized, skull-stripped volume
        brain_mask.nii.gz
        lesion_mask.nii.gz
        probability.nii.gz      the heatmap, kept for re-thresholding and review
        scene.json              meshes for the 3D viewer
        report.json
        slices/                 rendered PNG slice sets

The NIfTIs are kept, not just the summaries, because a reviewer who rejects a
lesion needs the voxels back to correct it, and because re-running downstream
steps at a different threshold should never require re-reading the original.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ..config import settings
from ..pipeline import (
    compare,
    mesh,
    preprocess,
    quantify,
    registration,
    report as report_mod,
    segmentation,
    slices,
)
from ..pipeline.volume import Volume, load_volume, save_mask, save_volume

logger = logging.getLogger(__name__)


@dataclass
class AnalysisArtifacts:
    directory: Path
    method: str
    burden: dict
    lesions: list[dict]
    report: dict
    slices: dict
    technique: dict
    duration_seconds: float


def analysis_dir(analysis_id: int) -> Path:
    return settings.derived_dir / f"analysis_{analysis_id}"


def run_analysis(
    study_path: str | Path,
    sequence: str,
    analysis_id: int,
    threshold: float | None = None,
) -> AnalysisArtifacts:
    """Full single-study pipeline. Raises on unrecoverable input problems."""
    started = time.perf_counter()
    threshold = settings.segmentation_threshold if threshold is None else threshold

    out_dir = analysis_dir(analysis_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    volume = load_volume(study_path, sequence=sequence)
    original_shape = volume.shape
    original_spacing = [round(float(s), 3) for s in volume.spacing]

    processed, brain_mask = preprocess.preprocess(volume)
    if not brain_mask.any():
        raise ValueError(
            "Brain extraction produced an empty mask. The upload may not be a brain MRI, "
            "or may be too heavily corrupted to process."
        )

    seg = segmentation.segment(
        processed, brain_mask, checkpoint=settings.active_checkpoint, threshold=threshold
    )
    lesions, burden = quantify.quantify(processed, seg.mask, seg.probability, brain_mask)

    save_volume(processed, out_dir / "preprocessed.nii.gz")
    save_mask(brain_mask, processed.affine, out_dir / "brain_mask.nii.gz")
    save_mask(seg.mask, processed.affine, out_dir / "lesion_mask.nii.gz")
    save_volume(processed.with_data(seg.probability), out_dir / "probability.nii.gz")

    scene = mesh.build_scene(brain_mask, seg.mask, processed.affine, lesions)
    (out_dir / "scene.json").write_text(json.dumps(scene), encoding="utf-8")

    slice_manifest = slices.render_study_slices(
        processed, seg.probability, seg.mask, brain_mask, out_dir / "slices"
    )

    technique = {
        "original_shape": list(original_shape),
        "original_spacing_mm": original_spacing,
        "processed_shape": list(processed.shape),
        "processed_spacing_mm": [round(float(s), 3) for s in processed.spacing],
        "segmentation_threshold": threshold,
        "segmentation_notes": seg.notes,
    }

    built = report_mod.build_report(
        lesions=lesions,
        burden=burden,
        segmentation_method=seg.method,
        sequences=[sequence],
        calibrated=seg.calibrated,
        preprocessing=technique,
        provenance=seg.provenance,
    )
    (out_dir / "report.json").write_text(json.dumps(built.to_dict(), indent=2), encoding="utf-8")

    duration = time.perf_counter() - started
    logger.info("Analysis %s finished in %.1fs (%s)", analysis_id, duration, seg.method)

    return AnalysisArtifacts(
        directory=out_dir,
        method=seg.method,
        burden=burden.to_dict(),
        lesions=[l.to_dict() for l in lesions],
        report=built.to_dict(),
        slices=slice_manifest,
        technique=technique,
        duration_seconds=round(duration, 2),
    )


def run_comparison(baseline_analysis_id: int, followup_analysis_id: int) -> dict:
    """Compare two completed analyses after aligning the follow-up to the baseline.

    The follow-up's *existing* segmentation is warped into baseline space rather
    than re-segmented there. Re-segmenting would let the detector respond to
    interpolation differences, so part of the measured change would come from the
    resampling rather than from the patient.
    """
    base_dir = analysis_dir(baseline_analysis_id)
    follow_dir = analysis_dir(followup_analysis_id)

    for directory in (base_dir, follow_dir):
        if not (directory / "preprocessed.nii.gz").exists():
            raise FileNotFoundError(
                f"Analysis artifacts missing at {directory.name}. Re-run the analysis before comparing."
            )

    base_vol = load_volume(base_dir / "preprocessed.nii.gz")
    base_brain = load_volume(base_dir / "brain_mask.nii.gz").data > 0.5
    base_lesions_mask = load_volume(base_dir / "lesion_mask.nii.gz").data > 0.5
    base_prob = load_volume(base_dir / "probability.nii.gz").data

    follow_vol = load_volume(follow_dir / "preprocessed.nii.gz")
    follow_brain = load_volume(follow_dir / "brain_mask.nii.gz").data > 0.5
    follow_lesions_mask = load_volume(follow_dir / "lesion_mask.nii.gz").data > 0.5
    follow_prob = load_volume(follow_dir / "probability.nii.gz").data

    reg = registration.register_rigid(
        fixed=base_vol,
        moving=follow_vol,
        moving_masks={"brain": follow_brain, "lesion": follow_lesions_mask},
        # The probability map must ride the same transform as the mask it explains,
        # or the heatmap in the viewer would sit beside the lesions, not on them.
        moving_images={"probability": follow_prob},
    )

    follow_brain_reg = reg.registered_masks["brain"]
    follow_lesion_reg = reg.registered_masks["lesion"]
    follow_prob_reg = reg.registered_images["probability"]

    base_lesion_list, base_burden = quantify.quantify(
        base_vol, base_lesions_mask, base_prob, base_brain
    )
    follow_lesion_list, follow_burden = quantify.quantify(
        reg.moving_registered, follow_lesion_reg, follow_prob_reg, follow_brain_reg
    )

    result = compare.compare_studies(
        baseline_lesions=base_lesion_list,
        baseline_burden=base_burden,
        followup_lesions=follow_lesion_list,
        followup_burden=follow_burden,
        baseline_mask=base_lesions_mask,
        followup_mask=follow_lesion_reg,
        registration_info=reg.summary(),
        segmentation_method=_method_of(base_dir),
    )

    payload = result.to_dict()
    payload["baseline_analysis_id"] = baseline_analysis_id
    payload["followup_analysis_id"] = followup_analysis_id
    payload["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # A comparison scene for the viewer: baseline and follow-up lesions in the
    # same coordinate frame, which is the whole point of having registered them.
    payload["scene"] = _comparison_scene(
        base_brain, base_lesions_mask, base_lesion_list,
        follow_lesion_reg, follow_lesion_list, base_vol.affine,
    )

    comparison_dir = settings.derived_dir / f"comparison_{baseline_analysis_id}_{followup_analysis_id}"
    comparison_dir.mkdir(parents=True, exist_ok=True)
    save_mask(follow_lesion_reg, base_vol.affine, comparison_dir / "followup_lesion_registered.nii.gz")
    (comparison_dir / "comparison.json").write_text(json.dumps(payload), encoding="utf-8")

    return payload


def _method_of(analysis_directory: Path) -> str | None:
    """Read back which segmentation backend produced an analysis, from its report."""
    report_path = analysis_directory / "report.json"
    if not report_path.exists():
        return None
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload.get("technique", {}).get("segmentation_method")


def _comparison_scene(
    brain_mask: np.ndarray,
    baseline_mask: np.ndarray,
    baseline_lesions: list,
    followup_mask: np.ndarray,
    followup_lesions: list,
    affine: np.ndarray,
) -> dict:
    """Meshes for the side-by-side 3D comparison, plus a voxelwise change map."""
    origin = mesh.brain_centre_world(brain_mask, affine)

    resolved = baseline_mask & ~followup_mask       # present before, gone now
    new = followup_mask & ~baseline_mask            # appeared since
    persistent = baseline_mask & followup_mask

    def surface(mask):
        return mesh.extract_surface(mask, affine, step=1, smooth_sigma=0.7, origin_offset=origin)

    return {
        "units": "millimetres",
        "origin_world_mm": [round(float(o), 2) for o in origin],
        "brain": mesh.extract_surface(
            brain_mask, affine, step=mesh.BRAIN_STEP, smooth_sigma=1.5, origin_offset=origin
        ),
        "baseline": mesh.build_scene(brain_mask, baseline_mask, affine, baseline_lesions)["lesions"],
        "followup": mesh.build_scene(brain_mask, followup_mask, affine, followup_lesions)["lesions"],
        "change": {
            "resolved": surface(resolved),
            "new": surface(new),
            "persistent": surface(persistent),
        },
        "bounds_mm": mesh.bounds(brain_mask, affine, origin),
    }
