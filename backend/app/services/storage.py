"""Upload validation and storage.

Two jobs: keep files that are not brain MRI out of the pipeline, and keep the
filename the user chose from reaching the filesystem. Uploads are written under a
generated name; the original is kept only as a database column.
"""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

import nibabel as nib

from ..config import settings

# Deliberately narrow. DICOM support means a de-identification step, and that is
# a bigger commitment than an extension check -- see docs/ROADMAP.md.
_NIFTI_SUFFIXES = (".nii", ".nii.gz")
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


class UploadError(ValueError):
    """Raised when an upload cannot be accepted. Message is safe to show a user."""


def sanitize_filename(name: str) -> str:
    """Strip any path component and anything that is not a plain filename character."""
    base = Path(name.replace("\\", "/")).name
    cleaned = _SAFE_NAME.sub("_", base).lstrip(".")
    return cleaned[:180] or "upload.nii.gz"


def validate_extension(filename: str) -> str:
    lowered = filename.lower()
    for suffix in _NIFTI_SUFFIXES:
        if lowered.endswith(suffix):
            return suffix
    raise UploadError(
        f"Unsupported file type. Upload a NIfTI volume ({' or '.join(_NIFTI_SUFFIXES)}); "
        f"convert DICOM series with dcm2niix first."
    )


def store_upload(file_obj, original_filename: str) -> dict:
    """Stream an upload to disk, then verify it really is a 3D volume.

    Validation happens after writing rather than before because a NIfTI header
    cannot be checked without a seekable file, and streaming to disk bounds
    memory use regardless of what was sent.
    """
    safe_name = sanitize_filename(original_filename)
    suffix = validate_extension(safe_name)

    settings.ensure_dirs()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    destination = settings.uploads_dir / stored_name

    max_bytes = settings.max_upload_mb * 1024 * 1024
    written = 0
    try:
        with destination.open("wb") as out:
            while chunk := file_obj.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise UploadError(f"File exceeds the {settings.max_upload_mb} MB limit.")
                out.write(chunk)
    except UploadError:
        destination.unlink(missing_ok=True)
        raise
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    try:
        metadata = _inspect_volume(destination)
    except UploadError:
        destination.unlink(missing_ok=True)
        raise

    return {
        "stored_path": str(destination),
        "original_filename": safe_name,
        "size_bytes": written,
        **metadata,
    }


def _inspect_volume(path: Path) -> dict:
    try:
        img = nib.load(str(path))
        shape = tuple(int(s) for s in img.shape)
        zooms = tuple(float(z) for z in img.header.get_zooms()[:3])
    except Exception as exc:
        raise UploadError(f"File is not a readable NIfTI volume: {exc}") from exc

    if len(shape) < 3:
        raise UploadError(f"Expected a 3D volume, got shape {shape}.")

    spatial = shape[:3]
    if min(spatial) < 16:
        raise UploadError(
            f"Volume is too small to be a brain MRI (shape {spatial}). "
            "Check that the upload is a full 3D series rather than a single slice."
        )
    if any(dim > 1024 for dim in spatial):
        raise UploadError(f"Volume dimensions are implausibly large (shape {spatial}).")
    if any(z <= 0 or z > 20 for z in zooms):
        raise UploadError(
            f"Voxel spacing {tuple(round(z, 2) for z in zooms)} mm is outside the plausible "
            "range; the header may be malformed."
        )

    return {
        "shape": "x".join(str(s) for s in spatial),
        "spacing_mm": "x".join(f"{z:.2f}" for z in zooms),
    }


def delete_artifacts(*paths: str | Path | None) -> None:
    """Best-effort cleanup. Never raises -- a failed delete must not fail a request."""
    for path in paths:
        if not path:
            continue
        target = Path(path)
        try:
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            else:
                target.unlink(missing_ok=True)
        except OSError:
            pass
