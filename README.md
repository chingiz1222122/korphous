# Telegram RAG Bot (Local)

## Overview
Local macOS-only Telegram setup with:
- Telethon user session that reads only enabled group/channel chats and stores messages in SQLite.
- python-telegram-bot for owner-only commands.
- OpenAI for answers and digests with source links.

## Setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your credentials.

## Run

```bash
python -m app.main
```

## Commands
- `/chats` — list chats and enable/disable.
- `/ask <question> [hours]` — Q&A with citations. Default 24h.
- `/digest <hours>` — summary with citations.

## Notes
- Only groups/channels are ingested (no private chats).
- Links use `t.me/<username>/<msg_id>` or `t.me/c/<internal_id>/<msg_id>`.
