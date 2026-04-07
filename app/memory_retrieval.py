from __future__ import annotations

from app.db import Database
from app.links import build_message_link


def resolve_entity(db: Database, name: str):
    matches = db.search_entities(name, limit=5)
    return matches


def build_entity_summary(db: Database, entity_row) -> str:
    timeline = db.get_entity_timeline(entity_row["entity_id"], limit=10)
    neighbors = db.get_entity_neighbors(entity_row["entity_id"], limit=8)
    lines = [
        f"Сущность: {entity_row['canonical_name']} ({entity_row['entity_type']})",
        f"Aliases: {entity_row['aliases'] or '—'}",
        f"Confidence: {entity_row['confidence']}",
        "",
        "Timeline:",
    ]
    if timeline:
        for item in timeline:
            link = build_message_link(item["chat_id"], None, item["msg_id"])
            lines.append(f"- [{item['event_type']}] {item['summary'][:120]}")
            lines.append(f"  {link}")
    else:
        lines.append("- Нет событий")

    lines.append("")
    lines.append("Связанные сущности:")
    if neighbors:
        for n in neighbors:
            lines.append(f"- {n['canonical_name']} ({n['entity_type']}) w={n['weight']:.2f}")
    else:
        lines.append("- Нет связей")
    return "\n".join(lines)
