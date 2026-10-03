"""Analysis, artifact, report, comparison, review and dashboard endpoints.

Every route resolves its resource through the signed-in doctor's patients
(services/auth.require_*), so one doctor can never read another's scans.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlmodel import Session, select

from ..db import engine, get_session
from ..models import Analysis, AnalysisStatus, Comparison, Doctor, Patient, Review, Study
from ..schemas import (
    AnalysisRead,
    AnalysisSummary,
    ComparisonCreate,
    ComparisonRead,
    ReviewCreate,
    ReviewRead,
)
from ..pipeline.compare import normalize_result
from ..pipeline.report import normalize_report, normalize_technique, public_lesions
from ..services import auth, pipeline_service, storage
from .patients import display_name, latest_analysis, patient_read, scan_status, study_read

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["analyses"])


def analysis_read(analysis: Analysis) -> AnalysisRead:
    data = analysis.model_dump()
    # Stored reports may predate the current wording; serve them normalized.
    data["report"] = normalize_report(analysis.report)
    data["technique"] = normalize_technique(analysis.technique)
    data["lesions"] = public_lesions(analysis.lesions) if analysis.lesions is not None else None
    return AnalysisRead(**data, has_snapshot=bool(analysis.snapshot_path))


def comparison_read(comparison: Comparison) -> ComparisonRead:
    data = comparison.model_dump()
    data["result"] = normalize_result(comparison.result)
    return ComparisonRead(**data)


@router.get("/pipeline/stages")
def pipeline_stages() -> list[dict]:
    """The analysis stages in execution order, for the processing screen."""
    return [{"key": key, "label": label} for key, label in pipeline_service.STAGES]


@router.post("/studies/{study_id}/analyze", response_model=AnalysisRead, status_code=202)
def start_analysis(
    study_id: int,
    background: BackgroundTasks,
    threshold: float | None = Query(None, ge=0.05, le=0.95),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> AnalysisRead:
    """Queue an analysis. Returns immediately; poll the analysis for status.

    The pipeline takes tens of seconds on a full volume, which is far too long to
    hold a request open, so the row is created first and the work runs after the
    response is sent. Re-running a scan (after a failure, or to re-analyse) makes
    a new analysis row; the old one is kept.
    """
    study = auth.require_study(session, study_id, doctor)

    current = latest_analysis(study)
    if current and current.status in (AnalysisStatus.pending, AnalysisStatus.running):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This scan is already being analysed. Wait for it to finish.",
        )

    analysis = Analysis(study_id=study_id, status=AnalysisStatus.pending, stage="queued")
    session.add(analysis)
    session.commit()
    session.refresh(analysis)

    background.add_task(
        _execute_analysis, analysis.id, study.stored_path, study.sequence, threshold
    )
    return analysis_read(analysis)


def _execute_analysis(
    analysis_id: int, study_path: str, sequence: str, threshold: float | None
) -> None:
    """Background worker. Owns its own sessions -- the request's is already closed."""
    from sqlmodel import Session as _Session

    def set_stage(stage: str) -> None:
        with _Session(engine) as session:
            analysis = session.get(Analysis, analysis_id)
            if analysis is None:
                return
            analysis.status = AnalysisStatus.running
            analysis.stage = stage
            analysis.stage_started_at = datetime.now(timezone.utc)
            session.add(analysis)
            session.commit()

    set_stage("starting")

    try:
        artifacts = pipeline_service.run_analysis(
            study_path, sequence, analysis_id, threshold, progress=set_stage
        )
    except Exception as exc:
        logger.exception("Analysis %s failed", analysis_id)
        with _Session(engine) as session:
            analysis = session.get(Analysis, analysis_id)
            if analysis is not None:
                analysis.status = AnalysisStatus.failed
                analysis.error = _user_facing_error(exc)
                analysis.completed_at = datetime.now(timezone.utc)
                session.add(analysis)
                session.commit()
        return

    with _Session(engine) as session:
        analysis = session.get(Analysis, analysis_id)
        if analysis is None:
            return
        analysis.status = AnalysisStatus.complete
        analysis.stage = "complete"
        analysis.method = artifacts.method
        analysis.artifacts_dir = str(artifacts.directory)
        analysis.burden = artifacts.burden
        analysis.lesions = artifacts.lesions
        analysis.report = artifacts.report
        analysis.slices = artifacts.slices
        analysis.technique = artifacts.technique
        analysis.duration_seconds = artifacts.duration_seconds
        analysis.completed_at = datetime.now(timezone.utc)
        session.add(analysis)
        session.commit()


@router.get("/analyses/{analysis_id}", response_model=AnalysisRead)
def get_analysis(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> AnalysisRead:
    return analysis_read(auth.require_analysis(session, analysis_id, doctor))


@router.get("/studies/{study_id}/analyses", response_model=list[AnalysisRead])
def list_study_analyses(
    study_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[AnalysisRead]:
    """Every run over one scan, newest first -- including failed ones."""
    study = auth.require_study(session, study_id, doctor)
    runs = sorted(study.analyses, key=lambda a: (a.created_at, a.id), reverse=True)
    return [analysis_read(a) for a in runs]


@router.get("/patients/{patient_id}/timeline", response_model=list[AnalysisSummary])
def patient_timeline(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[AnalysisSummary]:
    """Completed analyses in acquisition order: the disease-progression history."""
    auth.require_patient(session, patient_id, doctor)

    rows = session.exec(
        select(Analysis, Study)
        .join(Study, Analysis.study_id == Study.id)
        .where(Study.patient_id == patient_id)
        .where(Analysis.status == AnalysisStatus.complete)
    ).all()

    # Only the newest completed run per scan: a re-analysis supersedes the old one.
    newest: dict[int, tuple[Analysis, Study]] = {}
    for analysis, study in rows:
        kept = newest.get(study.id)
        if kept is None or (analysis.created_at, analysis.id) > (kept[0].created_at, kept[0].id):
            newest[study.id] = (analysis, study)

    summaries = []
    for analysis, study in newest.values():
        burden = analysis.burden or {}
        report = normalize_report(analysis.report) or {}
        summaries.append(
            AnalysisSummary(
                id=analysis.id,
                study_id=study.id,
                status=analysis.status,
                method=analysis.method,
                created_at=analysis.created_at,
                sequence=study.sequence,
                acquired_on=study.acquired_on,
                lesion_count=burden.get("lesion_count"),
                total_volume_cm3=burden.get("total_volume_cm3"),
                largest_volume_cm3=burden.get("largest_volume_cm3"),
                trend_headline=report.get("headline"),
            )
        )

    # Sort by acquisition date where known, falling back to upload order, so the
    # timeline reflects when the patient was scanned rather than when the file
    # happened to be uploaded.
    summaries.sort(key=lambda s: (s.acquired_on is None, s.acquired_on, s.created_at))
    return summaries


@router.get("/patients/{patient_id}/events")
def patient_events(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Everything that has happened to this patient's record, newest first.

    Built from the rows themselves -- upload times, analysis completion, reviews,
    comparisons -- so the timeline cannot drift from what actually happened.
    """
    patient = auth.require_patient(session, patient_id, doctor)
    events: list[dict] = [{
        "at": patient.created_at, "kind": "patient_created", "title": "Patient record created",
    }]

    for study in patient.studies:
        scan_label = f"{study.sequence} MRI" if study.sequence != "UNKNOWN" else "MRI"
        events.append({
            "at": study.uploaded_at, "kind": "scan_uploaded", "study_id": study.id,
            "title": f"{scan_label} uploaded",
            "detail": study.original_filename,
        })
        for analysis in study.analyses:
            if analysis.status == AnalysisStatus.complete and analysis.completed_at:
                events.append({
                    "at": analysis.completed_at, "kind": "analysis_completed",
                    "study_id": study.id, "analysis_id": analysis.id,
                    "title": "AI analysis completed",
                    "detail": (normalize_report(analysis.report) or {}).get("headline"),
                })
                if (analysis.report or {}).get("generated_at"):
                    events.append({
                        "at": analysis.completed_at, "kind": "report_generated",
                        "study_id": study.id, "analysis_id": analysis.id,
                        "title": "Preliminary report generated",
                    })
            elif analysis.status == AnalysisStatus.failed:
                events.append({
                    "at": analysis.completed_at or analysis.created_at, "kind": "analysis_failed",
                    "study_id": study.id, "analysis_id": analysis.id,
                    "title": "AI analysis failed", "detail": analysis.error,
                })
            for review in analysis.reviews:
                events.append({
                    "at": review.created_at, "kind": "reviewed",
                    "study_id": study.id, "analysis_id": analysis.id,
                    "title": f"Report {review.status.value} by {review.reviewer}",
                    "detail": review.comments,
                })

    comparisons = session.exec(select(Comparison).where(Comparison.patient_id == patient_id)).all()
    for comparison in comparisons:
        events.append({
            "at": comparison.created_at, "kind": "compared", "comparison_id": comparison.id,
            "title": "Scans compared",
            "detail": (comparison.result or {}).get("summary"),
        })

    events.sort(key=lambda event: _utc(event["at"]), reverse=True)
    return events


@router.get("/analyses/{analysis_id}/scene")
def get_scene(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> JSONResponse:
    """Triangle meshes for the 3D viewer.

    Served straight from the generated file rather than re-serialised through a
    Pydantic model: it is a few MB of flat float arrays and validating it would
    cost more than producing it did.
    """
    _require_complete(session, analysis_id, doctor)
    scene_path = pipeline_service.analysis_dir(analysis_id) / "scene.json"
    if not scene_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scene not generated for this analysis.")
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    scene["lesions"] = public_lesions(scene.get("lesions"))
    return JSONResponse(content=scene)


@router.get("/analyses/{analysis_id}/slices/{filename}")
def get_slice_image(
    analysis_id: int,
    filename: str,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> FileResponse:
    _require_complete(session, analysis_id, doctor)

    # Resolve and confirm containment: the filename comes from the client, and
    # "../" in a path parameter is the oldest trick there is.
    slices_dir = (pipeline_service.analysis_dir(analysis_id) / "slices").resolve()
    target = (slices_dir / filename).resolve()
    if not target.is_relative_to(slices_dir) or not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slice image not found.")

    return FileResponse(target, media_type="image/png")


@router.get("/analyses/{analysis_id}/volume")
def get_volume_info(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> dict:
    """Slice counts per plane, and which slices contain segmented voxels.

    Lets the viewer step through every slice of the preprocessed volume, not
    only the nine pre-rendered ones, and mark where the findings are.
    """
    _require_complete(session, analysis_id, doctor)
    import numpy as np

    source = _slice_source_or_404(analysis_id)
    planes = {}
    for plane, axis in source.axes.items():
        other = tuple(a for a in range(3) if a != axis)
        per_slice = source.mask.sum(axis=other)
        planes[plane] = {
            "count": int(source.data.shape[axis]),
            "lesion_slices": [int(i) for i in np.flatnonzero(per_slice > 0)],
            "peak_slice": int(np.argmax(per_slice)) if per_slice.any() else int(source.data.shape[axis] // 2),
        }
    return {"shape": list(source.data.shape), "spacing_mm": source.spacing, "planes": planes}


@router.get("/analyses/{analysis_id}/slice/{plane}/{index}")
def render_slice(
    analysis_id: int,
    plane: str,
    index: int,
    layer: str = Query("image", pattern="^(image|overlay|mask|heatmap)$"),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> Response:
    """Any slice of the preprocessed volume, rendered on demand as PNG."""
    _require_complete(session, analysis_id, doctor)
    from ..pipeline import slices as slice_render

    source = _slice_source_or_404(analysis_id)
    if plane not in source.axes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown plane '{plane}'.")
    axis = source.axes[plane]
    if not 0 <= index < source.data.shape[axis]:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Slice {index} is outside the volume (0–{source.data.shape[axis] - 1}).",
        )
    png = slice_render.render_slice(source.data, source.probability, source.mask, axis, index, layer)
    return Response(content=png, media_type="image/png")


def _slice_source_or_404(analysis_id: int):
    try:
        return pipeline_service.slice_source(analysis_id)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.get("/analyses/{analysis_id}/download/{artifact}")
def download_artifact(
    analysis_id: int,
    artifact: str,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> Response:
    """Download a derived NIfTI, so findings can be opened in ITK-SNAP or 3D Slicer."""
    analysis = _require_complete(session, analysis_id, doctor)

    if artifact == "report":
        # The stored report, with current wording -- not the raw file, which an
        # older pipeline version may have written.
        return JSONResponse(
            content=normalize_report(analysis.report),
            headers={"Content-Disposition": f'attachment; filename="analysis{analysis_id}_report.json"'},
        )

    allowed = {
        "preprocessed": "preprocessed.nii.gz",
        "brain-mask": "brain_mask.nii.gz",
        "lesion-mask": "lesion_mask.nii.gz",
        "probability": "probability.nii.gz",
        "report": "report.json",
    }
    if artifact not in allowed:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Unknown artifact '{artifact}'. Available: {', '.join(sorted(allowed))}.",
        )

    path = pipeline_service.analysis_dir(analysis_id) / allowed[artifact]
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact not found on disk.")

    return FileResponse(
        path,
        filename=f"analysis{analysis_id}_{allowed[artifact]}",
        media_type="application/json" if artifact == "report" else "application/gzip",
    )


# --- 3D snapshot and PDF report ------------------------------------------

@router.post("/analyses/{analysis_id}/snapshot", response_model=AnalysisRead)
def upload_snapshot(
    analysis_id: int,
    file: UploadFile = File(...),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> AnalysisRead:
    """Store a PNG captured from the 3D viewer, for inclusion in the report."""
    analysis = _require_complete(session, analysis_id, doctor)
    from PIL import Image, UnidentifiedImageError
    import io

    raw = file.file.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Snapshot is too large.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Snapshot is not a readable image.") from exc

    image.thumbnail((1600, 1600))
    destination = pipeline_service.analysis_dir(analysis_id) / "snapshot_3d.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    background_fill = Image.new("RGB", image.size, (255, 255, 255))
    if image.mode in ("RGBA", "LA"):
        background_fill.paste(image, mask=image.split()[-1])
    else:
        background_fill.paste(image.convert("RGB"))
    background_fill.save(destination, format="PNG", optimize=True)

    analysis.snapshot_path = str(destination)
    session.add(analysis)
    session.commit()
    session.refresh(analysis)
    return analysis_read(analysis)


@router.get("/analyses/{analysis_id}/snapshot")
def get_snapshot(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> FileResponse:
    analysis = _require_complete(session, analysis_id, doctor)
    if not analysis.snapshot_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No 3D snapshot saved for this analysis.")
    return FileResponse(analysis.snapshot_path, media_type="image/png")


@router.get("/analyses/{analysis_id}/report.pdf")
def download_report_pdf(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> Response:
    """The preliminary report as a PDF, built from this analysis's stored output."""
    from ..services.report_pdf import build_report_pdf

    analysis = _require_complete(session, analysis_id, doctor)
    study = session.get(Study, analysis.study_id)
    patient = session.get(Patient, study.patient_id)

    comparison = _latest_comparison_for(session, analysis.id)
    reviews = session.exec(
        select(Review).where(Review.analysis_id == analysis.id).order_by(Review.created_at)
    ).all()

    try:
        pdf = build_report_pdf(
            analysis=analysis,
            study=study,
            patient=patient,
            patient_name=display_name(patient),
            patient_age=patient_read(patient).age_years,
            doctor=doctor,
            comparison=comparison,
            reviews=reviews,
            slices_dir=pipeline_service.analysis_dir(analysis.id) / "slices",
        )
    except Exception as exc:
        logger.exception("Report PDF for analysis %s failed", analysis_id)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Report generation failed. The error has been logged; try again, or contact your administrator.",
        ) from exc

    filename = f"NeuroVision_report_{patient.code}_{(study.acquired_on or study.uploaded_at.date()).isoformat()}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- comparisons ---------------------------------------------------------

@router.post("/comparisons", response_model=ComparisonRead, status_code=status.HTTP_201_CREATED)
def create_comparison(
    payload: ComparisonCreate,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> ComparisonRead:
    """Register two analysed studies and quantify the change between them."""
    if payload.baseline_analysis_id == payload.followup_analysis_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Baseline and follow-up must be different analyses.",
        )

    baseline = _require_complete(session, payload.baseline_analysis_id, doctor)
    followup = _require_complete(session, payload.followup_analysis_id, doctor)

    base_study = session.get(Study, baseline.study_id)
    follow_study = session.get(Study, followup.study_id)
    if base_study.patient_id != follow_study.patient_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Refusing to compare studies from different patients.",
        )

    if (
        base_study.acquired_on
        and follow_study.acquired_on
        and follow_study.acquired_on < base_study.acquired_on
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "The follow-up study was acquired before the baseline. Swap the two.",
        )

    # The same pair always yields the same result; registration takes ~20 s,
    # so an existing comparison is returned instead of recomputed.
    existing = session.exec(
        select(Comparison)
        .where(Comparison.baseline_analysis_id == payload.baseline_analysis_id)
        .where(Comparison.followup_analysis_id == payload.followup_analysis_id)
    ).first()
    if existing is not None:
        return comparison_read(existing)

    try:
        result = pipeline_service.run_comparison(
            payload.baseline_analysis_id, payload.followup_analysis_id
        )
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    comparison = Comparison(
        patient_id=base_study.patient_id,
        baseline_analysis_id=payload.baseline_analysis_id,
        followup_analysis_id=payload.followup_analysis_id,
        trend=result.get("trend"),
        result={k: v for k, v in result.items() if k != "scene"},
    )
    session.add(comparison)
    session.commit()
    session.refresh(comparison)
    return comparison_read(comparison)


@router.get("/comparisons/{comparison_id}", response_model=ComparisonRead)
def get_comparison(
    comparison_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> ComparisonRead:
    return comparison_read(auth.require_comparison(session, comparison_id, doctor))


@router.get("/comparisons/{comparison_id}/scene")
def get_comparison_scene(
    comparison_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> JSONResponse:
    comparison = auth.require_comparison(session, comparison_id, doctor)

    path = (
        pipeline_service.settings.derived_dir
        / f"comparison_{comparison.baseline_analysis_id}_{comparison.followup_analysis_id}"
        / "comparison.json"
    )
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comparison scene not found.")

    payload = json.loads(path.read_text(encoding="utf-8"))
    return JSONResponse(content=payload.get("scene", {}))


@router.get("/patients/{patient_id}/comparisons", response_model=list[ComparisonRead])
def list_comparisons(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[ComparisonRead]:
    auth.require_patient(session, patient_id, doctor)
    rows = session.exec(
        select(Comparison)
        .where(Comparison.patient_id == patient_id)
        .order_by(Comparison.created_at.desc())
    ).all()
    return [comparison_read(c) for c in rows]


# --- reviews -------------------------------------------------------------

@router.post(
    "/analyses/{analysis_id}/reviews",
    response_model=ReviewRead,
    status_code=status.HTTP_201_CREATED,
)
def create_review(
    analysis_id: int,
    payload: ReviewCreate,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> ReviewRead:
    """Record a clinician's verdict on an analysis.

    Reviews are append-only. Each one is a new row rather than an edit of the
    last, so the sequence of who said what, and when, stays reconstructable.
    The reviewer is always the signed-in doctor, never a client-supplied name.
    """
    analysis = auth.require_analysis(session, analysis_id, doctor)
    if analysis.status != AnalysisStatus.complete:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a completed analysis can be reviewed.")

    known_ids = {lesion.get("id") for lesion in (analysis.lesions or [])}
    unknown = (set(payload.rejected_lesion_ids) | set(payload.confirmed_lesion_ids)) - known_ids
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Lesion ids not present in this analysis: {sorted(unknown)}.",
        )

    overlap = set(payload.rejected_lesion_ids) & set(payload.confirmed_lesion_ids)
    if overlap:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Lesions cannot be both confirmed and rejected: {sorted(overlap)}.",
        )

    data = payload.model_dump()
    data["reviewer"] = f"Dr. {doctor.full_name}" if not doctor.full_name.lower().startswith("dr") else doctor.full_name
    review = Review(analysis_id=analysis_id, **data)
    session.add(review)
    session.commit()
    session.refresh(review)
    return ReviewRead(**review.model_dump())


@router.get("/analyses/{analysis_id}/reviews", response_model=list[ReviewRead])
def list_reviews(
    analysis_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[ReviewRead]:
    auth.require_analysis(session, analysis_id, doctor)
    rows = session.exec(
        select(Review).where(Review.analysis_id == analysis_id).order_by(Review.created_at)
    ).all()
    return [ReviewRead(**r.model_dump()) for r in rows]


# --- dashboard and reports -----------------------------------------------

@router.get("/dashboard")
def dashboard(
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> dict:
    """Workload summary for the signed-in doctor, computed from their records."""
    patients = session.exec(select(Patient).where(Patient.doctor_id == doctor.id)).all()
    studies = [study for patient in patients for study in patient.studies]
    statuses = [scan_status(study) for study in studies]

    patient_rows = [patient_read(p) for p in patients]
    # Most recently active first: last scan, else last edit, else creation.
    patient_rows.sort(key=lambda r: _utc(r.last_scan_at or r.updated_at or r.created_at), reverse=True)

    by_id = {p.id: p for p in patients}
    recent_studies = sorted(studies, key=lambda s: s.uploaded_at, reverse=True)[:8]

    return {
        "counts": {
            "patients": len(patients),
            "scans": len(studies),
            "analyzed": sum(1 for s in statuses if s in ("needs_review", "reviewed")),
            "pending_review": statuses.count("needs_review"),
            "processing": sum(1 for s in statuses if s in ("queued", "processing")),
            "failed": statuses.count("failed"),
            "awaiting_analysis": statuses.count("uploaded"),
        },
        "recent_patients": [r.model_dump(mode="json") for r in patient_rows[:6]],
        "recent_scans": [
            study_read(study, by_id[study.patient_id]).model_dump(mode="json") for study in recent_studies
        ],
    }


@router.get("/reports")
def list_reports(
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Every generated report (completed analysis) across the doctor's patients."""
    rows = session.exec(
        select(Analysis, Study, Patient)
        .join(Study, Analysis.study_id == Study.id)
        .join(Patient, Study.patient_id == Patient.id)
        .where(Patient.doctor_id == doctor.id)
        .where(Analysis.status == AnalysisStatus.complete)
        .order_by(Analysis.completed_at.desc())
    ).all()

    reports = []
    for analysis, study, patient in rows:
        report = normalize_report(analysis.report) or {}
        latest_review = max(analysis.reviews, key=lambda r: r.created_at) if analysis.reviews else None
        reports.append({
            "analysis_id": analysis.id,
            "study_id": study.id,
            "patient_id": patient.id,
            "patient_name": display_name(patient),
            "patient_code": patient.code,
            "sequence": study.sequence,
            "acquired_on": study.acquired_on.isoformat() if study.acquired_on else None,
            "generated_at": report.get("generated_at"),
            "completed_at": analysis.completed_at.isoformat() if analysis.completed_at else None,
            "headline": report.get("headline"),
            "lesion_count": (analysis.burden or {}).get("lesion_count"),
            "review_status": latest_review.status.value if latest_review else None,
            "reviewer": latest_review.reviewer if latest_review else None,
            "superseded": latest_analysis(study).id != analysis.id,
        })
    return reports


@router.get("/notifications")
def notifications(
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Things that need the doctor: finished analyses awaiting review, failures, runs in progress."""
    rows = session.exec(
        select(Study, Patient)
        .join(Patient, Study.patient_id == Patient.id)
        .where(Patient.doctor_id == doctor.id)
    ).all()

    items = []
    for study, patient in rows:
        state = scan_status(study)
        latest = latest_analysis(study)
        if state not in ("needs_review", "failed", "processing", "queued"):
            continue
        at = (latest.completed_at or latest.created_at) if latest else study.uploaded_at
        items.append({
            "kind": state,
            "study_id": study.id,
            "patient_id": patient.id,
            "patient_name": display_name(patient),
            "at": at.isoformat() if at else None,
            "message": {
                "needs_review": "AI analysis ready for your review",
                "failed": "AI analysis could not be completed",
                "processing": "AI analysis in progress",
                "queued": "AI analysis queued",
            }[state],
        })
    items.sort(key=lambda i: i["at"] or "", reverse=True)
    return items[:30]


# --- helpers ---------------------------------------------------------------

def _user_facing_error(exc: Exception) -> str:
    """What the doctor sees when an analysis fails.

    Problems with the scan itself carry a message written for them. Anything
    else is an internal fault whose text may include server paths or library
    internals, so it is logged in full and shown only by type.
    """
    if isinstance(exc, pipeline_service.AnalysisInputError):
        return str(exc)[:1000]
    return (
        f"The analysis pipeline stopped with an internal error ({exc.__class__.__name__}). "
        "No results were produced and the uploaded scan is kept. Retry the analysis; if it "
        "fails again, ask your administrator to check the server log."
    )


def _utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; they were written as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _require_complete(session: Session, analysis_id: int, doctor: Doctor) -> Analysis:
    analysis = auth.require_analysis(session, analysis_id, doctor)
    if analysis.status != AnalysisStatus.complete:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Analysis {analysis_id} is '{analysis.status.value}', not complete.",
        )
    return analysis


def _latest_comparison_for(session: Session, analysis_id: int) -> Comparison | None:
    """The newest comparison in which this analysis is the follow-up."""
    return session.exec(
        select(Comparison)
        .where(Comparison.followup_analysis_id == analysis_id)
        .order_by(Comparison.created_at.desc())
    ).first()
