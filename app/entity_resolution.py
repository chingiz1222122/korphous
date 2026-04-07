from __future__ import annotations

import re
import unicodedata


def normalize_name(name: str) -> str:
    value = unicodedata.normalize("NFKC", name).strip().lower()
    value = re.sub(r"\s+", " ", value)
    return value


def canonicalize_entity(raw_name: str) -> str:
    cleaned = re.sub(r"[\"'`«»()\[\],.;:!?]", "", raw_name)
    cleaned = normalize_name(cleaned)
    return cleaned[:120]
