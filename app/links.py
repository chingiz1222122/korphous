from __future__ import annotations


def build_message_link(chat_id: int, chat_username: str | None, msg_id: int) -> str:
    if chat_username:
        return f"https://t.me/{chat_username}/{msg_id}"

    chat_id_str = str(chat_id)
    if chat_id_str.startswith("-100"):
        internal_id = chat_id_str[4:]
    else:
        internal_id = chat_id_str.lstrip("-")
    return f"https://t.me/c/{internal_id}/{msg_id}"
