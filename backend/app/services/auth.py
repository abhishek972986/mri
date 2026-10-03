"""Doctor authentication and access control.

Passwords
    scrypt (hashlib, stdlib) with a per-account random salt, stored as
    `scrypt$n$r$p$salt$hash`. Verification is constant-time. No plaintext and
    no reversible encoding is ever stored.

Sessions
    A 256-bit random token in an HttpOnly, SameSite=Lax cookie. The database
    keeps only its SHA-256, so a leaked database cannot be replayed as logins.
    Cookies rather than a bearer header because the browser loads MRI slices
    and photos through <img src>, which cannot carry an Authorization header.

CSRF
    SameSite=Lax already stops cross-site POSTs carrying the cookie in modern
    browsers. As a second line, every state-changing request must also send
    `X-Requested-With`, a header a cross-site form cannot set.

Ownership
    `require_*` helpers resolve a resource *through its owning doctor* and
    answer 404 -- not 403 -- when it belongs to someone else, so ids cannot be
    probed to learn which patients exist.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response, status
from sqlmodel import Session, select

from ..config import settings
from ..db import get_session
from ..models import Analysis, AuthSession, Comparison, Doctor, Patient, Study

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
MIN_PASSWORD_LENGTH = 8

CSRF_HEADER = "x-requested-with"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


# --- passwords ---------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n), r=int(r), p=int(p),
            dklen=len(bytes.fromhex(digest_hex)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )
    if password.isalpha() or password.isdigit():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Password must mix letters with numbers or symbols.",
        )


# A fixed hash to verify against when the email is unknown, so a failed login
# takes the same time whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def authenticate(session: Session, email: str, password: str) -> Doctor | None:
    doctor = session.exec(select(Doctor).where(Doctor.email == normalize_email(email))).first()
    if doctor is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not doctor.is_active or not verify_password(password, doctor.password_hash):
        return None
    return doctor


def normalize_email(email: str) -> str:
    return email.strip().lower()


# --- sessions ----------------------------------------------------------------

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes; they were written as UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def start_session(session: Session, response: Response, doctor: Doctor, remember: bool) -> None:
    token = secrets.token_urlsafe(32)
    lifetime = timedelta(days=settings.remember_me_days) if remember else timedelta(hours=settings.session_hours)
    record = AuthSession(
        token_hash=_hash_token(token),
        doctor_id=doctor.id,
        expires_at=_utcnow() + lifetime,
        persistent=remember,
    )
    doctor.last_login_at = _utcnow()
    session.add(record)
    session.add(doctor)
    # Expired sessions are only removed when their cookie is presented; sweep
    # the rest here so the table does not keep dead tokens indefinitely.
    now = _utcnow()
    for stale in session.exec(select(AuthSession).where(AuthSession.expires_at < now.replace(tzinfo=None))).all():
        session.delete(stale)
    session.commit()

    response.set_cookie(
        settings.session_cookie_name,
        token,
        # Without max_age the cookie dies with the browser; the server-side
        # expiry still applies either way.
        max_age=int(lifetime.total_seconds()) if remember else None,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def end_session(session: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        record = session.exec(select(AuthSession).where(AuthSession.token_hash == _hash_token(token))).first()
        if record:
            session.delete(record)
            session.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")


def end_all_sessions(session: Session, doctor_id: int, keep_token: str | None = None) -> None:
    """Sign a doctor out everywhere, e.g. after a password change."""
    keep = _hash_token(keep_token) if keep_token else None
    for record in session.exec(select(AuthSession).where(AuthSession.doctor_id == doctor_id)).all():
        if record.token_hash != keep:
            session.delete(record)
    session.commit()


def current_doctor(request: Request, session: Session = Depends(get_session)) -> Doctor:
    """Dependency: the signed-in doctor, or 401. Also enforces the CSRF header."""
    if request.method not in _SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header.")

    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")

    record = session.exec(select(AuthSession).where(AuthSession.token_hash == _hash_token(token))).first()
    if record is None or _as_aware(record.expires_at) < _utcnow():
        if record is not None:
            session.delete(record)
            session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")

    doctor = session.get(Doctor, record.doctor_id)
    if doctor is None or not doctor.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is disabled.")
    return doctor


def adopt_unowned_patients(session: Session, doctor: Doctor) -> int:
    """Give records created before accounts existed to the first doctor.

    Without an owner they would be unreachable -- every route filters by it.
    """
    orphans = session.exec(select(Patient).where(Patient.doctor_id.is_(None))).all()
    for patient in orphans:
        patient.doctor_id = doctor.id
        session.add(patient)
    session.commit()
    return len(orphans)


# --- ownership ---------------------------------------------------------------

def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")


def require_patient(session: Session, patient_id: int, doctor: Doctor) -> Patient:
    patient = session.get(Patient, patient_id)
    if patient is None or patient.doctor_id != doctor.id:
        raise _not_found("Patient")
    return patient


def require_study(session: Session, study_id: int, doctor: Doctor) -> Study:
    study = session.get(Study, study_id)
    if study is None:
        raise _not_found("Scan")
    patient = session.get(Patient, study.patient_id)
    if patient is None or patient.doctor_id != doctor.id:
        raise _not_found("Scan")
    return study


def require_analysis(session: Session, analysis_id: int, doctor: Doctor) -> Analysis:
    analysis = session.get(Analysis, analysis_id)
    if analysis is None:
        raise _not_found("Analysis")
    require_study(session, analysis.study_id, doctor)
    return analysis


def require_comparison(session: Session, comparison_id: int, doctor: Doctor) -> Comparison:
    comparison = session.get(Comparison, comparison_id)
    if comparison is None:
        raise _not_found("Comparison")
    require_patient(session, comparison.patient_id, doctor)
    return comparison
