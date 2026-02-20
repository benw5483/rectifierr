import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.core.database import Base


class TrimStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TrimJob(Base):
    __tablename__ = "trim_jobs"

    id = Column(Integer, primary_key=True, index=True)
    media_file_id = Column(Integer, ForeignKey("media_files.id"), nullable=False)
    # Optional — if started from an issue, resolve it on success
    issue_id = Column(Integer, ForeignKey("media_issues.id"), nullable=True)

    status = Column(Enum(TrimStatus), default=TrimStatus.PENDING, nullable=False)

    # The region to remove (seconds from start of file)
    remove_start = Column(Float, nullable=False)
    remove_end = Column(Float, nullable=False)

    # Metadata captured at job creation
    original_duration = Column(Float, nullable=True)
    backup_path = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    media_file = relationship("MediaFile")

    @property
    def remove_duration(self) -> float:
        return self.remove_end - self.remove_start

    @property
    def elapsed_seconds(self) -> float | None:
        if self.started_at:
            end = self.completed_at or datetime.utcnow()
            return (end - self.started_at).total_seconds()
        return None
