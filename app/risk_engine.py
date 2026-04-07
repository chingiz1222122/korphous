from __future__ import annotations

from datetime import datetime, timedelta, timezone


def detect_risks(db) -> list[dict]:
    now = datetime.now(timezone.utc)
    due_rows = db.list_due_workflows((now + timedelta(days=2)).isoformat(), limit=40)
    stale_rows = db.list_stale_workflows((now - timedelta(days=7)).isoformat(), limit=40)

    risks: list[dict] = []
    for row in due_rows:
        risks.append(
            {
                "workflow_id": row["workflow_id"],
                "risk_type": "deadline_approaching",
                "severity": "high",
                "evidence": f"due_at={row['due_at']}",
                "suggested_action": row["next_action"] or "Закрыть дедлайн или зафиксировать перенос",
            }
        )

    for row in stale_rows:
        risks.append(
            {
                "workflow_id": row["workflow_id"],
                "risk_type": "stale_workflow",
                "severity": "medium",
                "evidence": f"last_update_at={row['last_update_at']}",
                "suggested_action": row["next_action"] or "Сделать follow-up и зафиксировать статус",
            }
        )

    return risks
