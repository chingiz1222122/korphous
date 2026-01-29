from __future__ import annotations

import asyncio
import logging

from app.bot_app import run_bot
from app.config import load_settings
from app.telethon_reader import run_reader


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    loop = asyncio.get_event_loop()
    loop.run_until_complete(_run(settings))


async def _run(settings) -> None:
    await asyncio.gather(run_reader(settings), run_bot(settings))


if __name__ == "__main__":
    main()
