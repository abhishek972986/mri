"""Analysis, artifact, comparison, and review endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session, select

from ..db import engine, get_session
from ..models import Analysis, AnalysisStatus, Comparison, Patient, Review, Study
from ..schemas import (
    AnalysisRead,
    AnalysisSummary,
    ComparisonCreate,
    ComparisonRead,
    ReviewCreate,
    ReviewRead,
)
from ..services import pipeline_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["analyses"])


@router.post("/studies/{study_id}/analyze", response_model=AnalysisRead, status_code=202)
def start_analysis(
    study_id: int,
    background: BackgroundTasks,
    threshold: float | None = Query(None, ge=0.05, le=0.95),
    session: Session = Depends(get_session),
) -> AnalysisRead:
    """Queue an analysis. Returns immediately; poll the analysis for status.

    The pipeline takes tens of seconds on a full volume, which is far too long to
    hold a request open, so the row is created first and the work runs after the
    response is sent.
    """
    study = session.get(Study, study_id)
    if study is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study not found.")

    analysis = Analysis(study_id=study_id, status=AnalysisStatus.pending)
    session.add(analysis)
    session.commit()
    session.refresh(analysis)

    background.add_task(
        _execute_analysis, analysis.id, study.stored_path, study.sequence, threshold
    )
    return AnalysisRead(**analysis.model_dump())


def _execute_analysis(
    analysis_id: int, study_path: str, sequence: str, threshold: float | None
) -> None:
    """Background worker. Owns its own session -- the request's is already closed."""
    from sqlmodel import Session as _Session

    with _Session(engine) as session:
        analysis = session.get(Analysis, analysis_id)
        if analysis is None:
            return
        analysis.status = AnalysisStatus.running
        session.add(analysis)
        session.commit()

    try:
        artifacts = pipeline_service.run_analysis(study_path, sequence, analysis_id, threshold)
    except Exception as exc:
        logger.exception("Analysis %s failed", analysis_id)
        with _Session(engine) as session:
            analysis = session.get(Analysis, analysis_id)
            if analysis is not None:
                analysis.status = AnalysisStatus.failed
                analysis.error = str(exc)[:1000]
                analysis.completed_at = datetime.now(timezone.utc)
                session.add(analysis)
                session.commit()
        return

    with _Session(engine) as session:
        analysis = session.get(Analysis, analysis_id)
        if analysis is None:
            return
        analysis.status = AnalysisStatus.complete
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
def get_analysis(analysis_id: int, session: Session = Depends(get_session)) -> AnalysisRead:
    return AnalysisRead(**_require_analysis(session, analysis_id).model_dump())


@router.get("/patients/{patient_id}/timeline", response_model=list[AnalysisSummary])
def patient_timeline(patient_id: int, session: Session = Depends(get_session)) -> list[AnalysisSummary]:
    """Completed analyses in acquisition order: the disease-progression history."""
    if session.get(Patient, patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")

    rows = session.exec(
        select(Analysis, Study)
        .join(Study, Analysis.study_id == Study.id)
        .where(Study.patient_id == patient_id)
        .where(Analysis.status == AnalysisStatus.complete)
    ).all()

    summaries = []
    for analysis, study in rows:
        burden = analysis.burden or {}
        report = analysis.report or {}
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


@router.get("/analyses/{analysis_id}/scene")
def get_scene(analysis_id: int, session: Session = Depends(get_session)) -> JSONResponse:
    """Triangle meshes for the 3D viewer.

    Served straight from the generated file rather than re-serialised through a
    Pydantic model: it is a few MB of flat float arrays and validating it would
    cost more than producing it did.
    """
    _require_complete(session, analysis_id)
    scene_path = pipeline_service.analysis_dir(analysis_id) / "scene.json"
    if not scene_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scene not generated for this analysis.")
    return JSONResponse(content=json.loads(scene_path.read_text(encoding="utf-8")))


@router.get("/analyses/{analysis_id}/slices/{filename}")
def get_slice_image(
    analysis_id: int, filename: str, session: Session = Depends(get_session)
) -> FileResponse:
    _require_complete(session, analysis_id)

    # Resolve and confirm containment: the filename comes from the client, and
    # "../" in a path parameter is the oldest trick there is.
    slices_dir = (pipeline_service.analysis_dir(analysis_id) / "slices").resolve()
    target = (slices_dir / filename).resolve()
    if not target.is_relative_to(slices_dir) or not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slice image not found.")

    return FileResponse(target, media_type="image/png")


@router.get("/analyses/{analysis_id}/download/{artifact}")
def download_artifact(
    analysis_id: int, artifact: str, session: Session = Depends(get_session)
) -> FileResponse:
    """Download a derived NIfTI, so findings can be opened in ITK-SNAP or 3D Slicer."""
    _require_complete(session, analysis_id)

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


@router.post("/comparisons", response_model=ComparisonRead, status_code=status.HTTP_201_CREATED)
def create_comparison(
    payload: ComparisonCreate, session: Session = Depends(get_session)
) -> ComparisonRead:
    """Register two analysed studies and quantify the change between them."""
    if payload.baseline_analysis_id == payload.followup_analysis_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Baseline and follow-up must be different analyses.",
        )

    baseline = _require_complete(session, payload.baseline_analysis_id)
    followup = _require_complete(session, payload.followup_analysis_id)

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
    return ComparisonRead(**comparison.model_dump())


@router.get("/comparisons/{comparison_id}", response_model=ComparisonRead)
def get_comparison(comparison_id: int, session: Session = Depends(get_session)) -> ComparisonRead:
    comparison = session.get(Comparison, comparison_id)
    if comparison is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comparison not found.")
    return ComparisonRead(**comparison.model_dump())


@router.get("/comparisons/{comparison_id}/scene")
def get_comparison_scene(
    comparison_id: int, session: Session = Depends(get_session)
) -> JSONResponse:
    comparison = session.get(Comparison, comparison_id)
    if comparison is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comparison not found.")

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
def list_comparisons(patient_id: int, session: Session = Depends(get_session)) -> list[ComparisonRead]:
    rows = session.exec(
        select(Comparison)
        .where(Comparison.patient_id == patient_id)
        .order_by(Comparison.created_at.desc())
    ).all()
    return [ComparisonRead(**c.model_dump()) for c in rows]


@router.post(
    "/analyses/{analysis_id}/reviews",
    response_model=ReviewRead,
    status_code=status.HTTP_201_CREATED,
)
def create_review(
    analysis_id: int, payload: ReviewCreate, session: Session = Depends(get_session)
) -> ReviewRead:
    """Record a clinician's verdict on an analysis.

    Reviews are append-only. Each one is a new row rather than an edit of the
    last, so the sequence of who said what, and when, stays reconstructable.
    """
    analysis = _require_analysis(session, analysis_id)

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

    review = Review(analysis_id=analysis_id, **payload.model_dump())
    session.add(review)
    session.commit()
    session.refresh(review)
    return ReviewRead(**review.model_dump())


@router.get("/analyses/{analysis_id}/reviews", response_model=list[ReviewRead])
def list_reviews(analysis_id: int, session: Session = Depends(get_session)) -> list[ReviewRead]:
    _require_analysis(session, analysis_id)
    rows = session.exec(
        select(Review).where(Review.analysis_id == analysis_id).order_by(Review.created_at)
    ).all()
    return [ReviewRead(**r.model_dump()) for r in rows]


# --- helpers ---------------------------------------------------------------

def _require_analysis(session: Session, analysis_id: int) -> Analysis:
    analysis = session.get(Analysis, analysis_id)
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found.")
    return analysis


def _require_complete(session: Session, analysis_id: int) -> Analysis:
    analysis = _require_analysis(session, analysis_id)
    if analysis.status != AnalysisStatus.complete:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Analysis {analysis_id} is '{analysis.status.value}', not complete.",
        )
    return analysis
