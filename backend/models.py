from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class DownloadJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str
    command: str
    status: str = "pending"  # pending | downloading | done | failed
    title: Optional[str] = None
    filename: Optional[str] = None
    thumbnail_path: Optional[str] = None
    error_message: Optional[str] = None
    filesize: Optional[int] = None
    duration: Optional[int] = None
    download_seconds: Optional[float] = None
    progress_percent: Optional[float] = None
    progress_speed: Optional[str] = None
    progress_eta: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
