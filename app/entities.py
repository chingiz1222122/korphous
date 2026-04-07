from __future__ import annotations

import re
from dataclasses import dataclass

from app.entity_resolution import canonicalize_entity


@dataclass(frozen=True)
class ExtractedEntity:
    entity_type: str
    canonical_name: str
    mention_text: str
    mention_role: str | None = None


ENTITY_PATTERNS = {
    "project": [r"\bпроект\s+([a-zA-Zа-яА-Я0-9_\- ]{2,40})", r"\bинициатив[аы]\s+([a-zA-Zа-яА-Я0-9_\- ]{2,40})"],
    "event": [r"\b(встреча|созвон|вебинар|выставка|конференция|командировка)\b"],
    "object": [r"\bSKU\s*([A-Za-z0-9_-]{2,20})\b", r"\bконтракт\s*([A-Za-z0-9_-]{2,30})\b", r"\binvoice\s*([A-Za-z0-9_-]{2,30})\b"],
    "topic": [r"\b(налог[аи]?|wb|china|логистик[аеи]?|закупк[аи]?|hr|legal|cashflow)\b"],
    "decision": [r"\b(решили|решение|todo|next step|follow[- ]?up|блокер|риск)\b"],
}


def extract_entities(text: str) -> list[ExtractedEntity]:
    found: list[ExtractedEntity] = []
    if not text.strip():
        return found
    lowered = text.lower()

    person_candidates = re.findall(r"\b[A-ZА-ЯЁ][a-zа-яё]{2,}\b", text)
    for name in person_candidates[:5]:
        canonical = canonicalize_entity(name)
        if canonical:
            found.append(ExtractedEntity("person", canonical, name))

    for entity_type, patterns in ENTITY_PATTERNS.items():
        for pattern in patterns:
            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                mention = match.group(1) if match.groups() else match.group(0)
                canonical = canonicalize_entity(mention)
                if canonical:
                    role = "signal" if entity_type in {"decision", "event"} else None
                    found.append(ExtractedEntity(entity_type, canonical, mention, role))

    uniq: dict[tuple[str, str], ExtractedEntity] = {}
    for entity in found:
        uniq[(entity.entity_type, entity.canonical_name)] = entity
    return list(uniq.values())
