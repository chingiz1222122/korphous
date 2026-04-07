from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass

from openai import OpenAI


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddingResult:
    vector: list[float]
    text_hash: str


class EmbeddingService:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = OpenAI(api_key=api_key, timeout=40.0)
        self.model = model

    @staticmethod
    def text_hash(text: str) -> str:
        return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()

    def embed_text(self, text: str) -> EmbeddingResult:
        clean = text.strip()
        response = self.client.embeddings.create(model=self.model, input=clean)
        vector = response.data[0].embedding
        return EmbeddingResult(vector=vector, text_hash=self.text_hash(clean))


def vector_to_json(vector: list[float]) -> str:
    return json.dumps(vector, ensure_ascii=False)


def vector_from_json(raw: str) -> list[float]:
    return json.loads(raw)
