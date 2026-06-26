# ytdl-service — Claude Code Handoff

## Projektziel

Selbstgehosteter Download-Service für den Raspberry Pi 5. Der User schickt URLs (von beliebigen yt-dlp-kompatiblen Sites) per iOS Shortcut oder Web-UI, yt-dlp downloaded die Datei, ffmpeg generiert ein Thumbnail. Die Dateien liegen auf dem Pi und sind via WebDAV (Caddy) für Infuse erreichbar. Nächtlich werden die Dateien per rclone zu iCloud gesichert.

Zugriff ausschließlich über Cloudflare Tunnel (`ytdl.koellmann.dev`), geschützt via Cloudflare Access. Kein direkter Port-Zugriff von außen.

---

## Deployment-Kontext

- **Pi-Pfad**: `~/docker/yt-dlp/`
- **Cloudflare Tunnel**: Tunnel-ID `135c4f89-0ca0-4c57-b9dc-fd9561aae2ef`, Config unter `/etc/cloudflared/config.yml`
- **Neuer Tunnel-Eintrag** (manuell ergänzen nach Deployment):
  ```yaml
  - hostname: ytdl.koellmann.dev
    service: http://localhost:8090
  ```
- **Exposed Port**: `8090` (Caddy, nach außen)
- **Auth**: Cloudflare Access Policy auf `ytdl.koellmann.dev` — nur die hinterlegte Cloudflare-E-Mail des Users darf zugreifen. Kein eigenes Login-System nötig.
- **iOS Shortcut**: Schickt POST an `https://ytdl.koellmann.dev/api/jobs` (HTTPS via Tunnel, kein lokaler Port)

---

## Projektstruktur

```
~/docker/yt-dlp/
├── docker-compose.yml
├── data/                  # SQLite DB (wird von Docker gemountet, nicht im Repo)
├── downloads/             # Videos + Thumbnails (wird von Docker gemountet, nicht im Repo)
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── worker.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── QueueItem.tsx
│   │   │   ├── AddUrlForm.tsx
│   │   │   └── StatusBadge.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── caddy/
│   ├── Caddyfile
│   └── Dockerfile         # Eigenes Image mit WebDAV-Plugin (siehe unten)
└── rclone/
    └── backup.sh
```

---

## Stack

| Komponente | Technologie | Begründung |
|---|---|---|
| Backend | FastAPI (Python 3.12) | Passt nativ zu yt-dlp (Python), async-ready |
| Datenbank | SQLite via SQLModel | Keine externe DB nötig, reicht für Queue |
| Download | yt-dlp als Python-Library (nicht subprocess) | Sauberer, kein Shell-Escape-Problem |
| Thumbnail | ffmpeg via subprocess | Standard, zuverlässig |
| Frontend | React + TypeScript + Vite | Schnell, kein Overkill |
| Styling | Tailwind CSS | Utility-first, kein separates CSS nötig |
| File Server | Caddy mit WebDAV-Plugin | WebDAV für Infuse, served auch Frontend+API |
| Auth | Cloudflare Access (extern) | Kein eigenes Login, eine Policy reicht |
| Backup | rclone Cronjob im Backend-Container | iCloud Remote bereits konfiguriert |

---

## Backend — detaillierte Spezifikation

### SQLite Schema (SQLModel)

```python
class DownloadJob(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    url: str                          # Original-URL
    command: str                      # Vollständiger yt-dlp Befehl (editierbar)
    status: str                       # "pending" | "downloading" | "done" | "failed"
    title: str | None = None          # Von yt-dlp extrahierter Titel
    filename: str | None = None       # Relativer Pfad unter /downloads
    thumbnail_path: str | None = None # Relativer Pfad zum generierten Thumbnail
    error_message: str | None = None  # Fehlermeldung bei status="failed"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

### API Endpoints

#### `POST /api/jobs`
Neuen Download-Job anlegen.

Request Body:
```json
{ "url": "https://example.com/video" }
```

Verhalten:
- Baut automatisch den Default-Befehl:
  `yt-dlp -o "/downloads/%(uploader)s/%(title)s.%(ext)s" --trim-filenames 200 --print after_move:filepath <url>`
- Speichert Job mit `status="pending"` in SQLite
- Gibt den angelegten Job zurück
- Triggert den Worker (via asyncio Background Task)

Response: `DownloadJob` als JSON

---

#### `GET /api/jobs`
Alle Jobs zurückgeben, neueste zuerst.

Query Params:
- `status` (optional): filtern nach `pending | downloading | done | failed`

Response: `List[DownloadJob]`

---

#### `GET /api/jobs/{id}`
Einzelnen Job abrufen.

---

#### `PATCH /api/jobs/{id}/command`
Befehl eines fehlgeschlagenen Jobs editieren.

Request Body:
```json
{
  "command": "yt-dlp --cookies-from-browser chrome -o \"/downloads/%(title)s.%(ext)s\" https://..."
}
```

Nur erlaubt wenn `status="failed"`. Setzt `status` zurück auf `"pending"` und triggert Worker erneut.

---

#### `POST /api/jobs/{id}/retry`
Fehlgeschlagenen Job nochmal starten (mit aktuellem `command`). Nur erlaubt wenn `status="failed"`.

---

#### `DELETE /api/jobs/{id}`
Job löschen. Löscht auch die zugehörige Datei und das Thumbnail von Disk.

---

#### `GET /api/jobs/{id}/thumbnail`
Thumbnail-Bild als Datei zurückgeben (`FileResponse`).
Fallback: 404 wenn kein Thumbnail vorhanden (Frontend zeigt Placeholder).

---

### Worker (worker.py)

Läuft als asyncio Background Task. Immer nur **ein Download gleichzeitig** (schont Pi-Ressourcen).

**Ablauf pro Job:**

1. Job-Status → `"downloading"`
2. `command`-String aus DB via `shlex.split()` aufteilen → als Liste an `subprocess.run()` übergeben. **Kein `shell=True`** — das wäre eine Security-Lücke da der Befehl vom User editierbar ist.
3. Aus yt-dlp stdout den Dateipfad lesen (via `--print after_move:filepath` im Command)
4. ffmpeg aufrufen: `ffmpeg -i <filepath> -ss 3 -vframes 1 <filepath>.thumb.jpg`
5. Bei Erfolg: `status="done"`, `filename`, `thumbnail_path`, `title` in DB speichern
6. Bei Fehler: `status="failed"`, `error_message` = stderr letzte 20 Zeilen

**Fehlerbehandlung:**
- Timeout nach 30 Minuten
- ffmpeg-Fehler (Audio-only etc.) wird ignoriert — `thumbnail_path` bleibt `null`, kein Job-Fehler

---

## Frontend — detaillierte Spezifikation

### Design

Dunkles Theme, kompakt, informationsdicht. Internes Tool — kein Marketing-Look.

Palette:
- Background: `#0f0f0f`
- Surface: `#1a1a1a`
- Border: `#2a2a2a`
- Accent: `#6366f1` (Indigo)
- Success: `#22c55e`
- Error: `#ef4444`
- Text primary: `#f5f5f5`
- Text muted: `#737373`

### Komponenten

#### `AddUrlForm`
- Großes Input-Feld für URL (volle Breite)
- Submit-Button "Download"
- POST `/api/jobs` bei Submit, dann Liste aktualisieren
- Validierung: muss mit `http` anfangen

#### `QueueItem`

**pending / downloading:**
- URL (gekürzt auf max 60 Zeichen)
- Spinner-Animation / "In Queue" Text
- Timestamp

**done:**
- Thumbnail links (120×68px, object-fit: cover)
- Titel des Videos (fett)
- Dateiname darunter (monospace, gekürzt)
- "Done" Badge grün
- Timestamp

**failed:**
- "Failed" Badge rot
- Fehlermeldung in `<pre>`-Block (scrollbar, max-height 80px)
- `<textarea>` mit `command`-String (vorausgefüllt, volle Breite, monospace)
- Button "Retry" (Indigo) → PATCH command + POST retry
- Button "Delete" (rot, outlined) → DELETE job

#### `StatusBadge`
Pill-Komponente: pending (grau) / downloading (blau, CSS pulse-Animation) / done (grün) / failed (rot).

### Polling

Kein WebSocket. Polling alle **2 Sekunden** via `useEffect` + `setInterval`.
Nur aktiv wenn mindestens ein Job `status="pending"` oder `status="downloading"` hat.

---

## Caddy

### caddy/Dockerfile

Caddy's offizielles Image enthält das WebDAV-Modul nicht — eigenes Image erforderlich:

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-webdav

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### caddy/Caddyfile

```caddyfile
:80 {
    # WebDAV für Infuse
    route /webdav/* {
        uri strip_prefix /webdav
        webdav {
            root /downloads
        }
    }

    # File-Browser (Debugging)
    route /files/* {
        uri strip_prefix /files
        file_server browse {
            root /downloads
        }
    }

    # Backend API
    route /api/* {
        reverse_proxy backend:8000
    }

    # Frontend
    route /* {
        reverse_proxy frontend:3000
    }
}
```

**Infuse einbinden:** Server hinzufügen → WebDAV → `https://ytdl.koellmann.dev/webdav/`
Auth in Infuse: Cloudflare Access Service Token (kein normales Passwort). Alternativ: Infuse nur im LAN direkt auf `http://localhost:8090/webdav/` zeigen lassen — dann kein Auth-Problem.

---

## rclone Backup

### rclone/backup.sh

```bash
#!/bin/bash
set -e

LOGFILE="/data/rclone.log"
echo "[$(date)] Starting iCloud sync..." >> "$LOGFILE"

rclone sync /downloads icloud:ytdl-backup \
  --transfers 2 \
  --checkers 4 \
  --log-level INFO \
  --log-file "$LOGFILE"

echo "[$(date)] Sync complete." >> "$LOGFILE"
```

### Cronjob

Im Backend-Container via `crontab` (in Dockerfile einrichten):
```
0 3 * * * /rclone/backup.sh
```

Täglich 03:00 Uhr. rclone Binary und Config werden in den Container gemountet.

---

## Docker Compose

```yaml
version: "3.9"

services:
  backend:
    build: ./backend
    volumes:
      - ./downloads:/downloads
      - ./data:/data
      - ./rclone/backup.sh:/rclone/backup.sh
      - /home/koellman/.config/rclone:/root/.config/rclone:ro  # rclone config (read-only)
    environment:
      - DATABASE_URL=sqlite:////data/ytdl.db
      - DOWNLOADS_PATH=/downloads
    restart: unless-stopped

  frontend:
    build: ./frontend
    restart: unless-stopped

  caddy:
    build: ./caddy
    ports:
      - "8090:80"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile
      - ./downloads:/downloads
    depends_on:
      - backend
      - frontend
    restart: unless-stopped
```

Keine named volumes — alles als bind mounts unter `~/docker/yt-dlp/` für einfache Inspektion.

---

## iOS Shortcut Setup

Shortcut "Video speichern":
1. **Trigger**: Share Sheet, akzeptiert URLs
2. **Aktion**: "URL abrufen" (POST)
   - URL: `https://ytdl.koellmann.dev/api/jobs`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Body: `{"url": "<Shared URL>"}`
3. **Feedback**: Kurze Notification "Download gestartet"

Cloudflare Access lässt den Shortcut durch, da der Tunnel-Traffic von der registrierten E-Mail autorisiert ist — ggf. einen Cloudflare Access Service Token für den Shortcut anlegen falls Access den direkten API-Call blockt.

---

## Deployment-Checkliste (nach `docker compose up -d`)

1. `/etc/cloudflared/config.yml` um `ytdl.koellmann.dev → http://localhost:8090` ergänzen
2. `sudo systemctl restart cloudflared`
3. In Cloudflare Dashboard: Access Policy für `ytdl.koellmann.dev` anlegen (nur eigene E-Mail)
4. iOS Shortcut einrichten
5. Infuse: WebDAV-Server `https://ytdl.koellmann.dev/webdav/` oder LAN `http://<pi-ip>:8090/webdav/` hinzufügen

---

## Bekannte Einschränkungen / TODOs

- **Single Worker** — bewusst, Pi hat begrenzte Ressourcen. Später parallelisierbar.
- **yt-dlp Updates** — im Dockerfile: `pip install -U yt-dlp` beim Build. Sonst veraltet es schnell.
- **Audio-only Downloads** — ffmpeg Thumbnail schlägt fehl, wird ignoriert. Frontend zeigt Placeholder.
- **Infuse + Cloudflare Access** — Infuse unterstützt keine CF Access Tokens nativ. Empfehlung: Infuse im LAN direkt auf `http://<pi-ip>:8090/webdav/` zeigen lassen, nicht über den Tunnel.
- **rclone iCloud Remote** — muss auf dem Pi bereits als `icloud` konfiguriert sein. Der User hat das bereits eingerichtet.
