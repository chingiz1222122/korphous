from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class Question:
    key: str
    text: str
    min_length: int
    hint: str
    is_case: bool = False


@dataclass(slots=True)
class CandidateRecord:
    id: int
    telegram_user_id: int
    telegram_username: str | None
    full_name: str | None
    city_timezone: str | None
    wb_experience: str | None
    categories: str | None
    max_turnover: str | None
    sku_count: str | None
    hands_on_tasks: str | None
    quantified_results: str | None
    tools: str | None
    salary_expectation: str | None
    schedule_confirmation: str | None
    case_sales_drop: str | None
    case_low_conversion: str | None
    score: int | None
    verdict: str | None
    suitable: bool | None
    strengths: str | None
    red_flags: str | None
    summary: str | None
    recommended_salary: str | None
    next_step: str | None
    status: str
    created_at: datetime
    updated_at: datetime


REQUIRED_JSON_KEYS = {
    "score",
    "verdict",
    "suitable",
    "strengths",
    "red_flags",
    "summary",
    "recommended_salary",
    "next_step",
}


def validate_assessment(payload: dict[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_JSON_KEYS - payload.keys()
    if missing:
        raise ValueError(f"Assessment missing keys: {', '.join(sorted(missing))}")
    score = int(payload["score"])
    if score < 0 or score > 100:
        raise ValueError("Score must be 0..100")
    verdict = str(payload["verdict"]).strip().lower()
    if verdict not in {"отказать", "сомнительно", "звать на интервью"}:
        raise ValueError("Unexpected verdict")
    suitable = bool(payload["suitable"])
    strengths = payload["strengths"] if isinstance(payload["strengths"], list) else []
    red_flags = payload["red_flags"] if isinstance(payload["red_flags"], list) else []
    return {
        "score": score,
        "verdict": verdict,
        "suitable": suitable,
        "strengths": [str(v) for v in strengths],
        "red_flags": [str(v) for v in red_flags],
        "summary": str(payload["summary"]),
        "recommended_salary": str(payload["recommended_salary"]),
        "next_step": str(payload["next_step"]),
    }
