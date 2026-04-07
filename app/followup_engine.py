from __future__ import annotations

from datetime import datetime, timedelta, timezone


def detect_followups(db) -> list[dict]:
    stale_before = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    stale = db.list_stale_workflows(stale_before, limit=40)
    items: list[dict] = []
    for row in stale:
        items.append(
            {
                "workflow_id": row["workflow_id"],
                "title": f"{row['workflow_type']} / stage={row['current_stage']}",
                "why": f"Нет обновлений с {row['last_update_at']}",
                "next_step": row["next_action"] or "Запросить статус и обновить следующий шаг",
                "severity": "medium",
            }
        )
    return items
