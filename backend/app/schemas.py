"""Request and response models for the API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from .models import AnalysisStatus, ReviewStatus


class PatientCreate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    sex: str | None = Field(default=None, max_length=16)
    age_years: int | None = Field(default=None, ge=0, le=130)
    clinical_notes: str | None = None


class PatientRead(BaseModel):
    id: int
    code: str
    label: str | None
    sex: str | None
    age_years: int | None
    clinical_notes: str | None
    created_at: datetime
    study_count: int = 0


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


class AnalysisRead(BaseModel):
    id: int
    study_id: int
    status: AnalysisStatus
    method: str | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None
    duration_seconds: float | None
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
