from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class ChatRecord:
    chat_id: int
    title: str
    username: str | None
    chat_type: str
    enabled: bool
    updated_at: str


@dataclass(frozen=True)
class MessageRecord:
    chat_id: int
    msg_id: int
    date_utc: str
    sender_id: int | None
    text: str
    raw_json: str | None
    created_at: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(
        self,
        db_path: Path,
        lock_retry_attempts: int = 5,
        lock_retry_delay_seconds: float = 0.2,
    ) -> None:
        self.db_path = db_path
        self.lock_retry_attempts = lock_retry_attempts
        self.lock_retry_delay_seconds = lock_retry_delay_seconds

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
        finally:
            conn.close()

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.execute("BEGIN")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chats (
                    chat_id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    username TEXT,
                    chat_type TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    chat_id INTEGER NOT NULL,
                    msg_id INTEGER NOT NULL,
                    date_utc TEXT NOT NULL,
                    sender_id INTEGER,
                    text TEXT NOT NULL,
                    raw_json TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (chat_id, msg_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chats_enabled ON chats(enabled, chat_type)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date_utc DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, date_utc DESC)"
            )
            conn.execute("COMMIT")

    def _execute_with_retry(self, conn: sqlite3.Connection, query: str, params: tuple = ()) -> sqlite3.Cursor:
        last_error: Exception | None = None
        for attempt in range(1, self.lock_retry_attempts + 1):
            try:
                return conn.execute(query, params)
            except sqlite3.OperationalError as exc:
                last_error = exc
                if "database is locked" not in str(exc).lower() or attempt == self.lock_retry_attempts:
                    raise
                time.sleep(self.lock_retry_delay_seconds * attempt)
        if last_error:
            raise last_error
        raise RuntimeError("Unexpected retry failure")

    def upsert_chat(self, chat_id: int, title: str, username: str | None, chat_type: str, enabled: bool = False) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO chats (chat_id, title, username, chat_type, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET
                    title=excluded.title,
                    username=excluded.username,
                    chat_type=excluded.chat_type,
                    updated_at=excluded.updated_at
                """,
                (chat_id, title, username, chat_type, int(enabled), utc_now_iso()),
            )

    def list_chats(self) -> list[ChatRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT chat_id, title, username, chat_type, enabled, updated_at FROM chats ORDER BY title"
            ).fetchall()
        return [
            ChatRecord(
                chat_id=row["chat_id"],
                title=row["title"],
                username=row["username"],
                chat_type=row["chat_type"],
                enabled=bool(row["enabled"]),
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def is_chat_enabled(self, chat_id: int) -> bool:
        with self.connect() as conn:
            row = conn.execute("SELECT enabled FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        return bool(row["enabled"]) if row else False

    def get_enabled_chat_ids(self) -> set[int]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT chat_id FROM chats WHERE enabled = 1"
            ).fetchall()
        return {int(row["chat_id"]) for row in rows}

    def set_chat_enabled(self, chat_id: int, enabled: bool) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                "UPDATE chats SET enabled = ?, updated_at = ? WHERE chat_id = ?",
                (int(enabled), utc_now_iso(), chat_id),
            )

    def save_message(
        self,
        chat_id: int,
        msg_id: int,
        date_utc: datetime,
        sender_id: int | None,
        text: str,
        raw_json: dict | None,
    ) -> bool:
        raw_payload = json.dumps(raw_json, ensure_ascii=False) if raw_json is not None else None
        with self.connect() as conn:
            cursor = self._execute_with_retry(
                conn,
                """
                INSERT OR IGNORE INTO messages
                (chat_id, msg_id, date_utc, sender_id, text, raw_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chat_id,
                    msg_id,
                    date_utc.astimezone(timezone.utc).isoformat(),
                    sender_id,
                    text,
                    raw_payload,
                    utc_now_iso(),
                ),
            )
        return cursor.rowcount > 0

    def set_state(self, key: str, value: str) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO state(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value,
                    updated_at=excluded.updated_at
                """,
                (key, value, utc_now_iso()),
            )

    def get_state(self, key: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def ingestion_stats(self) -> dict[str, int]:
        with self.connect() as conn:
            chats_total = conn.execute("SELECT COUNT(*) AS n FROM chats").fetchone()["n"]
            chats_enabled = conn.execute("SELECT COUNT(*) AS n FROM chats WHERE enabled = 1").fetchone()["n"]
            messages_total = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
        return {
            "chats_total": int(chats_total),
            "chats_enabled": int(chats_enabled),
            "messages_total": int(messages_total),
        }
