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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS summary_cache (
                    cache_key TEXT PRIMARY KEY,
                    scope_type TEXT NOT NULL,
                    scope_value TEXT,
                    period TEXT NOT NULL,
                    summary_type TEXT NOT NULL,
                    input_signature TEXT NOT NULL,
                    summary_text TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_summary_cache_updated ON summary_cache(updated_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS digest_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scope_type TEXT NOT NULL,
                    scope_value TEXT,
                    period TEXT NOT NULL,
                    input_signature TEXT NOT NULL,
                    digest_text TEXT NOT NULL,
                    sent_by TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_digest_history_created ON digest_history(created_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS llm_request_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_type TEXT NOT NULL,
                    scope_type TEXT NOT NULL,
                    scope_value TEXT,
                    period TEXT NOT NULL,
                    input_signature TEXT,
                    selected_messages INTEGER NOT NULL,
                    success INTEGER NOT NULL,
                    error_text TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS message_embeddings (
                    chat_id INTEGER NOT NULL,
                    msg_id INTEGER NOT NULL,
                    embedding_model TEXT NOT NULL,
                    embedding_vector TEXT NOT NULL,
                    text_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(chat_id, msg_id, embedding_model)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_message_embeddings_model ON message_embeddings(embedding_model)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS entities (
                    entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL,
                    canonical_name TEXT NOT NULL,
                    aliases TEXT,
                    confidence REAL NOT NULL DEFAULT 0.5,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(entity_type, canonical_name)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(entity_type, canonical_name)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS entity_mentions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_id INTEGER NOT NULL,
                    chat_id INTEGER NOT NULL,
                    msg_id INTEGER NOT NULL,
                    mention_text TEXT NOT NULL,
                    mention_role TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(entity_id, chat_id, msg_id, mention_text)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id, created_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS relationships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_entity_id INTEGER NOT NULL,
                    relation_type TEXT NOT NULL,
                    target_entity_id INTEGER NOT NULL,
                    weight REAL NOT NULL DEFAULT 1.0,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    UNIQUE(source_entity_id, relation_type, target_entity_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id, weight DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS timelines (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    event_time TEXT,
                    chat_id INTEGER NOT NULL,
                    msg_id INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_timelines_entity_time ON timelines(entity_id, event_time DESC, created_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS workflows (
                    workflow_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_type TEXT NOT NULL,
                    entity_id INTEGER,
                    current_stage TEXT NOT NULL,
                    status TEXT NOT NULL,
                    last_update_at TEXT NOT NULL,
                    due_at TEXT,
                    risk_level TEXT NOT NULL DEFAULT 'low',
                    owner TEXT NOT NULL DEFAULT 'owner',
                    next_action TEXT,
                    source_message_refs TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(workflow_type, entity_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_workflows_risk ON workflows(risk_level, status, due_at)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS workflow_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    event_time TEXT,
                    chat_id INTEGER NOT NULL,
                    msg_id INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_workflow_events_wf ON workflow_events(workflow_id, created_at DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS workflow_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_id INTEGER NOT NULL,
                    alert_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    suggested_action TEXT,
                    cooldown_key TEXT NOT NULL,
                    last_sent_at TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_workflow_alerts_severity ON workflow_alerts(severity, created_at DESC)"
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

    def find_chats(self, query: str, limit: int = 30) -> list[ChatRecord]:
        pattern = f"%{query.lower()}%"
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT chat_id, title, username, chat_type, enabled, updated_at
                FROM chats
                WHERE lower(title) LIKE ?
                   OR lower(COALESCE(username, '')) LIKE ?
                   OR CAST(chat_id AS TEXT) LIKE ?
                ORDER BY enabled DESC, title
                LIMIT ?
                """,
                (pattern, pattern, pattern, limit),
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

    def get_chat(self, chat_id: int) -> ChatRecord | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT chat_id, title, username, chat_type, enabled, updated_at FROM chats WHERE chat_id = ?",
                (chat_id,),
            ).fetchone()
        if row is None:
            return None
        return ChatRecord(
            chat_id=row["chat_id"],
            title=row["title"],
            username=row["username"],
            chat_type=row["chat_type"],
            enabled=bool(row["enabled"]),
            updated_at=row["updated_at"],
        )

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

    def top_enabled_chat_message_counts(self, limit: int = 10) -> list[tuple[int, str, int]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT c.chat_id, c.title, COUNT(m.msg_id) AS msg_count
                FROM chats c
                LEFT JOIN messages m ON m.chat_id = c.chat_id
                WHERE c.enabled = 1
                GROUP BY c.chat_id, c.title
                ORDER BY msg_count DESC, c.title
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [(int(row["chat_id"]), row["title"], int(row["msg_count"])) for row in rows]

    def last_message_time_utc(self) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT MAX(date_utc) AS last_time FROM messages").fetchone()
        return row["last_time"] if row and row["last_time"] else None

    def fetch_messages_for_period(
        self,
        since_iso: str,
        chat_ids: list[int] | None = None,
        limit: int = 2000,
    ) -> list[sqlite3.Row]:
        with self.connect() as conn:
            if chat_ids:
                placeholders = ",".join(["?"] * len(chat_ids))
                rows = conn.execute(
                    f"""
                    SELECT
                        m.chat_id,
                        m.msg_id,
                        m.date_utc,
                        m.sender_id,
                        m.text,
                        m.raw_json,
                        c.title AS chat_title,
                        c.username AS chat_username,
                        c.chat_type AS chat_type
                    FROM messages m
                    JOIN chats c ON c.chat_id = m.chat_id
                    WHERE m.date_utc >= ?
                      AND m.chat_id IN ({placeholders})
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (since_iso, *chat_ids, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT
                        m.chat_id,
                        m.msg_id,
                        m.date_utc,
                        m.sender_id,
                        m.text,
                        m.raw_json,
                        c.title AS chat_title,
                        c.username AS chat_username,
                        c.chat_type AS chat_type
                    FROM messages m
                    JOIN chats c ON c.chat_id = m.chat_id
                    WHERE m.date_utc >= ?
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (since_iso, limit),
                ).fetchall()
        return rows

    def update_heartbeat(self, component: str) -> None:
        self.set_state(f"{component}_last_seen_utc", str(int(time.time())))

    def get_heartbeat(self, component: str) -> str | None:
        return self.get_state(f"{component}_last_seen_utc")

    def get_summary_cache(self, cache_key: str, input_signature: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT summary_text FROM summary_cache
                WHERE cache_key = ? AND input_signature = ?
                """,
                (cache_key, input_signature),
            ).fetchone()
        if row is None:
            return None
        self.touch_summary_cache(cache_key)
        return row["summary_text"]

    def touch_summary_cache(self, cache_key: str) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                "UPDATE summary_cache SET last_used_at = ? WHERE cache_key = ?",
                (utc_now_iso(), cache_key),
            )

    def upsert_summary_cache(
        self,
        cache_key: str,
        scope_type: str,
        scope_value: str | None,
        period: str,
        summary_type: str,
        input_signature: str,
        summary_text: str,
    ) -> None:
        now = utc_now_iso()
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO summary_cache(
                    cache_key, scope_type, scope_value, period, summary_type,
                    input_signature, summary_text, created_at, updated_at, last_used_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    input_signature=excluded.input_signature,
                    summary_text=excluded.summary_text,
                    updated_at=excluded.updated_at,
                    last_used_at=excluded.last_used_at
                """,
                (
                    cache_key,
                    scope_type,
                    scope_value,
                    period,
                    summary_type,
                    input_signature,
                    summary_text,
                    now,
                    now,
                    now,
                ),
            )

    def record_digest(
        self,
        scope_type: str,
        scope_value: str | None,
        period: str,
        input_signature: str,
        digest_text: str,
        sent_by: str,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO digest_history(scope_type, scope_value, period, input_signature, digest_text, sent_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (scope_type, scope_value, period, input_signature, digest_text, sent_by, utc_now_iso()),
            )
        self.set_state("last_digest_time_utc", str(int(time.time())))

    def get_last_digest(self) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT scope_type, scope_value, period, input_signature, digest_text, sent_by, created_at
                FROM digest_history
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()

    def count_summary_cache(self) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS n FROM summary_cache").fetchone()
        return int(row["n"])

    def log_llm_request(
        self,
        request_type: str,
        scope_type: str,
        scope_value: str | None,
        period: str,
        input_signature: str | None,
        selected_messages: int,
        success: bool,
        error_text: str | None = None,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO llm_request_log(
                    request_type, scope_type, scope_value, period,
                    input_signature, selected_messages, success, error_text, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    request_type,
                    scope_type,
                    scope_value,
                    period,
                    input_signature,
                    selected_messages,
                    int(success),
                    error_text,
                    utc_now_iso(),
                ),
            )
        if success:
            self.set_state("last_llm_success_utc", str(int(time.time())))

    def get_last_llm_call(self) -> sqlite3.Row | None:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT request_type, scope_type, scope_value, period, success, error_text, created_at
                FROM llm_request_log
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()

    def upsert_message_embedding(
        self,
        chat_id: int,
        msg_id: int,
        embedding_model: str,
        embedding_vector: str,
        text_hash: str,
    ) -> None:
        now = utc_now_iso()
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO message_embeddings(
                    chat_id, msg_id, embedding_model, embedding_vector, text_hash, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chat_id, msg_id, embedding_model) DO UPDATE SET
                    embedding_vector=excluded.embedding_vector,
                    text_hash=excluded.text_hash,
                    updated_at=excluded.updated_at
                """,
                (chat_id, msg_id, embedding_model, embedding_vector, text_hash, now, now),
            )

    def fetch_messages_for_embedding(
        self,
        since_iso: str,
        embedding_model: str,
        limit: int = 200,
        chat_id: int | None = None,
    ) -> list[sqlite3.Row]:
        with self.connect() as conn:
            if chat_id is None:
                rows = conn.execute(
                    """
                    SELECT m.chat_id, m.msg_id, m.text
                    FROM messages m
                    LEFT JOIN message_embeddings e
                      ON e.chat_id = m.chat_id
                     AND e.msg_id = m.msg_id
                     AND e.embedding_model = ?
                    WHERE m.date_utc >= ?
                      AND length(trim(m.text)) >= 20
                      AND e.chat_id IS NULL
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (embedding_model, since_iso, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT m.chat_id, m.msg_id, m.text
                    FROM messages m
                    LEFT JOIN message_embeddings e
                      ON e.chat_id = m.chat_id
                     AND e.msg_id = m.msg_id
                     AND e.embedding_model = ?
                    WHERE m.date_utc >= ?
                      AND m.chat_id = ?
                      AND length(trim(m.text)) >= 20
                      AND e.chat_id IS NULL
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (embedding_model, since_iso, chat_id, limit),
                ).fetchall()
        return rows

    def fetch_semantic_candidates(
        self,
        embedding_model: str,
        chat_ids: list[int] | None,
        since_iso: str,
        limit: int = 3000,
    ) -> list[sqlite3.Row]:
        with self.connect() as conn:
            if chat_ids:
                placeholders = ",".join(["?"] * len(chat_ids))
                rows = conn.execute(
                    f"""
                    SELECT
                        m.chat_id, m.msg_id, m.text, m.date_utc,
                        c.title AS chat_title, c.username AS chat_username,
                        e.embedding_vector
                    FROM message_embeddings e
                    JOIN messages m ON m.chat_id = e.chat_id AND m.msg_id = e.msg_id
                    JOIN chats c ON c.chat_id = m.chat_id
                    WHERE e.embedding_model = ?
                      AND m.date_utc >= ?
                      AND m.chat_id IN ({placeholders})
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (embedding_model, since_iso, *chat_ids, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT
                        m.chat_id, m.msg_id, m.text, m.date_utc,
                        c.title AS chat_title, c.username AS chat_username,
                        e.embedding_vector
                    FROM message_embeddings e
                    JOIN messages m ON m.chat_id = e.chat_id AND m.msg_id = e.msg_id
                    JOIN chats c ON c.chat_id = m.chat_id
                    WHERE e.embedding_model = ?
                      AND m.date_utc >= ?
                    ORDER BY m.date_utc DESC
                    LIMIT ?
                    """,
                    (embedding_model, since_iso, limit),
                ).fetchall()
        return rows

    def get_or_create_entity(self, entity_type: str, canonical_name: str, alias: str | None = None, confidence: float = 0.6) -> int:
        now = utc_now_iso()
        aliases = alias or canonical_name
        with self.connect() as conn:
            row = conn.execute(
                "SELECT entity_id, aliases FROM entities WHERE entity_type = ? AND canonical_name = ?",
                (entity_type, canonical_name),
            ).fetchone()
            if row:
                existing_aliases = row["aliases"] or ""
                if alias and alias not in existing_aliases.split("|"):
                    new_aliases = f"{existing_aliases}|{alias}" if existing_aliases else alias
                    self._execute_with_retry(
                        conn,
                        "UPDATE entities SET aliases = ?, updated_at = ? WHERE entity_id = ?",
                        (new_aliases, now, row["entity_id"]),
                    )
                return int(row["entity_id"])
            cursor = self._execute_with_retry(
                conn,
                """
                INSERT INTO entities(entity_type, canonical_name, aliases, confidence, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (entity_type, canonical_name, aliases, confidence, now, now),
            )
        return int(cursor.lastrowid)

    def add_entity_mention(
        self,
        entity_id: int,
        chat_id: int,
        msg_id: int,
        mention_text: str,
        mention_role: str | None = None,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT OR IGNORE INTO entity_mentions(entity_id, chat_id, msg_id, mention_text, mention_role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (entity_id, chat_id, msg_id, mention_text, mention_role, utc_now_iso()),
            )

    def upsert_relationship(
        self,
        source_entity_id: int,
        relation_type: str,
        target_entity_id: int,
        seen_at: str,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO relationships(source_entity_id, relation_type, target_entity_id, weight, first_seen, last_seen)
                VALUES (?, ?, ?, 1.0, ?, ?)
                ON CONFLICT(source_entity_id, relation_type, target_entity_id) DO UPDATE SET
                    weight = relationships.weight + 0.2,
                    last_seen = excluded.last_seen
                """,
                (source_entity_id, relation_type, target_entity_id, seen_at, seen_at),
            )

    def add_timeline_event(
        self,
        entity_id: int,
        event_type: str,
        event_time: str | None,
        chat_id: int,
        msg_id: int,
        summary: str,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO timelines(entity_id, event_type, event_time, chat_id, msg_id, summary, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (entity_id, event_type, event_time, chat_id, msg_id, summary, utc_now_iso()),
            )

    def search_entities(self, query: str, limit: int = 20) -> list[sqlite3.Row]:
        pattern = f"%{query.lower()}%"
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT entity_id, entity_type, canonical_name, aliases, confidence, updated_at
                FROM entities
                WHERE lower(canonical_name) LIKE ? OR lower(COALESCE(aliases, '')) LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (pattern, pattern, limit),
            ).fetchall()

    def get_entity_timeline(self, entity_id: int, limit: int = 30) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT event_type, event_time, chat_id, msg_id, summary, created_at
                FROM timelines
                WHERE entity_id = ?
                ORDER BY COALESCE(event_time, created_at) DESC
                LIMIT ?
                """,
                (entity_id, limit),
            ).fetchall()

    def get_entity_neighbors(self, entity_id: int, limit: int = 20) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT r.relation_type, r.weight, e.entity_id, e.entity_type, e.canonical_name
                FROM relationships r
                JOIN entities e ON e.entity_id = r.target_entity_id
                WHERE r.source_entity_id = ?
                ORDER BY r.weight DESC
                LIMIT ?
                """,
                (entity_id, limit),
            ).fetchall()

    def list_entities_by_type(self, entity_type: str, limit: int = 30) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT entity_id, canonical_name, confidence, updated_at
                FROM entities
                WHERE entity_type = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (entity_type, limit),
            ).fetchall()

    def fetch_messages_for_memory(self, since_iso: str, limit: int = 2000) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT chat_id, msg_id, date_utc, text
                FROM messages
                WHERE date_utc >= ?
                ORDER BY date_utc DESC
                LIMIT ?
                """,
                (since_iso, limit),
            ).fetchall()

    def upsert_workflow(
        self,
        workflow_type: str,
        entity_id: int | None,
        current_stage: str,
        status: str,
        last_update_at: str,
        due_at: str | None,
        risk_level: str,
        next_action: str | None,
        source_message_ref: str | None,
    ) -> int:
        now = utc_now_iso()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT workflow_id, source_message_refs FROM workflows WHERE workflow_type = ? AND entity_id IS ?",
                (workflow_type, entity_id),
            ).fetchone()
            if row:
                refs = row["source_message_refs"] or ""
                if source_message_ref and source_message_ref not in refs:
                    refs = f"{refs}|{source_message_ref}" if refs else source_message_ref
                self._execute_with_retry(
                    conn,
                    """
                    UPDATE workflows
                    SET current_stage=?, status=?, last_update_at=?, due_at=?, risk_level=?,
                        next_action=?, source_message_refs=?, updated_at=?
                    WHERE workflow_id=?
                    """,
                    (
                        current_stage,
                        status,
                        last_update_at,
                        due_at,
                        risk_level,
                        next_action,
                        refs,
                        now,
                        row["workflow_id"],
                    ),
                )
                return int(row["workflow_id"])

            cursor = self._execute_with_retry(
                conn,
                """
                INSERT INTO workflows(
                    workflow_type, entity_id, current_stage, status, last_update_at, due_at,
                    risk_level, next_action, source_message_refs, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workflow_type,
                    entity_id,
                    current_stage,
                    status,
                    last_update_at,
                    due_at,
                    risk_level,
                    next_action,
                    source_message_ref,
                    now,
                    now,
                ),
            )
        return int(cursor.lastrowid)

    def add_workflow_event(
        self,
        workflow_id: int,
        event_type: str,
        event_time: str | None,
        chat_id: int,
        msg_id: int,
        summary: str,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO workflow_events(workflow_id, event_type, event_time, chat_id, msg_id, summary, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (workflow_id, event_type, event_time, chat_id, msg_id, summary, utc_now_iso()),
            )

    def add_workflow_alert(
        self,
        workflow_id: int,
        alert_type: str,
        severity: str,
        evidence: str,
        suggested_action: str,
        cooldown_key: str,
    ) -> None:
        with self.connect() as conn:
            self._execute_with_retry(
                conn,
                """
                INSERT INTO workflow_alerts(workflow_id, alert_type, severity, evidence, suggested_action, cooldown_key, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (workflow_id, alert_type, severity, evidence, suggested_action, cooldown_key, utc_now_iso()),
            )

    def list_workflows(self, status: str | None = None, limit: int = 50) -> list[sqlite3.Row]:
        with self.connect() as conn:
            if status:
                return conn.execute(
                    """
                    SELECT workflow_id, workflow_type, entity_id, current_stage, status, last_update_at, due_at, risk_level, next_action
                    FROM workflows
                    WHERE status = ?
                    ORDER BY last_update_at DESC
                    LIMIT ?
                    """,
                    (status, limit),
                ).fetchall()
            return conn.execute(
                """
                SELECT workflow_id, workflow_type, entity_id, current_stage, status, last_update_at, due_at, risk_level, next_action
                FROM workflows
                ORDER BY last_update_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def list_stale_workflows(self, stale_before_iso: str, limit: int = 30) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT workflow_id, workflow_type, entity_id, current_stage, status, last_update_at, due_at, risk_level, next_action
                FROM workflows
                WHERE status != 'closed'
                  AND last_update_at < ?
                ORDER BY last_update_at ASC
                LIMIT ?
                """,
                (stale_before_iso, limit),
            ).fetchall()

    def list_due_workflows(self, due_before_iso: str, limit: int = 30) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT workflow_id, workflow_type, entity_id, current_stage, status, last_update_at, due_at, risk_level, next_action
                FROM workflows
                WHERE status != 'closed'
                  AND due_at IS NOT NULL
                  AND due_at <= ?
                ORDER BY due_at ASC
                LIMIT ?
                """,
                (due_before_iso, limit),
            ).fetchall()

    def list_recent_alerts(self, limit: int = 30) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT workflow_id, alert_type, severity, evidence, suggested_action, created_at
                FROM workflow_alerts
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
