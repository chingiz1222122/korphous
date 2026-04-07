from __future__ import annotations

import argparse
import sqlite3

from app.config import load_settings
from app.db import Database


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulate", choices=["db_lock", "bad_cache", "bad_heartbeat"], default="db_lock")
    return parser.parse_args()


def simulate_db_lock(db: Database) -> None:
    with db.connect() as conn:
        conn.execute("BEGIN EXCLUSIVE")
        try:
            db.set_state("chaos_test", "locked")
        except sqlite3.OperationalError as exc:
            print(f"expected lock error: {exc}")
        finally:
            conn.execute("ROLLBACK")


def simulate_bad_cache(db: Database) -> None:
    db.upsert_summary_cache(
        cache_key="chaos:bad",
        scope_type="all_enabled",
        scope_value=None,
        period="24h",
        summary_type="digest",
        input_signature="sig-a",
        summary_text="broken row",
    )
    cached = db.get_summary_cache("chaos:bad", "sig-b")
    print(f"cache_mismatch_result={cached}")


def simulate_bad_heartbeat(db: Database) -> None:
    db.set_state("collector_last_seen_utc", "not_an_int")
    print("collector_last_seen_utc set to invalid value")


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()

    if args.simulate == "db_lock":
        simulate_db_lock(db)
    elif args.simulate == "bad_cache":
        simulate_bad_cache(db)
    else:
        simulate_bad_heartbeat(db)


if __name__ == "__main__":
    main()
