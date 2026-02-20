import os
import shutil
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.media import IssueType, MediaFile, MediaIssue, MediaType
from app.models.scan_job import ScanType
from app.models.trim_job import TrimJob, TrimStatus
from app.services import scan_service
from app.services.ffmpeg_service import remove_segment

router = APIRouter()


# ---------------------------------------------------------------------------
# Media listing
# ---------------------------------------------------------------------------

@router.get("/")
def list_media(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    media_type: Optional[MediaType] = None,
    search: Optional[str] = None,
    series: Optional[str] = None,
    plex_library: Optional[str] = None,
    has_issues: Optional[bool] = None,
    unresolved_only: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(MediaFile)
    if media_type:
        q = q.filter(MediaFile.media_type == media_type)
    if plex_library:
        q = q.filter(MediaFile.plex_library == plex_library)
    if series:
        q = q.filter(MediaFile.series_title == series)
    if search:
        like = f"%{search}%"
        q = q.filter(
            or_(
                MediaFile.title.ilike(like),
                MediaFile.series_title.ilike(like),
            )
        )
    if has_issues is True:
        q = q.filter(MediaFile.issues.any())
    elif has_issues is False:
        q = q.filter(~MediaFile.issues.any())
    if unresolved_only:
        q = q.filter(MediaFile.issues.any(MediaIssue.resolved == False))  # noqa: E712

    total = q.count()
    items = (
        q.order_by(
            func.coalesce(MediaFile.series_title, MediaFile.title),
            MediaFile.season_number,
            MediaFile.episode_number,
        )
        .offset(skip)
        .limit(limit)
        .all()
    )
    return {"total": total, "items": [_media_dict(m) for m in items]}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    total_files = db.query(func.count(MediaFile.id)).scalar() or 0
    scanned = db.query(func.count(MediaFile.id)).filter(MediaFile.last_scanned.isnot(None)).scalar() or 0
    total_issues = db.query(func.count(MediaIssue.id)).scalar() or 0
    unresolved = db.query(func.count(MediaIssue.id)).filter(MediaIssue.resolved == False).scalar() or 0  # noqa
    bumpers = db.query(func.count(MediaIssue.id)).filter(MediaIssue.issue_type == IssueType.BUMPER).scalar() or 0
    logos = db.query(func.count(MediaIssue.id)).filter(MediaIssue.issue_type == IssueType.CHANNEL_LOGO).scalar() or 0
    files_with_issues = db.query(func.count(func.distinct(MediaIssue.media_file_id))).scalar() or 0
    return {
        "total_files": total_files,
        "scanned_files": scanned,
        "unscanned_files": total_files - scanned,
        "total_issues": total_issues,
        "unresolved_issues": unresolved,
        "bumpers_found": bumpers,
        "logos_found": logos,
        "files_with_issues": files_with_issues,
        "clean_files": total_files - files_with_issues,
    }


@router.get("/series")
def list_series(
    plex_library: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return distinct TV series with aggregated episode and issue counts."""
    q = db.query(MediaFile).filter(MediaFile.media_type == MediaType.EPISODE)
    if plex_library:
        q = q.filter(MediaFile.plex_library == plex_library)
    if search:
        q = q.filter(MediaFile.series_title.ilike(f"%{search}%"))

    rows = (
        q.with_entities(
            MediaFile.series_title,
            func.count(MediaFile.id).label("episode_count"),
        )
        .group_by(MediaFile.series_title)
        .order_by(MediaFile.series_title)
        .all()
    )

    # Unresolved-issue counts per series (episodes that have at least one)
    uq = (
        db.query(MediaFile.series_title, func.count(func.distinct(MediaFile.id)))
        .join(MediaIssue, MediaFile.id == MediaIssue.media_file_id)
        .filter(MediaIssue.resolved == False, MediaFile.media_type == MediaType.EPISODE)  # noqa: E712
    )
    if plex_library:
        uq = uq.filter(MediaFile.plex_library == plex_library)
    unresolved_map: dict[str, int] = dict(uq.group_by(MediaFile.series_title).all())

    return [
        {
            "series_title": r.series_title or "Unknown",
            "episode_count": r.episode_count,
            "unresolved_issues": unresolved_map.get(r.series_title, 0),
        }
        for r in rows
    ]


@router.get("/{media_id}")
def get_media(media_id: int, db: Session = Depends(get_db)):
    m = db.query(MediaFile).filter(MediaFile.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    return _media_dict(m, include_issues=True)


@router.delete("/{media_id}")
def delete_media(media_id: int, db: Session = Depends(get_db)):
    m = db.query(MediaFile).filter(MediaFile.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    db.delete(m)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Issues
# ---------------------------------------------------------------------------

@router.get("/{media_id}/issues")
def get_issues(media_id: int, db: Session = Depends(get_db)):
    m = db.query(MediaFile).filter(MediaFile.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    return [_issue_dict(i) for i in m.issues]


class ResolveRequest(BaseModel):
    method: str = "ignored"


@router.post("/{media_id}/issues/{issue_id}/resolve")
def resolve_issue(
    media_id: int,
    issue_id: int,
    body: ResolveRequest,
    db: Session = Depends(get_db),
):
    issue = db.query(MediaIssue).filter(
        MediaIssue.id == issue_id,
        MediaIssue.media_file_id == media_id,
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue.resolved = True
    issue.resolved_at = datetime.utcnow()
    issue.resolution_method = body.method
    db.commit()
    return {"status": "resolved", "method": body.method}


# ---------------------------------------------------------------------------
# Trim jobs  — create, poll, and execute
# ---------------------------------------------------------------------------

class TrimRequest(BaseModel):
    remove_start: float
    remove_end: float
    issue_id: Optional[int] = None

    @field_validator("remove_start", "remove_end")
    @classmethod
    def non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("Time values must be non-negative")
        return round(v, 3)


@router.post("/{media_id}/trim")
def start_trim(
    media_id: int,
    body: TrimRequest,
    db: Session = Depends(get_db),
):
    """
    Queue a trim operation: permanently remove [remove_start, remove_end] from
    the file. A .bak backup is created before modification.
    Returns a job_id that can be polled via GET /{media_id}/trim-jobs/{job_id}.
    """
    m = db.query(MediaFile).filter(MediaFile.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    if not m.duration_seconds:
        raise HTTPException(status_code=400, detail="File duration unknown — rescan first")
    if body.remove_start >= body.remove_end:
        raise HTTPException(status_code=422, detail="remove_start must be before remove_end")
    if body.remove_end > m.duration_seconds + 1:
        raise HTTPException(status_code=422, detail="remove_end exceeds file duration")
    remove_duration = body.remove_end - body.remove_start
    if remove_duration < 0.5:
        raise HTTPException(status_code=422, detail="Segment must be at least 0.5 seconds")

    # Validate issue belongs to this media file
    if body.issue_id:
        issue = db.query(MediaIssue).filter(
            MediaIssue.id == body.issue_id,
            MediaIssue.media_file_id == media_id,
        ).first()
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found")

    job = TrimJob(
        media_file_id=media_id,
        issue_id=body.issue_id,
        remove_start=body.remove_start,
        remove_end=body.remove_end,
        original_duration=m.duration_seconds,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    t = threading.Thread(target=_run_trim_job, args=(job.id,), daemon=True, name=f"trim-{job.id}")
    t.start()

    logger.info(
        f"Trim job {job.id} queued: removing {body.remove_start:.1f}s–{body.remove_end:.1f}s "
        f"from media {media_id}"
    )
    return _trim_job_dict(job)


@router.get("/{media_id}/trim-jobs/{job_id}")
def get_trim_job(media_id: int, job_id: int, db: Session = Depends(get_db)):
    job = db.query(TrimJob).filter(
        TrimJob.id == job_id,
        TrimJob.media_file_id == media_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Trim job not found")
    return _trim_job_dict(job)


@router.get("/{media_id}/trim-jobs")
def list_trim_jobs(media_id: int, db: Session = Depends(get_db)):
    jobs = (
        db.query(TrimJob)
        .filter(TrimJob.media_file_id == media_id)
        .order_by(TrimJob.created_at.desc())
        .limit(20)
        .all()
    )
    return [_trim_job_dict(j) for j in jobs]


def _run_trim_job(job_id: int) -> None:
    db = SessionLocal()
    tmp_path = None
    try:
        job = db.query(TrimJob).filter(TrimJob.id == job_id).first()
        if not job:
            return

        job.status = TrimStatus.RUNNING
        job.started_at = datetime.utcnow()
        db.commit()

        m = db.query(MediaFile).filter(MediaFile.id == job.media_file_id).first()
        if not m or not os.path.isfile(m.path):
            raise FileNotFoundError(f"Media file not found on disk: {m.path if m else '?'}")

        bak_path = m.path + ".bak"
        tmp_path = m.path + ".rectifierr_tmp"

        # Safety copy before any modification
        shutil.copy2(m.path, bak_path)
        job.backup_path = bak_path
        db.commit()

        total = job.original_duration or m.duration_seconds
        ok = remove_segment(m.path, tmp_path, job.remove_start, job.remove_end, total)

        if not ok or not os.path.exists(tmp_path):
            raise RuntimeError("FFmpeg did not produce output — check logs")

        os.replace(tmp_path, m.path)
        tmp_path = None  # replaced, don't clean up

        # Adjust stored duration
        new_duration = total - (job.remove_end - job.remove_start)
        m.duration_seconds = max(new_duration, 0)

        # Resolve linked issue
        if job.issue_id:
            issue = db.query(MediaIssue).filter(MediaIssue.id == job.issue_id).first()
            if issue:
                issue.resolved = True
                issue.resolved_at = datetime.utcnow()
                issue.resolution_method = "removed"

        job.status = TrimStatus.COMPLETED
        job.completed_at = datetime.utcnow()
        db.commit()

        logger.info(
            f"Trim job {job_id} complete — removed {job.remove_end - job.remove_start:.1f}s "
            f"from {m.path!r}, backup at {bak_path!r}"
        )

    except Exception as exc:
        logger.exception(f"Trim job {job_id} failed: {exc}")
        try:
            db.rollback()
            job = db.query(TrimJob).filter(TrimJob.id == job_id).first()
            if job:
                job.status = TrimStatus.FAILED
                job.error_message = str(exc)[:1000]
                job.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
        db.close()


# ---------------------------------------------------------------------------
# Scan trigger
# ---------------------------------------------------------------------------

@router.post("/{media_id}/scan")
def scan_media(
    media_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    m = db.query(MediaFile).filter(MediaFile.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    job = scan_service.create_scan_job(db, ScanType.SINGLE_FILE, media_file_id=m.id)
    background_tasks.add_task(scan_service.start_job_async, job.id)
    return {"job_id": job.id}


# ---------------------------------------------------------------------------
# Thumbnails
# ---------------------------------------------------------------------------

@router.get("/{media_id}/issues/{issue_id}/thumbnail")
def get_thumbnail(media_id: int, issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(MediaIssue).filter(
        MediaIssue.id == issue_id,
        MediaIssue.media_file_id == media_id,
    ).first()
    if not issue or not issue.thumbnail_path or not os.path.exists(issue.thumbnail_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(issue.thumbnail_path, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _media_dict(m: MediaFile, include_issues: bool = False) -> dict:
    d = {
        "id": m.id,
        "path": m.path,
        "title": m.title,
        "media_type": m.media_type,
        "series_title": m.series_title,
        "season_number": m.season_number,
        "episode_number": m.episode_number,
        "duration_seconds": m.duration_seconds,
        "file_size_bytes": m.file_size_bytes,
        "resolution": m.resolution,
        "codec": m.codec,
        "container": m.container,
        "plex_id": m.plex_id,
        "plex_library": m.plex_library,
        "last_scanned": m.last_scanned.isoformat() if m.last_scanned else None,
        "added_at": m.added_at.isoformat() if m.added_at else None,
        "issue_count": len(m.issues),
        "unresolved_issues": sum(1 for i in m.issues if not i.resolved),
    }
    if include_issues:
        d["issues"] = [_issue_dict(i) for i in m.issues]
    return d


def _issue_dict(i: MediaIssue) -> dict:
    return {
        "id": i.id,
        "media_file_id": i.media_file_id,
        "issue_type": i.issue_type,
        "start_seconds": i.start_seconds,
        "end_seconds": i.end_seconds,
        "duration": i.duration,
        "confidence": i.confidence,
        "description": i.description,
        "thumbnail_path": i.thumbnail_path,
        "resolved": i.resolved,
        "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        "resolution_method": i.resolution_method,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _trim_job_dict(j: TrimJob) -> dict:
    return {
        "id": j.id,
        "media_file_id": j.media_file_id,
        "issue_id": j.issue_id,
        "status": j.status,
        "remove_start": j.remove_start,
        "remove_end": j.remove_end,
        "remove_duration": j.remove_duration,
        "original_duration": j.original_duration,
        "backup_path": j.backup_path,
        "elapsed_seconds": j.elapsed_seconds,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        "error_message": j.error_message,
    }
