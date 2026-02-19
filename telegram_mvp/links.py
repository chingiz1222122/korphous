from __future__ import annotations

from typing import Optional


def message_link(chat_id: int, message_id: int, username: Optional[str]) -> str:
    if username:
        return f"https://t.me/{username}/{message_id}"
    internal_id = str(chat_id)
    if internal_id.startswith("-100"):
        internal_id = internal_id[4:]
    return f"https://t.me/c/{internal_id}/{message_id}"
