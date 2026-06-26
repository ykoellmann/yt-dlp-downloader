---
  1 — Pi vorbereiten

  SSH auf den Pi, dann Docker installieren falls noch nicht vorhanden:

  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  newgrp docker

  ---
  2 — Projekt auf den Pi kopieren

  Option A — direkt vom Mac rsync:
  rsync -av --exclude 'frontend/node_modules' --exclude 'frontend/dist' \
    ~/PycharmProjects/yt-dlp/ pi@<pi-ip>:~/docker/yt-dlp/

  Option B — via GitHub (wenn du's gepusht hast):
  git clone https://github.com/youruser/ytdl-service.git ~/docker/yt-dlp

  ---
  3 — Starten

  cd ~/docker/yt-dlp
  bash setup.sh

  Das erstellt data/ und downloads/, dann docker compose up -d --build. Erster Build dauert
  ~5–10 Minuten wegen xcaddy (Caddy mit WebDAV kompilieren).

  Status prüfen:
  docker compose logs -f

  Wenn alle drei Container healthy sind, ist die Web-UI unter http://<pi-ip>:8090 erreichbar —
  kurz testen bevor Cloudflare davor kommt.

  ---
  4 — Cloudflare Tunnel

  sudo nano /etc/cloudflared/config.yml

  Folgenden Block unter ingress: hinzufügen vor dem - service: http_status:404-Fallback:

  - hostname: ytdl.koellmann.dev
    service: http://localhost:8090

  Dann neu starten:

  sudo systemctl restart cloudflared
  sudo systemctl status cloudflared   # sollte "active (running)" zeigen

  Kurz warten, dann https://ytdl.koellmann.dev aufrufen — sollte die UI zeigen (noch ohne Auth).

  ---
  5 — Cloudflare Access

  Im Cloudflare Dashboard:

  1. Zero Trust → Access → Applications → Add an application
  2. Typ: Self-hosted
  3. Name: ytdl, Application domain: ytdl.koellmann.dev
  4. Policy hinzufügen:
    - Policy name: Owner
    - Action: Allow
    - Rule: Emails → yannikkoellmann227@gmail.com
  5. Speichern

  Ab jetzt fragt Cloudflare bei jedem Aufruf nach Login mit deiner E-Mail.

  ---
  6 — Infuse (WebDAV)

  Da Infuse keine Cloudflare Access Tokens unterstützt, direkt im LAN verbinden:

  In Infuse:
  1. Dateien → Mit Server verbinden → Über Netzwerk hinzufügen
  2. Protokoll: WebDAV
  3. Adresse: http://<pi-ip>:8090/webdav/
  4. Kein Benutzername/Passwort nötig (kein Auth im LAN)

  Du siehst dann alle Videos aus ~/docker/yt-dlp/downloads/.

  ---
  7 — iOS Shortcut

  1. Kurzbefehle-App → + → Aktion hinzufügen
  2. Suche: „Inhalt von URL abrufen"
  3. Konfiguration:
    - URL: https://ytdl.koellmann.dev/api/jobs
    - Methode: POST
    - Anfrage-Body: JSON
    - Body: {"url": "Kurzbefehl-Eingabe"} (die Variable kommt aus dem Share Sheet)
  4. Noch eine Aktion: Mitteilung anzeigen → "Download gestartet"
  5. Shortcut-Einstellungen → Im Share-Sheet anzeigen aktivieren

  Falls Cloudflare Access den API-Call blockt (passiert manchmal bei direkten API-Calls ohne
  Browser-Cookie): im Cloudflare Dashboard einen Service Token anlegen (Zero Trust → Access →
  Service Auth) und die Werte als Header im Shortcut mitschicken:
  - CF-Access-Client-Id: <client_id>
  - CF-Access-Client-Secret: <client_secret>

  ---
  8 — rclone Backup prüfen

  Der Cronjob läuft täglich um 03:00 Uhr im Backend-Container. Manuell testen:

  docker compose exec backend /rclone/backup.sh
  cat data/rclone.log

  Wenn du iCloud sync complete siehst, funktioniert alles.

  ---
  Kurzübersicht Reihenfolge

  Mac: rsync → Pi
  Pi:  bash setup.sh
       → docker compose up (5–10 min)
       → testen: http://<pi-ip>:8090 ✓
  Cloudflare: Tunnel-Config + restart
       → testen: https://ytdl.koellmann.dev ✓
  Cloudflare: Access Policy anlegen
       → Login erscheint ✓
  Infuse: WebDAV LAN-Adresse einrichten ✓
  iOS: Shortcut einrichten ✓
  rclone: /rclone/backup.sh manuell testen ✓