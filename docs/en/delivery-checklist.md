# Delivery & Acceptance Checklist

> Each acceptance item = id + command/operation + evidence path + latest result (evidence must be openable).
> All items are `not implemented` at scaffold stage; milestones update them to `pass / fail / partial`.
> Last updated: 2026-10-25 (scaffold)

## A. Phase 1 (doc 1 — 12 items)

| # | Acceptance | Command / operation | Planned evidence | Status |
|---|---|---|---|---|
| A1 | Clean clone runs without paid API | `pnpm install && pnpm demo` | `docs/test-evidence/A1-*` | todo |
| A2 | demo-web login/fill/submit/verify/screenshot | `pnpm test:e2e` | `runs/<id>/screenshots/` | todo |
| A3 | demo-desktop open/fill/save/verify/screenshot | `pnpm test:desktop` | `runs/<id>/screenshots/` | todo |
| A4 | Seeded defect → CodeTask → patch → apply → tests pass | `pnpm demo:code-loop` | `runs/<id>/code-task.json` etc. | todo |
| A5 | Two consecutive failures → escalate, no infinite loop | same (injected failure) | two-round logs + escalation event | todo |
| A6 | Every run has prompt/patch/test.log/screenshots/report, no secrets | `pnpm verify:evidence` | whole `runs/<id>/` | todo |
| A7 | Scout ≥10 leads (source+score), 3 drafts unsent | `pnpm demo:scout` | `scout-report.md` + approval queue | todo |
| A8 | Stop key within 5s; restart resumes without duplicates | `pnpm test:stop` | stop event + resume log | todo |
| A9 | Branch isolation (credentials / browser profiles) | `pnpm test:isolation` | isolation test + events | todo |
| A10 | New read-only dummy branch by config only | `pnpm demo:dummy-branch` | config + report | todo |
| A11 | Tests/lint/docs/license complete, no telemetry | `pnpm lint && pnpm test` | CI log | todo |
| A12 | Runtime prompts versioned, tested, replaceable | `pnpm test:prompts` | prompt test output | todo |

## B. Phase 2 (doc 2 — 8 items)

| # | Acceptance | Scenario | Evidence | Status |
|---|---|---|---|---|
| B1 | Topic selection: ≥3 business lines under ¥50k/30d, sources open in 30s | simulated proposal | proposal page + sources | todo |
| B2 | Bookkeeping: one expense shows 6 facts within 30s | ledger detail | ledger UI screenshot | todo |
| B3 | 2h offline produces no new promises; recovery reconciles in 10min | real network-off drill | gap list + reconciliation log | todo |
| B4 | Platform B ban → all actions stop in 15min + alternatives | ban fault injection | stop event + alternatives | todo |
| B5 | Any external promise traces to conversation text and authorization | promise trace | trace page screenshot | todo |
| B6 | Takeover key stops in 10s + pack within 30min | takeover drill | pack + timing | todo |
| B7 | Four out-of-scope request classes denied 100% with readable reasons | boundary tests | denial records | todo |
| B8 | Personal and enterprise modes each run one order; mismatches blocked | dual-mode e2e | evidence for both | todo |

## C. User requirements (U1–U8)

| # | Requirement | Evidence | Status |
|---|---|---|---|
| U1 | All UI tests are real browser/real desktop, never API substitutes | E2E screenshots/video + CI rule check | todo |
| U2 | Notifications & assistance (approval card/handoff/takeover) | notification log + card screenshots | todo |
| U3 | IoT reserved (contract + simulated fixture) | contract doc + fixture tests | todo |
| U4 | GitHub minzzj release, NC-SA license, bilingual docs | repo link + LICENSE + docs | todo |
| U5 | Promo video (real screenshots, two versions) | video + STORYBOARD/FACTS | todo |
| U6 | Phase 1 ends with HANDOFF and session stop | HANDOFF.md update record | in progress |
| U7 | Test key never committed, logs redacted, rotatable | secret scan report | scan script ready |
| U8 | Built on DSH plugin ecosystem with reuse | reuse matrix + pinned deps | designed |

## D. Evidence rules

- Every evidence path must be openable from inside the repository; screenshots come from E2E runs
  (never hand-captured).
- Before release, re-run everything from a clean neutral path and update the "latest result" column.
- Numbers in docs must match evidence: `pnpm verify:docs` (M4) enforces this.
