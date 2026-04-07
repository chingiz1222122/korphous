from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.logging_setup import setup_logging
from app.memory import memory_backfill


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120)
    parser.add_argument("--limit", type=int, default=6000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    count = memory_backfill(db, days=args.days, limit=args.limit)
    print(f"memory_entities_processed={count}")


if __name__ == "__main__":
    main()
