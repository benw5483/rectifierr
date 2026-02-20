"""
Scan orchestration service.

Creates ScanJob records, dispatches them to background threads,
and coordinates detection services against individual files.
"""
from __future__ import annotations

import os
import threading
from datetime import datetime
from pathlib import Path

from loguru import logger
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.media import IssueType, MediaFile, MediaIssue, MediaType
from app.models.scan_job import ScanJob, ScanStatus, ScanType
from app.services.bumper_detector import BumperDetector
from app.services.ffmpeg_service import extract_thumbnail, get_media_info
from app.services.logo_detector import LogoDetector

SUPPORTED_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".m4v", ".mov",
    ".ts", ".m2ts", ".wmv", ".flv", ".webm",
}

_active_jobs: dict[int, threading.Thread] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_scan_job(
    db: Session,
    scan_type: ScanType,
    target_path: str | None = None,
    media_file_id: int | None = None,
) -> ScanJob:
    job = ScanJob(
        scan_type=scan_type,
        target_path=target_path,
        media_file_id=media_file_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def start_job_async(job_id: int) -> None:
    with _lock:
        if job_id in _active_jobs:
            return
        t = threading.Thread(target=_run_job, args=(job_id,), daemon=True, name=f"scan-{job_id}")
        _active_jobs[job_id] = t
    t.start()


def cancel_job(job_id: int) -> bool:
    """Mark a job cancelled. Running jobs will check this flag."""
    db = SessionLocal()
    try:
        job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
        if job and job.status in (ScanStatus.PENDING, ScanStatus.RUNNING):
            job.status = ScanStatus.CANCELLED
            db.commit()
            return True
        return False
    finally:
        db.close()


def run_scheduled_scan() -> None:
    from app.core.config import settings
    db = SessionLocal()
    try:
        job = create_scan_job(db, ScanType.FULL_LIBRARY, target_path=settings.MEDIA_ROOT)
        start_job_async(job.id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Background execution
# ---------------------------------------------------------------------------

def _run_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
        if not job:
            return

        job.status = ScanStatus.RUNNING
        job.started_at = datetime.utcnow()
        db.commit()

        if job.scan_type in (ScanType.FULL_LIBRARY, ScanType.DIRECTORY):
            if job.scan_type == ScanType.FULL_LIBRARY and not job.target_path:
                from app.core.config import settings
                job.target_path = settings.MEDIA_ROOT
                db.commit()
            _scan_directory(db, job)
        elif job.scan_type in (ScanType.SINGLE_FILE, ScanType.BUMPER_ONLY, ScanType.LOGO_ONLY):
            _scan_single(db, job)

        # Refresh to check for cancellation
        db.refresh(job)
        if job.status == ScanStatus.RUNNING:
            job.status = ScanStatus.COMPLETED
            job.completed_at = datetime.utcnow()
            db.commit()

    except Exception as exc:
        logger.exception(f"Scan job {job_id} crashed: {exc}")
        try:
            db.rollback()
            job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
            if job:
                job.status = ScanStatus.FAILED
                job.error_message = str(exc)[:1000]
                job.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
        with _lock:
            _active_jobs.pop(job_id, None)


def _is_cancelled(db: Session, job_id: int) -> bool:
    db.expire_all()
    job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
    return job is None or job.status == ScanStatus.CANCELLED


def _scan_directory(db: Session, job: ScanJob) -> None:
    target = job.target_path
    if not target or not os.path.isdir(target):
        raise ValueError(f"Target directory does not exist: {target!r}")

    media_files: list[str] = []
    for root, dirs, files in os.walk(target):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if Path(name).suffix.lower() in SUPPORTED_EXTENSIONS:
                media_files.append(os.path.join(root, name))

    job.total_files = len(media_files)
    db.commit()
    logger.info(f"Directory scan: {len(media_files)} file(s) in {target!r}")

    for i, path in enumerate(media_files):
        if _is_cancelled(db, job.id):
            logger.info(f"Job {job.id} cancelled — stopping at file {i}")
            return
        try:
            _process_file(db, path, job)
        except FileNotFoundError as e:
            logger.warning(str(e))
        except Exception as e:
            logger.error(f"Error processing {path}: {e}")
        job.processed_files = i + 1
        db.commit()


def _scan_single(db: Session, job: ScanJob) -> None:
    job.total_files = 1
    db.commit()

    if job.media_file_id:
        media = db.query(MediaFile).filter(MediaFile.id == job.media_file_id).first()
        if not media:
            raise ValueError(f"Media record {job.media_file_id} not found in database")
        # Expose the path in the job so Activity can display it
        if not job.target_path:
            job.target_path = media.path
            db.commit()
        _process_file(db, media.path, job)
    elif job.target_path:
        _process_file(db, job.target_path, job)
    else:
        raise ValueError("Single-file scan requires media_file_id or target_path")

    job.processed_files = 1
    db.commit()


def _process_file(db: Session, file_path: str, job: ScanJob) -> None:
    if not os.path.isfile(file_path):
        # Raise so the job is marked FAILED with a visible error message rather
        # than silently "succeeding" without actually scanning anything.
        raise FileNotFoundError(
            f"File not found on disk: {file_path!r}. "
            "Check path prefix settings if files are mounted differently than Plex expects."
        )

    logger.info(f"Scanning: {file_path}")

    media = db.query(MediaFile).filter(MediaFile.path == file_path).first()
    if not media:
        media = _create_media_record(db, file_path)
    if not media:
        raise RuntimeError(f"Could not create media record for: {file_path!r}")

    # Backfill ffmpeg metadata for records created by Plex sync (which lacks it)
    if not media.duration_seconds or not media.codec:
        try:
            info = get_media_info(file_path)
            if info:
                fmt = info.get("format", {})
                if not media.duration_seconds:
                    raw_dur = fmt.get("duration")
                    media.duration_seconds = float(raw_dur) if raw_dur else None
                if not media.file_size_bytes:
                    raw_size = fmt.get("size")
                    media.file_size_bytes = int(raw_size) if raw_size else None
                for stream in info.get("streams", []):
                    if stream.get("codec_type") == "video":
                        if not media.resolution:
                            w, h = stream.get("width"), stream.get("height")
                            if w and h:
                                media.resolution = f"{w}x{h}"
                        if not media.codec:
                            media.codec = stream.get("codec_name")
                        break
        except Exception as e:
            logger.warning(f"Could not backfill media metadata for {file_path!r}: {e}")

    # Clear previous unresolved issues so re-scanning gives a clean slate.
    # Resolved issues (user-actioned) are intentionally preserved.
    db.query(MediaIssue).filter(
        MediaIssue.media_file_id == media.id,
        MediaIssue.resolved == False,  # noqa: E712
    ).delete()
    db.commit()
    # Refresh after the intermediate commit to avoid stale lazy-loads below.
    db.refresh(media)
    db.refresh(job)

    run_bumpers = job.scan_type != ScanType.LOGO_ONLY
    run_logos = job.scan_type not in (ScanType.BUMPER_ONLY, ScanType.SINGLE_FILE)

    from app.core.config import settings as cfg

    if run_bumpers:
        detector = BumperDetector()
        for c in detector.analyze(file_path):
            # Grab a thumbnail at the midpoint of the candidate
            mid = (c.start + c.end) / 2
            thumb_path = None
            if media.id:
                thumb_out = os.path.join(
                    cfg.THUMBNAILS_DIR, str(media.id), f"bumper_{c.position}.jpg"
                )
                if extract_thumbnail(file_path, mid, thumb_out):
                    thumb_path = thumb_out

            issue = MediaIssue(
                media_file_id=media.id,
                issue_type=IssueType.BUMPER,
                start_seconds=c.start,
                end_seconds=c.end,
                confidence=c.confidence,
                description=(
                    f"{c.position.capitalize()} bumper — {c.duration:.1f}s "
                    f"(confidence {c.confidence:.0%})"
                ),
                thumbnail_path=thumb_path,
                detection_data=str(c.signals),
            )
            db.add(issue)
            job.issues_found += 1

    if run_logos and cfg.LOGO_DETECTION_ENABLED:
        logo_det = LogoDetector()
        for logo in logo_det.analyze(file_path):
            issue = MediaIssue(
                media_file_id=media.id,
                issue_type=IssueType.CHANNEL_LOGO,
                start_seconds=0,
                end_seconds=media.duration_seconds or 0,
                confidence=logo.confidence,
                description=(
                    f"Channel logo in {logo.position} corner "
                    f"({logo.width}×{logo.height}px, "
                    f"persistence {logo.persistence:.0%})"
                ),
                detection_data=str(logo.to_dict()),
            )
            db.add(issue)
            job.issues_found += 1

    media.last_scanned = datetime.utcnow()
    db.commit()


def _create_media_record(db: Session, file_path: str) -> MediaFile | None:
    info = get_media_info(file_path)
    if not info:
        return None

    fmt = info.get("format", {})
    duration = float(fmt.get("duration", 0))
    size = int(fmt.get("size", 0))
    container = Path(file_path).suffix.lstrip(".").upper()

    resolution = codec = None
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            w, h = stream.get("width"), stream.get("height")
            if w and h:
                resolution = f"{w}x{h}"
            codec = stream.get("codec_name")
            break

    # Guess media type from directory structure
    p = file_path.lower()
    is_episode = any(k in p for k in [
        "/tv/", "/television/", "/series/", "/shows/",
        "season ", "s0", "s1", "s2", "s3", "s4", "s5",
        "s6", "s7", "s8", "s9", "episode",
    ])

    record = MediaFile(
        path=file_path,
        title=Path(file_path).stem,
        media_type=MediaType.EPISODE if is_episode else MediaType.MOVIE,
        duration_seconds=duration,
        file_size_bytes=size,
        resolution=resolution,
        codec=codec,
        container=container,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
