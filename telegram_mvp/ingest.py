from __future__ import annotations

import datetime as dt
from typing import Iterable, List

from telethon import TelegramClient
from telethon.tl.custom import Message

from telegram_mvp.db import MessageRecord, MessageStore
from telegram_mvp.links import message_link


async def _fetch_messages(
    client: TelegramClient,
    chat: str,
    since: dt.datetime | None,
) -> Iterable[Message]:
    return client.iter_messages(chat, offset_date=since, reverse=True)


async def ingest_chat(
    client: TelegramClient,
    store: MessageStore,
    chat: str,
) -> int:
    entity = await client.get_entity(chat)
    chat_id = entity.id
    username = getattr(entity, "username", None)
    since_iso = store.latest_message_date(chat_id)
    since = dt.datetime.fromisoformat(since_iso) if since_iso else None

    records: List[MessageRecord] = []
    async for message in await _fetch_messages(client, chat, since):
        if not message.message:
            continue
        permalink = message_link(chat_id, message.id, username)
        records.append(
            MessageRecord(
                chat_id=chat_id,
                message_id=message.id,
                date_iso=message.date.isoformat(),
                text=message.message,
                sender_id=message.sender_id,
                permalink=permalink,
            )
        )

    return store.insert_messages(records)


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()
