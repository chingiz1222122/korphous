from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
import os


@dataclass(frozen=True)
class Settings:
    telegram_api_id: int
    telegram_api_hash: str
    telethon_session: str
    bot_token: str
    owner_user_id: int
    sqlite_path: Path
    openai_api_key: str
    openai_model: str
    log_level: str


def load_settings() -> Settings:
    load_dotenv()

    telegram_api_id = int(os.environ["TELEGRAM_API_ID"])
    telegram_api_hash = os.environ["TELEGRAM_API_HASH"]
    telethon_session = os.environ.get("TELETHON_SESSION", "telethon.session")
    bot_token = os.environ["BOT_TOKEN"]
    owner_user_id = int(os.environ["OWNER_USER_ID"])
    sqlite_path = Path(os.environ.get("SQLITE_PATH", "./data/telegram.sqlite"))
    openai_api_key = os.environ["OPENAI_API_KEY"]
    openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    log_level = os.environ.get("LOG_LEVEL", "INFO")

    return Settings(
        telegram_api_id=telegram_api_id,
        telegram_api_hash=telegram_api_hash,
        telethon_session=telethon_session,
        bot_token=bot_token,
        owner_user_id=owner_user_id,
        sqlite_path=sqlite_path,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        log_level=log_level,
    )
