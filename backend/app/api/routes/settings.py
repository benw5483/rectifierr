"""
General application settings (detection tuning, automation schedule, path config).
Plex connection is handled by /api/plex/* — see routes/plex.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.setting import Setting

router = APIRouter()

SETTINGS_REGISTRY: dict[str, dict] = {
    # Library
    "media_root": {
        "description": "Fallback root path for filesystem scans (used when Plex is not connected)",
        "default": "/media",
    },
    "plex_path_prefix": {
        "description": "Path prefix Plex uses (e.g. /data/media). Leave blank if paths match.",
        "default": "",
    },
    "local_path_prefix": {
        "description": "Corresponding local path prefix (e.g. /media). Leave blank if paths match.",
        "default": "",
    },
    # Bumper detection
    "bumper_scan_seconds": {
        "description": "Seconds to analyse at start/end of each file for bumpers",
        "default": "180",
    },
    "bumper_max_duration": {
        "description": "Maximum bumper/promo duration to flag (seconds)",
        "default": "60",
    },
    "bumper_min_duration": {
        "description": "Minimum bumper duration to flag (seconds)",
        "default": "3",
    },
    "scene_threshold": {
        "description": "Scene-change sensitivity (0.0–1.0, lower = more sensitive)",
        "default": "0.35",
    },
    "min_confidence": {
        "description": "Minimum detection confidence to record an issue (0.0–1.0)",
        "default": "0.5",
    },
    # Logo detection
    "logo_detection_enabled": {
        "description": "Enable channel logo / watermark detection",
        "default": "true",
    },
    "logo_corner_margin": {
        "description": "Pixel margin from each corner to search for logos",
        "default": "180",
    },
    "logo_persistence": {
        "description": "Logo persistence threshold (0.0–1.0, higher = stricter)",
        "default": "0.85",
    },
    # Automation
    "auto_scan_enabled": {
        "description": "Run an automatic library scan on a schedule",
        "default": "false",
    },
    "auto_scan_hour": {
        "description": "Hour of day (UTC) to run the automatic scan (0–23)",
        "default": "3",
    },
}


class SettingUpdate(BaseModel):
    value: str


@router.get("/")
def get_all_settings(db: Session = Depends(get_db)):
    stored = {s.key: s.value for s in db.query(Setting).all()}
    return {
        key: {
            "value": stored.get(key, meta["default"]),
            "raw_set": key in stored,
            "description": meta["description"],
            "default": meta["default"],
        }
        for key, meta in SETTINGS_REGISTRY.items()
    }


@router.put("/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(get_db)):
    if key not in SETTINGS_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown setting: {key!r}")
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = body.value
    else:
        db.add(Setting(key=key, value=body.value, description=SETTINGS_REGISTRY[key]["description"]))
    db.commit()
    return {"key": key, "saved": True}
