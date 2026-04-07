from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    telegram_api_id: int
    telegram_api_hash: str
    telethon_session: str
    sqlite_path: Path
    log_level: str
    enabled_refresh_seconds: int
    lock_retry_attempts: int
    lock_retry_delay_seconds: float


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        telegram_api_id=int(os.environ["TELEGRAM_API_ID"]),
        telegram_api_hash=os.environ["TELEGRAM_API_HASH"],
        telethon_session=os.environ.get("TELETHON_SESSION", "user.session"),
        sqlite_path=Path(os.environ.get("SQLITE_PATH", "./data.sqlite3")),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
        enabled_refresh_seconds=int(os.environ.get("ENABLED_REFRESH_SECONDS", "30")),
        lock_retry_attempts=int(os.environ.get("DB_LOCK_RETRY_ATTEMPTS", "5")),
        lock_retry_delay_seconds=float(os.environ.get("DB_LOCK_RETRY_DELAY", "0.2")),
    )
