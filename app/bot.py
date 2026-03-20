from __future__ import annotations

import logging
from typing import Any

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from app.ai import AIAnalyzer
from app.config import Settings
from app.db import CandidateRepository
from app.questions import QUESTION_ORDER, build_questions
from app.sheets import SheetsWriter

logger = logging.getLogger(__name__)


class HiringBot:
    def __init__(
        self,
        settings: Settings,
        repo: CandidateRepository,
        analyzer: AIAnalyzer,
        sheets: SheetsWriter,
    ) -> None:
        self.settings = settings
        self.repo = repo
        self.analyzer = analyzer
        self.sheets = sheets
        self.questions = build_questions(settings.min_answer_length, settings.min_case_answer_length)

    def build_application(self) -> Application:
        app = Application.builder().token(self.settings.telegram_token).build()
        app.add_handler(CommandHandler("start", self.start_cmd))
        app.add_handler(CommandHandler("restart", self.restart_cmd))
        app.add_handler(CommandHandler("stats", self.stats_cmd))
        app.add_handler(CommandHandler("last", self.last_cmd))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_message))
        app.add_error_handler(self.on_error)
        return app

    async def start_cmd(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await self._start_interview(update, context, is_restart=False)

    async def restart_cmd(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await self._start_interview(update, context, is_restart=True)

    async def _start_interview(
        self,
        update: Update,
        context: ContextTypes.DEFAULT_TYPE,
        is_restart: bool,
    ) -> None:
        user = update.effective_user
        if not user or not update.message:
            return

        candidate_id = self.repo.create_candidate(user.id, user.username)
        context.user_data.clear()
        context.user_data["candidate_id"] = candidate_id
        context.user_data["answers"] = {}
        context.user_data["q_idx"] = 0

        intro = (
            "Начинаем интервью на позицию менеджера WB. "
            "Я задам 13 вопросов, включая 2 кейса. "
            "Важно отвечать конкретно и с цифрами — это повышает шанс пройти дальше."
        )
        if is_restart:
            intro = "Ок, начинаем заново. " + intro
        await update.message.reply_text(intro)
        await self._ask_next_question(update, context)

    async def stats_cmd(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        stats = self.repo.get_stats()
        text = (
            "📊 Статистика:\n"
            f"Всего кандидатов: {stats['total']}\n"
            f"Завершили интервью: {stats['completed']}\n"
            f"Сильные кандидаты: {stats['strong']}\n"
            f"Ошибки: {stats['errored']}"
        )
        await update.message.reply_text(text)

    async def last_cmd(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        rows = self.repo.get_last_candidates(limit=5)
        if not rows:
            await update.message.reply_text("Пока нет кандидатов.")
            return

        chunks = []
        for row in rows:
            chunks.append(
                "\n".join(
                    [
                        f"#{row['id']} — {row.get('full_name') or 'Без имени'}",
                        f"Статус: {row.get('status')}",
                        f"Score: {row.get('score')}",
                        f"Вердикт: {row.get('verdict')}",
                    ]
                )
            )
        await update.message.reply_text("\n\n".join(chunks))

    async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return

        if "candidate_id" not in context.user_data:
            await update.message.reply_text("Напишите /start, чтобы начать интервью.")
            return

        text = (update.message.text or "").strip()
        idx = int(context.user_data.get("q_idx", 0))
        if idx >= len(QUESTION_ORDER):
            await update.message.reply_text("Интервью уже завершено. Напишите /restart для повторного прохождения.")
            return

        key = QUESTION_ORDER[idx]
        question = self.questions[key]

        if not self._is_answer_valid(text, question.min_length):
            await update.message.reply_text(
                f"Ответ слишком короткий. {question.hint}\n"
                f"Минимум ~{question.min_length} символов."
            )
            return

        self.repo.update_answer(int(context.user_data["candidate_id"]), key, text)
        answers: dict[str, str] = context.user_data["answers"]
        answers[key] = text
        context.user_data["q_idx"] = idx + 1

        if idx + 1 < len(QUESTION_ORDER):
            await self._ask_next_question(update, context)
            return

        await update.message.reply_text("Спасибо! Анализирую ответы, это займёт до 20 секунд…")
        await self._finalize_candidate(update, context)

    async def _ask_next_question(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        idx = int(context.user_data.get("q_idx", 0))
        question = self.questions[QUESTION_ORDER[idx]]
        prefix = "🧩 " if question.is_case else ""
        await update.message.reply_text(f"{prefix}{question.text}")

    @staticmethod
    def _is_answer_valid(answer: str, min_length: int) -> bool:
        if len(answer) < min_length:
            return False
        tokens = answer.split()
        return len(tokens) >= 3

    async def _finalize_candidate(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        candidate_id = int(context.user_data["candidate_id"])
        answers: dict[str, str] = context.user_data["answers"]
        try:
            assessment = self.analyzer.analyze_candidate(answers)
            self.repo.save_assessment(candidate_id, assessment)
            candidate = self.repo.get_candidate(candidate_id)
            if not candidate:
                raise RuntimeError("Candidate not found after save")

            self.sheets.append_candidate(candidate)

            await self._notify_candidate(update, assessment)
            if assessment["score"] >= 70 and assessment["verdict"] == "звать на интервью":
                await self._notify_recruiter(context, candidate, assessment)
        except Exception:
            logger.exception("Failed to finalize candidate %s", candidate_id)
            self.repo.mark_error(candidate_id)
            await update.message.reply_text(
                "Упс, произошла техническая ошибка при анализе. "
                "Мы уже сохранили ваш прогресс, пожалуйста попробуйте /restart чуть позже."
            )

    async def _notify_candidate(self, update: Update, assessment: dict[str, Any]) -> None:
        if not update.message:
            return
        short_summary = assessment["summary"]
        text = (
            "✅ Интервью завершено. Спасибо за ответы!\n\n"
            f"Предварительный результат: *{assessment['verdict']}* (score {assessment['score']}/100)\n"
            f"Кратко: {short_summary}\n\n"
            "Если профиль подходит, мы свяжемся с вами по следующему этапу."
        )
        await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)

    async def _notify_recruiter(
        self,
        context: ContextTypes.DEFAULT_TYPE,
        candidate: dict[str, Any],
        assessment: dict[str, Any],
    ) -> None:
        strengths = "\n- " + "\n- ".join(assessment["strengths"]) if assessment["strengths"] else "\n- нет"
        red_flags = "\n- " + "\n- ".join(assessment["red_flags"]) if assessment["red_flags"] else "\n- нет"

        message = (
            "🔥 *Сильный кандидат WB*\n"
            f"Имя: {candidate.get('full_name')}\n"
            f"Опыт: {candidate.get('wb_experience')}\n"
            f"Оборот: {candidate.get('max_turnover')}\n"
            f"Score: {assessment['score']}\n"
            f"Вердикт: {assessment['verdict']}\n"
            f"Сильные стороны:{strengths}\n"
            f"Слабые стороны / red flags:{red_flags}\n\n"
            f"Кейс 1: {candidate.get('case_sales_drop')}\n\n"
            f"Кейс 2: {candidate.get('case_low_conversion')}"
        )

        await context.bot.send_message(
            chat_id=self.settings.recruiter_chat_id,
            text=message,
            parse_mode=ParseMode.MARKDOWN,
        )

    async def on_error(self, update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        logger.exception("Telegram update handling error", exc_info=context.error)


def render_webhook_url(settings: Settings) -> str | None:
    if not settings.webhook_base_url:
        return None
    base = settings.webhook_base_url.rstrip("/")
    secret = settings.webhook_secret or "wb-hiring"
    return f"{base}/{secret}"
