from __future__ import annotations

import logging
from datetime import timezone

from telethon import TelegramClient, events
from telethon.tl.types import Channel, Chat

from app.config import Settings
from app.db import ChatRecord, MessageRecord, get_enabled_chat_ids, init_db, insert_message, upsert_chat
from app.utils import format_message_link


logger = logging.getLogger(__name__)


def _is_group_or_channel(entity: object) -> bool:
    return isinstance(entity, (Channel, Chat))


async def _sync_dialogs(client: TelegramClient, settings: Settings) -> None:
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not _is_group_or_channel(entity):
            continue
        chat_id = entity.id if hasattr(entity, "id") else dialog.id
        username = getattr(entity, "username", None)
        title = getattr(entity, "title", None) or dialog.name
        upsert_chat(
            settings.sqlite_path,
            ChatRecord(chat_id=chat_id, title=title, username=username, enabled=False),
        )


def _message_record(
    event: events.NewMessage.Event,
    title: str,
    username: str | None,
    permalink: str,
) -> MessageRecord:
    return MessageRecord(
        chat_id=event.chat_id,
        chat_title=title,
        chat_username=username,
        msg_id=event.id,
        sender_id=event.sender_id,
        date=event.message.date.astimezone(timezone.utc),
        text=event.message.message or "",
        permalink=permalink,
    )


async def run_reader(settings: Settings) -> None:
    init_db(settings.sqlite_path)
    client = TelegramClient(
        settings.telethon_session,
        settings.telegram_api_id,
        settings.telegram_api_hash,
    )

    await client.start()
    await _sync_dialogs(client, settings)

    @client.on(events.NewMessage())
    async def handle_message(event: events.NewMessage.Event) -> None:
        if event.is_private:
            return
        chat = await event.get_chat()
        if not _is_group_or_channel(chat):
            return
        enabled_chat_ids = get_enabled_chat_ids(settings.sqlite_path)
        if chat.id not in enabled_chat_ids:
            return
        message_text = event.message.message or ""
        if not message_text.strip():
            return
        permalink = format_message_link(chat.id, getattr(chat, "username", None), event.id)
        record = _message_record(
            event,
            title=chat.title or "",
            username=getattr(chat, "username", None),
            permalink=permalink,
        )
        insert_message(settings.sqlite_path, record)
        logger.info("Saved message %s from chat %s", event.id, chat.id)

    logger.info("Telethon reader started")
    await client.run_until_disconnected()
