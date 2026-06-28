import asyncio
import os
import shlex
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, SQLModel, col, create_engine, select

from models import DownloadJob
import worker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:////data/ytdl.db")
DOWNLOADS_PATH = os.environ.get("DOWNLOADS_PATH", "/downloads")

# check_same_thread=False because worker threads also access the engine
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

app = FastAPI()


@app.on_event("startup")
async def on_startup():
    os.makedirs(DOWNLOADS_PATH, exist_ok=True)

    # WAL mode: allows concurrent reads during worker writes
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("PRAGMA synchronous=NORMAL"))
        conn.commit()

    SQLModel.metadata.create_all(engine)
    _migrate_db()
    await _recover_jobs()


async def _recover_jobs():
    """On restart: fail stuck downloading jobs, re-enqueue pending ones."""
    pending_ids: list[int] = []
    with Session(engine) as session:
        stuck = session.exec(
            select(DownloadJob).where(
                col(DownloadJob.status).in_(["downloading", "pending"])
            )
        ).all()
        for job in stuck:
            if job.status == "downloading":
                job.status = "failed"
                job.error_message = "Unterbrochen durch Neustart"
                job.progress_percent = None
                job.updated_at = datetime.utcnow()
                session.add(job)
            else:
                pending_ids.append(job.id)
        session.commit()

    for job_id in pending_ids:
        await worker.enqueue(job_id)


def _migrate_db():
    """Add columns that were added after the initial schema."""
    import sqlite3

    db_path = DATABASE_URL.removeprefix("sqlite:///")
    if not Path(db_path).exists():
        return

    new_columns = {
        "filesize": "INTEGER",
        "duration": "INTEGER",
        "download_seconds": "REAL",
        "progress_percent": "REAL",
        "progress_speed": "VARCHAR",
        "progress_eta": "VARCHAR",
    }

    conn = sqlite3.connect(db_path)
    try:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(downloadjob)")}
        for col, typ in new_columns.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE downloadjob ADD COLUMN {col} {typ}")
        conn.commit()
    finally:
        conn.close()


# fmt: off
QUALITY_FORMATS = {
    "best":  None,
    "2160p": "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
    "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720p":  "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480p":  "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "360p":  "bestvideo[height<=360]+bestaudio/best[height<=360]",
    "audio": "bestaudio/best",
}
# fmt: on


class CreateJobRequest(BaseModel):
    url: str
    quality: str = "best"
    format_id: Optional[str] = None
    format_has_audio: bool = True


class PatchCommandRequest(BaseModel):
    command: str


def _build_command(url: str, quality: str = "best", format_id: Optional[str] = None, format_has_audio: bool = True) -> str:
    if format_id:
        fmt = format_id if format_has_audio else f"{format_id}+bestaudio"
        format_flag = f'-f "{fmt}"'
    elif quality in QUALITY_FORMATS and QUALITY_FORMATS[quality]:
        format_flag = f'-f "{QUALITY_FORMATS[quality]}"'
    else:
        format_flag = ""

    parts = ["yt-dlp", "--progress", "--newline", "--impersonate", "chrome"]
    if format_flag:
        parts.append(format_flag)
    parts += [
        '-o "/downloads/%(title)s.%(ext)s"',
        "--trim-filenames 200",
        "--print after_move:filepath",
        url,
    ]
    return " ".join(parts)


# --- Endpoints ---

@app.post("/api/jobs", response_model=DownloadJob)
async def create_job(body: CreateJobRequest):
    job = DownloadJob(
        url=body.url,
        command=_build_command(body.url, body.quality, body.format_id, body.format_has_audio),
    )
    with Session(engine) as session:
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    await worker.enqueue(job_id)
    with Session(engine) as session:
        return session.get(DownloadJob, job_id)


@app.get("/api/jobs", response_model=list[DownloadJob])
def list_jobs(status: Optional[str] = None):
    with Session(engine) as session:
        q = select(DownloadJob).order_by(DownloadJob.created_at.desc())
        if status:
            q = q.where(DownloadJob.status == status)
        return session.exec(q).all()


@app.get("/api/jobs/{job_id}", response_model=DownloadJob)
def get_job(job_id: int):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        return job


@app.patch("/api/jobs/{job_id}/command", response_model=DownloadJob)
async def patch_command(job_id: int, body: PatchCommandRequest):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job.status != "failed":
            raise HTTPException(400, "Can only edit command of failed jobs")
        job.command = body.command
        job.status = "pending"
        job.error_message = None
        session.add(job)
        session.commit()

    await worker.enqueue(job_id)
    with Session(engine) as session:
        return session.get(DownloadJob, job_id)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job.status not in ("downloading", "pending"):
            raise HTTPException(400, "Job is not active")
    worker.cancel(job_id)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/retry", response_model=DownloadJob)
async def retry_job(job_id: int):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job.status not in ("failed", "cancelled"):
            raise HTTPException(400, "Can only retry failed or cancelled jobs")

        # Add -c to resume partial downloads, unless already present
        args = shlex.split(job.command)
        if args and args[0] == "yt-dlp" and "-c" not in args:
            args.insert(1, "-c")
            job.command = " ".join(shlex.quote(a) for a in args)

        job.status = "pending"
        job.error_message = None
        session.add(job)
        session.commit()

    await worker.enqueue(job_id)
    with Session(engine) as session:
        return session.get(DownloadJob, job_id)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        for path in [job.filename, job.thumbnail_path]:
            if path:
                try:
                    Path(path).unlink(missing_ok=True)
                except Exception:
                    pass
        session.delete(job)
        session.commit()
    return {"ok": True}


@app.get("/api/jobs/{job_id}/thumbnail")
def get_thumbnail(job_id: int):
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if not job or not job.thumbnail_path or not Path(job.thumbnail_path).exists():
            raise HTTPException(404, "No thumbnail")
        return FileResponse(job.thumbnail_path, media_type="image/jpeg")


@app.get("/api/formats")
async def get_formats(url: str):
    try:
        loop = asyncio.get_running_loop()
        formats = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _extract_formats(url)),
            timeout=60,
        )
        return formats
    except asyncio.TimeoutError:
        raise HTTPException(408, "Timeout beim Abrufen der Formate")
    except Exception as e:
        raise HTTPException(400, str(e))


def _extract_formats(url: str) -> list[dict]:
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True}
    try:
        from yt_dlp.utils import ImpersonateTarget
        opts["impersonate"] = ImpersonateTarget("chrome")
    except Exception:
        pass

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    formats = info.get("formats", [])
    # Some extractors return a single direct URL instead of a formats list
    if not formats and info.get("url"):
        formats = [info]

    result = []

    for f in formats:
        vcodec = f.get("vcodec") or "none"
        acodec = f.get("acodec") or "none"
        has_video = vcodec != "none"
        has_audio = acodec != "none"

        if not has_video and not has_audio:
            continue

        height = f.get("height")
        ext = f.get("ext", "")
        filesize = f.get("filesize") or f.get("filesize_approx")
        tbr = f.get("tbr") or 0
        format_note = f.get("format_note", "")

        if has_video and height:
            size_str = f" ~{filesize // 1024 // 1024} MB" if filesize else ""
            label = f"{height}p {ext.upper()}{size_str}"
            if format_note:
                label += f" [{format_note}]"
        elif has_audio and not has_video:
            label = f"Audio {ext.upper()}"
            if format_note:
                label += f" [{format_note}]"
        else:
            label = f.get("format", f.get("format_id", "?"))

        result.append({
            "format_id": f.get("format_id"),
            "label": label,
            "ext": ext,
            "height": height,
            "filesize": filesize,
            "has_video": has_video,
            "has_audio": has_audio,
            "tbr": tbr,
        })

    # sort: video by height desc then bitrate, then audio-only
    result.sort(key=lambda x: (x["has_video"], x["height"] or 0, x["tbr"] or 0), reverse=True)
    return result


@app.get("/api/stats")
def get_stats():
    import shutil

    with Session(engine) as session:
        jobs = session.exec(select(DownloadJob)).all()

    by_status: dict[str, int] = {}
    total_size = 0
    for job in jobs:
        by_status[job.status] = by_status.get(job.status, 0) + 1
        if job.filesize:
            total_size += job.filesize

    try:
        disk = shutil.disk_usage(DOWNLOADS_PATH)
        disk_free = disk.free
        disk_total = disk.total
        disk_used = disk.used
    except Exception:
        disk_free = disk_total = disk_used = None

    return {
        "total_jobs": len(jobs),
        "by_status": by_status,
        "total_size_bytes": total_size,
        "disk_free_bytes": disk_free,
        "disk_total_bytes": disk_total,
        "disk_used_bytes": disk_used,
    }
