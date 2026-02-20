"""
Plex integration: OAuth PIN auth, server discovery, and library sync.

Auth flow
---------
1. call request_pin(client_id)         → {pin_id, pin_code}
2. send user to build_auth_url(...)    → plex.tv signs them in
3. poll check_pin(client_id, pin_id)  → {authenticated, token}
4. call fetch_account(token, ...)      → display name / avatar
5. call fetch_servers(token, ...)      → list of Plex servers
6. user picks a server; store url + token in settings table
7. call start_sync(...)                → background thread populates media DB
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Optional

import httpx
from loguru import logger

PLEX_API = "https://plex.tv/api/v2"
_APP_HEADERS = {
    "X-Plex-Product": "Rectifierr",
    "X-Plex-Version": "0.1.0",
    "X-Plex-Platform": "Web",
    "Accept": "application/json",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _headers(client_id: str, token: Optional[str] = None) -> dict:
    h = {**_APP_HEADERS, "X-Plex-Client-Identifier": client_id}
    if token:
        h["X-Plex-Token"] = token
    return h


def ensure_client_id(db) -> str:
    """Return this installation's stable client identifier, creating it if needed."""
    from app.models.setting import Setting
    row = db.query(Setting).filter(Setting.key == "_plex_client_id").first()
    if row and row.value:
        return row.value
    cid = str(uuid.uuid4())
    db.add(Setting(key="_plex_client_id", value=cid, description="Plex OAuth client ID (auto-generated)"))
    db.commit()
    return cid


def _load_plex_settings(db) -> dict[str, str]:
    from app.models.setting import Setting
    rows = db.query(Setting).filter(Setting.key.like("plex_%")).all()
    return {r.key: r.value for r in rows if r.value}


def _save(db, key: str, value: str, description: str = "") -> None:
    from app.models.setting import Setting
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value, description=description))
    db.commit()


# ---------------------------------------------------------------------------
# OAuth PIN flow
# ---------------------------------------------------------------------------

def request_pin(client_id: str) -> dict:
    """Step 1 — request a PIN from plex.tv. Returns {pin_id, pin_code}."""
    with httpx.Client(timeout=15) as c:
        r = c.post(
            f"{PLEX_API}/pins",
            params={"strong": "true"},
            headers=_headers(client_id),
        )
        r.raise_for_status()
        d = r.json()
    return {"pin_id": d["id"], "pin_code": d["code"], "expires_at": d.get("expiresAt")}


def build_auth_url(client_id: str, pin_code: str) -> str:
    """Step 2 — URL to send the user to so they can authorise the PIN."""
    from urllib.parse import quote
    # forwardUrl is omitted intentionally: Plex rejects non-HTTPS / localhost
    # redirect targets. Auth detection is handled by polling, not redirects.
    return (
        f"https://app.plex.tv/auth#?"
        f"clientID={quote(client_id, safe='')}"
        f"&code={pin_code}"
        f"&context%5Bdevice%5D%5Bproduct%5D=Rectifierr"
    )


def check_pin(client_id: str, pin_id: int) -> dict:
    """Step 3 — poll until authToken appears. Returns {authenticated, token}."""
    with httpx.Client(timeout=15) as c:
        r = c.get(f"{PLEX_API}/pins/{pin_id}", headers=_headers(client_id))
        r.raise_for_status()
        d = r.json()
    token = d.get("authToken") or None
    return {"authenticated": token is not None, "token": token}


# ---------------------------------------------------------------------------
# Account & server discovery
# ---------------------------------------------------------------------------

def fetch_account(token: str, client_id: str) -> dict:
    """Return basic Plex account info for the signed-in user."""
    with httpx.Client(timeout=15) as c:
        r = c.get(f"{PLEX_API}/user", headers=_headers(client_id, token))
        r.raise_for_status()
        d = r.json()
    return {
        "id": str(d.get("id", "")),
        "username": d.get("username", ""),
        "email": d.get("email", ""),
        "thumb": d.get("thumb", ""),
    }


def fetch_servers(token: str, client_id: str) -> list[dict]:
    """
    Return all Plex Media Servers the account can reach.
    Connections are sorted: local first, then HTTPS.
    """
    with httpx.Client(timeout=15) as c:
        r = c.get(
            f"{PLEX_API}/resources",
            params={"includeHttps": "1", "includeRelay": "1"},
            headers=_headers(client_id, token),
        )
        r.raise_for_status()
        resources = r.json()

    servers = []
    for res in resources:
        if "server" not in res.get("provides", ""):
            continue
        conns = sorted(
            res.get("connections", []),
            key=lambda c: (not c.get("local", False), c.get("protocol", "") != "https"),
        )
        if not conns:
            continue
        servers.append({
            "name": res["name"],
            "machine_id": res.get("clientIdentifier", ""),
            "owned": res.get("owned", False),
            "best_url": conns[0]["uri"],
            "connections": [
                {"uri": c["uri"], "local": c.get("local", False), "relay": c.get("relay", False)}
                for c in conns[:5]
            ],
        })
    return servers


def fetch_libraries(token: str, server_url: str, client_id: str) -> list[dict]:
    """Return all library sections from the connected Plex server."""
    from plexapi.server import PlexServer as _PMS
    server = _PMS(server_url, token, timeout=10)
    result = []
    for s in server.library.sections():
        result.append({
            "key": str(s.key),
            "title": s.title,
            "type": s.type,   # "movie", "show", "artist", "photo"
        })
    return result


# ---------------------------------------------------------------------------
# Library sync
# ---------------------------------------------------------------------------

class _SyncState:
    """Thread-safe sync progress tracker."""

    def __init__(self):
        self._lock = threading.Lock()
        self._d: dict = {"status": "idle"}
        self._cancel_event = threading.Event()

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._d)

    def set(self, **kwargs) -> None:
        with self._lock:
            self._d.update(kwargs)

    def reset(self, **kwargs) -> None:
        with self._lock:
            self._cancel_event.clear()
            self._d = {"status": "idle", **kwargs}

    @property
    def running(self) -> bool:
        with self._lock:
            return self._d.get("status") == "running"

    def cancel(self) -> None:
        self._cancel_event.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()


_sync = _SyncState()


def get_sync_status() -> dict:
    return _sync.snapshot()


def cancel_sync() -> bool:
    """Request the running sync to stop. Returns False if not running."""
    if not _sync.running:
        return False
    _sync.cancel()
    return True


def start_sync(
    token: str,
    server_url: str,
    client_id: str,
    plex_path_prefix: str = "",
    local_path_prefix: str = "",
    library_keys: list[str] | None = None,
) -> bool:
    """
    Kick off a background library sync.
    Returns False if one is already running.
    """
    if _sync.running:
        return False
    _sync.reset(
        status="running",
        started_at=datetime.utcnow().isoformat(),
        total=0,
        processed=0,
        imported=0,
        updated=0,
        removed=0,
        error=None,
    )
    t = threading.Thread(
        target=_run_sync,
        args=(token, server_url, client_id, plex_path_prefix, local_path_prefix, library_keys),
        daemon=True,
        name="plex-sync",
    )
    t.start()
    return True


def _translate_path(path: str, plex_prefix: str, local_prefix: str) -> str:
    if plex_prefix and local_prefix and path.startswith(plex_prefix):
        return local_prefix + path[len(plex_prefix):]
    return path


def _run_sync(token: str, server_url: str, client_id: str, plex_prefix: str, local_prefix: str, library_keys: list[str] | None = None):
    from app.core.database import SessionLocal
    from app.models.media import MediaFile, MediaType

    db = SessionLocal()
    try:
        from plexapi.server import PlexServer
        server = PlexServer(server_url, token, timeout=30)
        logger.info(f"Plex sync: connected to {server.friendlyName!r}")

        # Gather all items first so we can report a total.
        # searchEpisodes() fetches all episodes in a single API call (vs N+1 per show).
        raw_items: list[tuple[str, object, str | None]] = []
        sections = server.library.sections()
        if library_keys:
            sections = [s for s in sections if str(s.key) in library_keys]
        for lib in sections:
            if lib.type == "show":
                for ep in lib.searchEpisodes():
                    raw_items.append(("episode", ep, ep.grandparentTitle))
            elif lib.type == "movie":
                for movie in lib.all():
                    raw_items.append(("movie", movie, None))

        _sync.set(total=len(raw_items))
        logger.info(f"Plex sync: {len(raw_items)} item(s) to process")

        # Preload all existing paths in one query to avoid N per-item SELECTs.
        existing_map: dict[str, MediaFile] = {m.path: m for m in db.query(MediaFile).all()}
        logger.info(f"Plex sync: {len(existing_map)} file(s) already in DB")

        imported = updated = removed = 0
        # Track paths seen in this run to handle multi-episode files (e.g. S01E01E02)
        # where Plex returns the same file twice under different episode entries.
        seen_paths: set[str] = set()

        for idx, (kind, item, series_title) in enumerate(raw_items):
            if _sync.cancelled:
                _sync.set(status="cancelled", completed_at=datetime.utcnow().isoformat())
                logger.info("Plex sync cancelled by user")
                db.commit()
                return
            try:
                raw_path = item.media[0].parts[0].file if (item.media and item.media[0].parts) else None
                if not raw_path:
                    _sync.set(processed=idx + 1, imported=imported, updated=updated)
                    continue
                path = _translate_path(raw_path, plex_prefix, local_prefix)

                # Skip duplicate paths within this sync run (multi-episode files)
                if path in seen_paths:
                    _sync.set(processed=idx + 1, imported=imported, updated=updated)
                    continue
                seen_paths.add(path)

                existing = existing_map.get(path)
                if existing:
                    # Keep Plex metadata fresh
                    existing.plex_id = str(item.ratingKey)
                    existing.plex_library = getattr(item, "librarySectionTitle", None)
                    if kind == "episode" and series_title:
                        existing.series_title = series_title
                        existing.season_number = item.seasonNumber
                        existing.episode_number = item.index
                    updated += 1
                else:
                    if kind == "episode":
                        title = item.title or f"S{item.seasonNumber:02d}E{item.index:02d}"
                    else:
                        title = item.title or "Unknown"

                    record = MediaFile(
                        path=path,
                        title=title,
                        media_type=MediaType.EPISODE if kind == "episode" else MediaType.MOVIE,
                        series_title=series_title,
                        season_number=item.seasonNumber if kind == "episode" else None,
                        episode_number=item.index if kind == "episode" else None,
                        plex_id=str(item.ratingKey),
                        plex_library=getattr(item, "librarySectionTitle", None),
                    )
                    db.add(record)
                    existing_map[path] = record
                    imported += 1

                if idx % 200 == 0:
                    db.commit()

                _sync.set(processed=idx + 1, imported=imported, updated=updated)

            except Exception as e:
                logger.warning(f"Skipping item during sync: {e}")
                # Roll back to a clean state so the session remains usable
                db.rollback()

        db.commit()

        _sync.set(
            status="completed",
            processed=len(raw_items),
            imported=imported,
            updated=updated,
            completed_at=datetime.utcnow().isoformat(),
        )
        logger.info(f"Plex sync complete: {imported} imported, {updated} updated")

    except Exception as exc:
        logger.exception(f"Plex sync failed: {exc}")
        _sync.set(status="failed", error=str(exc), completed_at=datetime.utcnow().isoformat())
    finally:
        db.close()
