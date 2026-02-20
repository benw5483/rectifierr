from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Rectifierr"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "sqlite:///./data/rectifierr.db"

    # Paths
    MEDIA_ROOT: str = "/media"
    CONFIG_DIR: str = "./data"
    THUMBNAILS_DIR: str = "./data/thumbnails"

    # Plex
    PLEX_URL: Optional[str] = None
    PLEX_TOKEN: Optional[str] = None

    # Bumper detection
    BUMPER_SCAN_SECONDS: int = 180      # Analyze first/last N seconds
    BUMPER_MAX_DURATION: int = 60       # Max bumper duration to flag
    BUMPER_MIN_DURATION: int = 3        # Min bumper duration to flag
    SCENE_CHANGE_THRESHOLD: float = 0.35
    BLACK_FRAME_THRESHOLD: float = 0.98
    BLACK_FRAME_MIN_DURATION: float = 0.1
    SILENCE_THRESHOLD_DB: float = -50.0
    SILENCE_MIN_DURATION: float = 0.3

    # Logo detection
    LOGO_CHECK_INTERVAL: int = 30       # Sample every N seconds
    LOGO_MAX_FRAMES: int = 40           # Max frames to sample
    LOGO_PERSISTENCE_THRESHOLD: float = 0.85
    LOGO_CORNER_MARGIN: int = 180       # Pixels from edge to check
    LOGO_MIN_AREA: int = 400            # Min logo area in pixels²
    LOGO_DETECTION_ENABLED: bool = True

    # Confidence
    MIN_CONFIDENCE: float = 0.5

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
