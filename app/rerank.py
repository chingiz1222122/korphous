from __future__ import annotations

from app.query_understanding import QueryIntent


def rerank_score(text: str, intent: QueryIntent) -> float:
    lowered = text.lower()
    score = 0.0
    for token in intent.expanded_terms:
        if len(token) > 2 and token in lowered:
            score += 0.4
    for tag in intent.intents:
        if tag == "deadlines" and any(x in lowered for x in ["срок", "дедлайн", "до "]):
            score += 1.2
        if tag == "finance" and any(x in lowered for x in ["оплата", "сумм", "стоим"]):
            score += 1.0
        if tag == "legal" and any(x in lowered for x in ["налог", "закон", "контракт"]):
            score += 1.0
        if tag == "logistics" and any(x in lowered for x in ["постав", "китай", "wb", "склад"]):
            score += 1.0
    return score
