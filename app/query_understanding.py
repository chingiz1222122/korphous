from __future__ import annotations

from dataclasses import dataclass


INTENT_TERMS = {
    "events": ["мероприят", "встреч", "конференц", "вебинар", "анонс", "эфир"],
    "deadlines": ["дедлайн", "срок", "до", "сегодня", "завтра"],
    "finance": ["оплат", "деньг", "бюджет", "скидк", "стоим"],
    "legal": ["налог", "закон", "прав", "договор", "контракт"],
    "logistics": ["поставк", "китай", "china", "логист", "wb", "склад"],
}


@dataclass(frozen=True)
class QueryIntent:
    normalized_query: str
    intents: list[str]
    expanded_terms: list[str]


def detect_intent(query: str) -> QueryIntent:
    q = query.lower().strip()
    intents: list[str] = []
    expanded: set[str] = set()
    for intent, terms in INTENT_TERMS.items():
        if any(term in q for term in terms):
            intents.append(intent)
            expanded.update(terms)
    expanded.update(query.lower().split())
    return QueryIntent(normalized_query=q, intents=intents, expanded_terms=sorted(expanded))
