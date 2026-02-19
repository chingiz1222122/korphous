from __future__ import annotations

import asyncio
import logging
from typing import Optional

from typing import Any

try:
    from telegram import Update
    from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters
except ImportError:  # pragma: no cover - optional runtime dependency for tests/docs
    Update = Any  # type: ignore[assignment]
    ContextTypes = Any  # type: ignore[assignment]
    Application = Any  # type: ignore[assignment]
    CommandHandler = Any  # type: ignore[assignment]
    MessageHandler = Any  # type: ignore[assignment]
    filters = Any  # type: ignore[assignment]

from telegram_mvp.config import load_settings
from telegram_mvp.db import MessageStore
from telegram_mvp.llm import LlmConfig, generate_answer
from telegram_mvp.summary import build_summary, format_summary


logging.basicConfig(level=logging.INFO)


def _parse_owner_id(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        logging.warning("OWNER_USER_ID is not a valid integer; disabling owner check")
        return None


def _is_allowed(user_id: Optional[int], owner_id: Optional[int]) -> bool:
    if owner_id is None:
        return True
    return user_id == owner_id


async def handle_summary(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    settings = load_settings()
    owner_id = _parse_owner_id(settings.owner_user_id)
    if not _is_allowed(update.effective_user.id if update.effective_user else None, owner_id):
        await update.message.reply_text("Доступ запрещён.")
        return

    store = MessageStore(settings.database_path)
    messages = build_summary(store, settings.summary_period_hours, settings.summary_keywords)
    await update.message.reply_text(format_summary(messages))


async def handle_question(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    settings = load_settings()
    owner_id = _parse_owner_id(settings.owner_user_id)
    if not _is_allowed(update.effective_user.id if update.effective_user else None, owner_id):
        await update.message.reply_text("Доступ запрещён.")
        return

    question = update.message.text or ""
    store = MessageStore(settings.database_path)
    messages = build_summary(store, settings.summary_period_hours, settings.summary_keywords)

    llm_config = LlmConfig(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
    )
    answer = generate_answer(llm_config, question, messages)
    response = f"{answer}\n\n{format_summary(messages)}"
    await update.message.reply_text(response)


def main() -> None:
    settings = load_settings()
    if not settings.bot_token:
        raise RuntimeError("BOT_TOKEN is required to run the bot")

    if Application is Any:
        raise RuntimeError("python-telegram-bot is not installed. Run: pip install -r requirements.txt")

    application = Application.builder().token(settings.bot_token).build()
    application.add_handler(CommandHandler("summary", handle_summary))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_question))
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
