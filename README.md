# Telegram Local Ingestion (Stage 1)

Stage 1 реализует только ingestion слой:
- Telethon collector (user session)
- надежный SQLite слой
- backfill истории

## Что делает collector
- Подключается как user через file session (`TELETHON_SESSION`).
- Проверяет, что сессия не bot account.
- Сидирует список чатов (group/supergroup/channel) в таблицу `chats`.
- Игнорирует private dialogs.
- Слушает `events.NewMessage` и сохраняет сообщения только из enabled-чатов.
- Подхватывает изменения enabled через refresh кеша (без перезапуска).

## База данных
Таблицы:
- `chats(chat_id, title, username, chat_type, enabled, updated_at)`
- `messages(chat_id, msg_id, date_utc, sender_id, text, raw_json, created_at)`
- `state(key, value, updated_at)`

Надежность:
- WAL mode
- busy_timeout
- retry на `database is locked`
- composite PK `(chat_id, msg_id)` для защиты от дублей

## Backfill
- `backfill_chat(chat_id, days)` — точечный backfill.
- `backfill_enabled_chats(days)` — bulk backfill по всем enabled чатам.
- Повторный запуск не дублирует сообщения.

## Setup (macOS, Python 3.11/3.12 recommended)
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Run collector
```bash
python scripts/run_collector.py
```

## Backfill one chat
```bash
python scripts/backfill_chat.py --chat-id -1001234567890 --days 7
```

## Backfill all enabled chats
```bash
python scripts/backfill_enabled.py --days 3
```
