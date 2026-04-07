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
    bot_token: str
    owner_user_id: int
    openai_api_key: str
    openai_model: str
    embedding_model: str
    default_period: str
    daily_digest_hour: int
    daily_digest_minute: int
    digest_default_scope: str
    digest_default_period: str
    scheduler_poll_seconds: int
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
        bot_token=os.environ["BOT_TOKEN"],
        owner_user_id=int(os.environ["OWNER_USER_ID"]),
        openai_api_key=os.environ["OPENAI_API_KEY"],
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        embedding_model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        default_period=os.environ.get("DEFAULT_PERIOD", "24h"),
        daily_digest_hour=int(os.environ.get("DAILY_DIGEST_HOUR", "9")),
        daily_digest_minute=int(os.environ.get("DAILY_DIGEST_MINUTE", "0")),
        digest_default_scope=os.environ.get("DIGEST_DEFAULT_SCOPE", "all_enabled"),
        digest_default_period=os.environ.get("DIGEST_DEFAULT_PERIOD", "24h"),
        scheduler_poll_seconds=int(os.environ.get("SCHEDULER_POLL_SECONDS", "30")),
        sqlite_path=Path(os.environ.get("SQLITE_PATH", "./data.sqlite3")),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
        enabled_refresh_seconds=int(os.environ.get("ENABLED_REFRESH_SECONDS", "30")),
        lock_retry_attempts=int(os.environ.get("DB_LOCK_RETRY_ATTEMPTS", "5")),
        lock_retry_delay_seconds=float(os.environ.get("DB_LOCK_RETRY_DELAY", "0.2")),
    )
