"""Request and response models for the API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from .models import AnalysisStatus, ReviewStatus


# --- auth and doctor ------------------------------------------------------

_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_PHONE = r"^[0-9+()\-\s.]{5,32}$"


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)
    remember: bool = False


class RegisterRequest(BaseModel):
    email: str = Field(pattern=_EMAIL, max_length=254)
    password: str = Field(min_length=8, max_length=256)
    full_name: str = Field(min_length=2, max_length=120)
    specialty: str | None = Field(default=None, max_length=120)
    hospital: str | None = Field(default=None, max_length=160)
    license_id: str | None = Field(default=None, max_length=64)


class DoctorRead(BaseModel):
    id: int
    email: str
    full_name: str
    specialty: str | None
    hospital: str | None
    license_id: str | None
    phone: str | None
    location: str | None
    has_photo: bool = False
    created_at: datetime
    last_login_at: datetime | None


class DoctorUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, pattern=_EMAIL, max_length=254)
    specialty: str | None = Field(default=None, max_length=120)
    hospital: str | None = Field(default=None, max_length=160)
    license_id: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    location: str | None = Field(default=None, max_length=160)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


# --- patients --------------------------------------------------------------

class PatientBase(BaseModel):
    first_name: str | None = Field(default=None, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    date_of_birth: date | None = None
    sex: str | None = Field(default=None, pattern="^(male|female|other|unspecified)$")
    code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9\-_/]{1,31}$")

    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)
    address: str | None = Field(default=None, max_length=400)

    medical_history: str | None = Field(default=None, max_length=5000)
    medications: str | None = Field(default=None, max_length=2000)
    conditions: str | None = Field(default=None, max_length=2000)
    allergies: str | None = Field(default=None, max_length=1000)
    neuro_history: str | None = Field(default=None, max_length=3000)
    clinical_notes: str | None = Field(default=None, max_length=5000)

    emergency_name: str | None = Field(default=None, max_length=120)
    emergency_phone: str | None = Field(default=None, max_length=32)
    emergency_relation: str | None = Field(default=None, max_length=60)


class PatientCreate(PatientBase):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    date_of_birth: date
    sex: str = Field(pattern="^(male|female|other|unspecified)$")


class PatientUpdate(PatientBase):
    pass


class PatientRead(BaseModel):
    id: int
    code: str
    label: str | None
    display_name: str
    first_name: str | None
    last_name: str | None
    date_of_birth: date | None
    sex: str | None
    age_years: int | None

    phone: str | None
    email: str | None
    address: str | None

    medical_history: str | None
    medications: str | None
    conditions: str | None
    allergies: str | None
    neuro_history: str | None
    clinical_notes: str | None

    emergency_name: str | None
    emergency_phone: str | None
    emergency_relation: str | None

    has_photo: bool = False
    created_at: datetime
    updated_at: datetime | None
    study_count: int = 0
    last_scan_at: datetime | None = None
    latest_status: str | None = None
    latest_result: str | None = None


class PatientPage(BaseModel):
    items: list[PatientRead]
    total: int
    page: int
    page_size: int


class StudyRead(BaseModel):
    id: int
    code: str
    patient_id: int
    sequence: str
    acquired_on: date | None
    description: str | None
    original_filename: str
    size_bytes: int
    shape: str | None
    spacing_mm: str | None
    uploaded_at: datetime
    latest_analysis_id: int | None = None
    latest_analysis_status: AnalysisStatus | None = None
    # Derived clinical-facing status: uploaded, queued, processing, completed,
    # needs_review, reviewed, failed. See routers/patients.scan_status.
    status: str = "uploaded"
    stage: str | None = None
    error: str | None = None
    completed_at: datetime | None = None
    lesion_count: int | None = None
    total_volume_cm3: float | None = None
    headline: str | None = None
    method: str | None = None
    # Present on cross-patient lists (dashboard, scans page).
    patient_name: str | None = None
    patient_code: str | None = None


class AnalysisRead(BaseModel):
    id: int
    study_id: int
    status: AnalysisStatus
    stage: str | None = None
    stage_started_at: datetime | None = None
    method: str | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None
    duration_seconds: float | None
    has_snapshot: bool = False
    burden: dict | None = None
    lesions: list | None = None
    report: dict | None = None
    slices: dict | None = None
    technique: dict | None = None


class AnalysisSummary(BaseModel):
    """Light row for lists and the timeline; omits the heavy nested payloads."""

    id: int
    study_id: int
    status: AnalysisStatus
    method: str | None
    created_at: datetime
    sequence: str | None = None
    acquired_on: date | None = None
    lesion_count: int | None = None
    total_volume_cm3: float | None = None
    largest_volume_cm3: float | None = None
    trend_headline: str | None = None


class ComparisonCreate(BaseModel):
    baseline_analysis_id: int
    followup_analysis_id: int


class ComparisonRead(BaseModel):
    id: int
    patient_id: int
    baseline_analysis_id: int
    followup_analysis_id: int
    trend: str | None
    created_at: datetime
    result: dict | None = None


class ReviewCreate(BaseModel):
    status: ReviewStatus = ReviewStatus.reviewed
    reviewer: str = Field(default="unknown", max_length=120)
    comments: str | None = None
    rejected_lesion_ids: list[int] = Field(default_factory=list)
    confirmed_lesion_ids: list[int] = Field(default_factory=list)
    edited_impression: str | None = None


class ReviewRead(BaseModel):
    id: int
    analysis_id: int
    status: ReviewStatus
    reviewer: str
    comments: str | None
    rejected_lesion_ids: list | None
    confirmed_lesion_ids: list | None
    edited_impression: str | None
    created_at: datetime


class DemoRequest(BaseModel):
    """Seed a synthetic patient with a baseline and follow-up study."""

    response: str = Field(default="improving", pattern="^(improving|worsening|stable|mixed)$")
    n_lesions: int = Field(default=5, ge=1, le=12)
    label: str | None = None
