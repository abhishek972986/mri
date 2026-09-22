"""API tests.

Each test gets its own temporary data directory and SQLite file, so runs cannot
see each other's patients and a failed run leaves nothing behind.

The pipeline itself is slow (~20 s per volume), so the tests that need a
completed analysis use a small phantom and are marked `slow`. Run the fast set
with `pytest -m "not slow"`.
"""

from __future__ import annotations

import io

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")

    # db.engine is bound at import time, so it has to be rebuilt against the
    # temporary path before the app's lifespan creates any tables.
    import app.db as db
    from sqlmodel import create_engine

    engine = create_engine(
        settings.resolved_database_url, connect_args={"check_same_thread": False}
    )
    monkeypatch.setattr(db, "engine", engine)

    import app.routers.analyses as analyses_router
    monkeypatch.setattr(analyses_router, "engine", engine)

    from app.main import app
    with TestClient(app) as test_client:
        yield test_client


def make_nifti_bytes(shape=(32, 32, 32), spacing=1.5) -> bytes:
    data = np.zeros(shape, dtype=np.float32)
    data[8:24, 8:24, 8:24] = 300.0
    image = nib.Nifti1Image(data, np.diag([spacing, spacing, spacing, 1.0]))
    buffer = io.BytesIO()
    file_map = image.make_file_map()
    file_map["image"].fileobj = buffer
    image.to_file_map(file_map)
    return buffer.getvalue()


# --- meta ------------------------------------------------------------------

def test_health_reports_the_active_backend(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["clinical_use"] is False
    assert "NOT A DIAGNOSIS" in body["disclaimer"]
    assert body["segmentation_backend"] in {"unet", "classical-fallback"}


# --- patients and studies --------------------------------------------------

def test_patient_lifecycle(client):
    created = client.post("/api/patients", json={"label": "Case A", "age_years": 40}).json()
    assert created["code"].startswith("PT-")

    listed = client.get("/api/patients").json()
    assert any(p["id"] == created["id"] for p in listed)

    assert client.delete(f"/api/patients/{created['id']}").status_code == 204
    assert client.get(f"/api/patients/{created['id']}").status_code == 404


def test_patient_schema_has_nowhere_to_put_phi(client):
    """Names and dates of birth must be impossible to store, not merely optional."""
    from app.models import Patient

    forbidden = {"name", "first_name", "last_name", "dob", "date_of_birth", "mrn", "nhs_number"}
    assert forbidden.isdisjoint(Patient.model_fields.keys())


def test_upload_accepts_a_nifti(client):
    patient = client.post("/api/patients", json={"label": "Upload test"}).json()

    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("scan.nii", make_nifti_bytes(), "application/octet-stream")},
        data={"sequence": "flair"},
    )
    assert response.status_code == 201, response.text

    study = response.json()
    assert study["sequence"] == "FLAIR"            # normalised to upper case
    assert study["shape"] == "32x32x32"
    assert study["spacing_mm"] == "1.50x1.50x1.50"


def test_upload_rejects_a_non_nifti(client):
    patient = client.post("/api/patients", json={}).json()
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("notes.txt", b"this is not a scan", "text/plain")},
    )
    assert response.status_code == 422
    assert "NIfTI" in response.json()["detail"]


def test_upload_rejects_a_single_slice(client):
    """A 2D image is a common mis-upload and must fail with a useful message."""
    patient = client.post("/api/patients", json={}).json()
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("slice.nii", make_nifti_bytes(shape=(64, 64, 2)), "application/octet-stream")},
    )
    assert response.status_code == 422
    assert "too small" in response.json()["detail"].lower()


def test_upload_rejects_an_unknown_sequence(client):
    patient = client.post("/api/patients", json={}).json()
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("scan.nii", make_nifti_bytes(), "application/octet-stream")},
        data={"sequence": "ULTRASOUND"},
    )
    assert response.status_code == 422


def test_filename_is_sanitized():
    from app.services.storage import sanitize_filename

    assert "/" not in sanitize_filename("../../etc/passwd.nii.gz")
    assert "\\" not in sanitize_filename(r"..\..\windows\system32\evil.nii")
    assert sanitize_filename("scan.nii.gz") == "scan.nii.gz"


# --- errors ----------------------------------------------------------------

def test_missing_resources_return_404(client):
    assert client.get("/api/analyses/9999").status_code == 404
    assert client.get("/api/patients/9999").status_code == 404
    assert client.get("/api/comparisons/9999").status_code == 404


def test_scene_requires_a_completed_analysis(client):
    patient = client.post("/api/patients", json={}).json()
    study = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("scan.nii", make_nifti_bytes(), "application/octet-stream")},
    ).json()

    from app.models import Analysis, AnalysisStatus
    from sqlmodel import Session
    import app.db as db

    with Session(db.engine) as session:
        session.add(Analysis(study_id=study["id"], status=AnalysisStatus.pending))
        session.commit()

    assert client.get("/api/analyses/1/scene").status_code == 409


def test_comparison_refuses_identical_analyses(client):
    response = client.post(
        "/api/comparisons", json={"baseline_analysis_id": 1, "followup_analysis_id": 1}
    )
    assert response.status_code == 422
    assert "different" in response.json()["detail"].lower()


# --- full pipeline ---------------------------------------------------------

@pytest.mark.slow
def test_demo_seed_runs_the_whole_pipeline(client):
    seeded = client.post("/api/demo/seed", json={"response": "improving", "n_lesions": 4}).json()
    assert len(seeded["analysis_ids"]) == 2

    # TestClient runs BackgroundTasks synchronously, so both analyses are done.
    for analysis_id in seeded["analysis_ids"]:
        analysis = client.get(f"/api/analyses/{analysis_id}").json()
        assert analysis["status"] == "complete", analysis.get("error")
        assert analysis["report"]["status"] == "draft"
        assert "NOT A DIAGNOSIS" in analysis["report"]["disclaimer"]
        assert analysis["burden"]["brain_volume_cm3"] > 500

        scene = client.get(f"/api/analyses/{analysis_id}/scene").json()
        assert scene["brain"]["triangle_count"] > 0

    comparison = client.post("/api/comparisons", json={
        "baseline_analysis_id": seeded["analysis_ids"][0],
        "followup_analysis_id": seeded["analysis_ids"][1],
    })
    assert comparison.status_code == 201, comparison.text
    assert comparison.json()["result"]["trend"] in {
        "improving", "worsening", "stable", "mixed", "indeterminate"
    }


@pytest.mark.slow
def test_slice_endpoint_blocks_path_traversal(client):
    seeded = client.post("/api/demo/seed", json={"response": "stable", "n_lesions": 2}).json()
    analysis_id = seeded["analysis_ids"][0]

    for attempt in ("../report.json", "..%2Freport.json", "....//report.json"):
        assert client.get(f"/api/analyses/{analysis_id}/slices/{attempt}").status_code in (404, 400)


@pytest.mark.slow
def test_review_validates_lesion_ids(client):
    seeded = client.post("/api/demo/seed", json={"response": "stable", "n_lesions": 3}).json()
    analysis_id = seeded["analysis_ids"][0]

    ok = client.post(f"/api/analyses/{analysis_id}/reviews", json={
        "status": "approved", "reviewer": "Dr Test", "rejected_lesion_ids": [],
    })
    assert ok.status_code == 201

    bad = client.post(f"/api/analyses/{analysis_id}/reviews", json={
        "rejected_lesion_ids": [9999],
    })
    assert bad.status_code == 422

    contradictory = client.post(f"/api/analyses/{analysis_id}/reviews", json={
        "rejected_lesion_ids": [1], "confirmed_lesion_ids": [1],
    })
    assert contradictory.status_code == 422
