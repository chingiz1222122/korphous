from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.logging_setup import setup_logging
from app.memory_retrieval import build_entity_summary, resolve_entity


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", action="append", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    for query in args.query:
        print("=" * 80)
        print("QUERY:", query)
        rows = resolve_entity(db, query)
        if not rows:
            print("No entity found")
            continue
        print(build_entity_summary(db, rows[0]))


if __name__ == "__main__":
    main()
