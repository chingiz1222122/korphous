import unittest

from telegram_mvp.db import MessageRecord
from telegram_mvp.llm import LlmConfig, build_llm_prompt, generate_answer


class LlmTests(unittest.TestCase):
    def test_build_prompt_includes_links(self):
        msg = MessageRecord(
            chat_id=1,
            message_id=1,
            date_iso="2026-01-01T00:00:00+00:00",
            text="Анонс митапа в пятницу",
            sender_id=1,
            permalink="https://t.me/test/1",
        )
        prompt = build_llm_prompt("Какие мероприятия?", [msg])
        self.assertIn("https://t.me/test/1", prompt)

    def test_generate_answer_without_messages(self):
        cfg = LlmConfig(api_key="dummy", model="gpt-5.2")
        answer = generate_answer(cfg, "Что важного?", [])
        self.assertIn("не найдено", answer.lower())


if __name__ == "__main__":
    unittest.main()
