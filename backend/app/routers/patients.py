"""Patient and study endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import Session, select

from ..db import get_session
from ..models import Analysis, Patient, Study
from ..schemas import PatientCreate, PatientRead, StudyRead
from ..services import storage

router = APIRouter(prefix="/api", tags=["patients"])

# Stored upper-case throughout, including the "UNKNOWN" placeholder: the router
# upper-cases whatever arrives, so a lower-case member here would make the
# default value fail its own validation.
VALID_SEQUENCES = {"T1", "T2", "FLAIR", "T1C", "DWI", "ADC", "UNKNOWN"}


@router.post("/patients", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate, session: Session = Depends(get_session)) -> PatientRead:
    patient = Patient(**payload.model_dump())
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return _patient_read(patient, 0)


@router.get("/patients", response_model=list[PatientRead])
def list_patients(session: Session = Depends(get_session)) -> list[PatientRead]:
    patients = session.exec(select(Patient).order_by(Patient.created_at.desc())).all()
    return [_patient_read(p, len(p.studies)) for p in patients]


@router.get("/patients/{patient_id}", response_model=PatientRead)
def get_patient(patient_id: int, session: Session = Depends(get_session)) -> PatientRead:
    patient = _require_patient(session, patient_id)
    return _patient_read(patient, len(patient.studies))


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(patient_id: int, session: Session = Depends(get_session)) -> None:
    patient = _require_patient(session, patient_id)

    # Remove the pixel data as well as the rows. A delete that leaves the MRI on
    # disk is not a delete.
    from ..services.pipeline_service import analysis_dir

    for study in patient.studies:
        storage.delete_artifacts(study.stored_path)
        for analysis in study.analyses:
            storage.delete_artifacts(analysis_dir(analysis.id))

    session.delete(patient)
    session.commit()


@router.post(
    "/patients/{patient_id}/studies",
    response_model=StudyRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_study(
    patient_id: int,
    file: UploadFile = File(...),
    sequence: str = Form("UNKNOWN"),
    acquired_on: date | None = Form(None),
    description: str | None = Form(None),
    session: Session = Depends(get_session),
) -> StudyRead:
    _require_patient(session, patient_id)

    sequence = sequence.strip().upper() or "UNKNOWN"
    if sequence not in VALID_SEQUENCES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unknown sequence '{sequence}'. Expected one of: {', '.join(sorted(VALID_SEQUENCES))}.",
        )

    try:
        stored = storage.store_upload(file.file, file.filename or "upload.nii.gz")
    except storage.UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    study = Study(
        patient_id=patient_id,
        sequence=sequence,
        acquired_on=acquired_on,
        description=description,
        **stored,
    )
    session.add(study)
    session.commit()
    session.refresh(study)
    return _study_read(study)


@router.get("/patients/{patient_id}/studies", response_model=list[StudyRead])
def list_studies(patient_id: int, session: Session = Depends(get_session)) -> list[StudyRead]:
    _require_patient(session, patient_id)
    studies = session.exec(
        select(Study).where(Study.patient_id == patient_id).order_by(Study.uploaded_at)
    ).all()
    return [_study_read(s) for s in studies]


@router.get("/studies/{study_id}", response_model=StudyRead)
def get_study(study_id: int, session: Session = Depends(get_session)) -> StudyRead:
    study = session.get(Study, study_id)
    if study is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study not found.")
    return _study_read(study)


@router.delete("/studies/{study_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_study(study_id: int, session: Session = Depends(get_session)) -> None:
    study = session.get(Study, study_id)
    if study is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study not found.")

    from ..services.pipeline_service import analysis_dir

    storage.delete_artifacts(study.stored_path)
    for analysis in study.analyses:
        storage.delete_artifacts(analysis_dir(analysis.id))

    session.delete(study)
    session.commit()


# --- helpers ---------------------------------------------------------------

def _require_patient(session: Session, patient_id: int) -> Patient:
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")
    return patient


def _patient_read(patient: Patient, study_count: int) -> PatientRead:
    return PatientRead(**patient.model_dump(), study_count=study_count)


def _study_read(study: Study) -> StudyRead:
    latest: Analysis | None = None
    if study.analyses:
        latest = max(study.analyses, key=lambda a: a.created_at)
    return StudyRead(
        **study.model_dump(),
        latest_analysis_id=latest.id if latest else None,
        latest_analysis_status=latest.status if latest else None,
    )
