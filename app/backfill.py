from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from telethon import TelegramClient
from telethon.tl.types import Channel, Chat

from app.config import Settings
from app.db import Database


logger = logging.getLogger(__name__)


def _is_supported_chat(entity: object) -> bool:
    return isinstance(entity, (Channel, Chat))


def _is_substantial(message) -> bool:
    text = message.message or ""
    if text.strip():
        return True
    return getattr(message, "media", None) is not None


async def _backfill_chat_async(
    settings: Settings,
    db: Database,
    chat_id: int,
    days: int,
) -> int:
    client = TelegramClient(
        settings.telethon_session,
        settings.telegram_api_id,
        settings.telegram_api_hash,
    )
    await client.start()
    me = await client.get_me()
    if me is None or getattr(me, "bot", False):
        raise RuntimeError("Telethon session must be a user account")

    entity = await client.get_entity(chat_id)
    if not _is_supported_chat(entity):
        logger.warning("Skipping chat_id=%s: unsupported dialog type", chat_id)
        await client.disconnect()
        return 0

    since = datetime.now(timezone.utc) - timedelta(days=days)
    saved = 0
    scanned = 0
    async for message in client.iter_messages(entity, offset_date=since, reverse=True):
        scanned += 1
        if not _is_substantial(message):
            continue
        inserted = db.save_message(
            chat_id=entity.id,
            msg_id=message.id,
            date_utc=message.date,
            sender_id=message.sender_id,
            text=(message.message or "").strip(),
            raw_json=message.to_dict() if hasattr(message, "to_dict") else None,
        )
        if inserted:
            saved += 1

    await client.disconnect()
    logger.info(
        "Backfill completed chat_id=%s days=%s scanned=%s inserted=%s",
        chat_id,
        days,
        scanned,
        saved,
    )
    return saved


def backfill_chat(settings: Settings, db: Database, chat_id: int, days: int) -> int:
    return asyncio.run(_backfill_chat_async(settings, db, chat_id, days))


def backfill_enabled_chats(settings: Settings, db: Database, days: int) -> dict[int, int]:
    results: dict[int, int] = {}
    for chat_id in sorted(db.get_enabled_chat_ids()):
        try:
            results[chat_id] = backfill_chat(settings, db, chat_id, days)
        except Exception:
            logger.exception("Backfill failed for chat_id=%s", chat_id)
            results[chat_id] = 0
    return results
