"""Database models.

Note on identifiers: this schema deliberately has nowhere to put a patient name,
date of birth, or hospital number. Patients are referenced by a generated
pseudonymous code, and an optional free-text label the clinician controls. Making
the PHI field absent rather than optional is the only version of "anonymized
before processing" that survives contact with a deadline.
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


class Patient(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(default_factory=lambda: _new_code("PT"), unique=True, index=True)
    label: Optional[str] = Field(default=None, description="Clinician-controlled pseudonym, never a real name")
    sex: Optional[str] = None
    age_years: Optional[int] = None
    clinical_notes: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)

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
    method: Optional[str] = None
    error: Optional[str] = None

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
