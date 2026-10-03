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
        # Every state-changing request must carry this (CSRF defence).
        test_client.headers.update({"X-Requested-With": "test"})
        register(test_client, "doctor@example.org", "Dr Test")
        yield test_client


PASSWORD = "correct-horse-7"


def register(client, email, name):
    response = client.post("/api/auth/register", json={
        "email": email, "password": PASSWORD, "full_name": name,
    })
    assert response.status_code == 201, response.text
    return response.json()


def new_patient(client, **overrides):
    payload = {"first_name": "Asha", "last_name": "Rao", "date_of_birth": "1984-03-02", "sex": "female"}
    payload.update(overrides)
    response = client.post("/api/patients", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


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
    created = new_patient(client)
    assert created["code"].startswith("NV-")
    assert created["display_name"] == "Asha Rao"
    assert created["age_years"] >= 40

    listed = client.get("/api/patients", params={"q": "asha rao"}).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == created["id"]
    assert client.get("/api/patients", params={"q": "nobody"}).json()["total"] == 0

    updated = client.put(f"/api/patients/{created['id']}", json={"allergies": "Penicillin"}).json()
    assert updated["allergies"] == "Penicillin"

    assert client.delete(f"/api/patients/{created['id']}").status_code == 204
    assert client.get(f"/api/patients/{created['id']}").status_code == 404


def test_patient_requires_name_dob_and_sex(client):
    assert client.post("/api/patients", json={"first_name": "A"}).status_code == 422
    assert client.post("/api/patients", json={
        "first_name": "A", "last_name": "B", "date_of_birth": "2999-01-01", "sex": "male",
    }).status_code == 422


def test_patient_id_must_be_unique(client):
    new_patient(client, code="HOSP-1")
    clash = client.post("/api/patients", json={
        "first_name": "B", "last_name": "C", "date_of_birth": "1990-01-01", "sex": "male", "code": "hosp-1",
    })
    assert clash.status_code == 409


# --- authentication and access control --------------------------------------

def test_patient_data_requires_sign_in(client):
    patient = new_patient(client)
    assert client.post("/api/auth/logout").status_code == 204

    assert client.get("/api/patients").status_code == 401
    assert client.get(f"/api/patients/{patient['id']}").status_code == 401
    assert client.get("/api/dashboard").status_code == 401


def test_doctors_cannot_see_each_others_patients(client):
    patient = new_patient(client)
    client.post("/api/auth/logout")

    from app.config import settings
    settings.allow_registration = True
    try:
        register(client, "other@example.org", "Dr Other")
    finally:
        settings.allow_registration = False

    # 404, not 403: another doctor's ids must not even be confirmable.
    assert client.get(f"/api/patients/{patient['id']}").status_code == 404
    assert client.get("/api/patients").json()["total"] == 0


def test_registration_closes_after_first_account(client):
    client.post("/api/auth/logout")
    assert client.get("/api/auth/status").json()["registration_open"] is False
    response = client.post("/api/auth/register", json={
        "email": "late@example.org", "password": PASSWORD, "full_name": "Dr Late",
    })
    assert response.status_code == 403


def test_login_and_wrong_password(client):
    client.post("/api/auth/logout")
    bad = client.post("/api/auth/login", json={"email": "doctor@example.org", "password": "wrong-pass-1"})
    assert bad.status_code == 401
    good = client.post("/api/auth/login", json={"email": "DOCTOR@example.org", "password": PASSWORD})
    assert good.status_code == 200
    assert client.get("/api/auth/me").json()["email"] == "doctor@example.org"


def test_passwords_are_never_stored_in_plaintext(client):
    from app.models import Doctor
    from sqlmodel import Session, select
    import app.db as db

    with Session(db.engine) as session:
        doctor = session.exec(select(Doctor)).first()
    assert PASSWORD not in doctor.password_hash
    assert doctor.password_hash.startswith("scrypt$")


def test_state_changes_require_csrf_header(client):
    response = client.post(
        "/api/patients",
        json={"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01", "sex": "male"},
        headers={"X-Requested-With": ""},
    )
    assert response.status_code == 403


def test_upload_accepts_a_nifti(client):
    patient = new_patient(client)

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
    patient = new_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("notes.txt", b"this is not a scan", "text/plain")},
    )
    assert response.status_code == 422
    assert "NIfTI" in response.json()["detail"]


def test_upload_rejects_a_single_slice(client):
    """A 2D image is a common mis-upload and must fail with a useful message."""
    patient = new_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("slice.nii", make_nifti_bytes(shape=(64, 64, 2)), "application/octet-stream")},
    )
    assert response.status_code == 422
    assert "too small" in response.json()["detail"].lower()


def test_upload_rejects_an_unknown_sequence(client):
    patient = new_patient(client)
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
    patient = new_patient(client)
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

        # The worker records real pipeline stages and finishes on "complete".
        assert analysis["stage"] == "complete"

        # A trained checkpoint runs at its own tuned operating point, and the
        # report records the threshold actually applied.
        technique = analysis["report"]["technique"]
        provenance = technique.get("model_provenance") or {}
        if provenance.get("operating_threshold"):
            assert technique["segmentation_threshold"] == provenance["operating_threshold"]

        # No readable text in the report names tuberculosis. Keys are skipped:
        # the checkpoint's negative provenance flag is literally named
        # "not_tuberculosis", and it is data, not report text.
        def strings(node):
            if isinstance(node, dict):
                for value in node.values():
                    yield from strings(value)
            elif isinstance(node, list):
                for value in node:
                    yield from strings(value)
            elif isinstance(node, str):
                yield node

        assert not [s for s in strings(analysis["report"]) if "tubercul" in s.lower()]

        pdf = client.get(f"/api/analyses/{analysis_id}/report.pdf")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")

    events = client.get(f"/api/patients/{seeded['patient_id']}/events").json()
    kinds = {e["kind"] for e in events}
    assert {"scan_uploaded", "analysis_completed", "report_generated"} <= kinds

    dashboard = client.get("/api/dashboard").json()
    assert dashboard["counts"]["scans"] == 2
    assert dashboard["counts"]["pending_review"] == 2

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


# --- sessions ----------------------------------------------------------------

def test_logout_destroys_the_session_server_side(client):
    from app.config import settings

    token = client.cookies.get(settings.session_cookie_name)
    assert token
    assert client.post("/api/auth/logout").status_code == 204

    # Replaying the old cookie must not work: the session row is gone.
    client.cookies.set(settings.session_cookie_name, token)
    assert client.get("/api/auth/me").status_code == 401


def test_remember_me_controls_cookie_lifetime(client):
    client.post("/api/auth/logout")
    short = client.post("/api/auth/login", json={"email": "doctor@example.org", "password": PASSWORD, "remember": False})
    assert "max-age" not in short.headers["set-cookie"].lower()
    client.post("/api/auth/logout")
    long = client.post("/api/auth/login", json={"email": "doctor@example.org", "password": PASSWORD, "remember": True})
    assert "max-age=2592000" in long.headers["set-cookie"].lower()
    assert "httponly" in long.headers["set-cookie"].lower()


def test_api_responses_are_never_cached(client):
    response = client.get("/api/patients")
    assert response.headers["cache-control"] == "no-store"


# --- patients ----------------------------------------------------------------

def test_patient_search_filter_sort_and_pagination(client):
    people = [("Asha", "female"), ("Rahul", "male"), ("Meera", "female"), ("Vikram", "male"), ("Nisha", "female")]
    for i, (first, sex) in enumerate(people):
        new_patient(client, first_name=first, last_name=f"Test{i}", sex=sex)

    page1 = client.get("/api/patients", params={"page_size": 2, "sort": "name"}).json()
    page3 = client.get("/api/patients", params={"page_size": 2, "page": 3, "sort": "name"}).json()
    assert page1["total"] == 5 and len(page1["items"]) == 2 and len(page3["items"]) == 1
    assert [p["first_name"] for p in page1["items"]] == ["Asha", "Meera"]

    assert client.get("/api/patients", params={"sex": "female"}).json()["total"] == 3
    assert client.get("/api/patients", params={"q": "vikram"}).json()["total"] == 1
    assert client.get("/api/patients", params={"status": "none"}).json()["total"] == 5


def test_patient_edit_keeps_id_and_validates(client):
    patient = new_patient(client)
    updated = client.put(f"/api/patients/{patient['id']}", json={"phone": "+44 20 7946 0000"}).json()
    assert updated["code"] == patient["code"] and updated["phone"] == "+44 20 7946 0000"
    assert client.put(f"/api/patients/{patient['id']}", json={"first_name": ""}).status_code == 422


# --- uploads and analysis lifecycle ------------------------------------------

def test_upload_rejects_a_corrupted_gzip(client):
    patient = new_patient(client)
    response = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("scan.nii.gz", b"\x1f\x8b\x08\x00truncated-garbage", "application/gzip")},
    )
    assert response.status_code == 422
    assert "not a readable nifti" in response.json()["detail"].lower()


def test_failed_analysis_reports_its_reason_and_can_be_retried(client):
    """An empty volume passes upload checks but has no brain: the real pipeline fails."""
    patient = new_patient(client)
    image = nib.Nifti1Image(np.zeros((40, 40, 40), dtype=np.float32), np.eye(4))
    buffer = io.BytesIO()
    file_map = image.make_file_map()
    file_map["image"].fileobj = buffer
    image.to_file_map(file_map)
    study = client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("blank.nii", buffer.getvalue(), "application/octet-stream")},
    ).json()

    first = client.post(f"/api/studies/{study['id']}/analyze").json()
    failed = client.get(f"/api/analyses/{first['id']}").json()
    assert failed["status"] == "failed"
    # A problem with the scan itself is explained in words meant for the doctor.
    assert "Brain extraction produced an empty mask" in failed["error"]
    assert client.get(f"/api/studies/{study['id']}").json()["status"] == "failed"

    retry = client.post(f"/api/studies/{study['id']}/analyze")
    assert retry.status_code == 202 and retry.json()["id"] != first["id"]
    assert len(client.get(f"/api/studies/{study['id']}/analyses").json()) == 2

    kinds = {e["kind"] for e in client.get(f"/api/patients/{patient['id']}/events").json()}
    assert "analysis_failed" in kinds


def _stored_study(client):
    patient = new_patient(client)
    return client.post(
        f"/api/patients/{patient['id']}/studies",
        files={"file": ("scan.nii", make_nifti_bytes(), "application/octet-stream")},
    ).json()


def test_cannot_start_a_second_run_while_one_is_running(client):
    study = _stored_study(client)

    from app.models import Analysis, AnalysisStatus
    from sqlmodel import Session
    import app.db as db

    with Session(db.engine) as session:
        session.add(Analysis(study_id=study["id"], status=AnalysisStatus.running, stage="segmenting"))
        session.commit()

    assert client.post(f"/api/studies/{study['id']}/analyze").status_code == 409


def test_runs_interrupted_by_a_restart_are_marked_failed(client):
    study = _stored_study(client)

    from app.main import _fail_interrupted_analyses
    from app.models import Analysis, AnalysisStatus
    from sqlmodel import Session
    import app.db as db

    with Session(db.engine) as session:
        run = Analysis(study_id=study["id"], status=AnalysisStatus.running, stage="mesh")
        session.add(run)
        session.commit()
        run_id = run.id

    assert _fail_interrupted_analyses() == 1
    analysis = client.get(f"/api/analyses/{run_id}").json()
    assert analysis["status"] == "failed" and "restarted" in analysis["error"]


# --- cross-doctor isolation over real pipeline output -------------------------

@pytest.mark.slow
def test_other_doctor_cannot_reach_any_scan_artifact(client):
    seeded = client.post("/api/demo/seed", json={"response": "worsening", "n_lesions": 3}).json()
    pid = seeded["patient_id"]
    sid = seeded["study_ids"][1]
    base_id, follow_id = seeded["analysis_ids"]

    # The owner can use every artifact.
    volume = client.get(f"/api/analyses/{follow_id}/volume")
    assert volume.status_code == 200
    axial = volume.json()["planes"]["axial"]
    assert axial["count"] > 100
    png = client.get(f"/api/analyses/{follow_id}/slice/axial/{axial['peak_slice']}", params={"layer": "mask"})
    assert png.status_code == 200 and png.content.startswith(b"\x89PNG")
    assert client.get(f"/api/analyses/{follow_id}/slice/axial/{axial['count']}").status_code == 404

    from PIL import Image
    snapshot = io.BytesIO()
    Image.new("RGB", (64, 48), (20, 30, 50)).save(snapshot, format="PNG")
    saved = client.post(f"/api/analyses/{follow_id}/snapshot", files={"file": ("s.png", snapshot.getvalue(), "image/png")})
    assert saved.json()["has_snapshot"]

    comparison = client.post("/api/comparisons", json={"baseline_analysis_id": base_id, "followup_analysis_id": follow_id}).json()
    first_slice = client.get(f"/api/analyses/{follow_id}").json()["slices"]["axial"][0]["image"]

    client.post("/api/auth/logout")
    from app.config import settings
    settings.allow_registration = True
    try:
        register(client, "intruder@example.org", "Dr Other")
    finally:
        settings.allow_registration = False

    probes = [
        f"/api/patients/{pid}", f"/api/patients/{pid}/studies", f"/api/patients/{pid}/timeline",
        f"/api/patients/{pid}/events", f"/api/patients/{pid}/comparisons", f"/api/patients/{pid}/photo",
        f"/api/studies/{sid}", f"/api/studies/{sid}/analyses",
        f"/api/analyses/{follow_id}", f"/api/analyses/{follow_id}/scene", f"/api/analyses/{follow_id}/volume",
        f"/api/analyses/{follow_id}/slice/axial/10", f"/api/analyses/{follow_id}/slices/{first_slice}",
        f"/api/analyses/{follow_id}/snapshot", f"/api/analyses/{follow_id}/report.pdf",
        f"/api/analyses/{follow_id}/download/lesion-mask", f"/api/analyses/{follow_id}/reviews",
        f"/api/comparisons/{comparison['id']}", f"/api/comparisons/{comparison['id']}/scene",
    ]
    for url in probes:
        assert client.get(url).status_code == 404, url

    assert client.post(f"/api/studies/{sid}/analyze").status_code == 404
    assert client.post(f"/api/analyses/{follow_id}/reviews", json={"status": "approved"}).status_code == 404
    assert client.post("/api/comparisons", json={"baseline_analysis_id": base_id, "followup_analysis_id": follow_id}).status_code == 404
    assert client.delete(f"/api/patients/{pid}").status_code == 404

    assert client.get("/api/patients").json()["total"] == 0
    assert client.get("/api/studies").json() == []
    assert client.get("/api/reports").json() == []
    assert client.get("/api/dashboard").json()["counts"]["scans"] == 0


def test_internal_pipeline_errors_do_not_leak_server_details(client, monkeypatch):
    """An unexpected fault is logged in full but shown to the doctor only by type."""
    study = _stored_study(client)

    import app.services.pipeline_service as service

    def explode(*args, **kwargs):
        raise RuntimeError(r"cannot open C:\srv\neurovision\data\uploads\secret.nii.gz")

    monkeypatch.setattr(service, "run_analysis", explode)
    run = client.post(f"/api/studies/{study['id']}/analyze").json()
    error = client.get(f"/api/analyses/{run['id']}").json()["error"]
    assert "RuntimeError" in error
    assert "uploads" not in error and "secret" not in error and "C:" not in error


def test_expired_sessions_are_swept_on_sign_in(client):
    from datetime import datetime, timedelta, timezone
    from app.models import AuthSession
    from sqlmodel import Session, select
    import app.db as db

    with Session(db.engine) as session:
        session.add(AuthSession(
            token_hash="stale", doctor_id=1,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        ))
        session.commit()

    client.post("/api/auth/login", json={"email": "doctor@example.org", "password": PASSWORD})
    with Session(db.engine) as session:
        assert session.exec(select(AuthSession).where(AuthSession.token_hash == "stale")).first() is None
