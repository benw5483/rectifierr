import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Enum, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class ScanStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ScanType(str, enum.Enum):
    FULL_LIBRARY = "full_library"
    SINGLE_FILE = "single_file"
    DIRECTORY = "directory"
    BUMPER_ONLY = "bumper_only"
    LOGO_ONLY = "logo_only"


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id = Column(Integer, primary_key=True, index=True)
    scan_type = Column(Enum(ScanType), nullable=False)
    status = Column(Enum(ScanStatus), default=ScanStatus.PENDING, nullable=False)

    # Target (either a directory path or a specific file via media_file_id)
    media_file_id = Column(Integer, ForeignKey("media_files.id"), nullable=True)
    target_path = Column(String, nullable=True)

    # Progress tracking
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    issues_found = Column(Integer, default=0)

    # Timing
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    error_message = Column(Text, nullable=True)

    media_file = relationship("MediaFile", back_populates="scan_jobs")

    @property
    def progress_pct(self) -> float:
        if self.total_files == 0:
            return 0.0
        return round((self.processed_files / self.total_files) * 100, 1)

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None
