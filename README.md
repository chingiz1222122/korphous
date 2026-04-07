# Telegram RAG Bot (Local)

## Что делает бот
- Раз в 24 часа Telethon запускает **batch-парсинг только включенных каналов** (не личек).
- Сырые сообщения сохраняются локально в SQLite (`./data/telegram.sqlite`).
- Через Bot API (python-telegram-bot) доступны owner-only команды:
  - `/chats` — показать каналы и переключить enable/disable.
  - `/ask <вопрос>` — ответ по локальной базе за окно времени (по умолчанию 24ч).
  - `/digest <hours>` — сводка важного за период.
- Для ответов/сводок используется OpenAI, в ответе возвращаются ссылки на исходные сообщения.

## Локальное хранение данных
- Все данные живут только на вашем Mac в `SQLITE_PATH`.
- Основные таблицы:
  - `chats` — каталог каналов + флаг `enabled`.
  - `messages` — спарсенные сообщения с `permalink`.
  - `ingestion_state` — когда канал парсился в последний раз.

## Setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Заполните `.env` вашими ключами.

## Run

```bash
python -m app.main
```

## Формат ссылок
- Если у канала есть username: `https://t.me/<username>/<msg_id>`.
- Иначе fallback: `https://t.me/c/<internal_id>/<msg_id>`.
