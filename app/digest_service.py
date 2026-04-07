from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from app.db import Database
from app.hybrid_retrieval import build_hybrid_context, retrieve_hybrid
from app.llm import LlmService
from app.retrieval import period_to_since


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DigestResult:
    text: str
    cache_hit: bool
    input_signature: str
    selected_count: int


def _signature_from_rows(rows, query: str | None, period: str) -> str:
    chunks = [period, query or ""]
    for row in rows[:800]:
        chunks.append(f"{row['chat_id']}:{row['msg_id']}")
    payload = "|".join(chunks)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _scope_to_cache_key(scope_type: str, scope_value: str | None, period: str, query: str | None) -> str:
    return f"digest:{scope_type}:{scope_value or '-'}:{period}:{(query or '').strip().lower()}"


def make_digest(
    db: Database,
    llm: LlmService,
    embedding_service,
    scope_type: str,
    scope_value: str | None,
    period: str,
    query: str | None,
    force: bool = False,
) -> DigestResult:
    since = period_to_since(period).isoformat()
    if scope_type == "single_chat":
        if scope_value is None:
            raise ValueError("scope_value is required for single_chat")
        chat_ids = [int(scope_value)]
    else:
        chat_ids = sorted(db.get_enabled_chat_ids())

    rows = db.fetch_messages_for_period(since_iso=since, chat_ids=chat_ids, limit=3000)
    if not rows:
        return DigestResult(
            text="Нового важного нет: за выбранный период не найдено сообщений.",
            cache_hit=True,
            input_signature="no_data",
            selected_count=0,
        )

    retrieval_query = query or "важное события дедлайн встреча оплата закон налог поставка"
    retrieved, _, hstats = retrieve_hybrid(
        db=db,
        embedding_service=embedding_service,
        query=retrieval_query,
        period=period,
        chat_ids=chat_ids,
        top_n=55,
    )
    if not retrieved:
        return DigestResult(
            text="Нового важного нет: релевантных сообщений не найдено.",
            cache_hit=True,
            input_signature="no_relevant",
            selected_count=0,
        )

    context_text, selected_items = build_hybrid_context(retrieved)
    input_signature = _signature_from_rows(rows, query, period)
    cache_key = _scope_to_cache_key(scope_type, scope_value, period, query)

    if not force:
        cached = db.get_summary_cache(cache_key, input_signature)
        if cached:
            logger.info("Digest cache hit: key=%s", cache_key)
            return DigestResult(
                text=cached,
                cache_hit=True,
                input_signature=input_signature,
                selected_count=len(selected_items),
            )

    logger.info("Digest hybrid stats: %s", hstats)
    result = llm.make_digest(query, context_text, len(selected_items))
    source_indexes = result.source_indexes or list(range(1, min(len(selected_items), 6) + 1))
    sources = ["Источники:"]
    for idx in source_indexes[:8]:
        item = selected_items[idx - 1]
        sources.append(f"{idx}. {item.chat_title}")
        sources.append(item.link)

    final_text = f"{result.text}\n\n" + "\n".join(sources)
    db.upsert_summary_cache(
        cache_key=cache_key,
        scope_type=scope_type,
        scope_value=scope_value,
        period=period,
        summary_type="digest",
        input_signature=input_signature,
        summary_text=final_text,
    )
    return DigestResult(
        text=final_text,
        cache_hit=False,
        input_signature=input_signature,
        selected_count=len(selected_items),
    )
