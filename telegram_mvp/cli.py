from __future__ import annotations

import argparse
import asyncio

from telethon import TelegramClient

from telegram_mvp.config import load_settings
from telegram_mvp.db import MessageStore
from telegram_mvp.ingest import ingest_chat
from telegram_mvp.summary import build_summary, format_summary


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Telegram monitoring MVP")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="Ingest new messages")
    ingest_parser.add_argument(
        "--chat",
        action="append",
        dest="chats",
        default=[],
        help="Chat username or ID (can be repeated)",
    )

    summary_parser = subparsers.add_parser("summary", help="Build daily summary")
    summary_parser.add_argument(
        "--hours",
        type=int,
        default=None,
        help="Period in hours (defaults to SUMMARY_PERIOD_HOURS)",
    )
    summary_parser.add_argument(
        "--keywords",
        default=None,
        help="Comma-separated keywords override",
    )

    return parser


async def _run_ingest(settings, chats):
    if not chats:
        raise RuntimeError("No chats provided. Set CHAT_LIST or use --chat.")
    store = MessageStore(settings.database_path)
    async with TelegramClient(settings.session_name, settings.api_id, settings.api_hash) as client:
        total = 0
        for chat in chats:
            total += await ingest_chat(client, store, chat)
        print(f"Added {total} messages")


def _run_summary(settings, hours, keywords_override):
    store = MessageStore(settings.database_path)
    keywords = settings.summary_keywords
    if keywords_override is not None:
        keywords = [item.strip() for item in keywords_override.split(",") if item.strip()]
    period = hours or settings.summary_period_hours
    messages = build_summary(store, period, keywords)
    print(format_summary(messages))


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    settings = load_settings()

    if args.command == "ingest":
        chats = args.chats or settings.chat_list
        asyncio.run(_run_ingest(settings, chats))
        return

    if args.command == "summary":
        _run_summary(settings, args.hours, args.keywords)
        return

    raise RuntimeError("Unknown command")


if __name__ == "__main__":
    main()
