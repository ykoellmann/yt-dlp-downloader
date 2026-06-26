import asyncio
import os
import re
import shlex
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from models import DownloadJob

_queue: asyncio.Queue = asyncio.Queue()
_worker_running = False

_active_procs: dict[int, subprocess.Popen] = {}
_cancelled_jobs: set[int] = set()

_PROGRESS_INTERVAL = 2.0
_last_progress_write: dict[int, float] = {}

PROGRESS_RE = re.compile(r'\[download\]\s+([\d.]+)%')
SPEED_RE = re.compile(r'at\s+([\d.]+\s*\S+/s)')
ETA_RE = re.compile(r'ETA\s+(\d+:\d+(?::\d+)?)')


def cancel(job_id: int) -> bool:
    """Terminate the running yt-dlp process for job_id. Returns True if a process was found."""
    proc = _active_procs.get(job_id)
    if proc:
        _cancelled_jobs.add(job_id)
        proc.terminate()
        return True
    return False


async def enqueue(job_id: int):
    await _queue.put(job_id)
    global _worker_running
    if not _worker_running:
        asyncio.create_task(_run_worker())


async def _run_worker():
    global _worker_running
    _worker_running = True
    try:
        while not _queue.empty():
            job_id = await _queue.get()
            await _process(job_id)
            _queue.task_done()
    finally:
        _worker_running = False


async def _process(job_id: int):
    from main import engine

    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if job is None:
            return
        job.status = "downloading"
        job.progress_percent = None
        job.progress_speed = None
        job.progress_eta = None
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()
        command = job.command

    started = time.monotonic()

    try:
        args = shlex.split(command)
        loop = asyncio.get_running_loop()
        returncode, filepath, stderr = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _run_download(args, job_id, engine)),
            timeout=1800,
        )

        elapsed = time.monotonic() - started

        if returncode != 0:
            if job_id in _cancelled_jobs:
                _cancelled_jobs.discard(job_id)
                _set_cancelled(job_id)
            else:
                _fail(job_id, "\n".join(stderr.splitlines()[-20:]))
            return

        if not filepath or not Path(filepath).exists():
            _fail(job_id, "yt-dlp lieferte keinen gültigen Dateipfad.\n" + stderr[-500:])
            return

        thumbnail_path = _make_thumbnail(filepath)
        filesize = _get_filesize(filepath)
        duration = _get_duration(filepath)

        with Session(engine) as session:
            job = session.get(DownloadJob, job_id)
            job.status = "done"
            job.filename = filepath
            job.thumbnail_path = thumbnail_path
            job.title = Path(filepath).stem
            job.filesize = filesize
            job.duration = duration
            job.download_seconds = elapsed
            job.progress_percent = 100.0
            job.progress_speed = None
            job.progress_eta = None
            job.updated_at = datetime.utcnow()
            session.add(job)
            session.commit()

    except asyncio.TimeoutError:
        _fail(job_id, "Timeout nach 30 Minuten.")
    except Exception as exc:
        _fail(job_id, str(exc))


def _run_download(args: list[str], job_id: int, engine) -> tuple[int, str | None, str]:
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    _active_procs[job_id] = proc

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []

    def read_stdout():
        for line in proc.stdout:
            stdout_lines.append(line.rstrip())

    def read_stderr():
        for line in proc.stderr:
            line = line.rstrip()
            stderr_lines.append(line)
            _try_parse_progress(line, job_id, engine)

    t1 = threading.Thread(target=read_stdout, daemon=True)
    t2 = threading.Thread(target=read_stderr, daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    proc.wait()
    _active_procs.pop(job_id, None)

    filepath = None
    for line in reversed(stdout_lines):
        stripped = line.strip()
        if stripped.startswith("/"):
            filepath = stripped
            break

    return proc.returncode, filepath, "\n".join(stderr_lines)


def _try_parse_progress(line: str, job_id: int, engine):
    m_pct = PROGRESS_RE.search(line)
    if not m_pct:
        return

    now = time.monotonic()
    if now - _last_progress_write.get(job_id, 0) < _PROGRESS_INTERVAL:
        return
    _last_progress_write[job_id] = now

    percent = float(m_pct.group(1))
    speed = (m := SPEED_RE.search(line)) and m.group(1)
    eta   = (m := ETA_RE.search(line))   and m.group(1)

    try:
        with Session(engine) as session:
            job = session.get(DownloadJob, job_id)
            if job and job.status == "downloading":
                job.progress_percent = percent
                job.progress_speed = speed or None
                job.progress_eta = eta or None
                job.updated_at = datetime.utcnow()
                session.add(job)
                session.commit()
    except Exception:
        pass


def _make_thumbnail(filepath: str) -> str | None:
    thumb = filepath + ".thumb.jpg"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", filepath, "-ss", "3", "-vframes", "1", thumb],
            capture_output=True, timeout=60,
        )
        if result.returncode == 0 and Path(thumb).exists():
            return thumb
    except Exception:
        pass
    return None


def _get_filesize(filepath: str) -> int | None:
    try:
        return os.path.getsize(filepath)
    except Exception:
        return None


def _get_duration(filepath: str) -> int | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", filepath],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(float(result.stdout.strip()))
    except Exception:
        pass
    return None


def _set_cancelled(job_id: int):
    from main import engine
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if job:
            job.status = "cancelled"
            job.error_message = None
            job.progress_percent = None
            job.updated_at = datetime.utcnow()
            session.add(job)
            session.commit()


def _fail(job_id: int, error: str):
    from main import engine
    with Session(engine) as session:
        job = session.get(DownloadJob, job_id)
        if job:
            job.status = "failed"
            job.error_message = error
            job.progress_percent = None
            job.updated_at = datetime.utcnow()
            session.add(job)
            session.commit()
