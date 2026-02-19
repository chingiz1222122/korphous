from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    api_id: int
    api_hash: str
    session_name: str
    database_path: str
    chat_list: List[str]
    summary_keywords: List[str]
    summary_period_hours: int
    bot_token: str
    openai_api_key: str
    openai_model: str
    owner_user_id: str


def _split_csv(value: str) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def load_settings() -> Settings:
    api_id = os.getenv("TG_API_ID")
    api_hash = os.getenv("TG_API_HASH")
    if not api_id or not api_hash:
        raise RuntimeError("TG_API_ID and TG_API_HASH are required")

    return Settings(
        api_id=int(api_id),
        api_hash=api_hash,
        session_name=os.getenv("TG_SESSION", "monitoring_session"),
        database_path=os.getenv("DATABASE_PATH", "./telegram_messages.db"),
        chat_list=_split_csv(os.getenv("CHAT_LIST", "")),
        summary_keywords=_split_csv(os.getenv("SUMMARY_KEYWORDS", "")),
        summary_period_hours=int(os.getenv("SUMMARY_PERIOD_HOURS", "24")),
        bot_token=os.getenv("BOT_TOKEN", ""),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-5.2"),
        owner_user_id=os.getenv("OWNER_USER_ID", ""),
    )
