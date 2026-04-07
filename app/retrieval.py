from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.links import build_message_link


IMPORTANT_TERMS = {
    "мероприятие",
    "встреча",
    "вебинар",
    "дедлайн",
    "сегодня",
    "завтра",
    "регистрация",
    "закон",
    "налог",
    "скидка",
    "оплата",
    "поставка",
    "контракт",
    "конференция",
    "прямой",
    "эфир",
}


@dataclass(frozen=True)
class RetrievedMessage:
    chat_id: int
    msg_id: int
    date_utc: str
    text: str
    chat_title: str
    chat_username: str | None
    score: float
    link: str


def period_to_since(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "24h":
        return now - timedelta(hours=24)
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    return now - timedelta(hours=24)


def tokenize(text: str) -> list[str]:
    return [token for token in re.findall(r"[\wа-яА-ЯёЁ]{3,}", text.lower()) if token]


def _message_score(message_text: str, query_tokens: set[str]) -> float:
    text = message_text.lower()
    tokens = set(tokenize(text))

    score = 0.0
    if query_tokens:
        overlap = tokens.intersection(query_tokens)
        score += len(overlap) * 4.0

    important_hits = len([term for term in IMPORTANT_TERMS if term in text])
    score += important_hits * 2.5

    if re.search(r"\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b", text):
        score += 1.2
    if re.search(r"\b\d{1,2}:\d{2}\b", text):
        score += 1.0
    if "http://" in text or "https://" in text:
        score += 1.0
    if len(text) > 200:
        score += 1.0

    return score


def retrieve_messages(
    rows,
    query: str,
    top_n: int = 40,
) -> list[RetrievedMessage]:
    query_tokens = set(tokenize(query))
    result: list[RetrievedMessage] = []

    for row in rows:
        text = (row["text"] or "").strip()
        if len(text) < 2:
            continue
        score = _message_score(text, query_tokens)
        if score <= 0 and query_tokens:
            continue
        result.append(
            RetrievedMessage(
                chat_id=int(row["chat_id"]),
                msg_id=int(row["msg_id"]),
                date_utc=row["date_utc"],
                text=text,
                chat_title=row["chat_title"],
                chat_username=row["chat_username"],
                score=score,
                link=build_message_link(int(row["chat_id"]), row["chat_username"], int(row["msg_id"])),
            )
        )

    result.sort(key=lambda item: item.score, reverse=True)
    return result[:top_n]


def build_context(items: list[RetrievedMessage], max_chars: int = 12000) -> tuple[str, list[RetrievedMessage]]:
    chunks: list[str] = []
    selected: list[RetrievedMessage] = []
    total = 0

    for idx, item in enumerate(items, start=1):
        block = (
            f"[{idx}] date={item.date_utc} chat={item.chat_title} chat_id={item.chat_id}\n"
            f"text={item.text}\n"
            f"link={item.link}\n"
        )
        if total + len(block) > max_chars:
            break
        chunks.append(block)
        selected.append(item)
        total += len(block)

    return "\n".join(chunks), selected
