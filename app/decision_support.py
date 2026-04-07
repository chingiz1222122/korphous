from __future__ import annotations


def build_focus_items(db, followups: list[dict], risks: list[dict], top_n: int = 8) -> list[dict]:
    items: list[dict] = []
    for risk in risks:
        score = 10 if risk["severity"] == "high" else 6
        items.append(
            {
                "score": score,
                "item": f"Workflow #{risk['workflow_id']} — {risk['risk_type']}",
                "why": risk["evidence"],
                "next": risk["suggested_action"],
            }
        )
    for fu in followups:
        items.append(
            {
                "score": 5,
                "item": fu["title"],
                "why": fu["why"],
                "next": fu["next_step"],
            }
        )

    items.sort(key=lambda x: x["score"], reverse=True)
    return items[:top_n]
