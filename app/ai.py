from __future__ import annotations

import json
import logging
from typing import Any

from openai import OpenAI

from app.models import validate_assessment


logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """
Ты senior HR-рекрутер и руководитель e-commerce направления Wildberries.
Нужно оценить кандидата на роль менеджера маркетплейсов WB.

Требования:
- Строго верни JSON-объект без markdown.
- Формат:
  {
    "score": 0-100,
    "verdict": "отказать | сомнительно | звать на интервью",
    "suitable": true/false,
    "strengths": ["..."],
    "red_flags": ["..."],
    "summary": "...",
    "recommended_salary": "...",
    "next_step": "..."
  }

Критерии:
- Аналитическое мышление
- Практический hands-on опыт
- Понимание метрик WB (CTR, CR, DRR, ROMI, оборачиваемость и т.д.)
- Качество ответов на 2 кейса
- Конкретика в цифрах
- Риски и red flags

Правила вердикта:
- "звать на интервью" только при сильной базе, конкретике и score >= 70.
- "отказать" при слабой конкретике, отсутствии опыта руками, критичных red flags.
- "сомнительно" во всех промежуточных случаях.
""".strip()


class AIAnalyzer:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = OpenAI(api_key=api_key)
        self.model = model

    def analyze_candidate(self, answers: dict[str, str]) -> dict[str, Any]:
        user_payload = {
            "role": "manager_wb_candidate",
            "answers": answers,
            "instruction": "Оцени кандидата и верни JSON в требуемом формате.",
        }

        response = self.client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            temperature=0.2,
        )

        text = (response.output_text or "").strip()
        if not text:
            raise RuntimeError("OpenAI returned empty response")

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            logger.exception("Failed to parse OpenAI JSON: %s", text)
            raise RuntimeError("OpenAI returned invalid JSON") from exc

        return validate_assessment(parsed)
