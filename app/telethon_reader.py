from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from telethon import TelegramClient
from telethon.tl.types import Channel

from app.config import Settings
from app.db import (
    ChatRecord,
    MessageRecord,
    get_enabled_chat_ids,
    get_last_ingestion_run,
    init_db,
    insert_message,
    set_last_ingestion_run,
    upsert_chat,
)
from app.utils import format_message_link


logger = logging.getLogger(__name__)
SYNC_INTERVAL_SECONDS = 24 * 60 * 60


def _is_channel(entity: object) -> bool:
    return isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False))


async def _sync_channels_catalog(client: TelegramClient, settings: Settings) -> None:
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not _is_channel(entity):
            continue
        upsert_chat(
            settings.sqlite_path,
            ChatRecord(
                chat_id=entity.id,
                title=getattr(entity, "title", dialog.name),
                username=getattr(entity, "username", None),
                enabled=False,
            ),
        )


def _message_record(chat: Channel, message) -> MessageRecord:
    return MessageRecord(
        chat_id=chat.id,
        chat_title=chat.title or "",
        chat_username=getattr(chat, "username", None),
        msg_id=message.id,
        sender_id=message.sender_id,
        date=message.date.astimezone(timezone.utc),
        text=message.message or "",
        permalink=format_message_link(chat.id, getattr(chat, "username", None), message.id),
    )


async def _ingest_channel(client: TelegramClient, settings: Settings, chat_id: int) -> int:
    chat = await client.get_entity(chat_id)
    if not _is_channel(chat):
        return 0

    last_run = get_last_ingestion_run(settings.sqlite_path, chat_id)
    default_start = datetime.now(timezone.utc) - timedelta(hours=24)
    since = last_run or default_start

    inserted = 0
    async for message in client.iter_messages(chat, offset_date=since, reverse=True):
        if not message.message or not message.message.strip():
            continue
        insert_message(settings.sqlite_path, _message_record(chat, message))
        inserted += 1

    set_last_ingestion_run(settings.sqlite_path, chat_id, datetime.now(timezone.utc))
    logger.info("Ingested %s messages from channel %s", inserted, chat_id)
    return inserted


async def run_reader(settings: Settings) -> None:
    init_db(settings.sqlite_path)
    client = TelegramClient(
        settings.telethon_session,
        settings.telegram_api_id,
        settings.telegram_api_hash,
    )

    await client.start()
    await _sync_channels_catalog(client, settings)
    logger.info("Telethon daily channel ingester started")

    while True:
        try:
            enabled_chat_ids = get_enabled_chat_ids(settings.sqlite_path)
            for chat_id in enabled_chat_ids:
                await _ingest_channel(client, settings, chat_id)
        except Exception:
            logger.exception("Daily ingest iteration failed")
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)
