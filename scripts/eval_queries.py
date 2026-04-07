from __future__ import annotations

import argparse

from app.config import load_settings
from app.db import Database
from app.embeddings import EmbeddingService
from app.hybrid_retrieval import retrieve_hybrid
from app.logging_setup import setup_logging


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", action="append", required=True)
    parser.add_argument("--period", default="30d")
    parser.add_argument("--top", type=int, default=8)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    emb = EmbeddingService(settings.openai_api_key, settings.embedding_model)

    enabled = sorted(db.get_enabled_chat_ids())
    for q in args.query:
        print("=" * 80)
        print(f"QUERY: {q}")
        results, intent, stats = retrieve_hybrid(db, emb, q, args.period, enabled or None, top_n=args.top)
        print(f"INTENTS: {intent.intents} | STATS: {stats}")
        for i, item in enumerate(results, start=1):
            print(f"[{i}] score={item.final_score:.3f} chat={item.chat_title} id={item.chat_id}/{item.msg_id}")
            print(f"    {item.text[:180]}")
            print(f"    {item.link}")


if __name__ == "__main__":
    main()
