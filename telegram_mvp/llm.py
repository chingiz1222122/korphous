from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency
    OpenAI = None  # type: ignore[assignment]

from telegram_mvp.db import MessageRecord


@dataclass(frozen=True)
class LlmConfig:
    api_key: Optional[str]
    model: str


def build_llm_prompt(question: str, messages: List[MessageRecord]) -> str:
    lines = [
        "Ты помощник, который отвечает на вопросы по сообщениям Telegram.",
        "Отвечай кратко и только на основе предоставленных сообщений.",
        "Каждый факт должен иметь ссылку на сообщение.",
        "",
        f"Вопрос: {question}",
        "",
        "Сообщения:",
    ]
    for message in messages:
        excerpt = message.text.strip().replace("\n", " ")
        if len(excerpt) > 300:
            excerpt = f"{excerpt[:297]}..."
        lines.append(f"- {excerpt} ({message.permalink})")
    return "\n".join(lines)


def generate_answer(
    config: LlmConfig,
    question: str,
    messages: List[MessageRecord],
) -> str:
    if not messages:
        return "Сообщений за выбранный период не найдено, поэтому ответ сформировать нельзя."

    if not config.api_key or OpenAI is None:
        return "LLM не настроен. Используйте сводку из сообщений ниже."

    try:
        client = OpenAI(api_key=config.api_key)
        prompt = build_llm_prompt(question, messages)
        response = client.responses.create(
            model=config.model,
            input=prompt,
        )
        answer = response.output_text.strip()
        if answer:
            return answer
    except Exception:
        pass

    return "Не удалось получить ответ LLM. Используйте сводку из сообщений ниже."
