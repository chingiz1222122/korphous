from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional


@dataclass(frozen=True)
class MessageRecord:
    chat_id: int
    message_id: int
    date_iso: str
    text: str
    sender_id: Optional[int]
    permalink: str


class MessageStore:
    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._conn = sqlite3.connect(self._path)
        self._conn.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                date_iso TEXT NOT NULL,
                text TEXT NOT NULL,
                sender_id INTEGER,
                permalink TEXT NOT NULL,
                PRIMARY KEY (chat_id, message_id)
            )
            """
        )
        self._conn.commit()

    def insert_messages(self, messages: Iterable[MessageRecord]) -> int:
        rows = [
            (
                msg.chat_id,
                msg.message_id,
                msg.date_iso,
                msg.text,
                msg.sender_id,
                msg.permalink,
            )
            for msg in messages
        ]
        if not rows:
            return 0
        before = self._conn.total_changes
        self._conn.executemany(
            """
            INSERT OR IGNORE INTO messages
            (chat_id, message_id, date_iso, text, sender_id, permalink)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        self._conn.commit()
        return self._conn.total_changes - before

    def close(self) -> None:
        self._conn.close()

    def latest_message_date(self, chat_id: int) -> Optional[str]:
        row = self._conn.execute(
            "SELECT date_iso FROM messages WHERE chat_id = ? ORDER BY date_iso DESC LIMIT 1",
            (chat_id,),
        ).fetchone()
        if not row:
            return None
        return row["date_iso"]

    def fetch_recent_messages(self, since_iso: str) -> List[MessageRecord]:
        rows = self._conn.execute(
            """
            SELECT chat_id, message_id, date_iso, text, sender_id, permalink
            FROM messages
            WHERE date_iso >= ?
            ORDER BY date_iso DESC
            """,
            (since_iso,),
        ).fetchall()
        return [
            MessageRecord(
                chat_id=row["chat_id"],
                message_id=row["message_id"],
                date_iso=row["date_iso"],
                text=row["text"],
                sender_id=row["sender_id"],
                permalink=row["permalink"],
            )
            for row in rows
        ]
