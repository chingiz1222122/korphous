from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from app.config import load_settings
from app.db import Database


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflows", type=int, default=5000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()

    now = datetime.now(timezone.utc)
    for i in range(args.workflows):
        due_at = (now + timedelta(days=(i % 10) - 5)).isoformat()
        wf_id = db.upsert_workflow(
            workflow_type="supplier" if i % 2 == 0 else "payment",
            entity_id=None,
            current_stage="shipment",
            status="active",
            last_update_at=(now - timedelta(days=i % 15)).isoformat(),
            due_at=due_at,
            risk_level="medium",
            next_action="Сделать follow-up",
            source_message_ref=f"-100:{i}",
        )
        db.add_workflow_event(wf_id, "update", now.isoformat(), -100123, 1000 + i, f"workflow event {i}")

    stale = db.list_stale_workflows((now - timedelta(days=7)).isoformat(), limit=100)
    due = db.list_due_workflows((now + timedelta(days=2)).isoformat(), limit=100)
    print(f"workflow_total={args.workflows} stale_sample={len(stale)} due_sample={len(due)}")


if __name__ == "__main__":
    main()
