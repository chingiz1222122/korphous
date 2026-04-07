from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from telethon import TelegramClient, events
from telethon.tl.types import Channel, Chat

from app.config import Settings
from app.db import Database


logger = logging.getLogger(__name__)


@dataclass
class EnabledCache:
    ids: set[int]
    loaded_at: float


class Collector:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self.client = TelegramClient(
            settings.telethon_session,
            settings.telegram_api_id,
            settings.telegram_api_hash,
        )
        self.enabled_cache = EnabledCache(ids=set(), loaded_at=0.0)

    def _chat_type(self, entity: object) -> str | None:
        if isinstance(entity, Channel):
            return "channel" if bool(getattr(entity, "broadcast", False)) else "supergroup"
        if isinstance(entity, Chat):
            return "group"
        return None

    def _is_supported_dialog(self, entity: object) -> bool:
        return self._chat_type(entity) is not None

    def _refresh_enabled_cache_if_needed(self, force: bool = False) -> None:
        now = time.time()
        ttl = self.settings.enabled_refresh_seconds
        if force or (now - self.enabled_cache.loaded_at) >= ttl:
            self.enabled_cache = EnabledCache(ids=self.db.get_enabled_chat_ids(), loaded_at=now)

    def _is_substantial_message(self, message: events.NewMessage.Event) -> bool:
        text = message.message.message or ""
        if text.strip():
            return True
        media = getattr(message.message, "media", None)
        return media is not None

    async def ensure_user_session(self) -> None:
        me = await self.client.get_me()
        if me is None or getattr(me, "bot", False):
            raise RuntimeError("Telethon session must be a user account, not a bot account")
        logger.info("Connected as user id=%s", me.id)

    async def seed_chats(self) -> int:
        seeded = 0
        async for dialog in self.client.iter_dialogs():
            entity = dialog.entity
            if not self._is_supported_dialog(entity):
                continue
            self.db.upsert_chat(
                chat_id=entity.id,
                title=getattr(entity, "title", dialog.name),
                username=getattr(entity, "username", None),
                chat_type=self._chat_type(entity) or "unknown",
            )
            seeded += 1
        self.db.set_state("last_seed_utc", str(int(time.time())))
        logger.info("Seeded/updated chats: %s", seeded)
        return seeded

    async def handle_new_message(self, event: events.NewMessage.Event) -> None:
        try:
            if event.is_private:
                return
            chat = await event.get_chat()
            if not self._is_supported_dialog(chat):
                return
            self._refresh_enabled_cache_if_needed()
            if chat.id not in self.enabled_cache.ids:
                return
            if not self._is_substantial_message(event):
                return
            saved = self.db.save_message(
                chat_id=chat.id,
                msg_id=event.id,
                date_utc=event.message.date,
                sender_id=event.sender_id,
                text=(event.message.message or "").strip(),
                raw_json=event.message.to_dict() if hasattr(event.message, "to_dict") else None,
            )
            if saved:
                logger.info("Saved message chat_id=%s msg_id=%s", chat.id, event.id)
        except Exception:
            logger.exception("Error while processing new message")

    async def run(self) -> None:
        self.db.init_db()
        await self.client.start()
        await self.ensure_user_session()
        await self.seed_chats()
        self._refresh_enabled_cache_if_needed(force=True)

        self.client.add_event_handler(self.handle_new_message, events.NewMessage())
        logger.info("Collector started and listening for new messages")
        await self.client.run_until_disconnected()


def run_collector(settings: Settings) -> None:
    db = Database(
        settings.sqlite_path,
        lock_retry_attempts=settings.lock_retry_attempts,
        lock_retry_delay_seconds=settings.lock_retry_delay_seconds,
    )
    collector = Collector(settings, db)
    asyncio.run(collector.run())
