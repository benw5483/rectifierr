from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.scan_job import ScanJob, ScanStatus, ScanType
from app.services import scan_service

router = APIRouter()


class ScanRequest(BaseModel):
    scan_type: ScanType
    target_path: Optional[str] = None
    media_file_id: Optional[int] = None


@router.post("/")
def start_scan(
    request: ScanRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if request.scan_type == ScanType.SINGLE_FILE and not request.media_file_id and not request.target_path:
        raise HTTPException(status_code=400, detail="single_file scan requires media_file_id or target_path")

    job = scan_service.create_scan_job(
        db,
        request.scan_type,
        target_path=request.target_path,
        media_file_id=request.media_file_id,
    )
    background_tasks.add_task(scan_service.start_job_async, job.id)
    return _job_dict(job)


@router.get("/queue")
def get_queue(
    status: Optional[ScanStatus] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = db.query(ScanJob).order_by(ScanJob.created_at.desc())
    if status:
        q = q.filter(ScanJob.status == status)
    jobs = q.limit(limit).all()
    return [_job_dict(j) for j in jobs]


@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    jobs = db.query(ScanJob).filter(
        ScanJob.status.in_([ScanStatus.PENDING, ScanStatus.RUNNING])
    ).all()
    return [_job_dict(j) for j in jobs]


@router.get("/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_dict(job)


@router.delete("/{job_id}")
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(ScanJob).filter(ScanJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (ScanStatus.PENDING, ScanStatus.RUNNING):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {job.status} job")
    scan_service.cancel_job(job.id)
    return {"status": "cancelled"}


def _job_dict(j: ScanJob) -> dict:
    return {
        "id": j.id,
        "scan_type": j.scan_type,
        "status": j.status,
        "target_path": j.target_path,
        "media_file_id": j.media_file_id,
        "total_files": j.total_files,
        "processed_files": j.processed_files,
        "issues_found": j.issues_found,
        "progress_pct": j.progress_pct,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        "duration_seconds": j.duration_seconds,
        "error_message": j.error_message,
    }
