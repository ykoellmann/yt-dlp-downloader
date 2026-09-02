# yt-dlp-downloader

Self-hosted download service for any Docker host (built and tested on a Raspberry Pi 5). Send URLs from any yt-dlp-compatible site via iOS Shortcut or Web UI — files land on your server and are accessible via WebDAV (e.g. Infuse). Optional nightly rclone backup to a cloud remote.

## Stack

| Component | Technology |
|-----------|-----------|
| Backend | FastAPI + Python 3.12 |
| Database | SQLite via SQLModel |
| Downloader | yt-dlp (Python API + subprocess) |
| Thumbnails | ffmpeg + ffprobe |
| Frontend | React + TypeScript + Vite + Tailwind CSS v4 |
| File server | Caddy with WebDAV plugin (via xcaddy) |
| Auth | Reverse proxy of your choice (tested with Cloudflare Access) |
| Backup | Optional rclone cronjob |

## Features

- Queue-based downloads (one at a time, conserves low-power hosts like a Pi)
- Real-time progress bar with speed + ETA
- Quality presets (Best / 4K / 1080p / 720p / 480p / 360p / Audio only)
- Manual format selection — fetches available formats per URL before downloading
- Chrome impersonation via `curl-cffi` for sites with bot protection
- Cancel active downloads, retry failed/cancelled jobs (resumes with `-c`)
- Disk usage stats, total downloaded size
- Thumbnail generation for done jobs
- WebDAV server for e.g. Infuse integration
- File browser at `/files/`

## Prerequisites

- Any Linux host with Docker + Docker Compose (built and tested on a Raspberry Pi 5 / arm64)
- Optional: a reverse proxy / tunnel (e.g. Cloudflare Tunnel) if you want to expose the service outside your LAN
- Optional: rclone configured on the host with a remote of your choice, if you want automated backups

## Deployment

Pre-built images are published to `ghcr.io/ykoellmann/ytdl-*` via GitHub Actions (see `.github/workflows/build.yml`) for `linux/arm64`. No local build required.

```bash
git clone https://github.com/ykoellmann/yt-dlp-downloader.git
cd yt-dlp-downloader
mkdir -p data downloads
cp .env.example .env   # edit RCLONE_CONFIG_DIR if you use the backup cronjob
docker compose pull
docker compose up -d
```

The web UI is then reachable at `http://<host-ip>:8090`.

### Reverse proxy / public access (optional)

Point your reverse proxy or tunnel at `http://localhost:8090`. Example for a Cloudflare Tunnel config:

```yaml
ingress:
  - hostname: ytdl.your-domain.com
    service: http://localhost:8090
```

Restrict access with your proxy's auth mechanism (e.g. a Cloudflare Access policy allowing only your own email address) — the app itself has no built-in authentication.

### WebDAV (e.g. Infuse)

Add a server in your WebDAV client:
- **Type**: WebDAV
- **URL**: `http://<host-ip>:8090/webdav/` (LAN access recommended — many WebDAV clients, e.g. Infuse, don't support proxy auth tokens like Cloudflare Access natively)

### iOS Shortcut

Create a shortcut with these actions:

1. **Trigger**: Share Sheet, accepts URLs
2. **Action**: Get Contents of URL
   - URL: `https://ytdl.your-domain.com/api/jobs` (or your LAN address)
   - Method: `POST`
   - Headers: `Content-Type: application/json`
   - Body: `{"url": "<Shared URL>"}`
3. **Feedback**: Show notification "Download started"

If your reverse-proxy auth blocks the shortcut's direct API call (common with Cloudflare Access, since there's no browser cookie), create a service token in your proxy and add it to the shortcut headers, e.g. for Cloudflare:
- `CF-Access-Client-Id: <client_id>`
- `CF-Access-Client-Secret: <client_secret>`

## Updating

New images are built automatically on every push to `main`. On the host:

```bash
docker compose pull
docker compose up -d
```

## Local Development

Requires Python 3.12, ffmpeg, yt-dlp, and Node.js installed locally.

```bash
# Terminal 1 — Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
mkdir -p /tmp/ytdl/{downloads,data}
DATABASE_URL=sqlite:////tmp/ytdl/data/ytdl.db \
DOWNLOADS_PATH=/tmp/ytdl/downloads \
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev   # → http://localhost:5173, proxies /api/* to :8000
```

## Project Structure

```
.
├── .github/workflows/
│   └── build.yml         # CI: builds + pushes images to ghcr.io on push to main
├── backend/
│   ├── main.py            # FastAPI app, all endpoints
│   ├── models.py          # SQLModel schema
│   ├── worker.py          # Async download worker, progress parsing
│   ├── requirements.txt
│   └── Dockerfile
├── caddy/
│   ├── Caddyfile          # Reverse proxy + WebDAV + file browser
│   └── Dockerfile         # Custom build with caddy-webdav plugin
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   └── components/
│   │       ├── AddUrlForm.tsx   # URL input, quality picker, format selector
│   │       ├── QueueItem.tsx    # Job card (all states)
│   │       ├── StatsBar.tsx     # Download stats + disk usage
│   │       └── StatusBadge.tsx
│   └── Dockerfile
├── rclone/
│   └── backup.sh          # Optional daily backup script (see below)
├── docker-compose.yml
└── .env.example
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Create download job |
| `GET` | `/api/jobs` | List all jobs (optional `?status=` filter) |
| `GET` | `/api/jobs/:id` | Get single job |
| `PATCH` | `/api/jobs/:id/command` | Edit yt-dlp command (failed jobs only) |
| `POST` | `/api/jobs/:id/retry` | Retry failed/cancelled job (adds `-c`) |
| `POST` | `/api/jobs/:id/cancel` | Cancel active download |
| `DELETE` | `/api/jobs/:id` | Delete job and files from disk |
| `GET` | `/api/jobs/:id/thumbnail` | Thumbnail image |
| `GET` | `/api/formats?url=` | Fetch available formats for a URL |
| `GET` | `/api/stats` | Download count + disk usage |

### POST /api/jobs

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "quality": "1080p",
  "format_id": "137",
  "format_has_audio": false
}
```

`quality` options: `best` (default) · `2160p` · `1080p` · `720p` · `480p` · `360p` · `audio`

## Notes

- **Single worker by design** — assumes a low-power host (e.g. a Pi). Parallelism can be added later.
- **Images are built for `linux/arm64` only** — adjust `.github/workflows/build.yml`'s `platforms` if you need `linux/amd64` too.
- **yt-dlp updates** — the backend image is rebuilt with `pip install -U yt-dlp` on every push to `main`; pull the latest image periodically (or set up Renovate/Watchtower) to stay current.
- **Audio-only downloads** — ffmpeg thumbnail generation fails silently; the frontend shows a placeholder.
- **rclone backup is optional** — only relevant if you mount a configured rclone config directory and set `RCLONE_CONFIG_DIR` in `.env`.