from __future__ import annotations

from app.config import load_settings
from app.db import Database
from app.decision_support import build_focus_items
from app.followup_engine import detect_followups
from app.risk_engine import detect_risks


def main() -> None:
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    followups = detect_followups(db)
    risks = detect_risks(db)
    focus = build_focus_items(db, followups, risks)
    print("FOLLOWUPS:", len(followups))
    print("RISKS:", len(risks))
    print("FOCUS:")
    for item in focus:
        print(item)


if __name__ == "__main__":
    main()
