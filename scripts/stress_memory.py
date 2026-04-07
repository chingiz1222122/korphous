from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.memory import memory_backfill


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--limit", type=int, default=50000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    processed = memory_backfill(db, days=args.days, limit=args.limit)
    print(f"stress_memory_processed={processed}")


if __name__ == "__main__":
    main()
