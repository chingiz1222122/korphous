from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from telegram import Bot

from app.bot.state import get_selected_chat
from app.config import Settings, load_settings
from app.db import Database
from app.digest_service import make_digest
from app.embeddings import EmbeddingService
from app.llm import LlmService
from app.decision_support import build_focus_items
from app.followup_engine import detect_followups
from app.logging_setup import setup_logging
from app.risk_engine import detect_risks


logger = logging.getLogger(__name__)


def _today_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%d")


def _due(now: datetime, settings: Settings) -> bool:
    return now.hour == settings.daily_digest_hour and now.minute == settings.daily_digest_minute


async def run_scheduler() -> None:
    settings = load_settings()
    setup_logging(settings.log_level, log_file=Path("logs/scheduler.log"))

    db = Database(
        settings.sqlite_path,
        lock_retry_attempts=settings.lock_retry_attempts,
        lock_retry_delay_seconds=settings.lock_retry_delay_seconds,
    )
    db.init_db()
    bot = Bot(token=settings.bot_token)
    llm = LlmService(api_key=settings.openai_api_key, model=settings.openai_model)
    embeddings = EmbeddingService(api_key=settings.openai_api_key, model=settings.embedding_model)

    logger.info("Scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        db.update_heartbeat("scheduler")
        try:
            if _due(now, settings):
                run_key = _today_key(now)
                already = db.get_state("scheduler_last_run_date")
                if already != run_key:
                    if settings.digest_default_scope == "selected":
                        selected_chat = get_selected_chat(db, settings.owner_user_id)
                        if selected_chat is None:
                            scope_type = "all_enabled"
                            scope_value = None
                        else:
                            scope_type = "single_chat"
                            scope_value = str(selected_chat)
                    else:
                        scope_type = "all_enabled"
                        scope_value = None

                    result = make_digest(
                        db=db,
                        llm=llm,
                        embedding_service=embeddings,
                        scope_type=scope_type,
                        scope_value=scope_value,
                        period=settings.digest_default_period,
                        query=None,
                        force=False,
                    )
                    await bot.send_message(chat_id=settings.owner_user_id, text=result.text[:3900])
                    followups = detect_followups(db)
                    risks = detect_risks(db)
                    focus_items = build_focus_items(db, followups, risks, top_n=5)
                    if focus_items:
                        lines = ["Operational digest:"]
                        for item in focus_items:
                            lines.append(f"- {item['item']}")
                            lines.append(f"  Why: {item['why']}")
                            lines.append(f"  Next: {item['next']}")
                        await bot.send_message(chat_id=settings.owner_user_id, text="\n".join(lines)[:3900])
                    db.record_digest(
                        scope_type=scope_type,
                        scope_value=scope_value,
                        period=settings.digest_default_period,
                        input_signature=result.input_signature,
                        digest_text=result.text,
                        sent_by="scheduler",
                    )
                    db.set_state("scheduler_last_run_date", run_key)
                    logger.info("Scheduler sent digest cache_hit=%s", result.cache_hit)
        except Exception:
            logger.exception("Scheduler iteration failed")

        await asyncio.sleep(settings.scheduler_poll_seconds)


def main() -> None:
    asyncio.run(run_scheduler())


if __name__ == "__main__":
    main()
