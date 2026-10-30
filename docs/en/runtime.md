# Real-time Auto Execution (v1.4)

Sending a goal = creating a Run that executes automatically, with a live event stream. No more "click start" and no more silent waiting.

## Auto-run

- Console `/chat`: type a goal → send → plan → dispatch → execute → acceptance, **fully automatic**.
- CLI: `steward runtime --goal "build a quotation page"` executes to completion (or until a human confirmation is needed).

## Live event stream (SSE)

`GET /api/chat/runs/:id/stream?since=<seq>` (Server-Sent Events) reports: `run.queued/started`, `plan.generating`, `plan.ready`, `step.started/completed`, `agent.turn` (per-turn input/output summary, tokens, model mode), `tool.called/result`, `approval.required`, `run.paused/resumed/interrupted`, `run.completed/blocked/failed`, `token.updated`.

Each event has a monotonic `seq`; reconnect with `since` replays missed events; refreshing the page restores progress.

## Approval policy (configurable)

`runtime` settings: `auto_run` (default true), `approval_mode` (`auto_low_risk` default / `auto_all` / `manual`), `full_auto` (default false), `max_auto_steps` (20), `rework_limit` (1), `event_retention` (1000).

Dangerous actions (deleting programs/plugins, destructive file operations) **always** require human confirmation; automation never bypasses it.

## Run management

Interrupt / pause / resume, approve / reject; `/runs/:id` shows live timeline + evidence.

```bash
steward runtime --goal "build a quotation page"
steward runtime --action list
steward runtime --action stream --run <id>
steward runtime --action approve --run <id> --step 3
steward runtime --action interrupt|resume --run <id>
```

## Concurrency & recovery

Up to 3 concurrent runs (queue beyond); reconnect replays events since seq; after process restart unfinished runs are set to `paused` (resume required, to avoid unattended dangerous repeats); event retention is bounded (older events may be pruned).

## Architecture

```
Console /chat ──POST /api/chat/runs──▶ RunManager (steward-runtime)
     ▲                                  │ auto-execute loop
     │ EventSource (SSE)                ▼
     └── /api/chat/runs/:id/stream ── OrchestratorEngine (conductor/agents/tools) → runs/ + .steward/runtime/
```

## Safety

Budgets/token limits, per-run step cap and approval policy are layered guardrails. Dangerous actions require double confirmation + recycle backup + audit. Local-only (127.0.0.1).
