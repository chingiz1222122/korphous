from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.memory_retrieval import resolve_entity


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--entity", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    rows = resolve_entity(db, args.entity)
    if not rows:
        print("Entity not found")
        return
    entity = rows[0]
    timeline = db.get_entity_timeline(entity["entity_id"], limit=30)
    for item in timeline:
        print(f"[{item['event_type']}] {item['event_time'] or item['created_at']} {item['summary']}")


if __name__ == "__main__":
    main()
