# Unraid Deployment

Two containers are required: **rectifierr-backend** and **rectifierr-frontend**.

Images are published to GitHub Container Registry and rebuilt automatically on every push to `main`.

---

## Container 1 — Backend

| Field      | Value                                           |
| ---------- | ----------------------------------------------- |
| Name       | `rectifierr-backend`                            |
| Repository | `ghcr.io/benw5483/rectifierr-backend:latest`    |
| Port       | `8000` → `8000`                                 |
| Volume     | `/mnt/user/appdata/rectifierr` → `/config` (rw) |
| Volume     | `/mnt/user/YourMediaFolder` → `/media` (ro)     |

**Variables:**

| Name                     | Value                             |
| ------------------------ | --------------------------------- |
| `MEDIA_ROOT`             | `/media`                          |
| `DATABASE_URL`           | `sqlite:////config/rectifierr.db` |
| `CONFIG_DIR`             | `/config`                         |
| `THUMBNAILS_DIR`         | `/config/thumbnails`              |
| `BUMPER_SCAN_SECONDS`    | `180`                             |
| `LOGO_DETECTION_ENABLED` | `true`                            |
| `MIN_CONFIDENCE`         | `0.5`                             |

---

## Container 2 — Frontend

| Field      | Value                                         |
| ---------- | --------------------------------------------- |
| Name       | `rectifierr-frontend`                         |
| Repository | `ghcr.io/benw5483/rectifierr-frontend:latest` |
| Port       | `7878` → `80`                                 |

**Variables:**

| Name          | Value                                      |
| ------------- | ------------------------------------------ |
| `BACKEND_URL` | `http://192.168.1.x:8000` ← your Unraid IP |

Access the UI at `http://unraid-ip:7878`.

---

## Path Prefix

After connecting Plex, go to **Settings → Path Prefix** and map Plex's internal paths to the container's `/media` path.

- **Plex prefix** — the path Plex stores for your files (visible on any media item's file info in Plex)
- **Local prefix** — `/media/` followed by any subfolder if your volume mount doesn't cover the full path

For example, if Plex stores `/mnt/user/data/Movies/foo.mkv` and you mounted `/mnt/user/data` → `/media`:

- Plex prefix: `/mnt/user/data/`
- Local prefix: `/media/`

---

## Updating

Pull the latest images and restart both containers:

```bash
docker pull ghcr.io/benw5483/rectifierr-backend:latest
docker pull ghcr.io/benw5483/rectifierr-frontend:latest
```

Then restart each container from the Unraid Docker tab.
