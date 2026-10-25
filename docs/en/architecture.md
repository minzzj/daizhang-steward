# Architecture

> Status: design fixed; **Phase 1 (M0 kernel + M1 real browser + M2 real desktop & safety + M3 Scout +
> M4 release close-out) is fully implemented and verified, released as v0.5.0; Phase 2 P1
> personal-edition MVP is implemented and delivered as v0.6.0 (2026-10-25)**; Phase 2 P2–P4 proceeds
> per the ROADMAP.
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
┌ Interface ─ CLI / local web console (P1, binds 127.0.0.1 only + token-protected writes) / notification channels / MCP
├ Orchestration ─ Conductor (goal decomposition, branch lifecycle, budget, acceptance) / steward-domain business engine
├ Execution ─ AgentRuntime (plan-act-observe-reflect-report) → Operator / Scout / Reviewer
├ Capability ─ ToolRegistry (browser, desktop, fs, HTTP, messaging, code exec, payment[disabled])
│              HarnessAdapter (mock / DSH headless / DeepSeek API)
├ Governance ─ PolicyEngine, budget gates, stop key, checkpoints, audit, boundary rules (P1: 18 personal-mode)
└ Data ─ SQLite (WAL) + events.jsonl (hash chain) + runs/ artifacts + versioned prompts/
      + <root>/domain/state.json + domain/events.jsonl (P1 business domain; atomic, append-only, redacted)
```

## 3. Run modes

| Mode | Command | Purpose |
|---|---|---|
| Core CLI | `node dist/apps/cli/src/index.js demo/browser-flow/desktop-flow/scout/dummy-branch/business/boundary-check/console/approve/takeover/code-loop/run/branch/report/stop/safety-check/version/help` | 24/7 operation, demos, acceptance |
| Local web console (P1) | `node dist/apps/cli/src/index.js console [--port 4180]` | Dashboard / project timeline / ledger six facts / approval cards / takeover key / monthly report; binds 127.0.0.1 only |
| DSH cockpit (optional) | `dsh --profile daizhang web` | Human oversight GUI; mounts `steward-mcp` plus `dsh-browser`/`dsh-computer-use` |

The core is a standalone Node/TS process; the cockpit is only an optional human interface.

The repository is a **single package** (no pnpm workspace): `packages/*/src` + `apps/cli/src` are
compiled by `tsc -p tsconfig.json` into `dist/`, and all commands use npm (`npm run build`, `npm test`,
`npm run demo`, `npm run acceptance`, `npm run acceptance:m2`, `npm run acceptance:m3`,
`npm run acceptance:m4`, `npm run acceptance:p1`). **Since P1, `takeover` and `approve` are real human
commands** (18 implemented commands + 0 placeholders).

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
from 11 to **12 implemented + 2 placeholders**.

**M4 implementation status**: A10 adds the CLI command `dummy-branch` (alias `demo-dummy`) — a read-only
dummy branch consisting only of a BranchSpec (role/tools/prompt_ref) + the existing `reviewer@1.0.0`
prompt; **no change to the core runtime/CLI branch mechanism**. Command count 12 → **13 implemented +
2 placeholders**. A11 release readiness is a single `npm run acceptance:m4` check (build, 80 tests, A10,
CC BY-NC-SA 4.0 license text, NOTICE/COMMERCIAL, bilingual doc pairing, no telemetry,
`package.json`/CLI version consistency 0.5.0, release docs present) and produces
`m4-acceptance-*` + `evidence-m4-*`. Phase 1 is released as **v0.5.0** (release notes
`docs/RELEASE_NOTES_v0.5.0.md`, demo script `docs/demo-script.*`, good first issues
`docs/good-first-issues.md`).

**P1 implementation status (Phase 2 personal-edition MVP, v0.6.0)**:
- `packages/steward-domain`: business-domain engine — 8 concepts (mandate / three-level budget /
  project / task / agent / evidence / ledger / tombstone + four confidence levels); topic proposals
  (≥3 business lines with checkable sources); ledger with mandatory six facts; promise tracing
  (conversation text → mandate clause → project); approval cards (default pending, expired = suspended,
  never auto-approved); takeover key + 6-section takeover pack; monthly report; L0/L1/L2 summaries;
  18 personal-mode boundary rules (catalog of 20); one simulated business line end to end; persistence
  in `<root>/domain/state.json` (atomic write) + `domain/events.jsonl` (append-only audit, redacted
  detail). Pure logic, zero dependencies, no network, no real money.
- `packages/steward-console`: local web console — Node's built-in `http` + plain HTML/CSS/JS (zero
  third-party dependencies), **binds 127.0.0.1 only** (any other host throws `ConsoleSecurityError`),
  writes require `X-Steward-Token`, no CDN/external links/inline scripts (CSP); pages: dashboard /
  project timeline / ledger six-facts drawer / approval cards / takeover key (stop + resume) / monthly
  report / `/health` + JSON API.
- `tests/e2e-console/`: real-browser E2E (headed Chrome, 9 steps / 73 checks / 9 screenshots,
  browser-measured takeover stop **88 ms** ≤10000 ms; asserts local-only binding, 401 on writes without
  token, same-origin requests only, no page JS errors).
- `examples/demo-business/`: one purely fictional simulated personal-edition business line (3 candidate
  business lines / customer inquiry / quote / 9 tasks / 7 messages / deliverables / payment / invoice /
  expenses / monthly report; reserved domains, no real personal data).
- The CLI adds `business`, `boundary-check`, `console`, `approve` (real approval) and `takeover` (real
  takeover/resume) → command count **13 → 18 implemented + 0 placeholders**; `npm run acceptance:p1` is
  a one-command acceptance (12 checks, local headed Chrome). **B3/B4 (fault drills) → P2, B8
  (enterprise) → P3; full Conductor/Reviewer orchestration remains later work.**

## 4. Branch lifecycle

```text
goal → Conductor creates BranchSpec → PolicyEngine validates budget/tools/approval policy
     → AgentRuntime executes (plan→act→observe→reflect) → artifacts + events
     → Reviewer checks evidence → Conductor accepts → terminate/expire (keep artifacts & events)
```

A branch cannot spawn another branch; it submits a `BranchRequest` to the Conductor. Expired
branches stop automatically.

P1 status: the CLI assembles the operator branch (BranchSpec + tool allowlist) directly for
`browser-flow` / `desktop-flow` / `code-loop`, the scout branch for `scout` (drafts only, approval
queue, never sends) and the dummy branch for `dummy-branch` (read-only, config + existing prompt only);
the business command runs the domain engine (project → tasks → delivery → payment/invoice → monthly
report) and `console` provides the human interface (dashboard / approval cards / takeover key / monthly
report); the runtime integrates the stop controller, checkpoints (including `run --resume`), profile
locks and per-branch credential references. Conductor branch spawning, Reviewer evidence checks and the
Conductor acceptance interface remain later work; in P1 approvals/takeover are handled by the domain
engine + human commands/console.

## 5. Evidence and ledger

- `events.jsonl`: append-only with `seq` and a hash chain; fields in `contracts.md`; secrets redacted.
- `runs/<run-id>/`: M0 artifacts are `prompt.md`, `report.md`, `console.log`, `meta.json`,
  `events.jsonl`, plus `code-task.json`, `code-result.json`, `patch.diff` and `test.log` from the
  MockHarness loop; from M1 real-browser runs also contain `e2e/<case>/screenshots/`,
  `e2e/<case>/result.json` and `e2e/server.log`; from M2 real-desktop runs also contain
  `e2e-desktop/screenshots/`, `e2e-desktop/result.json`, `steps.json`, `sidecar.log`, and an atomic
  `checkpoint.json` written after every step; from M3 Scout runs also contain `scout-report.md/.json`,
  `leads-scored.json`, `drafts.json`, `approval-queue.json` and `outreach-drafts/`; from M4 dummy-branch
  runs the report also carries `role` / `tools` / `prompt_ref`; **from P1 `business` runs they also
  contain `proposal.json`, `business-result.json`, `ledger-facts.json` (six facts),
  `promise-traces.json`, `takeover-pack.json`, `boundary-check.json`, `monthly-report.{json,md}` and
  `summaries.json`**; console E2E runs also contain `result.json` + 9 step screenshots +
  `console-server.log`. Acceptance copies them to `docs/test-evidence/evidence-m1-<stamp>/` …
  `evidence-m4-<stamp>/` and `evidence-p1-<stamp>/`.
- Business-domain state is persisted separately in `<root>/domain/state.json` (atomic write) +
  `domain/events.jsonl` (append-only audit, redacted detail); approval cards, takeover state and the
  monthly report are produced by the domain engine, and `approve` / `takeover` commands share the same
  state as the console (human decisions, never auto-approved).
- The SQLite index is rebuildable by replaying events; after a crash, resume from the checkpoint
  without resending messages or double-paying.

## 6. Summary levels

- **L0 action card** — who, to whom, what, which authorization, where the evidence is, result.
- **L1 project summary** — goal, progress, cost, revenue, open items, risks, next acceptance.
- **L2 monthly report** — income/expense, margin, collection rate, budget headroom, portfolio,
  compliance events, next-month proposals.

Each level states "as of when" and "coverage (complete / partial / not covered)".

P1 status: `steward-domain`'s `summaries()` produces L0/L1/L2 and `buildMonthlyReport("YYYY-MM")`
produces the L2 monthly report (income/expense/margin/budget headroom/compliance events/next-month
proposals/as_of/coverage); the console consumes them via `/api/summary?level=` and the `/report` page.

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

Multi-tenant SaaS, billing, heavy frontend (phase 1; P1 only ships a zero-dependency local web console),
unapproved payments/contracts/account-permission changes, bypassing CAPTCHAs or risk controls.
