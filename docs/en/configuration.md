# Configuration & Models (v1.3)

All parameters are configurable: run mode, 14 feature toggles, budgets, token budget, payments/bank cards, **multi-model providers & API keys**, **system prompts**, and **system action policy**.

## Entry points

- Console (recommended): `steward console --port 4180` → `http://127.0.0.1:4180/settings`
- CLI: `steward config`, `steward config --action mode --mode personal`, `steward agents`
- File: `.steward/config.json` (gitignored; **references & masks only, never plaintext keys**)

## Run modes

| | demo | personal | enterprise |
|---|---|---|---|
| Payment | demo ledger only | **WeChat Pay / Alipay / personal bank card** | **corporate account** |
| Invoice | none | personal receipt (optional) | VAT general/special |
| Contract/seal | none | **no contract, no signature** | authorization/seal process, AI never signs |
| Dual review | off | **off** | **on** |
| Default token limit | 1,000,000 | 2,000,000 | 10,000,000 |

## Feature toggles (14)

browser / desktop / coding_loop / scout / content / research / payments / invoicing / notifications / auto_send / console / fault_drills / enterprise / demo_data. Disabled features are rejected by the kernel with a readable reason.

## Budget & tokens

Three layers (month/project/per-transaction) + **zero-budget mode**; token limit / per-action limit / on-exceed policy (block/notify).

## Payments & bank cards

Console `/settings` → highlighted **Payments & Bank Cards** group: WeChat Pay / Alipay / personal bank card (masked accounts), payout account (masked card/WeChat/Alipay), enterprise corporate account + VAT invoice + dual review; **epay** settings (enabled, demo/live, gateway, merchant ID, key ref, notify/return URLs, methods). Keys are references only (`env:NAME` or `file:secrets.json#id`); plaintext never written to config.json.

## Models & API keys

Four providers (DeepSeek default, OpenAI-compatible, Anthropic, local Ollama-compatible); base_url / model / key reference / enabled; **one-click key sync** to all features; **per-agent model selection** (11 roles); key resolution returns only `has_key` + mask to the UI.

## System prompts

11 professional prompts: supervisor (system controller) + conductor (project conductor) + 9 specialists. Editable in console; conductor prompt must contain the "do not bypass" safety clause; save bumps version and writes config audit. Source: `prompts/v2/*.md` + `prompts/manifest-v2.json` (sha256).

## System action policy

Managed app allowlist, managed plugins directory, `allow_destructive`, `require_confirmation` (mandatory for dangerous actions), confirmation token TTL (default 120s).

## Data & security

`steward data --action stats|reset` (whitelist, no path traversal, keeps config); all config/key/prompt/system-action changes are audited (no plaintext keys). Local-only: binds `127.0.0.1`, write APIs require `X-Steward-Token`.

## Harness execution (v1.5.1)

New `harness` config: `enabled` (default true), `profile` (headless), `dsh_bin` (empty = auto-detect), `timeout_ms`, `max_concurrency`, `artifact_retention_days`, `report_required`, `roles[]` (11 roles with enabled/workspace/timeout/max_tokens_per_run; supervisor always off). Editable in /settings; falls back to the previous local actions when dsh is unavailable. See [harness.md](harness.md).
