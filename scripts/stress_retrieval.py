from __future__ import annotations

import argparse
import time

from app.config import load_settings
from app.db import Database
from app.embeddings import EmbeddingService
from app.hybrid_retrieval import retrieve_hybrid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loops", type=int, default=20)
    parser.add_argument("--period", default="30d")
    parser.add_argument("--query", default="что по поставкам и оплатам")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = load_settings()
    db = Database(settings.sqlite_path, settings.lock_retry_attempts, settings.lock_retry_delay_seconds)
    db.init_db()
    emb = EmbeddingService(settings.openai_api_key, settings.embedding_model)
    chats = sorted(db.get_enabled_chat_ids())

    latencies = []
    for _ in range(args.loops):
        t0 = time.perf_counter()
        results, intent, stats = retrieve_hybrid(db, emb, args.query, args.period, chats or None, top_n=20)
        latencies.append(time.perf_counter() - t0)
    print(f"retrieval_loops={args.loops}")
    print(f"latency_avg={sum(latencies)/len(latencies):.3f}s latency_max={max(latencies):.3f}s")


if __name__ == "__main__":
    main()
