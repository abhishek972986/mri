"""NeuroTB AI API.

Decision-support for intracranial tuberculosis imaging: lesion detection and
segmentation, 3D quantification, longitudinal change analysis, and structured
preliminary reporting for clinician review.

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
from .routers import analyses, demo, patients
from .services.storage import UploadError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("neurotb")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Data directory: %s", settings.data_dir)
    checkpoint = settings.active_checkpoint
    if checkpoint:
        logger.info("Segmentation checkpoint: %s", checkpoint)
        meta = _checkpoint_metadata(checkpoint)
        if meta.get("not_tuberculosis"):
            logger.warning(
                "Model was trained on %s, NOT tuberculosis. It segments focal brain "
                "lesions; it cannot identify tuberculomas as such.",
                meta.get("pathology") or meta.get("trained_on"),
            )
    else:
        logger.warning(
            "No trained checkpoint configured. Running the classical fallback detector: "
            "demonstration only, with no validated sensitivity or specificity."
        )
    yield


app = FastAPI(
    title="NeuroTB AI",
    description=__doc__,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
