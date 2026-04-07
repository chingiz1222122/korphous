from __future__ import annotations

from pathlib import Path

from app.collector import run_collector
from app.config import load_settings
from app.logging_setup import setup_logging


def main() -> None:
    settings = load_settings()
    setup_logging(settings.log_level, log_file=Path("logs/collector.log"))
    run_collector(settings)


if __name__ == "__main__":
    main()
