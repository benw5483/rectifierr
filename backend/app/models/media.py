import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, Enum, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class MediaType(str, enum.Enum):
    MOVIE = "movie"
    EPISODE = "episode"


class IssueType(str, enum.Enum):
    BUMPER = "bumper"
    CHANNEL_LOGO = "channel_logo"
    COMMERCIAL = "commercial"


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, index=True)
    path = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    media_type = Column(Enum(MediaType), nullable=False, default=MediaType.EPISODE)

    # TV-specific
    series_title = Column(String, nullable=True, index=True)
    season_number = Column(Integer, nullable=True)
    episode_number = Column(Integer, nullable=True)

    # File metadata
    duration_seconds = Column(Float, nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    resolution = Column(String, nullable=True)
    codec = Column(String, nullable=True)
    container = Column(String, nullable=True)

    # Plex
    plex_id = Column(String, nullable=True, index=True)
    plex_library = Column(String, nullable=True)

    # State
    last_scanned = Column(DateTime, nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow)

    issues = relationship(
        "MediaIssue", back_populates="media_file", cascade="all, delete-orphan"
    )
    scan_jobs = relationship(
        "ScanJob", back_populates="media_file", cascade="all, delete-orphan"
    )


class MediaIssue(Base):
    __tablename__ = "media_issues"

    id = Column(Integer, primary_key=True, index=True)
    media_file_id = Column(Integer, ForeignKey("media_files.id"), nullable=False)
    issue_type = Column(Enum(IssueType), nullable=False)

    # Timing within the file
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)

    # Detection metadata
    confidence = Column(Float, nullable=False, default=0.0)
    description = Column(Text, nullable=True)
    thumbnail_path = Column(String, nullable=True)

    # Extra signal data stored as JSON string
    detection_data = Column(Text, nullable=True)

    # Resolution
    resolved = Column(Boolean, default=False, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolution_method = Column(String, nullable=True)  # "removed", "ignored"

    created_at = Column(DateTime, default=datetime.utcnow)

    media_file = relationship("MediaFile", back_populates="issues")

    @property
    def duration(self) -> float:
        return self.end_seconds - self.start_seconds
