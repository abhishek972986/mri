"""Application configuration."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NEUROTB_", env_file=".env", extra="ignore")

    app_name: str = "NeuroVision AI"
    data_dir: Path = PROJECT_ROOT / "data"
    database_url: str = ""

    # Path to a trained segmentation checkpoint. When absent, the pipeline falls
    # back to the classical detector and every report says so.
    model_checkpoint: Path | None = None
    # None lets each backend use its own operating point: a trained checkpoint's
    # threshold tuned on its validation set, or the classical detector's 0.6.
    # Set NEUROTB_SEGMENTATION_THRESHOLD only to deliberately override both.
    segmentation_threshold: float | None = None

    # Uploads are capped well above a typical structural series (~30 MB) but far
    # below anything that would exhaust memory during resampling.
    max_upload_mb: int = 512
    allowed_extensions: tuple[str, ...] = (".nii", ".nii.gz", ".gz")

    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    # --- authentication ---------------------------------------------------
    # Sessions are opaque random tokens in an HttpOnly cookie; only their hash
    # is stored. A plain session lasts a working day, "remember me" a month.
    session_cookie_name: str = "nv_session"
    session_hours: int = 12
    remember_me_days: int = 30
    # Set true behind HTTPS so the cookie is never sent in clear text.
    cookie_secure: bool = False
    # Self-service sign-up is off by default: accounts are created by an
    # administrator (backend/manage.py). The very first account can always be
    # created from the login screen, so a fresh install is usable.
    allow_registration: bool = False

    max_photo_mb: int = 5

    @property
    def active_checkpoint(self) -> Path | None:
        """The checkpoint actually in use.

        An explicit NEUROTB_MODEL_CHECKPOINT always wins. Otherwise the newest
        file in backend/checkpoints is picked up automatically, so finishing a
        training run is enough to put the model in front of the API without
        also having to remember to set an environment variable.
        """
        if self.model_checkpoint:
            return self.model_checkpoint if self.model_checkpoint.exists() else None

        checkpoint_dir = BACKEND_ROOT / "checkpoints"
        if not checkpoint_dir.is_dir():
            return None
        candidates = sorted(
            checkpoint_dir.glob("*.pt"), key=lambda f: f.stat().st_mtime, reverse=True
        )
        return candidates[0] if candidates else None

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def derived_dir(self) -> Path:
        return self.data_dir / "derived"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'neurotb.db').as_posix()}"

    @property
    def photos_dir(self) -> Path:
        return self.data_dir / "photos"

    def ensure_dirs(self) -> None:
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.derived_dir.mkdir(parents=True, exist_ok=True)
        self.photos_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
