"""Administration commands for doctor accounts.

    python backend/manage.py create-doctor --email a@b.org --name "Asha Rao" [--specialty Neurology] [--hospital "City Hospital"]
    python backend/manage.py reset-password --email a@b.org
    python backend/manage.py list-doctors
    python backend/manage.py deactivate --email a@b.org

Passwords are prompted for, or read from stdin with --password-stdin for
scripted setup -- never passed as an argument, where they would land in shell
history and the process list. A password reset also signs the doctor out
everywhere.

There is no emailed reset link: this install has no mail transport, and a
reset flow that cannot deliver its link would be a fake one. "Forgot password?"
on the login page points doctors at their administrator, who runs this.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlmodel import Session, select  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.models import Doctor  # noqa: E402
from app.services import auth  # noqa: E402


def _read_password(args) -> str:
    if getattr(args, "password_stdin", False):
        password = sys.stdin.readline().rstrip("\r\n")
        if len(password) < auth.MIN_PASSWORD_LENGTH or password.isalpha() or password.isdigit():
            raise SystemExit(
                f"Password from stdin rejected: at least {auth.MIN_PASSWORD_LENGTH} characters, "
                "mixing letters with numbers or symbols."
            )
        return password
    return _prompt_password()


def _prompt_password() -> str:
    while True:
        first = getpass.getpass("New password: ")
        if len(first) < auth.MIN_PASSWORD_LENGTH or first.isalpha() or first.isdigit():
            print(f"  At least {auth.MIN_PASSWORD_LENGTH} characters, mixing letters with numbers or symbols.")
            continue
        if getpass.getpass("Repeat password: ") != first:
            print("  Passwords do not match.")
            continue
        return first


def create_doctor(args) -> int:
    with Session(engine) as session:
        email = auth.normalize_email(args.email)
        if session.exec(select(Doctor).where(Doctor.email == email)).first():
            print(f"An account for {email} already exists.")
            return 1
        first_account = session.exec(select(Doctor)).first() is None
        doctor = Doctor(
            email=email,
            password_hash=auth.hash_password(_read_password(args)),
            full_name=args.name,
            specialty=args.specialty,
            hospital=args.hospital,
        )
        session.add(doctor)
        session.commit()
        session.refresh(doctor)
        if first_account:
            adopted = auth.adopt_unowned_patients(session, doctor)
            if adopted:
                print(f"Assigned {adopted} existing patient record(s) to this first account.")
        print(f"Created doctor #{doctor.id} <{email}>.")
    return 0


def reset_password(args) -> int:
    with Session(engine) as session:
        doctor = session.exec(select(Doctor).where(Doctor.email == auth.normalize_email(args.email))).first()
        if doctor is None:
            print("No such account.")
            return 1
        doctor.password_hash = auth.hash_password(_read_password(args))
        session.add(doctor)
        session.commit()
        auth.end_all_sessions(session, doctor.id)
        print(f"Password reset for {doctor.email}; all sessions signed out.")
    return 0


def list_doctors(_args) -> int:
    with Session(engine) as session:
        for doctor in session.exec(select(Doctor).order_by(Doctor.id)).all():
            state = "active" if doctor.is_active else "disabled"
            print(f"#{doctor.id:<4} {doctor.email:<36} {doctor.full_name:<28} {state}")
    return 0


def deactivate(args) -> int:
    with Session(engine) as session:
        doctor = session.exec(select(Doctor).where(Doctor.email == auth.normalize_email(args.email))).first()
        if doctor is None:
            print("No such account.")
            return 1
        doctor.is_active = False
        session.add(doctor)
        session.commit()
        auth.end_all_sessions(session, doctor.id)
        print(f"Deactivated {doctor.email}.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create-doctor")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--specialty")
    p.add_argument("--hospital")
    p.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    p.set_defaults(func=create_doctor)

    p = sub.add_parser("reset-password")
    p.add_argument("--email", required=True)
    p.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    p.set_defaults(func=reset_password)

    p = sub.add_parser("list-doctors")
    p.set_defaults(func=list_doctors)

    p = sub.add_parser("deactivate")
    p.add_argument("--email", required=True)
    p.set_defaults(func=deactivate)

    args = parser.parse_args()
    init_db()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
