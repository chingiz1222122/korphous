from __future__ import annotations

import argparse

from app.backfill import backfill_enabled_chats
from app.config import load_settings
from app.db import Database
from app.logging_setup import setup_logging


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill all enabled chats")
    parser.add_argument("--days", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(
        settings.sqlite_path,
        lock_retry_attempts=settings.lock_retry_attempts,
        lock_retry_delay_seconds=settings.lock_retry_delay_seconds,
    )
    db.init_db()
    result = backfill_enabled_chats(settings, db, args.days)
    for chat_id, inserted in result.items():
        print(f"chat_id={chat_id} inserted={inserted}")


if __name__ == "__main__":
    main()
