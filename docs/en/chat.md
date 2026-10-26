# Chat / Projects / Evidence (v1.3)

## Two-tier orchestration

```
L1 System controller (supervisor) — managed programs/plugins, models & prompts, all logs,
   project delegation, dangerous-action confirmation
     │ delegate
L2 Project conductor (conductor) — plan, dispatch, budget, evidence, acceptance
     │ dispatch
L3 Specialists: operator / harness / customer / finance / reviewer / backend / scout / content / research
```

## Console chat (/chat)

Tell the conductor what you want (e.g. "build a single-page HTML quotation and record a ¥10 payment request"), it generates a 4–6 step plan, then click "Start". You can **interrupt** (checkpoint recorded), **resume** (completed steps not repeated), **approve/reject** approval steps. After completion open `/runs/<session-id>` for the timeline, evidence thumbnails (click to enlarge), `report.md`, logs and per-agent summaries.

## CLI

```bash
steward project --goal "build a quotation page and record a ¥10 payment request" --json
steward supervisor --goal "check system, disable demo-plugin, delegate a project" --json
steward chat --action interrupt|resume|approve|reject|detail|logs --session <id> [--step N]
steward chat --action list
```

## Agent conversation & per-turn summaries

Every call records an `AgentTurn`: seq / at / agent_role / input_summary / output_summary / detail / tokens / status / evidence_refs / model_mode. View per-agent turns at `/agents/<role>`, run details at `/runs/<id>`; APIs: `/api/chat/sessions`, `/api/chat/runs/:id`, `/api/chat/agents/:role/transcripts`, `/api/chat/evidence?run_id=`.

## Evidence

Each run directory `runs/<session-id>/` contains deliverables, quality-check, review, payment request, ledger record, events log and system-action evidence. The console evidence lightbox reads real files (screenshots inlined as base64, markdown rendered).

## Model provenance

Every model call is tagged `remote` (real model) or `local_fallback` (local rule fallback, explicitly labelled). No key/network failure → automatic fallback with clear label.

## Data boundary

Sessions/evidence live in local `runs/` (gitignored); config in `.steward/`; console binds `127.0.0.1` and requires a token for writes.
