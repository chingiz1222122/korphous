from __future__ import annotations

from dataclasses import dataclass
from datetime import timezone

from openai import OpenAI

from app.db import MessageRecord


@dataclass(frozen=True)
class RagAnswer:
    answer: str
    citations: list[str]


def build_context(messages: list[MessageRecord]) -> str:
    lines: list[str] = []
    for message in messages:
        timestamp = message.date.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        line = (
            f"[{timestamp}] ({message.chat_title}) {message.text.strip()} "
            f"[source: {message.permalink}]"
        )
        lines.append(line)
    return "\n".join(lines)


def ask_with_citations(
    client: OpenAI,
    model: str,
    question: str,
    messages: list[MessageRecord],
) -> RagAnswer:
    context = build_context(messages)
    prompt = (
        "You are a personal assistant answering questions based on Telegram chat logs. "
        "Use only the provided context. If not enough info, say so. "
        "Always include citations by referencing the provided source links."
    )
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": f"Question: {question}\n\nContext:\n{context}",
            },
        ],
        temperature=0.2,
    )
    answer = completion.choices[0].message.content or ""
    citations = list({message.permalink for message in messages})
    return RagAnswer(answer=answer, citations=citations)


def summarize_messages(
    client: OpenAI,
    model: str,
    messages: list[MessageRecord],
    hours: int,
) -> RagAnswer:
    context = build_context(messages)
    prompt = (
        "You summarize important updates from Telegram chats. "
        "Provide a concise digest with bullet points. "
        "Always include source links from the context."
    )
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": f"Summarize the last {hours} hours.\n\nContext:\n{context}",
            },
        ],
        temperature=0.3,
    )
    answer = completion.choices[0].message.content or ""
    citations = list({message.permalink for message in messages})
    return RagAnswer(answer=answer, citations=citations)
