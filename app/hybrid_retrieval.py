from __future__ import annotations

import math
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.embeddings import EmbeddingService, vector_from_json
from app.links import build_message_link
from app.query_understanding import QueryIntent, detect_intent
from app.rerank import rerank_score
from app.retrieval import retrieve_messages


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HybridCandidate:
    chat_id: int
    msg_id: int
    chat_title: str
    chat_username: str | None
    text: str
    date_utc: str
    link: str
    keyword_score: float
    semantic_score: float
    importance_score: float
    recency_score: float
    rerank_score: float
    final_score: float


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _parse_date(date_iso: str) -> datetime:
    return datetime.fromisoformat(date_iso)


def _recency_score(date_iso: str) -> float:
    dt = _parse_date(date_iso)
    age_days = max((datetime.now(timezone.utc) - dt).total_seconds() / 86400, 0)
    if age_days < 2:
        return 1.0
    if age_days < 7:
        return 0.7
    if age_days < 30:
        return 0.4
    return 0.15


def _importance_score(text: str) -> float:
    lowered = text.lower()
    score = 0.0
    if len(lowered) > 160:
        score += 0.5
    if any(x in lowered for x in ["дедлайн", "встреч", "оплат", "контракт", "налог", "поставка"]):
        score += 1.2
    if "http://" in lowered or "https://" in lowered:
        score += 0.5
    return score


def retrieve_hybrid(
    db,
    embedding_service: EmbeddingService,
    query: str,
    period: str,
    chat_ids: list[int] | None,
    top_n: int = 40,
) -> tuple[list[HybridCandidate], QueryIntent, dict[str, int]]:
    intent = detect_intent(query)

    from app.retrieval import period_to_since

    since = period_to_since(period)
    since_soft = since - timedelta(days=90)

    lexical_rows = db.fetch_messages_for_period(since.isoformat(), chat_ids=chat_ids, limit=3000)
    lexical_candidates = retrieve_messages(lexical_rows, " ".join(intent.expanded_terms), top_n=200)
    lexical_map = {(c.chat_id, c.msg_id): c.score for c in lexical_candidates}

    query_vector = embedding_service.embed_text(intent.normalized_query).vector
    semantic_rows = db.fetch_semantic_candidates(
        embedding_model=embedding_service.model,
        chat_ids=chat_ids,
        since_iso=since_soft.isoformat(),
        limit=4000,
    )

    fused: dict[tuple[int, int], HybridCandidate] = {}

    for row in semantic_rows:
        try:
            vector = vector_from_json(row["embedding_vector"])
        except Exception:
            continue
        sem = _cosine(query_vector, vector)
        if sem < 0.15:
            continue
        key = (int(row["chat_id"]), int(row["msg_id"]))
        text = (row["text"] or "").strip()
        if not text:
            continue
        keyword = lexical_map.get(key, 0.0)
        importance = _importance_score(text)
        recency = _recency_score(row["date_utc"])
        rr = rerank_score(text, intent)
        final = (keyword * 0.35) + (sem * 4.0 * 0.4) + (importance * 0.15) + (recency * 0.05) + (rr * 0.05)
        fused[key] = HybridCandidate(
            chat_id=key[0],
            msg_id=key[1],
            chat_title=row["chat_title"],
            chat_username=row["chat_username"],
            text=text,
            date_utc=row["date_utc"],
            link=build_message_link(key[0], row["chat_username"], key[1]),
            keyword_score=keyword,
            semantic_score=sem,
            importance_score=importance,
            recency_score=recency,
            rerank_score=rr,
            final_score=final,
        )

    for item in lexical_candidates:
        key = (item.chat_id, item.msg_id)
        if key in fused:
            continue
        rr = rerank_score(item.text, intent)
        final = (item.score * 0.55) + (_importance_score(item.text) * 0.25) + (_recency_score(item.date_utc) * 0.1) + (rr * 0.1)
        fused[key] = HybridCandidate(
            chat_id=item.chat_id,
            msg_id=item.msg_id,
            chat_title=item.chat_title,
            chat_username=item.chat_username,
            text=item.text,
            date_utc=item.date_utc,
            link=item.link,
            keyword_score=item.score,
            semantic_score=0.0,
            importance_score=_importance_score(item.text),
            recency_score=_recency_score(item.date_utc),
            rerank_score=rr,
            final_score=final,
        )

    ranked = sorted(fused.values(), key=lambda x: x.final_score, reverse=True)[:top_n]
    stats = {
        "lexical_candidates": len(lexical_candidates),
        "semantic_candidates": len(semantic_rows),
        "fused_candidates": len(fused),
        "selected": len(ranked),
    }
    logger.info("Hybrid retrieval stats: %s", stats)
    return ranked, intent, stats


def build_hybrid_context(candidates: list[HybridCandidate], max_chars: int = 12000) -> tuple[str, list[HybridCandidate]]:
    parts: list[str] = []
    selected: list[HybridCandidate] = []
    total = 0
    for idx, c in enumerate(candidates, start=1):
        block = (
            f"[{idx}] date={c.date_utc} chat={c.chat_title} chat_id={c.chat_id} score={c.final_score:.3f}\n"
            f"text={c.text}\n"
            f"link={c.link}\n"
        )
        if total + len(block) > max_chars:
            break
        parts.append(block)
        selected.append(c)
        total += len(block)
    return "\n".join(parts), selected
