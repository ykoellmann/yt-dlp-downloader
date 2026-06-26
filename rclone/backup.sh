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
