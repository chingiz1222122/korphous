from __future__ import annotations

from app.config import load_settings
from app.db import Database
from app.logging_setup import setup_logging
from app.memory import memory_backfill


def main() -> None:
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    # Practical local strategy: replay memory extraction to rebuild relationships/timelines incrementally.
    count = memory_backfill(db, days=365, limit=20000)
    print(f"graph_rebuild_processed={count}")


if __name__ == "__main__":
    main()
