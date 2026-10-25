# Architecture

> Status: design fixed; **M0 kernel + M1 real-browser loop + M2 real Windows desktop & safety modules +
> M3 Scout customer branch implemented and verified (2026-10-25)**, the rest lands through M4.
> Companions: `contracts.md`, `threat-model.md`, `adapters.md`.

## 1. Design principles

1. **Composable first** — Operator, Scout and Reviewer are configurations of one `AgentRuntime`
   (BranchSpec), not hard-coded classes. Adding a branch means adding config, prompts and a tool
   allowlist.
2. **Evidence first** — every external action produces an entry in `events.jsonl` and artifacts in
   `runs/<id>/`. A "success" without evidence counts as unfinished.
3. **Deny by default** — PolicyEngine decides `allow / deny / approve / unknown`; timeouts suspend,
   never auto-approve.
4. **Human owns responsibility** — approvals, takeover, exceptions and monthly reconciliation are
   done by a human. The AI is never a legal subject.
5. **Replaceable foundation** — the core does not hard-depend on DeepSeek Harness; HarnessAdapter
   isolates it and MockHarness keeps demos offline and free.

## 2. Layers

```text
┌ Interface ─ Phase-1 CLI / Phase-2 local web console / notification channels / MCP
├ Orchestration ─ Conductor (goal decomposition, branch lifecycle, budget, acceptance)
├ Execution ─ AgentRuntime (plan-act-observe-reflect-report) → Operator / Scout / Reviewer
├ Capability ─ ToolRegistry (browser, desktop, fs, HTTP, messaging, code exec, payment[disabled])
│              HarnessAdapter (mock / DSH headless / DeepSeek API)
├ Governance ─ PolicyEngine, budget gates, stop key, checkpoints, audit
└ Data ─ SQLite (WAL) + events.jsonl (hash chain) + runs/ artifacts + versioned prompts/
```

## 3. Run modes

| Mode | Command | Purpose |
|---|---|---|
| Core CLI | `node dist/apps/cli/src/index.js demo/browser-flow/desktop-flow/scout/code-loop/run/branch/report/stop/safety-check/version/help` | 24/7 operation, demos, acceptance |
| DSH cockpit (optional) | `dsh --profile daizhang web` | Human oversight GUI; mounts `steward-mcp` plus `dsh-browser`/`dsh-computer-use` |

The core is a standalone Node/TS process; the cockpit is only an optional human interface.

The repository is a **single package** (no pnpm workspace): `packages/*/src` + `apps/cli/src` are
compiled by `tsc -p tsconfig.json` into `dist/`, and all commands use npm (`npm run build`, `npm test`,
`npm run demo`, `npm run acceptance`, `npm run acceptance:m2`, `npm run acceptance:m3`). `takeover` and
`approve` are still placeholder commands.

**M1 implementation status**: `packages/steward-browser` provides the Playwright real-browser adapter
(headed by default, `chrome→msedge` fallback, per-run `userDataDir`, per-step screenshot / DOM /
console evidence, 5 failure classes, risk-control keywords → stop-and-hand-off);
`packages/steward-harness/src/patch.ts` applies patches in an isolated git worktree and `loop.ts`
(`runCodeLoop`) stops after at most two rounds and escalates; `tests/e2e-browser/` holds real-browser
E2E (normal green / login-timeout red).

**M2 implementation status**: `packages/steward-desktop` provides the real Windows desktop adapter —
a long-lived Python ctypes sidecar makes real Win32 calls: window enumeration/focus, BitBlt
screenshots with a self-written PNG encoder, `SendInput` real mouse and Unicode real keyboard;
allowlist deny-by-default, Per-Monitor V2 DPI awareness, 5 failure classes, per-step screenshot
evidence, stop-and-hand-off on credential/security prompts. `tests/e2e-desktop/` holds real-desktop
E2E (real keyboard/mouse + 20 screenshots + JSON content assertions). Three new core safety modules:
`stop-controller.ts` (200ms watchdog + `AbortController` + `withAbort`, stop ≤5s), `checkpoint.ts`
(atomic checkpoints, `listResumable`, per-step `markStepDone`; `run --resume` skips completed steps)
and `isolation.ts` (`CredentialVault` cross-branch credential isolation + redaction, `ProfileLock`
profile exclusivity, `assertBranchToolsAllowed` allowlist assertion); the runtime integrates them and
exposes `signal` / `locks` / `vault` in `ToolContext`. The CLI adds `desktop-flow`, `safety-check` and
`run --resume <runId>` (11 implemented commands + 2 placeholders after M2).

**M3 implementation status**: `packages/steward-scout` provides the Scout customer-branch engine
(`ScoutEngine`): ICP + exactly 3 high-value scenarios, four-factor scoring (need 40% / budget 20% /
reachability 20% / compliance 20%), source hard-checks (missing `source_url` / non-http(s) / empty
`signal` / empty `consent_basis` → discard and record), `org+signal` normalized dedupe, ≤150-char
outreach drafts that cite a concrete signal (never impersonating a human, no bulk sending), a human
approval queue (all items default `pending`), a daily ≤10-per-channel limit, unsubscribe and
reply/meeting stats, and `ScoutReport`. The module is **pure logic, zero dependencies, zero network
I/O**: `markSent` only records state and never sends; fixtures live in `examples/scout-fixtures/`
(14 fictional compliant leads). The CLI adds `scout` (fixture-driven; writes `scout-report.md/.json`,
`leads-scored.json`, `drafts.json`, `approval-queue.json`, `outreach-drafts/`), taking the command count
from 11 to **12 implemented + 2 placeholders**. Conductor / Reviewer are still planned (M4+).

## 4. Branch lifecycle

```text
goal → Conductor creates BranchSpec → PolicyEngine validates budget/tools/approval policy
     → AgentRuntime executes (plan→act→observe→reflect) → artifacts + events
     → Reviewer checks evidence → Conductor accepts → terminate/expire (keep artifacts & events)
```

A branch cannot spawn another branch; it submits a `BranchRequest` to the Conductor. Expired
branches stop automatically.

M3 status: the CLI assembles the operator branch (BranchSpec + tool allowlist) directly for
`browser-flow` / `desktop-flow` / `code-loop`, and the scout branch for `scout` (drafts only, approval
queue, never sends); the runtime integrates the stop controller, checkpoints (including `run
--resume`), profile locks and per-branch credential references. Conductor branch spawning, Reviewer
evidence checks and the Conductor acceptance interface are still planned (M4+).

## 5. Evidence and ledger

- `events.jsonl`: append-only with `seq` and a hash chain; fields in `contracts.md`; secrets redacted.
- `runs/<run-id>/`: M0 artifacts are `prompt.md`, `report.md`, `console.log`, `meta.json`,
  `events.jsonl`, plus `code-task.json`, `code-result.json`, `patch.diff` and `test.log` from the
  MockHarness loop; from M1 real-browser runs also contain `e2e/<case>/screenshots/`,
  `e2e/<case>/result.json` and `e2e/server.log`; from M2 real-desktop runs also contain
  `e2e-desktop/screenshots/`, `e2e-desktop/result.json`, `steps.json`, `sidecar.log`, and an atomic
  `checkpoint.json` written after every step; from M3 Scout runs also contain `scout-report.md/.json`,
  `leads-scored.json`, `drafts.json`, `approval-queue.json` and `outreach-drafts/`. Acceptance copies
  them to `docs/test-evidence/evidence-m1-<stamp>/`, `evidence-m2-<stamp>/` and
  `evidence-m3-<stamp>/`. `approval.json` lands with the formal approval queue (later milestone).
- The SQLite index is rebuildable by replaying events; after a crash, resume from the checkpoint
  without resending messages or double-paying.

## 6. Summary levels

- **L0 action card** — who, to whom, what, which authorization, where the evidence is, result.
- **L1 project summary** — goal, progress, cost, revenue, open items, risks, next acceptance.
- **L2 monthly report** — income/expense, margin, collection rate, budget headroom, portfolio,
  compliance events, next-month proposals.

Each level states "as of when" and "coverage (complete / partial / not covered)".

## 7. Extension points

| To add | Change only |
|---|---|
| New branch (support/delivery/finance) | BranchSpec + prompt + tool allowlist |
| New tool | ToolRegistry registration (args, risk, approval, evidence type) |
| New notification channel | NotifyAdapter implementation |
| New business line | Project template + prompt |
| New model | LLM routing + budget gate |
| IoT devices | IoTAdapter (MQTT / HTTP JSON-RPC) |

## 8. Explicit non-goals

Multi-tenant SaaS, billing, heavy frontend (phase 1), unapproved payments/contracts/account-permission
changes, bypassing CAPTCHAs or risk controls.
