# Telegram Monitoring MVP

Этот MVP-скелет собирает сообщения из выбранных публичных чатов/каналов через MTProto (Telethon), сохраняет их в SQLite и формирует суточную сводку с ссылками на сообщения. Также добавлен Telegram Bot API для общения и LLM-ответов.

## Возможности
- Сбор сообщений из списка чатов (username или chat ID).
- Хранение сообщений в SQLite.
- Сводка за последние N часов с фильтрацией по ключевым словам.
- Генерация ссылок на сообщения.
- Телеграм-бот: ответы на вопросы и команда `/summary`.
- LLM-ответы на основе найденных сообщений.

## Требования
- Python 3.10+
- Telegram API ID/Hash (https://my.telegram.org)
- BOT_TOKEN (BotFather)

## Установка
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Настройка окружения
Создайте `.env` (или экспортируйте переменные окружения):

```
TG_API_ID=123456
TG_API_HASH=abcdef1234567890
TG_SESSION=monitoring_session
DATABASE_PATH=./telegram_messages.db
CHAT_LIST=@channel1,@channel2
SUMMARY_KEYWORDS=митап,ивент,регистрация,вебинар
SUMMARY_PERIOD_HOURS=24
BOT_TOKEN=123456:ABCDEF
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2
OWNER_USER_ID=123456789
```

## Запуск
### 1) Сбор сообщений
```bash
python -m telegram_mvp.cli ingest
```

### 2) Получение сводки за сутки
```bash
python -m telegram_mvp.cli summary
```

### 3) Запуск Telegram-бота
```bash
python -m telegram_mvp.bot
```

## Что дальше
- Добавить планировщик (cron/apscheduler) для автосводки.
- Расширить фильтры и семантический поиск.

## Безопасность
Храните `.env` и сессии Telethon в защищённом месте. Не публикуйте API ID/Hash и токены.
