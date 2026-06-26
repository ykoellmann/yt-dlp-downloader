# ytdl-service

Self-hosted download service for Raspberry Pi. Send URLs from any yt-dlp-compatible site via iOS Shortcut or Web UI — files land on the Pi and are accessible via WebDAV (e.g. Infuse). Nightly rclone backup to iCloud.

Access is exclusively via Cloudflare Tunnel (`ytdl.koellmann.dev`), protected by Cloudflare Access. No open ports.

## Stack

| Component | Technology |
|-----------|-----------|
| Backend | FastAPI + Python 3.12 |
| Database | SQLite via SQLModel |
| Downloader | yt-dlp (Python API + subprocess) |
| Thumbnails | ffmpeg + ffprobe |
| Frontend | React + TypeScript + Vite + Tailwind CSS v4 |
| File server | Caddy with WebDAV plugin (via xcaddy) |
| Auth | Cloudflare Access |
| Backup | rclone cronjob (03:00 daily) |

## Features

- Queue-based downloads (one at a time, conserves Pi resources)
- Real-time progress bar with speed + ETA
- Quality presets (Best / 4K / 1080p / 720p / 480p / 360p / Audio only)
- Manual format selection — fetches available formats per URL before downloading
- Chrome impersonation via `curl-cffi` for sites with bot protection
- Cancel active downloads, retry failed/cancelled jobs (resumes with `-c`)
- Disk usage stats, total downloaded size
- Thumbnail generation for done jobs
- WebDAV server for Infuse integration
- File browser at `/files/`

## Prerequisites

- Raspberry Pi 5 (or any Linux box)
- Docker + Docker Compose
- Cloudflare account with a tunnel configured
- rclone configured on the host with an `icloud` remote (for backup)

## Deployment

### 1. Clone & deploy

```bash
git clone https://github.com/youruser/ytdl-service.git ~/docker/yt-dlp
cd ~/docker/yt-dlp
bash setup.sh
```

`setup.sh` creates the `data/` and `downloads/` directories and runs `docker compose up -d --build`.

### 2. Cloudflare Tunnel

Add to `/etc/cloudflared/config.yml`:

```yaml
- hostname: ytdl.koellmann.dev
  service: http://localhost:8090
```

Then restart the tunnel:

```bash
sudo systemctl restart cloudflared
```

### 3. Cloudflare Access

In the Cloudflare dashboard, create an Access Policy for `ytdl.koellmann.dev` that allows only your email address. No login system needed in the app.

### 4. Infuse (WebDAV)

Add a server in Infuse:
- **Type**: WebDAV
- **URL**: `http://<pi-ip>:8090/webdav/` (LAN, recommended — Infuse doesn't support Cloudflare Access tokens natively)

### 5. iOS Shortcut

Create a shortcut with these actions:

1. **Trigger**: Share Sheet, accepts URLs
2. **Action**: Get Contents of URL
   - URL: `https://ytdl.koellmann.dev/api/jobs`
   - Method: `POST`
   - Headers: `Content-Type: application/json`
   - Body: `{"url": "<Shared URL>"}`
3. **Feedback**: Show notification "Download gestartet"

If Cloudflare Access blocks the shortcut, create a Cloudflare Access Service Token and add it to the shortcut headers (`CF-Access-Client-Id` + `CF-Access-Client-Secret`).

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
├── backend/
│   ├── main.py          # FastAPI app, all endpoints
│   ├── models.py        # SQLModel schema
│   ├── worker.py        # Async download worker, progress parsing
│   ├── requirements.txt
│   └── Dockerfile
├── caddy/
│   ├── Caddyfile        # Reverse proxy + WebDAV + file browser
│   └── Dockerfile       # Custom build with caddy-webdav plugin
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
│   └── backup.sh        # Daily iCloud sync
├── docker-compose.yml
└── setup.sh             # First-time deployment script
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

- **Single worker by design** — the Pi has limited resources. Parallelism can be added later.
- **yt-dlp updates** — the Dockerfile runs `pip install -U yt-dlp` at build time. Rebuild periodically to stay current.
- **Audio-only downloads** — ffmpeg thumbnail generation fails silently; the frontend shows a placeholder.
- **rclone** — must be configured on the host with an `icloud` remote before deploying. The config is mounted read-only into the container.
