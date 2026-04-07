from __future__ import annotations

import logging
from pathlib import Path

from app.bot.handlers import build_bot_application
from app.config import load_settings
from app.db import Database
from app.embeddings import EmbeddingService
from app.llm import LlmService
from app.logging_setup import setup_logging


def main() -> None:
    settings = load_settings()
    setup_logging(settings.log_level, log_file=Path("logs/bot.log"))

    db = Database(
        settings.sqlite_path,
        lock_retry_attempts=settings.lock_retry_attempts,
        lock_retry_delay_seconds=settings.lock_retry_delay_seconds,
    )
    db.init_db()
    llm = LlmService(api_key=settings.openai_api_key, model=settings.openai_model)
    embedding_service = EmbeddingService(api_key=settings.openai_api_key, model=settings.embedding_model)

    logging.getLogger(__name__).info("Starting owner-only bot UI")
    application = build_bot_application(settings, db)
    application.bot_data["llm"] = llm
    application.bot_data["embeddings"] = embedding_service
    application.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
