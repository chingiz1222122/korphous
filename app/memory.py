from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.db import Database
from app.entities import extract_entities
from app.timelines import extract_event_time, infer_event_type
from app.workflows import detect_workflow_signal


logger = logging.getLogger(__name__)


def process_message_for_memory(db: Database, chat_id: int, msg_id: int, date_utc: str, text: str) -> int:
    entities = extract_entities(text)
    if not entities:
        return 0

    entity_ids: list[int] = []
    for entity in entities:
        entity_id = db.get_or_create_entity(entity.entity_type, entity.canonical_name, alias=entity.mention_text)
        db.add_entity_mention(entity_id, chat_id, msg_id, entity.mention_text, entity.mention_role)
        db.add_timeline_event(
            entity_id=entity_id,
            event_type=infer_event_type(text),
            event_time=extract_event_time(text),
            chat_id=chat_id,
            msg_id=msg_id,
            summary=text[:240],
        )
        entity_ids.append(entity_id)

    for i in range(len(entity_ids)):
        for j in range(i + 1, len(entity_ids)):
            db.upsert_relationship(entity_ids[i], "co_mentioned_with", entity_ids[j], date_utc)
            db.upsert_relationship(entity_ids[j], "co_mentioned_with", entity_ids[i], date_utc)

    signal = detect_workflow_signal(text)
    if signal:
        primary_entity_id = entity_ids[0] if entity_ids else None
        workflow_id = db.upsert_workflow(
            workflow_type=signal.workflow_type,
            entity_id=primary_entity_id,
            current_stage=signal.stage,
            status=signal.status,
            last_update_at=date_utc,
            due_at=signal.due_at,
            risk_level=signal.risk_level,
            next_action=signal.next_action,
            source_message_ref=f"{chat_id}:{msg_id}",
        )
        db.add_workflow_event(
            workflow_id=workflow_id,
            event_type=signal.stage,
            event_time=extract_event_time(text),
            chat_id=chat_id,
            msg_id=msg_id,
            summary=text[:240],
        )

    return len(entity_ids)


def memory_backfill(db: Database, days: int = 90, limit: int = 5000) -> int:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = db.fetch_messages_for_memory(since, limit=limit)
    total = 0
    for row in rows:
        text = (row["text"] or "").strip()
        if len(text) < 5:
            continue
        total += process_message_for_memory(db, row["chat_id"], row["msg_id"], row["date_utc"], text)
    logger.info("Memory backfill processed entities=%s", total)
    return total
