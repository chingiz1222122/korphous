from __future__ import annotations

import datetime as dt
from typing import Iterable, List

from telegram_mvp.db import MessageRecord, MessageStore


def _filter_messages(
    messages: Iterable[MessageRecord],
    keywords: List[str],
) -> List[MessageRecord]:
    if not keywords:
        return list(messages)
    lowered = [kw.lower() for kw in keywords]
    filtered: List[MessageRecord] = []
    for message in messages:
        text = message.text.lower()
        if any(keyword in text for keyword in lowered):
            filtered.append(message)
    return filtered


def build_summary(
    store: MessageStore,
    hours: int,
    keywords: List[str],
) -> List[MessageRecord]:
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    messages = store.fetch_recent_messages(since.isoformat())
    return _filter_messages(messages, keywords)


def format_summary(messages: List[MessageRecord]) -> str:
    if not messages:
        return "За период сообщений по фильтрам не найдено."
    lines = ["Сводка важных сообщений:"]
    for message in messages:
        excerpt = message.text.strip().replace("\n", " ")
        if len(excerpt) > 160:
            excerpt = f"{excerpt[:157]}..."
        lines.append(f"- {excerpt} ({message.permalink})")
    return "\n".join(lines)
