# DeepSeek Harness Agents (v1.5)

From v1.5, every specialist agent is a **real DeepSeek Harness agent**: it thinks, calls tools (read/write/edit/bash/pwsh/browser/web_search…), produces real files (artifacts) and writes reports — all visible in the console.

## Why DeepSeek Harness

- Real execution: reads/writes files, runs commands, writes code, verifies results.
- Visible process: thinking / tool_call / tool_result / text / final / usage streamed as events.
- Verifiable artifacts: each file has path, kind, size, sha256; reports contain data and evidence.
- Cost control: single entry (`dsh --profile headless --json`), per-task timeout/token caps.

## Harness metadata per agent

| Role | Tools (examples) | Typical artifacts |
|---|---|---|
| conductor | read/glob/grep (read-only) | plans, acceptance summary |
| operator | read/write/edit/bash/browser | HTML/docs/screenshots |
| harness | read/write/edit/bash/test | code/patches/tests/quality report |
| reviewer | read/glob/grep | independent review report |
| finance | read/write | ledger/payment drafts/finance report |
| backend | read/write/bash | data report/events/backup manifest |
| scout | web_search/web_fetch/write | lead report |
| content | read/write | content drafts |
| research | web_search/web_fetch/write | research report |
| customer | read/write | customer message drafts |
| supervisor | (system action layer; Harness off by default) | system actions/audit |

## Configuration (`harness` in config / console settings)

`enabled` (default true), `profile` (headless), `dsh_bin` (auto-detect), `timeout_ms` (300000), `max_concurrency` (2), `artifact_retention_days` (30), `report_required` (true), `roles[]` (11 roles with enabled/workspace/timeout/max_tokens_per_run; supervisor always off).

## Evidence layout (per run)

- `harness/step-<n>-events.jsonl` — raw events (thinking/tool/text/final/usage)
- `harness/step-<n>-artifacts.json` — artifact manifest (rel_path/kind/size/sha256)
- `harness/step-<n>-report.md` — agent report
- `harness/step-<n>-summary.json` — thinking/tools/usage/final/artifacts
- `harness/metrics.json` — token totals, steps, tool-call breakdown, duration, events
- `artifacts/step-<n>-<role>/…` — copied real artifacts

## Safety

Workspace isolation per step; no API keys injected/forwarded (DSH uses its own local credentials); dangerous actions (delete program/plugin, payments, external sends) require human approval/signature; token/timeout limits terminate with evidence preserved; failures fall back to the previous local tools instead of pretending success.

## Cost

A small task (create note.md + read-back + report, 4 steps) measured ≈ 0.93M tokens. Prefer small goals / few steps; per-step cap default 2M tokens (configurable).
