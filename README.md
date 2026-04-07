# Telegram Local Assistant (Stage 7: Operations Copilot)

## 1) Workflow schema strategy
SQLite-first operational layer:
- `workflows`
- `workflow_events`
- `workflow_alerts`

Связано с memory graph (`entities`, `entity_mentions`, `relationships`, `timelines`) и источниками `messages`.

## 2) Stale/risk detection strategy
- stale workflow: `last_update_at` старше порога
- deadline risk: `due_at` близко
- heuristics по workflow type и stage
- explainable evidence + suggested action

## 3) Proactive alert strategy
- alerts формируются как candidates
- только owner delivery
- scheduler присылает ежедневный digest + operational focus digest
- human-in-the-loop: бот только предлагает действия, не делает auto-actions в внешние чаты

## New commands
- `/focus`
- `/followups`
- `/risks`
- `/waiting`
- `/nextsteps`
- + memory commands `/whois`, `/timeline`, `/project`, `/people`, `/projects`, `/deadlines`, `/decisions`

## Workflow/memory tools
```bash
python scripts/rebuild_workflows.py
python scripts/memory_backfill.py --days 120 --limit 6000
python scripts/debug_workflow.py
python scripts/debug_risk.py
python scripts/eval_focus_queries.py
```
