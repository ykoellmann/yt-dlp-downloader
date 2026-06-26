#!/bin/bash
set -e

DEPLOY_DIR="${1:-$HOME/docker/yt-dlp}"

echo "Erstelle Verzeichnisse in $DEPLOY_DIR ..."
mkdir -p "$DEPLOY_DIR"/{data,downloads}

echo "Starte Container ..."
cd "$DEPLOY_DIR"
docker compose up -d --build

echo ""
echo "Fertig. Nächste Schritte:"
echo "  1. /etc/cloudflared/config.yml um 'ytdl.koellmann.dev → http://localhost:8090' ergänzen"
echo "  2. sudo systemctl restart cloudflared"
echo "  3. Cloudflare Access Policy für ytdl.koellmann.dev anlegen"
