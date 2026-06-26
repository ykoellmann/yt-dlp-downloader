FROM python:3.12-slim

RUN apt-get update && apt-get install -y ffmpeg cron rclone && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir -U yt-dlp && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /rclone

RUN echo "0 3 * * * /rclone/backup.sh >> /data/rclone.log 2>&1" | crontab -

CMD ["sh", "-c", "service cron start && uvicorn main:app --host 0.0.0.0 --port 8000"]
