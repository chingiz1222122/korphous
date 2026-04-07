from __future__ import annotations

import argparse

from app.backfill import backfill_chat
from app.config import load_settings
from app.db import Database
from app.logging_setup import setup_logging


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill one chat")
    parser.add_argument("--chat-id", type=int, required=True)
    parser.add_argument("--days", type=int, default=7)
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
    inserted = backfill_chat(settings, db, args.chat_id, args.days)
    print(f"chat_id={args.chat_id} inserted={inserted}")


if __name__ == "__main__":
    main()
