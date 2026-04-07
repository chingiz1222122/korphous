from __future__ import annotations


def create_alert_candidates(db, risks: list[dict]) -> list[dict]:
    candidates: list[dict] = []
    for risk in risks:
        if risk["severity"] not in {"high", "medium"}:
            continue
        candidates.append(
            {
                "workflow_id": risk["workflow_id"],
                "alert_type": risk["risk_type"],
                "severity": risk["severity"],
                "evidence": risk["evidence"],
                "suggested_action": risk["suggested_action"],
                "cooldown_key": f"wf:{risk['workflow_id']}:{risk['risk_type']}",
            }
        )
    return candidates
