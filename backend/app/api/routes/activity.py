from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.media import MediaIssue
from app.models.scan_job import ScanJob, ScanStatus

router = APIRouter()


@router.get("/")
def get_activity(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(ScanJob).order_by(desc(ScanJob.created_at))
    total = q.count()
    jobs = q.offset(skip).limit(limit).all()
    return {"total": total, "items": [_job_dict(j) for j in jobs]}


@router.get("/recent-issues")
def recent_issues(
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    issues = (
        db.query(MediaIssue)
        .order_by(desc(MediaIssue.created_at))
        .limit(limit)
        .all()
    )
    return [
        {
            "id": i.id,
            "media_file_id": i.media_file_id,
            "issue_type": i.issue_type,
            "description": i.description,
            "confidence": i.confidence,
            "resolved": i.resolved,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "media_title": i.media_file.title if i.media_file else None,
            "series_title": i.media_file.series_title if i.media_file else None,
        }
        for i in issues
    ]


def _job_dict(j: ScanJob) -> dict:
    return {
        "id": j.id,
        "scan_type": j.scan_type,
        "status": j.status,
        "target_path": j.target_path,
        "total_files": j.total_files,
        "processed_files": j.processed_files,
        "issues_found": j.issues_found,
        "progress_pct": j.progress_pct,
        "duration_seconds": j.duration_seconds,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        "error_message": j.error_message,
    }
