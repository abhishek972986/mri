"""Patient and scan (study) endpoints.

Every route is scoped to the signed-in doctor: patients are looked up through
their owner, and a patient belonging to another doctor answers 404.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlmodel import Session, select

from ..db import get_session
from ..models import Analysis, AnalysisStatus, Doctor, Patient, Study
from ..schemas import PatientCreate, PatientPage, PatientRead, PatientUpdate, StudyRead
from ..pipeline.report import normalize_report
from ..services import auth, storage

router = APIRouter(prefix="/api", tags=["patients"])

# Stored upper-case throughout, including the "UNKNOWN" placeholder: the router
# upper-cases whatever arrives, so a lower-case member here would make the
# default value fail its own validation.
VALID_SEQUENCES = {"T1", "T2", "FLAIR", "T1C", "DWI", "ADC", "UNKNOWN"}

SORTS = {"recent", "name", "last_scan", "age"}
STATUSES = {"none", "uploaded", "queued", "processing", "completed", "needs_review", "reviewed", "failed"}


# --- patients --------------------------------------------------------------

@router.post("/patients", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
def create_patient(
    payload: PatientCreate,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> PatientRead:
    data = _clean(payload.model_dump())
    _check_dob(data.get("date_of_birth"))
    data["code"] = _unique_code(session, data.get("code"))

    patient = Patient(**data, doctor_id=doctor.id)
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patient_read(patient)


@router.get("/patients", response_model=PatientPage)
def list_patients(
    q: str | None = Query(None, max_length=120, description="Name, patient ID, phone or email"),
    sex: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    sort: str = Query("recent"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> PatientPage:
    if sort not in SORTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"sort must be one of {sorted(SORTS)}.")
    if status_filter and status_filter not in STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"status must be one of {sorted(STATUSES)}.")

    query = select(Patient).where(Patient.doctor_id == doctor.id)
    if sex:
        query = query.where(Patient.sex == sex)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        # "Rahul Sharma" should match first and last name together, not only
        # each field on its own.
        from sqlalchemy import func as sa_func

        full_name = sa_func.lower(sa_func.coalesce(Patient.first_name, "") + " " + sa_func.coalesce(Patient.last_name, ""))
        query = query.where(or_(
            full_name.like(term),
            sa_func.lower(Patient.code).like(term),
            sa_func.lower(sa_func.coalesce(Patient.label, "")).like(term),
            sa_func.lower(sa_func.coalesce(Patient.phone, "")).like(term),
            sa_func.lower(sa_func.coalesce(Patient.email, "")).like(term),
        ))

    rows = [patient_read(p) for p in session.exec(query).all()]

    if status_filter:
        rows = [r for r in rows if (r.latest_status or "none") == status_filter]

    if sort == "name":
        rows.sort(key=lambda r: r.display_name.lower())
    elif sort == "last_scan":
        rows.sort(key=lambda r: (r.last_scan_at is None, -(r.last_scan_at.timestamp() if r.last_scan_at else 0)))
    elif sort == "age":
        rows.sort(key=lambda r: (r.age_years is None, r.age_years or 0))
    else:
        rows.sort(key=lambda r: r.created_at, reverse=True)

    total = len(rows)
    start = (page - 1) * page_size
    return PatientPage(items=rows[start:start + page_size], total=total, page=page, page_size=page_size)


@router.get("/patients/{patient_id}", response_model=PatientRead)
def get_patient(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> PatientRead:
    return patient_read(auth.require_patient(session, patient_id, doctor))


@router.put("/patients/{patient_id}", response_model=PatientRead)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> PatientRead:
    patient = auth.require_patient(session, patient_id, doctor)
    changes = _clean(payload.model_dump(exclude_unset=True))

    for required in ("first_name", "last_name", "date_of_birth", "sex"):
        if required in changes and changes[required] in (None, ""):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{required.replace('_', ' ').capitalize()} is required.")
    if "date_of_birth" in changes:
        _check_dob(changes["date_of_birth"])
    if "code" in changes:
        if not changes["code"]:
            changes.pop("code")
        elif changes["code"] != patient.code:
            changes["code"] = _unique_code(session, changes["code"])

    for key, value in changes.items():
        setattr(patient, key, value)
    patient.updated_at = datetime.now(timezone.utc)
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patient_read(patient)


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> None:
    patient = auth.require_patient(session, patient_id, doctor)

    # Remove the pixel data as well as the rows. A delete that leaves the MRI on
    # disk is not a delete.
    from ..services.pipeline_service import analysis_dir

    for study in patient.studies:
        storage.delete_artifacts(study.stored_path)
        for analysis in study.analyses:
            storage.delete_artifacts(analysis_dir(analysis.id), analysis.snapshot_path)
    storage.delete_artifacts(patient.photo_path)

    session.delete(patient)
    session.commit()


@router.post("/patients/{patient_id}/photo", response_model=PatientRead)
def upload_patient_photo(
    patient_id: int,
    file: UploadFile = File(...),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> PatientRead:
    patient = auth.require_patient(session, patient_id, doctor)
    try:
        path = storage.store_photo(file.file, "patients")
    except storage.UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    storage.delete_artifacts(patient.photo_path)
    patient.photo_path = path
    patient.updated_at = datetime.now(timezone.utc)
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patient_read(patient)


@router.get("/patients/{patient_id}/photo")
def get_patient_photo(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> FileResponse:
    patient = auth.require_patient(session, patient_id, doctor)
    if not patient.photo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No photo for this patient.")
    return FileResponse(patient.photo_path, media_type="image/jpeg")


# --- scans (studies) -------------------------------------------------------

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
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> StudyRead:
    auth.require_patient(session, patient_id, doctor)

    sequence = sequence.strip().upper() or "UNKNOWN"
    if sequence not in VALID_SEQUENCES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unknown sequence '{sequence}'. Expected one of: {', '.join(sorted(VALID_SEQUENCES))}.",
        )
    if acquired_on and acquired_on > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Scan date cannot be in the future.")

    try:
        stored = storage.store_upload(file.file, file.filename or "upload.nii.gz")
    except storage.UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    study = Study(
        patient_id=patient_id,
        sequence=sequence,
        acquired_on=acquired_on,
        description=(description or "").strip() or None,
        **stored,
    )
    session.add(study)
    session.commit()
    session.refresh(study)
    return study_read(study)


@router.get("/patients/{patient_id}/studies", response_model=list[StudyRead])
def list_studies(
    patient_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[StudyRead]:
    auth.require_patient(session, patient_id, doctor)
    studies = session.exec(
        select(Study).where(Study.patient_id == patient_id).order_by(Study.uploaded_at.desc())
    ).all()
    return [study_read(s) for s in studies]


@router.get("/studies", response_model=list[StudyRead])
def list_all_studies(
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = Query(None, max_length=120),
    limit: int = Query(200, ge=1, le=500),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> list[StudyRead]:
    """Every scan across the doctor's patients, newest first."""
    rows = session.exec(
        select(Study, Patient)
        .join(Patient, Study.patient_id == Patient.id)
        .where(Patient.doctor_id == doctor.id)
        .order_by(Study.uploaded_at.desc())
    ).all()

    items = [study_read(study, patient) for study, patient in rows]
    if status_filter:
        items = [i for i in items if i.status == status_filter]
    if q and q.strip():
        term = q.strip().lower()
        items = [i for i in items if term in (i.patient_name or "").lower() or term in (i.patient_code or "").lower()]
    return items[:limit]


@router.get("/studies/{study_id}", response_model=StudyRead)
def get_study(
    study_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> StudyRead:
    study = auth.require_study(session, study_id, doctor)
    return study_read(study, session.get(Patient, study.patient_id))


@router.delete("/studies/{study_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_study(
    study_id: int,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> None:
    study = auth.require_study(session, study_id, doctor)

    from ..services.pipeline_service import analysis_dir

    storage.delete_artifacts(study.stored_path)
    for analysis in study.analyses:
        storage.delete_artifacts(analysis_dir(analysis.id), analysis.snapshot_path)

    session.delete(study)
    session.commit()


# --- read models -----------------------------------------------------------

def display_name(patient: Patient) -> str:
    name = " ".join(part for part in (patient.first_name, patient.last_name) if part)
    return name or patient.label or patient.code


def age_of(patient: Patient) -> int | None:
    if patient.date_of_birth:
        today = date.today()
        dob = patient.date_of_birth
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return patient.age_years


def latest_analysis(study: Study) -> Analysis | None:
    if not study.analyses:
        return None
    return max(study.analyses, key=lambda a: (a.created_at, a.id))


def scan_status(study: Study) -> str:
    """Clinical-facing status of a scan, derived from its latest analysis.

    completed analyses split into `needs_review` and `reviewed` on whether a
    clinician has recorded a review -- AI output is never treated as final.
    """
    analysis = latest_analysis(study)
    if analysis is None:
        return "uploaded"
    if analysis.status == AnalysisStatus.pending:
        return "queued"
    if analysis.status == AnalysisStatus.running:
        return "processing"
    if analysis.status == AnalysisStatus.failed:
        return "failed"
    return "reviewed" if analysis.reviews else "needs_review"


def study_read(study: Study, patient: Patient | None = None) -> StudyRead:
    latest = latest_analysis(study)
    burden = (latest.burden or {}) if latest else {}
    report = (normalize_report(latest.report) or {}) if latest else {}
    return StudyRead(
        **study.model_dump(),
        latest_analysis_id=latest.id if latest else None,
        latest_analysis_status=latest.status if latest else None,
        status=scan_status(study),
        stage=latest.stage if latest else None,
        error=latest.error if latest and latest.status == AnalysisStatus.failed else None,
        completed_at=latest.completed_at if latest else None,
        lesion_count=burden.get("lesion_count"),
        total_volume_cm3=burden.get("total_volume_cm3"),
        headline=report.get("headline"),
        method=latest.method if latest else None,
        patient_name=display_name(patient) if patient else None,
        patient_code=patient.code if patient else None,
    )


def patient_read(patient: Patient) -> PatientRead:
    studies = sorted(patient.studies, key=lambda s: s.uploaded_at, reverse=True)
    latest_study = studies[0] if studies else None
    latest_result = None
    if latest_study:
        analysis = latest_analysis(latest_study)
        if analysis and analysis.report:
            latest_result = normalize_report(analysis.report).get("headline")

    data = patient.model_dump(exclude={"doctor_id", "photo_path", "age_years"})
    return PatientRead(
        **data,
        age_years=age_of(patient),
        display_name=display_name(patient),
        has_photo=bool(patient.photo_path),
        study_count=len(studies),
        last_scan_at=latest_study.uploaded_at if latest_study else None,
        latest_status=scan_status(latest_study) if latest_study else None,
        latest_result=latest_result,
    )


# --- helpers ---------------------------------------------------------------

def _clean(data: dict) -> dict:
    """Trim strings and turn blanks into NULL, so "" never masquerades as data."""
    cleaned = {}
    for key, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        cleaned[key] = value
    return cleaned


def _check_dob(dob: date | None) -> None:
    if dob is None:
        return
    today = date.today()
    if dob > today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Date of birth cannot be in the future.")
    if today.year - dob.year > 130:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Date of birth is implausibly far in the past.")


def _unique_code(session: Session, requested: str | None) -> str:
    """Use the clinician's patient ID if given and free; otherwise mint NV-######."""
    if requested:
        code = requested.strip().upper()
        if session.exec(select(Patient).where(Patient.code == code)).first():
            raise HTTPException(status.HTTP_409_CONFLICT, f"Patient ID {code} is already in use.")
        return code
    for _ in range(20):
        code = f"NV-{secrets.randbelow(1_000_000):06d}"
        if not session.exec(select(Patient).where(Patient.code == code)).first():
            return code
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not allocate a patient ID.")
