"""Demo seeding: create a synthetic patient with a baseline and follow-up study.

This exists so the system can be run, demonstrated, and regression-tested without
any patient data. Seeded patients are labelled SYNTHETIC in the database and the
phantom origin travels with them into every report.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlmodel import Session

from ..config import settings
from ..db import get_session
from ..models import Patient, Study
from ..pipeline import synth
from ..pipeline.volume import save_volume
from ..schemas import DemoRequest
from .analyses import _execute_analysis

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/seed", status_code=status.HTTP_201_CREATED)
def seed_demo(
    payload: DemoRequest,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
) -> dict:
    """Generate a synthetic longitudinal pair, store it, and queue both analyses."""
    settings.ensure_dirs()

    baseline, followup = synth.make_longitudinal_pair(
        response=payload.response,
        n_lesions=payload.n_lesions,
        seed=int(uuid.uuid4().int % 10_000),
    )

    patient = Patient(
        label=payload.label or f"SYNTHETIC demo ({payload.response})",
        sex="unspecified",
        age_years=34,
        clinical_notes=(
            "Synthetic phantom generated for demonstration. Not a real patient and not "
            "real imaging. Lesions are simulated spheres with optional enhancing rims; "
            "any measurement taken from this study describes the phantom, not a disease."
        ),
    )
    session.add(patient)
    session.commit()
    session.refresh(patient)

    today = date.today()
    studies = []
    for phantom, acquired, description in (
        (baseline, today - timedelta(days=90), "Synthetic baseline study"),
        (followup, today, f"Synthetic follow-up study ({payload.response})"),
    ):
        filename = f"synthetic_{uuid.uuid4().hex}.nii.gz"
        path = settings.uploads_dir / filename
        save_volume(phantom.volume, path)

        study = Study(
            patient_id=patient.id,
            sequence=phantom.volume.sequence,
            acquired_on=acquired,
            description=description,
            original_filename=filename,
            stored_path=str(path),
            size_bytes=path.stat().st_size,
            shape="x".join(str(s) for s in phantom.volume.shape),
            spacing_mm="x".join(f"{s:.2f}" for s in phantom.volume.spacing),
        )
        session.add(study)
        studies.append(study)

    session.commit()
    for study in studies:
        session.refresh(study)

    from ..models import Analysis, AnalysisStatus

    analysis_ids = []
    for study in studies:
        analysis = Analysis(study_id=study.id, status=AnalysisStatus.pending)
        session.add(analysis)
        session.commit()
        session.refresh(analysis)
        analysis_ids.append(analysis.id)
        background.add_task(
            _execute_analysis, analysis.id, study.stored_path, study.sequence, None
        )

    return {
        "patient_id": patient.id,
        "patient_code": patient.code,
        "study_ids": [s.id for s in studies],
        "analysis_ids": analysis_ids,
        "response": payload.response,
        "ground_truth_lesion_counts": [len(baseline.lesions), len(followup.lesions)],
        "note": (
            "Both analyses are queued. Poll /api/analyses/{id} until status is 'complete', "
            "then POST /api/comparisons with the two analysis ids."
        ),
    }
