"""NeuroVision AI API.

AI-assisted brain MRI analysis for clinician review: focal lesion segmentation
with a 3D U-Net trained on adult diffuse glioma (BraTS 2024, FLAIR), 3D
quantification and visualisation, longitudinal change analysis, and structured
preliminary reporting. The model marks regions of abnormal signal; it does not
identify what they are.

Nothing this service returns is a diagnosis. Every report it generates is marked
as requiring review by a qualified clinician, and the API has no endpoint that
finalises a report without a recorded human reviewer.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import init_db
from .pipeline.nets import torch_available
from .pipeline.report import DISCLAIMER
from .routers import analyses, auth, demo, patients
from .services.storage import UploadError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("neurotb")


class _DropQueryStrings(logging.Filter):
    """Keep patient searches out of the access log.

    Uvicorn logs the full request path, and `/api/patients?q=...` carries
    patient names. The path alone is enough to operate the service.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3 and isinstance(record.args[2], str):
            args = list(record.args)
            args[2] = args[2].split("?", 1)[0]
            record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(_DropQueryStrings())


def _fail_interrupted_analyses() -> int:
    """Analyses run inside this process; a restart kills them mid-flight.

    Left alone, their rows would say "running" forever and the processing
    screen would wait indefinitely. They are marked failed with the reason,
    so the doctor sees what happened and can retry.
    """
    from datetime import datetime, timezone

    from sqlmodel import Session, select

    from .db import engine
    from .models import Analysis, AnalysisStatus

    with Session(engine) as session:
        stuck = session.exec(
            select(Analysis).where(Analysis.status.in_([AnalysisStatus.pending, AnalysisStatus.running]))
        ).all()
        for analysis in stuck:
            analysis.status = AnalysisStatus.failed
            analysis.error = (
                "Interrupted: the server restarted while this analysis was running. "
                "No results were produced. Retry the analysis to run it again."
            )
            analysis.completed_at = datetime.now(timezone.utc)
            session.add(analysis)
        session.commit()
    return len(stuck)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    interrupted = _fail_interrupted_analyses()
    if interrupted:
        logger.warning("Marked %d interrupted analysis run(s) as failed.", interrupted)
    logger.info("Data directory: %s", settings.data_dir)
    checkpoint = settings.active_checkpoint
    if checkpoint:
        logger.info("Segmentation checkpoint: %s", checkpoint)
        meta = _checkpoint_metadata(checkpoint)
        if meta.get("pathology") or meta.get("trained_on"):
            logger.info(
                "Model trained on %s. It segments focal signal abnormality; it does "
                "not identify what a segmented region is.",
                meta.get("pathology") or meta.get("trained_on"),
            )
    else:
        logger.warning(
            "No trained checkpoint configured. Running the classical fallback detector: "
            "demonstration only, with no validated sensitivity or specificity."
        )
    yield


app = FastAPI(
    title="NeuroVision AI",
    description=__doc__,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    # The frontend reaches the API through Vite's same-origin proxy, so the
    # session cookie needs no cross-origin credentials in normal use.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def no_store_for_api(request: Request, call_next):
    """Patient data, MRI slices and reports must not be written to the browser's
    disk cache, where they would outlive the session and survive a sign-out."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(analyses.router)
app.include_router(demo.router)


@app.exception_handler(UploadError)
async def upload_error_handler(request: Request, exc: UploadError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": str(exc)}
    )


def _checkpoint_metadata(path) -> dict:
    """Read a checkpoint's config without building the model.

    Loaded lazily and defensively: torch is optional, and a checkpoint from a
    different codebase must not stop the service from starting.
    """
    try:
        import torch

        state = torch.load(path, map_location="cpu", weights_only=False)
        config = state.get("config", {})
        return {
            "name": path.name,
            "trained_on": config.get("trained_on"),
            "pathology": config.get("pathology"),
            "not_tuberculosis": bool(config.get("not_tuberculosis", False)),
            "calibrated": bool(config.get("calibrated", False)),
            "epochs": config.get("epochs"),
            "train_case_count": config.get("train_case_count"),
            "val_patch_dice": config.get("val_patch_dice"),
        }
    except Exception as exc:
        logger.warning("Could not read checkpoint metadata: %s", exc)
        return {"name": getattr(path, "name", str(path)), "unreadable": True}


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    """Service status, including which segmentation backend is actually in use.

    The backend is surfaced deliberately: a caller has no way to interpret a
    result without knowing whether it came from a trained model or the fallback.
    """
    checkpoint = settings.active_checkpoint
    metadata = _checkpoint_metadata(checkpoint) if checkpoint else {}

    return {
        "status": "ok",
        "app": settings.app_name,
        "segmentation_backend": "unet" if checkpoint else "classical-fallback",
        "checkpoint_loaded": bool(checkpoint),
        "model": metadata,
        # Stated separately from the disclaimer because it is the one fact a
        # caller needs to interpret any result this service returns.
        "trained_on_tuberculosis": bool(checkpoint) and not metadata.get("not_tuberculosis", True),
        "torch_available": torch_available(),
        "clinical_use": False,
        "disclaimer": DISCLAIMER,
    }
