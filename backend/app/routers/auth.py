"""Sign-in, sign-out, and the signed-in doctor's own profile."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import Session, func, select

from ..config import settings
from ..db import get_session
from ..models import Doctor
from ..schemas import DoctorRead, DoctorUpdate, LoginRequest, PasswordChange, RegisterRequest
from ..services import auth, storage

router = APIRouter(prefix="/api", tags=["auth"])


def doctor_read(doctor: Doctor) -> DoctorRead:
    # getattr rather than model_dump: after a commit the instance is expired,
    # and only attribute access reloads it (model_dump would see an empty dict).
    fields = {name: getattr(doctor, name) for name in DoctorRead.model_fields if name != "has_photo"}
    return DoctorRead(**fields, has_photo=bool(doctor.photo_path))


def _doctor_count(session: Session) -> int:
    return session.exec(select(func.count()).select_from(Doctor)).one()


@router.get("/auth/status")
def auth_status(session: Session = Depends(get_session)) -> dict:
    """Public: whether this install has any doctor account yet.

    The login screen uses it to offer first-account setup on a fresh install
    and nothing more. It reveals no account details.
    """
    has_accounts = _doctor_count(session) > 0
    return {
        "has_accounts": has_accounts,
        "registration_open": settings.allow_registration or not has_accounts,
    }


@router.post("/auth/register", response_model=DoctorRead, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> DoctorRead:
    """Create a doctor account.

    Open only for the first account on a fresh install, or when
    NEUROTB_ALLOW_REGISTRATION is set. Otherwise accounts are created by an
    administrator with `python backend/manage.py create-doctor`.
    """
    if not request.headers.get(auth.CSRF_HEADER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header.")

    first_account = _doctor_count(session) == 0
    if not (first_account or settings.allow_registration):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Registration is closed. Ask an administrator to create your account.",
        )

    auth.validate_new_password(payload.password)
    email = auth.normalize_email(payload.email)
    if session.exec(select(Doctor).where(Doctor.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")

    doctor = Doctor(
        email=email,
        password_hash=auth.hash_password(payload.password),
        full_name=payload.full_name.strip(),
        specialty=payload.specialty,
        hospital=payload.hospital,
        license_id=payload.license_id,
    )
    session.add(doctor)
    session.commit()
    session.refresh(doctor)

    if first_account:
        auth.adopt_unowned_patients(session, doctor)

    auth.start_session(session, response, doctor, remember=False)
    return doctor_read(doctor)


@router.post("/auth/login", response_model=DoctorRead)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> DoctorRead:
    if not request.headers.get(auth.CSRF_HEADER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header.")

    doctor = auth.authenticate(session, payload.email, payload.password)
    if doctor is None:
        # One message for unknown email and wrong password alike.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password.")

    auth.start_session(session, response, doctor, remember=payload.remember)
    return doctor_read(doctor)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, session: Session = Depends(get_session)) -> None:
    auth.end_session(session, request, response)


@router.get("/auth/me", response_model=DoctorRead)
def me(doctor: Doctor = Depends(auth.current_doctor)) -> DoctorRead:
    return doctor_read(doctor)


# --- profile -------------------------------------------------------------------

@router.get("/doctor/profile", response_model=DoctorRead)
def get_profile(doctor: Doctor = Depends(auth.current_doctor)) -> DoctorRead:
    return doctor_read(doctor)


@router.put("/doctor/profile", response_model=DoctorRead)
def update_profile(
    payload: DoctorUpdate,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> DoctorRead:
    changes = payload.model_dump(exclude_unset=True)

    if "email" in changes and changes["email"] is not None:
        email = auth.normalize_email(changes["email"])
        clash = session.exec(select(Doctor).where(Doctor.email == email, Doctor.id != doctor.id)).first()
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "Another account already uses this email.")
        changes["email"] = email
    if "full_name" in changes and not (changes["full_name"] or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name is required.")

    for key, value in changes.items():
        if key in ("email", "full_name") and value is None:
            continue
        setattr(doctor, key, value.strip() if isinstance(value, str) else value)
    session.add(doctor)
    session.commit()
    session.refresh(doctor)
    return doctor_read(doctor)


@router.put("/doctor/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChange,
    request: Request,
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> None:
    if not auth.verify_password(payload.current_password, doctor.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Current password is incorrect.")
    auth.validate_new_password(payload.new_password)

    doctor.password_hash = auth.hash_password(payload.new_password)
    session.add(doctor)
    session.commit()
    # Everyone else holding a session for this account is signed out; this
    # browser stays signed in.
    auth.end_all_sessions(session, doctor.id, keep_token=request.cookies.get(settings.session_cookie_name))


@router.post("/doctor/profile/photo", response_model=DoctorRead)
def upload_profile_photo(
    file: UploadFile = File(...),
    doctor: Doctor = Depends(auth.current_doctor),
    session: Session = Depends(get_session),
) -> DoctorRead:
    try:
        path = storage.store_photo(file.file, "doctors")
    except storage.UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    storage.delete_artifacts(doctor.photo_path)
    doctor.photo_path = path
    session.add(doctor)
    session.commit()
    session.refresh(doctor)
    return doctor_read(doctor)


@router.get("/doctor/profile/photo")
def get_profile_photo(doctor: Doctor = Depends(auth.current_doctor)) -> FileResponse:
    if not doctor.photo_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile photo.")
    return FileResponse(doctor.photo_path, media_type="image/jpeg")
