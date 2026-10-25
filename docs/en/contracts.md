# Core Contracts

> Rule: **fields may only be added, never removed.** All timestamps are ISO 8601 (with UTC offset),
> all paths are repository-relative. Machine-readable JSON Schemas will land in
> `packages/steward-core/schemas/` at M0; this document is the normative description.

## 1. BranchSpec

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique branch id |
| `parent_id` | string \| null | Parent branch; tracks who spawned whom |
| `role` | `conductor` \| `operator` \| `scout` \| `reviewer` \| `dummy` | Role |
| `goal` | string | Measurable goal |
| `tools` | string[] | Tool allowlist; anything else is uncallable |
| `budget` | object | `{token, time_minutes, cost_cny}`; warn at 80%, pause at 100% |
| `approval_policy` | object | `{require_approval: string[], deny: string[]}` |
| `expires_at` | string \| null | Auto-stop on expiry |
| `prompt_ref` | string | Runtime prompt version (e.g. `operator@1.0.0`) |

Branches cannot spawn branches; they submit a `BranchRequest` to the Conductor.

## 2. CodeTask

```json
{
  "task_id": "ct-20261025-001",
  "repo": "github.com/minzzj/daizhang-steward",
  "branch": "fix/login-timeout",
  "goal": "Fix missing timeout error on demo-web login page",
  "reproduction": ["start demo-web", "open /login", "type any account", "wait 4s"],
  "expected": "show 'Request timed out, please retry'",
  "actual": "spinner spins forever, no message",
  "files": ["examples/demo-web/src/login.ts"],
  "acceptance": ["pnpm test:e2e -- --grep login-timeout"],
  "constraints": ["no public API changes", "no paid dependencies"],
  "forbidden": ["packages/steward-core/auth/**"],
  "output": "unified_diff"
}
```

A task without an executable acceptance check never enters the code loop.

## 3. CodeResult

```json
{
  "task_id": "ct-20261025-001",
  "patch": "diff --git a/... b/...",
  "summary": "add timeout branch in api.ts, render error in login.ts",
  "tests_run": ["pnpm test:e2e -- --grep login-timeout"],
  "risks": ["mobile layout not covered"],
  "uncovered": ["real network jitter"]
}
```

Patches are applied in an isolated worktree and tested. On success: TestReport + PR draft. On
failure: at most two rounds, then escalate to a human. Never auto-merge to main.

## 4. Lead

| Field | Meaning |
|---|---|
| `lead_id` / `org` / `role` | Identity, organization, role |
| `source_url` | Required; leads without a source are discarded |
| `signal` | Quoted demand signal |
| `fit_score` | 0–1: need 40% + budget/size 20% + reachability 20% + compliance risk 20% |
| `channel` | email / platform DM / etc. |
| `consent_basis` | Compliance basis (public business email, explicit tool request, ...) |
| `status` | drafted / approved / sent / replied / unsubscribed / archived |

Outreach is drafted only; sending requires approval; ≤10 per channel per day; unsubscribe
supported; never impersonate a human.

## 5. ApprovalCard

`id, branch, action, target, amount_cny?, risk_level(low/medium/high/critical), evidence[], options[approve/revise/reject], expires_at, decided_by, decided_at, decision`

Three exits: approved / rejected / timeout-suspended (never auto-approved). High-risk actions
without approval are denied.

## 6. TakeoverPack

`open_orders[], pending_threads[], payable[], credentials[], risks[], generated_at, coverage(complete/partial/not-covered)`
All four health-check classes (blocker/warning/info/undeterminable) must produce a pack.

## 7. Event (one line per event in `events.jsonl`)

| Field | Meaning |
|---|---|
| `seq` | Monotonic counter |
| `prev_hash` / `hash` | Hash chain (tamper-evident) |
| `ts` | ISO 8601 |
| `branch_id` / `tool` | Origin branch and tool |
| `target` | URL / window / account / file acted on |
| `input_digest` | Redacted input digest |
| `policy_decision` | allow / deny / approve / unknown |
| `result` | success / failure / unknown |
| `evidence_path` | Repository-relative evidence path |
| `confidence` | certain / probable / unknown / tombstone |

Append-only; secrets and PII redacted; retained ≥ 90 days.
