from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from app.config import load_settings
from app.db import Database
from app.embeddings import EmbeddingService, vector_to_json
from app.logging_setup import setup_logging


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--limit", type=int, default=2000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    setup_logging(settings.log_level)
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    service = EmbeddingService(settings.openai_api_key, settings.embedding_model)

    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).isoformat()
    remaining = args.limit
    inserted = 0
    while remaining > 0:
        batch = min(remaining, 200)
        rows = db.fetch_messages_for_embedding(since_iso=since, embedding_model=settings.embedding_model, limit=batch)
        if not rows:
            break
        for row in rows:
            text = (row["text"] or "").strip()
            if len(text) < 20:
                continue
            emb = service.embed_text(text)
            db.upsert_message_embedding(
                chat_id=row["chat_id"],
                msg_id=row["msg_id"],
                embedding_model=settings.embedding_model,
                embedding_vector=vector_to_json(emb.vector),
                text_hash=emb.text_hash,
            )
            inserted += 1
        remaining -= len(rows)
    print(f"embedded_backfill={inserted}")


if __name__ == "__main__":
    main()
