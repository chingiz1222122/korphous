from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from app.config import load_settings
from app.db import Database


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--messages", type=int, default=100000)
    parser.add_argument("--chat-id", type=int, default=-100999000111)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    db.upsert_chat(args.chat_id, "Stress Chat", None, "channel", enabled=True)

    now = datetime.now(timezone.utc)
    inserted = 0
    for i in range(args.messages):
        when = now - timedelta(minutes=i)
        saved = db.save_message(
            chat_id=args.chat_id,
            msg_id=10_000_000 + i,
            date_utc=when,
            sender_id=1,
            text=f"stress message {i} поставка дедлайн invoice {i%17}",
            raw_json=None,
        )
        if saved:
            inserted += 1
    print(f"stress_ingestion_inserted={inserted}")


if __name__ == "__main__":
    main()
