from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class ChatIdentity:
    chat_id: int
    title: str
    username: str | None


def format_message_link(chat_id: int, username: str | None, msg_id: int) -> str:
    if username:
        return f"https://t.me/{username}/{msg_id}"
    if str(chat_id).startswith("-100"):
        internal_id = str(chat_id)[4:]
        return f"https://t.me/c/{internal_id}/{msg_id}"
    return f"https://t.me/c/{abs(chat_id)}/{msg_id}"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
