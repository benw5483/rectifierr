"""
Plex OAuth + library management endpoints.

Auth flow (frontend drives this):
  POST /auth/start           → {pin_id, pin_code, auth_url}
  GET  /auth/poll/{pin_id}   → {authenticated, token?}  (poll every 2 s)
  GET  /servers              → [{name, machine_id, best_url, ...}]
  POST /server               → save chosen server; returns updated status
  POST /sync                 → kick off background sync
  GET  /sync/status          → live progress
  GET  /status               → full connection state (called on page load)
  DELETE /disconnect         → clear token + server + account info
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.models.setting import Setting
from app.services import plex_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(db: Session, key: str) -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return (row.value or "") if row else ""


def _set(db: Session, key: str, value: str, description: str = "") -> None:
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value, description=description))
    db.commit()


def _delete(db: Session, *keys: str) -> None:
    for key in keys:
        row = db.query(Setting).filter(Setting.key == key).first()
        if row:
            db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
def plex_status(db: Session = Depends(get_db)):
    """Return full connection state (used on every Settings page load)."""
    token = _get(db, "plex_token")
    server_url = _get(db, "plex_url")
    return {
        "connected": bool(token and server_url),
        "account": {
            "username": _get(db, "plex_account_username"),
            "id": _get(db, "plex_account_id"),
            "thumb": _get(db, "plex_account_thumb"),
        },
        "server": {
            "name": _get(db, "plex_server_name"),
            "machine_id": _get(db, "plex_machine_id"),
            "url": server_url,
        },
        "path_prefix": {
            "plex": _get(db, "plex_path_prefix"),
            "local": _get(db, "local_path_prefix"),
        },
        "sync": plex_service.get_sync_status(),
        "library_keys": [k for k in _get(db, "plex_library_keys").split(",") if k],
    }


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

@router.post("/auth/start")
def auth_start(db: Session = Depends(get_db)):
    """Request a PIN from plex.tv and return the URL to send the user to."""
    client_id = plex_service.ensure_client_id(db)

    try:
        pin = plex_service.request_pin(client_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"plex.tv unreachable: {e}")

    auth_url = plex_service.build_auth_url(client_id, pin["pin_code"])

    return {
        "pin_id": pin["pin_id"],
        "pin_code": pin["pin_code"],
        "auth_url": auth_url,
        "expires_at": pin.get("expires_at"),
    }


@router.get("/auth/poll/{pin_id}")
def auth_poll(pin_id: int, db: Session = Depends(get_db)):
    """
    Poll plex.tv to see if the user has authorised the PIN.
    On success, persist the token and account info; return {authenticated: true}.
    """
    client_id = plex_service.ensure_client_id(db)

    try:
        result = plex_service.check_pin(client_id, pin_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"plex.tv error: {e}")

    if result["authenticated"] and result["token"]:
        token = result["token"]
        _set(db, "plex_token", token, "Plex auth token (OAuth)")

        # Fetch account info opportunistically
        try:
            acct = plex_service.fetch_account(token, client_id)
            _set(db, "plex_account_username", acct["username"])
            _set(db, "plex_account_id", acct["id"])
            _set(db, "plex_account_thumb", acct["thumb"])
        except Exception as e:
            # Non-fatal — token is still valid
            pass

    return {"authenticated": result["authenticated"]}


# ---------------------------------------------------------------------------
# Server discovery & selection
# ---------------------------------------------------------------------------

@router.get("/libraries")
def list_libraries(db: Session = Depends(get_db)):
    """List all library sections on the connected Plex server."""
    token = _get(db, "plex_token")
    server_url = _get(db, "plex_url")
    if not token or not server_url:
        raise HTTPException(status_code=400, detail="Plex server not configured")
    client_id = plex_service.ensure_client_id(db)
    try:
        libs = plex_service.fetch_libraries(token, server_url, client_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch libraries: {e}")
    # Mark which ones are currently selected
    saved = _get(db, "plex_library_keys")
    selected = set(saved.split(",")) if saved else set()
    for lib in libs:
        lib["selected"] = lib["key"] in selected
    return libs


@router.get("/servers")
def list_servers(db: Session = Depends(get_db)):
    """Return Plex servers accessible to the authenticated account."""
    token = _get(db, "plex_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated with Plex")

    client_id = plex_service.ensure_client_id(db)
    try:
        servers = plex_service.fetch_servers(token, client_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch servers: {e}")

    return servers


class LibrarySelectionRequest(BaseModel):
    keys: list[str]

@router.put("/library-selection")
def save_library_selection(body: LibrarySelectionRequest, db: Session = Depends(get_db)):
    """Save which Plex library sections to sync."""
    _set(db, "plex_library_keys", ",".join(body.keys), "Selected Plex library section keys")
    return {"saved": True, "keys": body.keys}


class ServerSelectRequest(BaseModel):
    name: str
    machine_id: str
    url: str  # the connection URI to use


@router.post("/server")
def select_server(body: ServerSelectRequest, db: Session = Depends(get_db)):
    """Persist the chosen Plex server and verify connectivity."""
    token = _get(db, "plex_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated with Plex")

    # Quick connectivity check
    try:
        from plexapi.server import PlexServer
        PlexServer(body.url, token, timeout=10)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach server at {body.url!r}: {e}")

    _set(db, "plex_url", body.url, "Plex server URL (selected via OAuth)")
    _set(db, "plex_server_name", body.name, "Plex server friendly name")
    _set(db, "plex_machine_id", body.machine_id, "Plex server machine identifier")

    return {"saved": True, "name": body.name, "url": body.url}


# ---------------------------------------------------------------------------
# Path prefix mapping
# ---------------------------------------------------------------------------

class PathPrefixRequest(BaseModel):
    plex_prefix: str = ""
    local_prefix: str = ""


@router.put("/path-prefix")
def set_path_prefix(body: PathPrefixRequest, db: Session = Depends(get_db)):
    """
    Optionally configure path translation between what Plex reports and
    what Rectifierr can access on disk.
    e.g. Plex: /data/media  →  Rectifierr: /media
    """
    _set(db, "plex_path_prefix", body.plex_prefix, "Plex file path prefix")
    _set(db, "local_path_prefix", body.local_prefix, "Local file path prefix")
    return {"saved": True}


# ---------------------------------------------------------------------------
# Library sync
# ---------------------------------------------------------------------------

@router.post("/sync")
def start_sync(db: Session = Depends(get_db)):
    token = _get(db, "plex_token")
    server_url = _get(db, "plex_url")
    if not token or not server_url:
        raise HTTPException(status_code=400, detail="Plex server not configured — connect first")
    client_id = plex_service.ensure_client_id(db)
    plex_prefix = _get(db, "plex_path_prefix")
    local_prefix = _get(db, "local_path_prefix")
    saved_keys = _get(db, "plex_library_keys")
    library_keys = [k for k in saved_keys.split(",") if k] if saved_keys else None
    started = plex_service.start_sync(token, server_url, client_id, plex_prefix, local_prefix, library_keys)
    if not started:
        return {"started": False, "message": "A sync is already running"}
    return {"started": True}


@router.delete("/sync")
def cancel_sync():
    """Cancel an in-progress sync."""
    cancelled = plex_service.cancel_sync()
    return {"cancelled": cancelled}


@router.get("/sync/status")
def sync_status():
    """Return live sync progress (poll at 2 s intervals)."""
    return plex_service.get_sync_status()


# ---------------------------------------------------------------------------
# Disconnect
# ---------------------------------------------------------------------------

@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    """Clear all Plex credentials and server config."""
    _delete(
        db,
        "plex_token",
        "plex_url",
        "plex_server_name",
        "plex_machine_id",
        "plex_account_username",
        "plex_account_id",
        "plex_account_thumb",
    )
    return {"disconnected": True}
