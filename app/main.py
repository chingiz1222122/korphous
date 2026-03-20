from __future__ import annotations

import logging

from app.ai import AIAnalyzer
from app.bot import HiringBot, render_webhook_url
from app.config import load_settings
from app.db import CandidateRepository
from app.sheets import SheetsWriter


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)


def main() -> None:
    settings = load_settings()
    repo = CandidateRepository(settings.database_path)
    analyzer = AIAnalyzer(settings.openai_api_key, settings.openai_model)
    sheets = SheetsWriter(settings.google_service_account_json, settings.google_sheet_name)

    bot = HiringBot(settings=settings, repo=repo, analyzer=analyzer, sheets=sheets)
    app = bot.build_application()

    webhook_url = render_webhook_url(settings)
    if webhook_url:
        app.run_webhook(
            listen="0.0.0.0",
            port=settings.app_port,
            webhook_url=webhook_url,
            secret_token=settings.webhook_secret,
            allowed_updates=["message"],
        )
    else:
        app.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
