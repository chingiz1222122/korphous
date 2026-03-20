# WB Hiring Telegram Bot

Production-ready Telegram-бот для найма менеджера маркетплейсов Wildberries.

## Что делает система

- Проводит структурированное интервью с кандидатом в Telegram.
- Задаёт обязательные вопросы и 2 кейса.
- Проверяет минимальную полноту ответа (анти-"односложные ответы").
- Анализирует ответы через OpenAI Responses API.
- Возвращает структурированную оценку (score/verdict/red flags).
- Сохраняет всех кандидатов в SQLite.
- Записывает всех кандидатов в Google Sheets (`WB Candidates`).
- Отправляет рекрутеру в Telegram только сильных кандидатов:
  - `score >= 70`
  - `verdict == "звать на интервью"`

---

## Архитектура

```text
Candidate (Telegram)
   -> python-telegram-bot handlers
      -> SQLite repository (answers + status + score)
      -> OpenAI Responses API (AI assessment JSON)
      -> Google Sheets (append + color coding)
      -> Recruiter Telegram notifications (only strong)
```

### Модули

- `app/main.py` — точка входа, запуск polling/webhook.
- `app/config.py` — ENV-конфиг.
- `app/bot.py` — Telegram-логика, команды и интервью-сценарий.
- `app/questions.py` — банк вопросов и требования к минимальной длине.
- `app/ai.py` — OpenAI интеграция и валидация JSON оценки.
- `app/db.py` — SQLite слой, статистика, хранение кандидатов.
- `app/sheets.py` — запись в Google Sheets + цветовая маркировка.

---

## Требования

- Python 3.11+
- Telegram bot token
- OpenAI API key
- Google service account JSON с доступом к Google Sheet

---

## Настройка

1. Установите зависимости:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Создайте `.env` из примера:

```bash
cp .env.example .env
```

3. Заполните `.env`:

- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `RECRUITER_CHAT_ID` (ваш telegram chat id)
- `GOOGLE_SERVICE_ACCOUNT_JSON`

4. Создайте Google таблицу **WB Candidates** (или имя из `GOOGLE_SHEET_NAME`) и откройте доступ service-account email.

5. Запуск (polling):

```bash
set -a && source .env && set +a
python -m app.main
```

---

## Команды бота

- `/start` — начать интервью
- `/restart` — начать заново
- `/stats` — статистика по кандидатам
- `/last` — последние кандидаты

---

## Формат AI-оценки (обязательный JSON)

```json
{
  "score": 0,
  "verdict": "отказать | сомнительно | звать на интервью",
  "suitable": false,
  "strengths": [],
  "red_flags": [],
  "summary": "",
  "recommended_salary": "",
  "next_step": ""
}
```

---

## Webhook режим

Если задать:

- `WEBHOOK_BASE_URL=https://your-domain.com`
- `WEBHOOK_SECRET=super-secret-path`

бот запустится через webhook на `APP_PORT`, иначе — polling.

---

## Docker

```bash
docker build -t wb-hiring-bot .
docker run --env-file .env -v $(pwd)/credentials:/app/credentials wb-hiring-bot
```

---

## Логирование и отказоустойчивость

- Ошибки обработки апдейтов логируются.
- Ошибки финализации кандидата помечаются статусом `error` в SQLite.
- Прогресс интервью сохраняется после каждого ответа.

