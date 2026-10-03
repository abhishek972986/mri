"""Database models.

Ownership: every Patient belongs to exactly one Doctor, and everything below a
patient (studies, analyses, comparisons, reviews) is reached through it. The
routers enforce that chain on every request -- see services/auth.py.

Identifiable data: the clinical application stores patient demographics and
contact details (name, date of birth, phone, address) because a doctor-facing
record is unusable without them. That was a deliberate change from the original
pseudonymous-only schema, and it is why every patient route now requires an
authenticated doctor and checks ownership. The database file and data/ folder
hold PHI and must be protected accordingly (disk encryption, backups, no
commits -- data/ is already git-ignored).
"""

import uuid
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, List, Optional

from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, Relationship, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_code(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


class AnalysisStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"


class ReviewStatus(str, Enum):
    draft = "draft"
    reviewed = "reviewed"
    approved = "approved"
    rejected = "rejected"


class Doctor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    # scrypt, salted per account -- see services/auth.py. Never a plaintext password.
    password_hash: str
    full_name: str
    specialty: Optional[str] = None
    hospital: Optional[str] = None
    license_id: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    photo_path: Optional[str] = None
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utcnow)
    last_login_at: Optional[datetime] = None

    patients: List["Patient"] = Relationship(back_populates="doctor")


class AuthSession(SQLModel, table=True):
    """A signed-in browser. Only the SHA-256 of the cookie token is stored."""

    id: Optional[int] = Field(default=None, primary_key=True)
    token_hash: str = Field(unique=True, index=True)
    doctor_id: int = Field(foreign_key="doctor.id", index=True)
    created_at: datetime = Field(default_factory=_utcnow)
    expires_at: datetime
    persistent: bool = Field(default=False)


class Patient(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    # Owning doctor. Nullable only so rows created before accounts existed can be
    # migrated; they are adopted by the first doctor account (services/auth.py).
    doctor_id: Optional[int] = Field(default=None, foreign_key="doctor.id", index=True)
    code: str = Field(default_factory=lambda: _new_code("PT"), unique=True, index=True)
    label: Optional[str] = Field(default=None, description="Optional display label (legacy / synthetic records)")

    # Personal
    first_name: Optional[str] = Field(default=None, index=True)
    last_name: Optional[str] = Field(default=None, index=True)
    date_of_birth: Optional[date] = None
    sex: Optional[str] = None
    age_years: Optional[int] = None

    # Contact
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None

    # Clinical
    medical_history: Optional[str] = None
    medications: Optional[str] = None
    conditions: Optional[str] = None
    allergies: Optional[str] = None
    neuro_history: Optional[str] = None
    clinical_notes: Optional[str] = None

    # Emergency contact
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    emergency_relation: Optional[str] = None

    photo_path: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: Optional[datetime] = None

    doctor: Optional["Doctor"] = Relationship(back_populates="patients")

    studies: List["Study"] = Relationship(
        back_populates="patient",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Study(SQLModel, table=True):
    """One uploaded MRI volume: a single sequence from a single session."""

    id: Optional[int] = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patient.id", index=True)
    code: str = Field(default_factory=lambda: _new_code("ST"), unique=True, index=True)

    sequence: str = Field(default="UNKNOWN", description="T1, T2, FLAIR, T1C, T1, DWI, ADC or UNKNOWN")
    acquired_on: Optional[date] = None
    description: Optional[str] = None

    original_filename: str
    stored_path: str
    size_bytes: int = 0
    shape: Optional[str] = None
    spacing_mm: Optional[str] = None

    uploaded_at: datetime = Field(default_factory=_utcnow)

    patient: Optional["Patient"] = Relationship(back_populates="studies")
    analyses: List["Analysis"] = Relationship(
        back_populates="study",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Analysis(SQLModel, table=True):
    """One run of the pipeline over one study."""

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="study.id", index=True)

    status: AnalysisStatus = Field(default=AnalysisStatus.pending, index=True)
    # The pipeline stage currently executing, written by the worker as each one
    # starts (see pipeline_service.STAGES). This is real progress, not a timer.
    stage: Optional[str] = None
    stage_started_at: Optional[datetime] = None
    method: Optional[str] = None
    error: Optional[str] = None
    # PNG captured from the 3D viewer by the doctor, embedded in the PDF report.
    snapshot_path: Optional[str] = None

    created_at: datetime = Field(default_factory=_utcnow)
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None

    # Derived artifacts live on disk; the row holds the folder and the summaries
    # the dashboard needs without touching a NIfTI.
    artifacts_dir: Optional[str] = None

    burden: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    lesions: Optional[List[Any]] = Field(default=None, sa_column=Column(JSON))
    report: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    slices: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    technique: Optional[dict] = Field(default=None, sa_column=Column(JSON))

    study: Optional["Study"] = Relationship(back_populates="analyses")
    reviews: List["Review"] = Relationship(
        back_populates="analysis",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Comparison(SQLModel, table=True):
    """A longitudinal comparison between two completed analyses."""

    id: Optional[int] = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patient.id", index=True)
    baseline_analysis_id: int = Field(foreign_key="analysis.id", index=True)
    followup_analysis_id: int = Field(foreign_key="analysis.id", index=True)

    trend: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON))


class Review(SQLModel, table=True):
    """Doctor-in-the-loop record.

    Corrections are stored as an audit trail rather than overwriting the AI
    output: the original prediction, what the clinician changed, and who changed
    it all remain recoverable. That is both a medico-legal requirement and the
    only honest basis for using these corrections as future training labels.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    analysis_id: int = Field(foreign_key="analysis.id", index=True)

    status: ReviewStatus = Field(default=ReviewStatus.draft)
    reviewer: str = Field(default="unknown")
    comments: Optional[str] = None

    # Lesion ids the reviewer rejected as false positives, plus any free-form
    # corrections to the generated text.
    rejected_lesion_ids: Optional[List[Any]] = Field(default=None, sa_column=Column(JSON))
    confirmed_lesion_ids: Optional[List[Any]] = Field(default=None, sa_column=Column(JSON))
    edited_impression: Optional[str] = None

    created_at: datetime = Field(default_factory=_utcnow)

    analysis: Optional["Analysis"] = Relationship(back_populates="reviews")
