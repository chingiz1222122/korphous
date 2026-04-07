from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.memory_retrieval import build_entity_summary, resolve_entity


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    rows = resolve_entity(db, args.name)
    if not rows:
        print("Entity not found")
        return
    print(build_entity_summary(db, rows[0]))


if __name__ == "__main__":
    main()
