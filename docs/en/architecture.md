# Architecture

> Status: design fixed at scaffold stage. Implementation lands through milestones M0–M4.
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
| Core CLI | `pnpm steward run/branch/report/stop/takeover` | 24/7 operation, demos, acceptance |
| DSH cockpit (optional) | `dsh --profile daizhang web` | Human oversight GUI; mounts `steward-mcp` plus `dsh-browser`/`dsh-computer-use` |

The core is a standalone Node/TS process; the cockpit is only an optional human interface.

## 4. Branch lifecycle

```text
goal → Conductor creates BranchSpec → PolicyEngine validates budget/tools/approval policy
     → AgentRuntime executes (plan→act→observe→reflect) → artifacts + events
     → Reviewer checks evidence → Conductor accepts → terminate/expire (keep artifacts & events)
```

A branch cannot spawn another branch; it submits a `BranchRequest` to the Conductor. Expired
branches stop automatically.

## 5. Evidence and ledger

- `events.jsonl`: append-only with `seq` and a hash chain; fields in `contracts.md`; secrets redacted.
- `runs/<run-id>/`: `prompt.md`, `patch.diff`, `test.log`, `screenshots/`, `console.log`,
  `report.md`, `approval.json`.
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
