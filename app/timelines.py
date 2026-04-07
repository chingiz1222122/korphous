from __future__ import annotations

import re


def infer_event_type(text: str) -> str:
    lowered = text.lower()
    if any(x in lowered for x in ["дедлайн", "срок", "до "]):
        return "deadline"
    if any(x in lowered for x in ["встреч", "созвон", "вебинар", "конференц", "выставк"]):
        return "meeting"
    if any(x in lowered for x in ["оплат", "invoice", "счет", "выплат"]):
        return "payment"
    if any(x in lowered for x in ["контракт", "договор"]):
        return "contract"
    if any(x in lowered for x in ["постав", "shipment", "контейнер"]):
        return "shipment"
    return "update"


def extract_event_time(text: str) -> str | None:
    m = re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
    if m:
        return m.group(0)
    return None
