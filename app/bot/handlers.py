from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

from app.backfill import backfill_chat
from app.bot.keyboards import chat_actions_keyboard
from app.bot.state import (
    get_selected_chat,
    get_selected_period,
    set_selected_chat,
    set_selected_period,
)
from app.config import Settings
from app.db import Database
from app.digest_service import make_digest
from app.hybrid_retrieval import build_hybrid_context, retrieve_hybrid
from app.llm import LlmService
from app.decision_support import build_focus_items
from app.followup_engine import detect_followups
from app.memory_retrieval import build_entity_summary, resolve_entity
from app.risk_engine import detect_risks
from app.retrieval import period_to_since


logger = logging.getLogger(__name__)


def _is_owner(update: Update, owner_user_id: int) -> bool:
    user = update.effective_user
    return user is not None and user.id == owner_user_id


async def _deny(update: Update) -> None:
    if update.message:
        await update.message.reply_text("Доступ запрещён. Этот бот только для владельца.")
    if update.callback_query:
        await update.callback_query.answer("Доступ запрещён", show_alert=True)


def owner_only(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        settings: Settings = context.application.bot_data["settings"]
        db: Database = context.application.bot_data["db"]
        db.update_heartbeat("bot")
        if not _is_owner(update, settings.owner_user_id):
            logger.warning("Denied access for user=%s", getattr(update.effective_user, "id", None))
            await _deny(update)
            return
        logger.info("Command/action accepted from owner: %s", func.__name__)
        return await func(update, context)

    return wrapper


def _db(context: ContextTypes.DEFAULT_TYPE) -> Database:
    return context.application.bot_data["db"]


def _owner_id(context: ContextTypes.DEFAULT_TYPE) -> int:
    settings: Settings = context.application.bot_data["settings"]
    return settings.owner_user_id


def _llm(context: ContextTypes.DEFAULT_TYPE) -> LlmService:
    return context.application.bot_data["llm"]


def _embeddings(context: ContextTypes.DEFAULT_TYPE):
    return context.application.bot_data["embeddings"]


@owner_only
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    await update.message.reply_text(
        "Привет! Это управляющий бот ingestion-системы.\n\n"
        "Основные команды:\n"
        "/help — подробная справка\n"
        "/chats [query] — список чатов + кнопки\n"
        "/enabled — только enabled чаты\n"
        "/use <chat_id> — выбрать текущий чат\n"
        "/where — показать выбранный чат\n"
        "/enable <chat_id> / /disable <chat_id>\n"
        "/status — состояние системы\n"
        "/stats — статистика БД\n"
        "/period <24h|7d|30d>\n"
        "/backfill <chat_id> <days>"
        "\n/digestnow [force]"
        "\n/lastdigest"
        "\n/health"
    )


@owner_only
async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    await update.message.reply_text(
        "Команды:\n"
        "/chats [query] — поиск по title/username/chat_id\n"
        "/enabled — список включённых чатов\n"
        "/use <chat_id> — выбрать активный чат\n"
        "/where — показать активный чат\n"
        "/enable <chat_id> — включить чат\n"
        "/disable <chat_id> — выключить чат\n"
        "/status — базовый статус collector + БД\n"
        "/stats — расширенная статистика\n"
        "/period <24h|7d|30d> — сохранить рабочий период\n"
        "/backfill <chat_id> <days> — догрузка истории\n"
        "/ask <вопрос> — ответ по выбранному чату\n"
        "/askall <вопрос> — ответ по всем enabled чатам\n"
        "/digest [тема] — сводка за период"
        "\n/digestnow [force] — принудительный digest"
        "\n/lastdigest — последний отправленный digest"
        "\n/health — heartbeat и диагностика"
    )


def _render_chat_line(chat, selected_chat_id: int | None) -> str:
    username = f"@{chat.username}" if chat.username else "—"
    enabled = "enabled" if chat.enabled else "disabled"
    selected = " [current]" if selected_chat_id == chat.chat_id else ""
    return f"• {chat.title} ({username})\n  id={chat.chat_id} | {enabled}{selected}"


@owner_only
async def chats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    query = " ".join(context.args).strip()
    chats = db.find_chats(query) if query else db.list_chats()[:30]
    if not chats:
        await update.message.reply_text("Чаты не найдены.")
        return

    selected_chat_id = get_selected_chat(db, owner_id)
    await update.message.reply_text(f"Найдено чатов: {len(chats)}")
    for chat in chats[:20]:
        text = _render_chat_line(chat, selected_chat_id)
        await update.message.reply_text(
            text,
            reply_markup=chat_actions_keyboard(chat, is_selected=selected_chat_id == chat.chat_id),
        )


@owner_only
async def enabled_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    selected_chat_id = get_selected_chat(db, owner_id)
    enabled_ids = db.get_enabled_chat_ids()
    if not enabled_ids:
        await update.message.reply_text("Нет enabled-чатов.")
        return
    lines = []
    for chat_id in sorted(enabled_ids):
        chat = db.get_chat(chat_id)
        if chat is None:
            continue
        lines.append(_render_chat_line(chat, selected_chat_id))
    await update.message.reply_text("\n\n".join(lines) if lines else "Нет enabled-чатов.")


def _parse_chat_id(args: list[str]) -> int | None:
    if not args:
        return None
    try:
        return int(args[0])
    except ValueError:
        return None


@owner_only
async def use_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    chat_id = _parse_chat_id(context.args)
    if chat_id is None:
        await update.message.reply_text("Использование: /use <chat_id>")
        return
    chat = db.get_chat(chat_id)
    if chat is None:
        await update.message.reply_text("Чат не найден в базе.")
        return
    set_selected_chat(db, owner_id, chat_id)
    await update.message.reply_text(f"Текущий чат: {chat.title} ({chat.chat_id})")


@owner_only
async def where_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    selected_chat_id = get_selected_chat(db, owner_id)
    if selected_chat_id is None:
        await update.message.reply_text("Текущий чат не выбран.")
        return
    chat = db.get_chat(selected_chat_id)
    if chat is None:
        await update.message.reply_text("Выбранный чат отсутствует в базе.")
        return
    await update.message.reply_text(_render_chat_line(chat, selected_chat_id))


async def _set_enabled(update: Update, context: ContextTypes.DEFAULT_TYPE, enabled: bool) -> None:
    assert update.message
    db = _db(context)
    chat_id = _parse_chat_id(context.args)
    if chat_id is None:
        cmd = "/enable" if enabled else "/disable"
        await update.message.reply_text(f"Использование: {cmd} <chat_id>")
        return
    chat = db.get_chat(chat_id)
    if chat is None:
        await update.message.reply_text("Чат не найден в базе.")
        return
    db.set_chat_enabled(chat_id, enabled)
    status = "enabled" if enabled else "disabled"
    await update.message.reply_text(f"Чат {chat.title} ({chat_id}) -> {status}")


@owner_only
async def enable_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _set_enabled(update, context, enabled=True)


@owner_only
async def disable_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _set_enabled(update, context, enabled=False)


@owner_only
async def period_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    allowed = {"24h", "7d", "30d"}
    if not context.args or context.args[0] not in allowed:
        await update.message.reply_text("Использование: /period <24h|7d|30d>")
        return
    value = context.args[0]
    set_selected_period(db, owner_id, value)
    await update.message.reply_text(f"Период сохранён: {value}")


def _format_epoch(epoch_value: str | None) -> str:
    if not epoch_value:
        return "—"
    try:
        dt = datetime.fromtimestamp(int(epoch_value), tz=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    except ValueError:
        return "—"


@owner_only
async def status_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    owner_id = _owner_id(context)
    stats = db.ingestion_stats()
    selected_chat_id = get_selected_chat(db, owner_id)
    selected_period = get_selected_period(db, owner_id)
    selected_chat = db.get_chat(selected_chat_id) if selected_chat_id is not None else None

    collector_status = db.get_state("collector_status") or "unknown"
    collector_started = _format_epoch(db.get_state("collector_started_utc"))
    last_ingest = _format_epoch(db.get_state("collector_last_ingest_utc"))
    scheduler_seen = _format_epoch(db.get_heartbeat("scheduler"))
    collector_seen = _format_epoch(db.get_heartbeat("collector"))
    last_message = db.last_message_time_utc() or "—"
    last_digest = _format_epoch(db.get_state("last_digest_time_utc"))
    last_llm_ok = _format_epoch(db.get_state("last_llm_success_utc"))

    await update.message.reply_text(
        "Статус системы:\n"
        f"• collector_status: {collector_status}\n"
        f"• collector_started: {collector_started}\n"
        f"• collector_last_seen: {collector_seen}\n"
        f"• scheduler_last_seen: {scheduler_seen}\n"
        f"• last_ingest_event: {last_ingest}\n"
        f"• chats_enabled/total: {stats['chats_enabled']}/{stats['chats_total']}\n"
        f"• messages_total: {stats['messages_total']}\n"
        f"• last_message_time: {last_message}\n"
        f"• last_digest_time: {last_digest}\n"
        f"• last_llm_success: {last_llm_ok}\n"
        f"• selected_chat: {selected_chat.title if selected_chat else 'не выбран'}\n"
        f"• selected_period: {selected_period}"
    )


@owner_only
async def stats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    stats = db.ingestion_stats()
    last_message = db.last_message_time_utc() or "—"
    top_rows = db.top_enabled_chat_message_counts(limit=10)
    cache_count = db.count_summary_cache()

    lines = [
        "Статистика БД:",
        f"• total_chats: {stats['chats_total']}",
        f"• enabled_chats: {stats['chats_enabled']}",
        f"• total_messages: {stats['messages_total']}",
        f"• summary_cache_rows: {cache_count}",
        f"• last_message_time: {last_message}",
        "• messages per enabled chat (top-10):",
    ]
    if not top_rows:
        lines.append("  — нет данных")
    else:
        for chat_id, title, count in top_rows:
            lines.append(f"  - {title} ({chat_id}): {count}")
    await update.message.reply_text("\n".join(lines))


@owner_only
async def backfill_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    settings: Settings = context.application.bot_data["settings"]
    if len(context.args) < 2:
        await update.message.reply_text("Использование: /backfill <chat_id> <days>")
        return

    try:
        chat_id = int(context.args[0])
        days = int(context.args[1])
    except ValueError:
        await update.message.reply_text("chat_id и days должны быть числами")
        return

    chat = db.get_chat(chat_id)
    if chat is None:
        await update.message.reply_text("Чат не найден в базе.")
        return

    await update.message.reply_text(f"Запускаю backfill: chat_id={chat_id}, days={days}...")
    inserted = await asyncio.to_thread(backfill_chat, settings, db, chat_id, days)
    await update.message.reply_text(f"Backfill завершён: вставлено {inserted} сообщений.")


def _format_sources(selected_items, source_indexes: list[int]) -> str:
    if not selected_items:
        return "Источники: нет."
    if not source_indexes:
        source_indexes = list(range(1, min(6, len(selected_items) + 1)))
    lines = ["Источники:"]
    for idx in source_indexes[:8]:
        item = selected_items[idx - 1]
        lines.append(f"{idx}. {item.chat_title}")
        lines.append(item.link)
    return "\n".join(lines)


def _trim_for_telegram(text: str, limit: int = 3900) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _memory_expansion(db: Database, question: str, max_chars: int = 2200) -> str:
    matches = resolve_entity(db, question)
    if not matches:
        return ""
    summary = build_entity_summary(db, matches[0])
    return summary[:max_chars]


@owner_only
async def ask_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    started = time.perf_counter()
    db = _db(context)
    owner_id = _owner_id(context)
    llm = _llm(context)
    embeddings = _embeddings(context)
    question = " ".join(context.args).strip()
    if not question:
        await update.message.reply_text("Использование: /ask <вопрос>")
        return

    selected_chat_id = get_selected_chat(db, owner_id)
    if selected_chat_id is None:
        await update.message.reply_text(
            "Текущий чат не выбран. Используйте /use <chat_id> или /askall <вопрос>."
        )
        return

    period = get_selected_period(db, owner_id) or context.application.bot_data["settings"].default_period
    retrieved, intent, hstats = retrieve_hybrid(
        db=db,
        embedding_service=embeddings,
        query=question,
        period=period,
        chat_ids=[selected_chat_id],
        top_n=35,
    )
    if not retrieved:
        await update.message.reply_text("Недостаточно данных за выбранный период для ответа.")
        return

    context_text, selected_items = build_hybrid_context(retrieved, max_chars=11000)
    memory_text = _memory_expansion(db, question)
    if memory_text:
        context_text = f"MEMORY CONTEXT:\n{memory_text}\n\nRETRIEVAL CONTEXT:\n{context_text}"
    logger.info("ask hybrid stats=%s intents=%s", hstats, intent.intents)
    try:
        result = await asyncio.to_thread(llm.answer_question, question, context_text, len(selected_items))
        db.log_llm_request(
            request_type="ask",
            scope_type="single_chat",
            scope_value=str(selected_chat_id),
            period=period,
            input_signature=None,
            selected_messages=len(selected_items),
            success=True,
        )
    except Exception:
        logger.exception("OpenAI error in /ask")
        db.log_llm_request(
            request_type="ask",
            scope_type="single_chat",
            scope_value=str(selected_chat_id),
            period=period,
            input_signature=None,
            selected_messages=len(selected_items),
            success=False,
            error_text="openai_error",
        )
        await update.message.reply_text("OpenAI сейчас недоступен. Попробуйте позже.")
        return

    body = _trim_for_telegram(result.text)
    sources = _format_sources(selected_items, result.source_indexes)
    await update.message.reply_text(f"{body}\n\n{sources}")
    logger.info("ask completed in %.2fs", time.perf_counter() - started)


@owner_only
async def askall_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    started = time.perf_counter()
    db = _db(context)
    owner_id = _owner_id(context)
    llm = _llm(context)
    embeddings = _embeddings(context)
    question = " ".join(context.args).strip()
    if not question:
        await update.message.reply_text("Использование: /askall <вопрос>")
        return

    enabled_chat_ids = sorted(db.get_enabled_chat_ids())
    if not enabled_chat_ids:
        await update.message.reply_text("Нет enabled-чатов. Сначала включите чат через /enable.")
        return

    period = get_selected_period(db, owner_id) or context.application.bot_data["settings"].default_period
    retrieved, intent, hstats = retrieve_hybrid(
        db=db,
        embedding_service=embeddings,
        query=question,
        period=period,
        chat_ids=enabled_chat_ids,
        top_n=40,
    )
    if not retrieved:
        await update.message.reply_text("Недостаточно данных за выбранный период для ответа.")
        return

    context_text, selected_items = build_hybrid_context(retrieved, max_chars=12000)
    memory_text = _memory_expansion(db, question)
    if memory_text:
        context_text = f"MEMORY CONTEXT:\n{memory_text}\n\nRETRIEVAL CONTEXT:\n{context_text}"
    logger.info("askall hybrid stats=%s intents=%s", hstats, intent.intents)
    try:
        result = await asyncio.to_thread(llm.answer_question, question, context_text, len(selected_items))
        db.log_llm_request(
            request_type="askall",
            scope_type="all_enabled",
            scope_value=None,
            period=period,
            input_signature=None,
            selected_messages=len(selected_items),
            success=True,
        )
    except Exception:
        logger.exception("OpenAI error in /askall")
        db.log_llm_request(
            request_type="askall",
            scope_type="all_enabled",
            scope_value=None,
            period=period,
            input_signature=None,
            selected_messages=len(selected_items),
            success=False,
            error_text="openai_error",
        )
        await update.message.reply_text("OpenAI сейчас недоступен. Попробуйте позже.")
        return

    body = _trim_for_telegram(result.text)
    sources = _format_sources(selected_items, result.source_indexes)
    await update.message.reply_text(f"{body}\n\n{sources}")
    logger.info("askall completed in %.2fs", time.perf_counter() - started)


@owner_only
async def digest_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    started = time.perf_counter()
    db = _db(context)
    owner_id = _owner_id(context)
    query = " ".join(context.args).strip() or None

    selected_chat_id = get_selected_chat(db, owner_id)
    if selected_chat_id is None:
        chat_ids = sorted(db.get_enabled_chat_ids())
        if not chat_ids:
            await update.message.reply_text("Нет selected chat и нет enabled-чатов для дайджеста.")
            return
    else:
        chat_ids = [selected_chat_id]

    period = get_selected_period(db, owner_id) or context.application.bot_data["settings"].default_period
    llm = _llm(context)
    scope_type = "single_chat" if selected_chat_id is not None else "all_enabled"
    scope_value = str(selected_chat_id) if selected_chat_id is not None else None
    try:
        result = await asyncio.to_thread(
            make_digest,
            db,
            llm,
            embeddings,
            scope_type,
            scope_value,
            period,
            query,
            False,
        )
        db.log_llm_request(
            request_type="digest",
            scope_type=scope_type,
            scope_value=scope_value,
            period=period,
            input_signature=result.input_signature,
            selected_messages=result.selected_count,
            success=True,
        )
    except Exception:
        logger.exception("OpenAI error in /digest")
        db.log_llm_request(
            request_type="digest",
            scope_type=scope_type,
            scope_value=scope_value,
            period=period,
            input_signature=None,
            selected_messages=0,
            success=False,
            error_text="openai_error",
        )
        await update.message.reply_text("OpenAI сейчас недоступен. Попробуйте позже.")
        return

    body = _trim_for_telegram(result.text)
    await update.message.reply_text(body)
    db.record_digest(
        scope_type=scope_type,
        scope_value=scope_value,
        period=period,
        input_signature=result.input_signature,
        digest_text=result.text,
        sent_by="bot",
    )
    logger.info("digest completed in %.2fs", time.perf_counter() - started)


@owner_only
async def digestnow_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    force = bool(context.args and context.args[0].lower() == "force")
    db = _db(context)
    owner_id = _owner_id(context)
    llm = _llm(context)
    embeddings = _embeddings(context)
    selected_chat_id = get_selected_chat(db, owner_id)
    period = get_selected_period(db, owner_id) or context.application.bot_data["settings"].default_period
    scope_type = "single_chat" if selected_chat_id is not None else "all_enabled"
    scope_value = str(selected_chat_id) if selected_chat_id is not None else None
    try:
        result = await asyncio.to_thread(
            make_digest, db, llm, embeddings, scope_type, scope_value, period, None, force
        )
        await update.message.reply_text(_trim_for_telegram(result.text))
        db.record_digest(
            scope_type=scope_type,
            scope_value=scope_value,
            period=period,
            input_signature=result.input_signature,
            digest_text=result.text,
            sent_by="bot_digestnow",
        )
    except Exception:
        logger.exception("Error in /digestnow")
        await update.message.reply_text("Не удалось собрать digest сейчас.")


@owner_only
async def lastdigest_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    row = db.get_last_digest()
    if row is None:
        await update.message.reply_text("Digest ещё не отправлялся.")
        return
    text = (
        "Последний digest:\\n"
        f"• created_at: {row['created_at']}\\n"
        f"• scope: {row['scope_type']} {row['scope_value'] or ''}\\n"
        f"• period: {row['period']}\\n"
        f"• sent_by: {row['sent_by']}\\n"
        f"• signature: {row['input_signature'][:12]}..."
    )
    await update.message.reply_text(text)


@owner_only
async def health_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    collector_seen = _format_epoch(db.get_heartbeat("collector"))
    scheduler_seen = _format_epoch(db.get_heartbeat("scheduler"))
    bot_seen = _format_epoch(db.get_heartbeat("bot"))
    last_llm = db.get_last_llm_call()
    last_llm_line = "—"
    if last_llm is not None:
        last_llm_line = (
            f"{last_llm['created_at']} type={last_llm['request_type']} "
            f"success={bool(last_llm['success'])}"
        )
    await update.message.reply_text(
        "Health:\\n"
        f"• collector_last_seen: {collector_seen}\\n"
        f"• scheduler_last_seen: {scheduler_seen}\\n"
        f"• bot_last_seen: {bot_seen}\\n"
        f"• last_db_write(message): {db.last_message_time_utc() or '—'}\\n"
        f"• summary_cache_rows: {db.count_summary_cache()}\\n"
        f"• last_llm_call: {last_llm_line}"
    )


@owner_only
async def whois_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    query = " ".join(context.args).strip()
    if not query:
        await update.message.reply_text("Использование: /whois <entity>")
        return
    matches = resolve_entity(db, query)
    if not matches:
        await update.message.reply_text("Сущность не найдена.")
        return
    await update.message.reply_text(_trim_for_telegram(build_entity_summary(db, matches[0])))


@owner_only
async def timeline_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    query = " ".join(context.args).strip()
    if not query:
        await update.message.reply_text("Использование: /timeline <entity>")
        return
    matches = resolve_entity(db, query)
    if not matches:
        await update.message.reply_text("Сущность не найдена.")
        return
    entity = matches[0]
    timeline = db.get_entity_timeline(entity["entity_id"], limit=15)
    if not timeline:
        await update.message.reply_text("По сущности нет timeline событий.")
        return
    lines = [f"Timeline: {entity['canonical_name']}"]
    for row in timeline:
        lines.append(f"- [{row['event_type']}] {row['summary'][:120]}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


async def _list_entities_by_type(update: Update, context: ContextTypes.DEFAULT_TYPE, entity_type: str, title: str) -> None:
    assert update.message
    db = _db(context)
    rows = db.list_entities_by_type(entity_type, limit=20)
    if not rows:
        await update.message.reply_text(f"Нет сущностей типа {title}.")
        return
    lines = [title + ":"]
    for row in rows:
        lines.append(f"- {row['canonical_name']} (conf={row['confidence']})")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def people_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _list_entities_by_type(update, context, "person", "People")


@owner_only
async def projects_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _list_entities_by_type(update, context, "project", "Projects")


@owner_only
async def deadlines_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _list_entities_by_type(update, context, "event", "Deadlines/Events")


@owner_only
async def decisions_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _list_entities_by_type(update, context, "decision", "Decisions")


@owner_only
async def project_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await whois_cmd(update, context)


@owner_only
async def followups_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    items = detect_followups(db)
    if not items:
        await update.message.reply_text("Нет зависших follow-up задач.")
        return
    lines = ["Follow-ups:"]
    for item in items[:12]:
        lines.append(f"- {item['title']}")
        lines.append(f"  Почему: {item['why']}")
        lines.append(f"  Следующий шаг: {item['next_step']}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def risks_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    risks = detect_risks(db)
    if not risks:
        await update.message.reply_text("Активных рисков не найдено.")
        return
    lines = ["Риски:"]
    for r in risks[:12]:
        lines.append(f"- [{r['severity']}] {r['risk_type']} (wf#{r['workflow_id']})")
        lines.append(f"  Evidence: {r['evidence']}")
        lines.append(f"  Action: {r['suggested_action']}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def waiting_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    followups = detect_followups(db)
    waiting_items = [x for x in followups if "Нет обновлений" in x["why"]]
    if not waiting_items:
        await update.message.reply_text("Нет процессов в ожидании.")
        return
    lines = ["Waiting:"]
    for item in waiting_items[:10]:
        lines.append(f"- {item['title']} | {item['why']}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def nextsteps_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    followups = detect_followups(db)
    if not followups:
        await update.message.reply_text("Нет явных next steps.")
        return
    lines = ["Рекомендуемые next steps:"]
    for item in followups[:10]:
        lines.append(f"- {item['title']}: {item['next_step']}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def focus_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    assert update.message
    db = _db(context)
    followups = detect_followups(db)
    risks = detect_risks(db)
    focus_items = build_focus_items(db, followups, risks, top_n=8)
    if not focus_items:
        await update.message.reply_text("Сейчас нет критичных фокус-элементов.")
        return
    lines = ["Фокус на сейчас:"]
    for item in focus_items:
        lines.append(f"- {item['item']} (score={item['score']})")
        lines.append(f"  Why: {item['why']}")
        lines.append(f"  Next: {item['next']}")
    await update.message.reply_text(_trim_for_telegram("\n".join(lines)))


@owner_only
async def chats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None:
        return
    await query.answer()

    db = _db(context)
    owner_id = _owner_id(context)
    data = query.data or ""

    try:
        action, raw_chat_id = data.split(":", 1)
        chat_id = int(raw_chat_id)
    except ValueError:
        await query.answer("Некорректные данные кнопки", show_alert=True)
        return

    chat = db.get_chat(chat_id)
    if chat is None:
        await query.answer("Чат не найден", show_alert=True)
        return

    if action == "toggle":
        db.set_chat_enabled(chat_id, not chat.enabled)
        chat = db.get_chat(chat_id)
        logger.info("Toggle chat_id=%s -> %s", chat_id, chat.enabled if chat else None)
    elif action == "use":
        set_selected_chat(db, owner_id, chat_id)
        logger.info("Selected chat_id=%s", chat_id)
    else:
        await query.answer("Неизвестное действие", show_alert=True)
        return

    selected_chat_id = get_selected_chat(db, owner_id)
    refreshed = db.get_chat(chat_id)
    if refreshed is None:
        await query.answer("Чат больше не существует", show_alert=True)
        return

    await query.edit_message_text(
        _render_chat_line(refreshed, selected_chat_id),
        reply_markup=chat_actions_keyboard(refreshed, is_selected=selected_chat_id == chat_id),
    )


def build_bot_application(settings: Settings, db: Database) -> Application:
    application = Application.builder().token(settings.bot_token).build()
    application.bot_data["settings"] = settings
    application.bot_data["db"] = db

    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(CommandHandler("chats", chats_cmd))
    application.add_handler(CommandHandler("enabled", enabled_cmd))
    application.add_handler(CommandHandler("use", use_cmd))
    application.add_handler(CommandHandler("where", where_cmd))
    application.add_handler(CommandHandler("enable", enable_cmd))
    application.add_handler(CommandHandler("disable", disable_cmd))
    application.add_handler(CommandHandler("status", status_cmd))
    application.add_handler(CommandHandler("stats", stats_cmd))
    application.add_handler(CommandHandler("period", period_cmd))
    application.add_handler(CommandHandler("backfill", backfill_cmd))
    application.add_handler(CommandHandler("ask", ask_cmd))
    application.add_handler(CommandHandler("askall", askall_cmd))
    application.add_handler(CommandHandler("digest", digest_cmd))
    application.add_handler(CommandHandler("digestnow", digestnow_cmd))
    application.add_handler(CommandHandler("lastdigest", lastdigest_cmd))
    application.add_handler(CommandHandler("health", health_cmd))
    application.add_handler(CommandHandler("whois", whois_cmd))
    application.add_handler(CommandHandler("project", project_cmd))
    application.add_handler(CommandHandler("timeline", timeline_cmd))
    application.add_handler(CommandHandler("people", people_cmd))
    application.add_handler(CommandHandler("projects", projects_cmd))
    application.add_handler(CommandHandler("deadlines", deadlines_cmd))
    application.add_handler(CommandHandler("decisions", decisions_cmd))
    application.add_handler(CommandHandler("focus", focus_cmd))
    application.add_handler(CommandHandler("followups", followups_cmd))
    application.add_handler(CommandHandler("risks", risks_cmd))
    application.add_handler(CommandHandler("waiting", waiting_cmd))
    application.add_handler(CommandHandler("nextsteps", nextsteps_cmd))
    application.add_handler(CallbackQueryHandler(chats_callback, pattern=r"^(toggle|use):"))
    return application
