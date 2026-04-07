from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from openai import OpenAI


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LlmResult:
    text: str
    source_indexes: list[int]


class LlmService:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = OpenAI(api_key=api_key, timeout=40.0)
        self.model = model

    @staticmethod
    def _extract_indexes(text: str, max_index: int) -> list[int]:
        found = []
        for raw in re.findall(r"\[(\d+)]", text):
            value = int(raw)
            if 1 <= value <= max_index and value not in found:
                found.append(value)
        return found

    def answer_question(self, question: str, context: str, max_index: int) -> LlmResult:
        system_prompt = (
            "Ты помощник, отвечающий только на основе переданного контекста Telegram. "
            "Не выдумывай факты. Если данных мало — честно скажи об этом. "
            "Пиши по-русски кратко и полезно. В ответе обязательно делай ссылки на источники в формате [n]."
        )
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Вопрос: {question}\n\nКонтекст:\n{context}",
                },
            ],
        )
        text = response.choices[0].message.content or "Не удалось получить ответ модели."
        idx = self._extract_indexes(text, max_index)
        return LlmResult(text=text, source_indexes=idx)

    def make_digest(self, query: str | None, context: str, max_index: int) -> LlmResult:
        system_prompt = (
            "Сделай краткую структурированную сводку по контексту Telegram. "
            "Раздели ответ на блоки: Главное, События/дедлайны, Риски/изменения. "
            "Пиши по-русски. Добавляй ссылки на источники в формате [n]."
        )
        user_prompt = "Сделай дайджест."
        if query:
            user_prompt = f"Сделай тематический дайджест по теме: {query}."

        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0.3,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"{user_prompt}\n\nКонтекст:\n{context}"},
            ],
        )
        text = response.choices[0].message.content or "Не удалось получить дайджест."
        idx = self._extract_indexes(text, max_index)
        return LlmResult(text=text, source_indexes=idx)
