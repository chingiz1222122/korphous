from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    telegram_username TEXT,
    full_name TEXT,
    city_timezone TEXT,
    wb_experience TEXT,
    categories TEXT,
    max_turnover TEXT,
    sku_count TEXT,
    hands_on_tasks TEXT,
    quantified_results TEXT,
    tools TEXT,
    salary_expectation TEXT,
    schedule_confirmation TEXT,
    case_sales_drop TEXT,
    case_low_conversion TEXT,
    score INTEGER,
    verdict TEXT,
    suitable INTEGER,
    strengths TEXT,
    red_flags TEXT,
    summary TEXT,
    recommended_salary TEXT,
    next_step TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
"""


class CandidateRepository:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def create_candidate(self, telegram_user_id: int, telegram_username: str | None) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO candidates(telegram_user_id, telegram_username)
                VALUES (?, ?)
                """,
                (telegram_user_id, telegram_username),
            )
            conn.commit()
            return int(cur.lastrowid)

    def update_answer(self, candidate_id: int, key: str, value: str) -> None:
        if key not in {
            "full_name",
            "city_timezone",
            "wb_experience",
            "categories",
            "max_turnover",
            "sku_count",
            "hands_on_tasks",
            "quantified_results",
            "tools",
            "salary_expectation",
            "schedule_confirmation",
            "case_sales_drop",
            "case_low_conversion",
        }:
            raise ValueError(f"Unexpected answer key: {key}")
        with self._connect() as conn:
            conn.execute(
                f"UPDATE candidates SET {key} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (value, candidate_id),
            )
            conn.commit()

    def save_assessment(self, candidate_id: int, assessment: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE candidates
                SET score = ?,
                    verdict = ?,
                    suitable = ?,
                    strengths = ?,
                    red_flags = ?,
                    summary = ?,
                    recommended_salary = ?,
                    next_step = ?,
                    status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    assessment["score"],
                    assessment["verdict"],
                    1 if assessment["suitable"] else 0,
                    json.dumps(assessment["strengths"], ensure_ascii=False),
                    json.dumps(assessment["red_flags"], ensure_ascii=False),
                    assessment["summary"],
                    assessment["recommended_salary"],
                    assessment["next_step"],
                    "completed",
                    candidate_id,
                ),
            )
            conn.commit()

    def mark_error(self, candidate_id: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE candidates SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (candidate_id,),
            )
            conn.commit()

    def get_candidate(self, candidate_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone()
            return dict(row) if row else None

    def get_last_candidates(self, limit: int = 5) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM candidates ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_stats(self) -> dict[str, int]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errored,
                    SUM(CASE WHEN score >= 70 AND verdict = 'звать на интервью' THEN 1 ELSE 0 END) as strong
                FROM candidates
                """
            ).fetchone()
            return {
                "total": int(row["total"] or 0),
                "completed": int(row["completed"] or 0),
                "errored": int(row["errored"] or 0),
                "strong": int(row["strong"] or 0),
            }
