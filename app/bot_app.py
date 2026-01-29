from __future__ import annotations

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from app.config import Settings
from app.db import fetch_recent_messages, list_chats, set_chat_enabled
from app.openai_client import create_openai_client
from app.rag import ask_with_citations, summarize_messages


logger = logging.getLogger(__name__)


def _owner_only(settings: Settings):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
        if update.effective_user is None:
            return False
        if update.effective_user.id != settings.owner_user_id:
            if update.message:
                await update.message.reply_text("Access denied.")
            return False
        return True

    return wrapper


def _format_chat_button(chat_id: int, title: str, enabled: bool) -> InlineKeyboardButton:
    label = f"{'✅' if enabled else '❌'} {title}"
    return InlineKeyboardButton(label, callback_data=f"toggle:{chat_id}")


async def chats_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    if not await _owner_only(settings)(update, context):
        return
    chats = list_chats(settings.sqlite_path)
    keyboard = [[_format_chat_button(chat.chat_id, chat.title, chat.enabled)] for chat in chats]
    if update.message:
        await update.message.reply_text(
            "Enable/disable chats:",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )


async def toggle_chat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    if not await _owner_only(settings)(update, context):
        return
    query = update.callback_query
    if query is None:
        return
    await query.answer()
    data = query.data or ""
    if not data.startswith("toggle:"):
        return
    chat_id = int(data.split(":", 1)[1])
    chats = list_chats(settings.sqlite_path)
    current = next((chat for chat in chats if chat.chat_id == chat_id), None)
    if current is None:
        await query.edit_message_text("Chat not found.")
        return
    set_chat_enabled(settings.sqlite_path, chat_id, not current.enabled)
    updated = list_chats(settings.sqlite_path)
    keyboard = [[_format_chat_button(chat.chat_id, chat.title, chat.enabled)] for chat in updated]
    await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(keyboard))


async def ask_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    if not await _owner_only(settings)(update, context):
        return
    if update.message is None:
        return
    args = context.args
    if not args:
        await update.message.reply_text("Usage: /ask <question> [hours]")
        return
    hours = 24
    if args and args[0].isdigit():
        hours = int(args[0])
        question = " ".join(args[1:]).strip()
    else:
        question = " ".join(args).strip()
    if not question:
        await update.message.reply_text("Please provide a question.")
        return
    messages = fetch_recent_messages(settings.sqlite_path, hours=hours)
    if not messages:
        await update.message.reply_text("No messages found for the requested period.")
        return
    client = create_openai_client(settings)
    result = ask_with_citations(client, settings.openai_model, question, messages)
    response = result.answer
    citations = "\n".join(f"- {link}" for link in result.citations)
    await update.message.reply_text(f"{response}\n\nSources:\n{citations}")


async def digest_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    if not await _owner_only(settings)(update, context):
        return
    if update.message is None:
        return
    hours = 24
    if context.args and context.args[0].isdigit():
        hours = int(context.args[0])
    messages = fetch_recent_messages(settings.sqlite_path, hours=hours)
    if not messages:
        await update.message.reply_text("No messages found for the requested period.")
        return
    client = create_openai_client(settings)
    result = summarize_messages(client, settings.openai_model, messages, hours)
    citations = "\n".join(f"- {link}" for link in result.citations)
    await update.message.reply_text(f"{result.answer}\n\nSources:\n{citations}")


def build_application(settings: Settings) -> Application:
    application = Application.builder().token(settings.bot_token).build()
    application.bot_data["settings"] = settings
    application.add_handler(CommandHandler("chats", chats_command))
    application.add_handler(CommandHandler("ask", ask_command))
    application.add_handler(CommandHandler("digest", digest_command))
    application.add_handler(CallbackQueryHandler(toggle_chat))
    return application


async def run_bot(settings: Settings) -> None:
    application = build_application(settings)
    await application.initialize()
    await application.start()
    await application.updater.start_polling()
    logger.info("Bot started")
    await application.updater.wait()
