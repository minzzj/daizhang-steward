# Core Contracts

> Rule: **fields may only be added, never removed.** All timestamps are ISO 8601 (with UTC offset),
> all paths are repository-relative. Machine-readable JSON Schemas are planned for a later milestone
> under `packages/steward-core/schemas/`; at M1 the TS types in `packages/steward-core/src/types.ts`
> plus unit tests are the machine-checked source, and this document stays normative.

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
  "goal": "Fix the missing timeout error on the demo-web login page under the slow-network path",
  "reproduction": ["start demo-web (127.0.0.1:4173)", "open the slow path /login?timeout=1", "type any account and click login", "wait 4s (that server path responds after 4s)"],
  "expected": "show 'Request timed out, please retry' and re-enable the button",
  "actual": "spinner spins forever, no message",
  "files": ["examples/demo-web/app.js"],
  "acceptance": ["node tests/e2e-browser/login-flow.mjs --case login-timeout"],
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
  "summary": "add timeout recovery in examples/demo-web/app.js and render the error message",
  "tests_run": ["node tests/e2e-browser/login-flow.mjs --case login-timeout"],
  "risks": ["mobile layout not covered"],
  "uncovered": ["real network jitter"]
}
```

Patches are applied in an isolated git worktree and tested (implemented in M1: `patch.ts` +
`runCodeLoop`). On success: TestReport + PR draft. On failure: at most two rounds, then escalate to a
human (`escalated=true` / exit 1). Never auto-merge to main.

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
