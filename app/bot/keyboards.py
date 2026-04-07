from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from app.db import ChatRecord


def chat_actions_keyboard(chat: ChatRecord, is_selected: bool) -> InlineKeyboardMarkup:
    enable_label = "Disable" if chat.enabled else "Enable"
    use_label = "✅ Use" if is_selected else "Use"
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(enable_label, callback_data=f"toggle:{chat.chat_id}")],
            [InlineKeyboardButton(use_label, callback_data=f"use:{chat.chat_id}")],
        ]
    )
