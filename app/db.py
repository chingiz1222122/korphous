from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ChatRecord:
    chat_id: int
    title: str
    username: str | None
    enabled: bool


@dataclass(frozen=True)
class MessageRecord:
    chat_id: int
    chat_title: str
    chat_username: str | None
    msg_id: int
    sender_id: int | None
    date: datetime
    text: str
    permalink: str


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                username TEXT,
                enabled INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                chat_title TEXT NOT NULL,
                chat_username TEXT,
                msg_id INTEGER NOT NULL,
                sender_id INTEGER,
                date TEXT NOT NULL,
                text TEXT NOT NULL,
                permalink TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_messages_chat_date
            ON messages (chat_id, date)
            """
        )
        conn.commit()


def upsert_chat(db_path: Path, chat: ChatRecord) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO chats (chat_id, title, username, enabled)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                title=excluded.title,
                username=excluded.username
            """,
            (chat.chat_id, chat.title, chat.username, int(chat.enabled)),
        )
        conn.commit()


def set_chat_enabled(db_path: Path, chat_id: int, enabled: bool) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE chats SET enabled = ? WHERE chat_id = ?",
            (int(enabled), chat_id),
        )
        conn.commit()


def list_chats(db_path: Path) -> list[ChatRecord]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT chat_id, title, username, enabled FROM chats ORDER BY title"
        ).fetchall()
    return [
        ChatRecord(
            chat_id=row["chat_id"],
            title=row["title"],
            username=row["username"],
            enabled=bool(row["enabled"]),
        )
        for row in rows
    ]


def get_enabled_chat_ids(db_path: Path) -> set[int]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT chat_id FROM chats WHERE enabled = 1"
        ).fetchall()
    return {row["chat_id"] for row in rows}


def insert_message(db_path: Path, message: MessageRecord) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO messages (
                chat_id, chat_title, chat_username, msg_id, sender_id, date, text, permalink
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message.chat_id,
                message.chat_title,
                message.chat_username,
                message.msg_id,
                message.sender_id,
                message.date.isoformat(),
                message.text,
                message.permalink,
            ),
        )
        conn.commit()


def fetch_messages(
    db_path: Path,
    since: datetime,
    limit: int = 200,
) -> list[MessageRecord]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT chat_id, chat_title, chat_username, msg_id, sender_id, date, text, permalink
            FROM messages
            WHERE date >= ?
            ORDER BY date DESC
            LIMIT ?
            """,
            (since.isoformat(), limit),
        ).fetchall()
    messages: list[MessageRecord] = []
    for row in rows:
        messages.append(
            MessageRecord(
                chat_id=row["chat_id"],
                chat_title=row["chat_title"],
                chat_username=row["chat_username"],
                msg_id=row["msg_id"],
                sender_id=row["sender_id"],
                date=datetime.fromisoformat(row["date"]),
                text=row["text"],
                permalink=row["permalink"],
            )
        )
    return messages


def fetch_recent_messages(db_path: Path, hours: int, limit: int = 300) -> list[MessageRecord]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return fetch_messages(db_path, since=since, limit=limit)
