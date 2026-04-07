from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkflowSignal:
    workflow_type: str
    stage: str
    status: str
    risk_level: str
    next_action: str
    due_at: str | None


def detect_workflow_signal(text: str) -> WorkflowSignal | None:
    lowered = text.lower()

    if any(x in lowered for x in ["постав", "sample", "moq", "shipment", "контейнер", "фабрик"]):
        stage = "supplier_negotiation"
        if any(x in lowered for x in ["отгруз", "shipment", "контейнер"]):
            stage = "shipment"
        return WorkflowSignal("supplier", stage, "active", "medium", "Сделать follow-up с поставщиком", None)

    if any(x in lowered for x in ["wb", "карточк", "sku", "реклам", "запуск"]):
        return WorkflowSignal("sku_launch", "launch", "active", "medium", "Проверить next step по запуску SKU", None)

    if any(x in lowered for x in ["кандидат", "интервью", "оффер", "ваканси"]):
        return WorkflowSignal("hiring", "interview", "active", "medium", "Определить следующий шаг по кандидату", None)

    if any(x in lowered for x in ["претенз", "договор", "иск", "юрист"]):
        return WorkflowSignal("legal_claim", "claim", "active", "high", "Проверить срок ответа по legal issue", None)

    if any(x in lowered for x in ["сч[её]т", "оплат", "invoice", "выплат"]):
        return WorkflowSignal("payment", "payment_pending", "active", "high", "Проверить статус оплаты и подтверждение", None)

    if any(x in lowered for x in ["встреч", "поездк", "выставк", "вебинар", "командировк"]):
        return WorkflowSignal("events_trip", "event_planning", "active", "low", "Сделать post-event follow-up", None)

    return None
