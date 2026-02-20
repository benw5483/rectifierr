from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.core.database import init_db
from app.core.scheduler import start_scheduler, stop_scheduler
from app.api.routes import activity, media, plex, scan, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Rectifierr starting up")
    init_db()
    start_scheduler()
    yield
    stop_scheduler()
    logger.info("Rectifierr shut down")


app = FastAPI(
    title="Rectifierr",
    description="Plex media quality auditor — bumper, ad, and logo detection",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router, prefix="/api/media", tags=["media"])
app.include_router(scan.router, prefix="/api/scan", tags=["scan"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(activity.router, prefix="/api/activity", tags=["activity"])
app.include_router(plex.router, prefix="/api/plex", tags=["plex"])


@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "app": "Rectifierr", "version": "0.1.0"}
