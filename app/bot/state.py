from __future__ import annotations

from app.db import Database


def _owner_key(owner_id: int, suffix: str) -> str:
    return f"owner:{owner_id}:{suffix}"


def set_selected_chat(db: Database, owner_id: int, chat_id: int) -> None:
    db.set_state(_owner_key(owner_id, "selected_chat_id"), str(chat_id))


def get_selected_chat(db: Database, owner_id: int) -> int | None:
    value = db.get_state(_owner_key(owner_id, "selected_chat_id"))
    if value is None:
        return None
    return int(value)


def set_selected_period(db: Database, owner_id: int, period: str) -> None:
    db.set_state(_owner_key(owner_id, "selected_period"), period)


def get_selected_period(db: Database, owner_id: int) -> str:
    value = db.get_state(_owner_key(owner_id, "selected_period"))
    return value or "24h"
