from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow-id", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    rows = db.list_workflows(limit=50)
    for row in rows:
        if args.workflow_id and row["workflow_id"] != args.workflow_id:
            continue
        print(dict(row))


if __name__ == "__main__":
    main()
