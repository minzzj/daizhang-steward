# Delivery & Acceptance Checklist

> Each acceptance item = id + command/operation + evidence path + latest result (evidence must be openable).
> **Phase 1 (M0–M4) is complete and released as v0.5.0: A1–A12 all `pass`. Phase 2 P1 (personal-edition
> MVP) is complete and delivered as v0.6.0: B1/B2/B5/B6/B7 pass; B3/B4 pending P2, B8 pending P3.**
> Last updated: 2026-10-25 (Phase 2 P1 complete, v0.6.0)

## A. Phase 1 (doc 1 — 12 items)

| # | Acceptance | Command / operation | Evidence | Status |
|---|---|---|---|---|
| A1 | Clean clone runs without paid API | `npm install && npm run demo` | `runs/run-20261025-172017-eb9116/report.md` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md` (MockHarness, no paid API) | ✅ pass (2026-10-25) |
| A2 | demo-web login/fill/submit/verify/screenshot | `npm run acceptance` (or `node tests/e2e-browser/login-flow.mjs --case normal`) | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A2-browser-flow/`: `e2e/normal/screenshots/001…007-*.png` (7 steps / 7 real screenshots), `e2e/normal/result.json`, `e2e/server.log`, `report.md`; run `run-20261025-175213-9ea8ab` | ✅ pass (2026-10-25) |
| A3 | demo-desktop open/fill/save/verify/screenshot | `node tests/e2e-desktop/run.mjs` (or `npm run acceptance:m2`) | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/`: `e2e-desktop/screenshots/001…020-*.png` (20 real step screenshots), `e2e-desktop/result.json` (36/36 checks), `e2e-desktop/project.json` (real saved JSON, content verified), `steps.json`, `sidecar.log`, `report.md`, `checkpoint.json`; run `run-20261025-185100-6a4d70` | ✅ pass (2026-10-25; real window + real SendInput mouse/keyboard) |
| A4 | Seeded defect → CodeTask → patch → apply → tests pass | `node dist/apps/cli/src/index.js code-loop` (or `npm run acceptance`) | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A4-code-loop/`: `patch.diff`, `code-loop-result.json`, `e2e/login-timeout/` (4 screenshots + `result.json`), `report.md`; run `run-20261025-175216-fe8759` | ✅ pass (2026-10-25; red→green on round 1) |
| A5 | Two consecutive failures → escalate, no infinite loop | `node dist/apps/cli/src/index.js code-loop --fail` (or `npm run acceptance`) | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A5-escalation/`: `test.log` (two failed rounds), `code-loop-result.json` (`escalated=true`, `rounds=2`), `e2e/login-timeout/screenshots/004-assert-timeout-recovery-fail.png`; run `run-20261025-175223-de0b95`; `codeLoopFail` exit 1 is expected | ✅ pass (2026-10-25) |
| A6 | Every run has prompt/patch/test.log/screenshots/report, no secrets | `npm run demo` + `npm run evidence` + `npm run acceptance` + `npm run acceptance:m2` + `npm run acceptance:m3` + `npm run acceptance:m4` | M0: `runs/run-20261025-172017-eb9116/` (`prompt.md` / `patch.diff` / `test.log` / `report.md` / `events.jsonl` / `console.log` / `meta.json` / `code-task.json` / `code-result.json` / `goal.md`) + `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}`; M1: `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/` (45 files incl. real e2e screenshots); M2: `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/` (34 files incl. real desktop screenshots + `checkpoint.json` + 53/53 test logs); M3: `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` + `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/` (15 files: scout-run report/drafts/approval-queue/events + 74/74 `unit-tests.log`); M4: `docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `docs/test-evidence/evidence-m4-<stamp>/` (A10 dummy-branch evidence + 80/80 `unit-tests.log` + A11 release-readiness checks; repo-level `npm run check:secrets` passes) | ✅ pass (2026-10-25; M4 includes release-readiness and A10 evidence) |
| A7 | Scout ≥10 leads (source+score), 3 drafts unsent | `node dist/apps/cli/src/index.js scout --json` (or `npm run acceptance:m3`) | `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/scout-run/`: `scout-report.json` (`leads_total=14`, `leads_discarded=4`, `qualified_count=8`, `drafts_count=3`, `pending_approval=3`, `sent_count=0`, 4 `rejected_reasons`, 3 `scenarios`), `leads-scored.json`, `drafts.json` (110–113 chars ≤150, `cites_signal=true`), `approval-queue.json` (all 3 `pending`), `outreach-drafts/lead-001.md`/`lead-004.md`/`lead-006.md`, `scout-report.md`, `report.md`; run `run-20261025-200457-17b4e7` | ✅ pass (2026-10-25; fixture-driven, no network, 0 sent) |
| A8 | Stop key within 5s; restart resumes without duplicates | `node dist/apps/cli/src/index.js safety-check`; in-flight preemption and resume are covered by `tests/unit/m2-runtime.test.mjs` (part of `npm test`) | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json` (`stop.ok=true`, measured **305ms** <5000ms; `checkpoint` save/load/completed); `m2-runtime-tests.log` (stop preempts within 5s, resume skips completed steps without re-running them) | ✅ pass (2026-10-25) |
| A9 | Branch isolation (credentials / browser profiles) | `node dist/apps/cli/src/index.js safety-check`; `tests/unit/m2-safety.test.mjs` (part of `npm test`) | `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A8-A9-safety-check/safety-check-result.json`: cross-branch credential reads denied (`CrossBranchAccessError`), redacted output contains no reference plaintext, same-profile concurrent use denied (`ProfileBusyError`), tools outside the allowlist denied; isolation cases in `tests/unit/m2-safety.test.mjs` | ✅ pass (2026-10-25) |
| A10 | New read-only dummy branch by config only | `node dist/apps/cli/src/index.js dummy-branch [--json]` (or `npm run acceptance:m4`) | A10 check in `docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` + `evidence-m4-2026-10-25_13-43-07/A10-dummy-branch/` (dummy-branch run artifacts); `tests/unit/m4-release.test.mjs` (asserts `role=dummy`, `tools=[echo]`, `promptRef=reviewer@1.0.0`, run report exists); reuses `prompts/reviewer.md`, no core change | ✅ pass (2026-10-25; config + existing reviewer prompt only) |
| A11 | Tests/lint/docs/license complete, no telemetry | `npm run lint && npm test` + `npm run acceptance:m4` | A11 checks in `docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.{md,json}` (CC BY-NC-SA 4.0 license text + non-commercial, NOTICE third-party declaration, COMMERCIAL notice, bilingual docs pairing, no telemetry, version consistency 0.5.0, release docs present) + `tests/unit/m4-release.test.mjs` + CI #10 (Windows + Ubuntu green) + 80/80 tests | ✅ pass (2026-10-25; v0.5.0 release-ready) |
| A12 | Runtime prompts versioned, tested, replaceable | `npm run test:prompts` | `prompts/manifest.json` (4 roles + sha256) + `tests/unit/prompts.test.mjs` (5 assertions) | ✅ pass (2026-10-25) |

> **M0 verdict (2026-10-25)**: A1 / A6 / A12 pass. `npm run check`, `npm run check:secrets`,
> `npm test` (30/30), `npm run demo` and `npm run evidence` all exit 0; the evidence files are
> generated by `npm run evidence` and are never edited by hand.
>
> **M1 verdict (2026-10-25)**: A2 / A4 / A5 / A6 pass (local headed real Chrome, `npm run acceptance`
> OK). A2: 7 steps / 7 real screenshots; A4: red→green on round 1; A5: escalation after two failed
> rounds (exit 1, no infinite retry). M1 historical result: **35/35** tests, CLI **9 commands + 2
> placeholders**; `npm run lint`, `npm run check` and `npm run check:secrets` passed. Evidence:
> `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
> `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/` (45 files: A2 / A4 / A5 groups).
>
> **M2 verdict (2026-10-25)**: A3 / A8 / A9 pass (local real Windows desktop session,
> `npm run acceptance:m2` OK: build + **53/53** tests + desktop flow + stop-key/checkpoint + isolation
> self-check all ✅). A3: a real window is driven with real mouse/keyboard (SendInput) through
> open → fill → save → validate → screenshots — **36/36 checks, 20 real screenshots, JSON content
> verified** (run `run-20261025-185100-6a4d70`); A8: stop key measured **305ms** (<5000ms), runtime
> integration tests prove in-flight preemption and checkpoint resume skips completed steps without
> re-running them; A9: cross-branch credentials unreadable (`CrossBranchAccessError`), same profile
> cannot be used concurrently (`ProfileBusyError`), tools outside the allowlist denied. Tests
> **53/53** (M1's 35 + `m2-safety` 14 + `m2-runtime` 4); the CLI now ships **11 implemented commands +
> 2 placeholders**. Evidence: `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
> `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/` (34 files, sanitized).
>
> **M3 verdict (2026-10-25)**: A7 passes (local fixture-driven Scout run, no network egress,
> `npm run acceptance:m3` OK, **12/12 checks true**). Scout run `run-20261025-200457-17b4e7`:
> **14** fixture leads → **4** discarded (missing `source_url` / invalid URL / empty `consent_basis` /
> duplicate — one each) → 10 pass the source hard-checks, of which **8** reach the default 0.5 qualified
> threshold → **3 outreach drafts** (110–113 chars, all ≤150 and citing a concrete signal) →
> approval queue **all 3 `pending`**, **0 sent**; ICP + **3 high-value scenarios**; every discard reason
> recorded. Tests **74/74** (M2's 53 + `scout.test.mjs` 21, 11 test files); the CLI now ships
> **12 implemented commands + 2 placeholders** (new `scout`). Evidence:
> `docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.{md,json}` +
> `docs/test-evidence/evidence-m3-2026-10-25_12-04-47/` (15 files: scout-run evidence + `unit-tests.log`,
> sanitized).
>
> **M4 verdict (2026-10-25, Phase 1 close-out)**: A10 / A11 / A12 pass, `npm run acceptance:m4` OK
> (10 checks all ✅). A10: `steward dummy-branch` read-only branch (`role=dummy`, `tools=[echo]`,
> reusing the `reviewer@1.0.0` prompt, no core change); A11: release-readiness checks all pass
> (license / third-party NOTICE / commercial notice / bilingual doc pairing / no telemetry / version
> consistency 0.5.0 / release docs present), CI #10 green on Windows + Ubuntu; A12: prompt versioning
> unchanged. Tests **80/80** (M1–M3's 74 + `m4-release` 6, 12 test files); the CLI now ships
> **13 implemented commands + 2 placeholders** (new `dummy-branch`). Evidence:
> `docs/test-evidence/m4-acceptance-<stamp>.{md,json}` + `evidence-m4-<stamp>/` (generated by
> `npm run acceptance:m4`, sanitized).
>
> **Phase-1 verdict (2026-10-25, v0.5.0)**: **A1–A12 all pass**; Phase 1 (M0–M4) is complete and
> released as **v0.5.0**. Delivered: Operator (real browser A2/A4/A5 + real Windows desktop A3), the
> Harness code loop, the Scout customer branch (A7, drafts only — never sends), safety modules
> (A8/A9), the A10 read-only dummy branch, A11 release readiness and prompts v1 (A12); **80/80** tests,
> **13 commands + 2 placeholders**. Release notes `docs/RELEASE_NOTES_v0.5.0.md`, demo script
> `docs/demo-script.*`, good first issues `docs/good-first-issues.md`. Next: Phase 2 P1
> personal-edition MVP.
>
> **P1 verdict (2026-10-25, Phase 2 personal-edition MVP, v0.6.0)**: B1 / B2 / B5 / B6 / B7 pass,
> `npm run acceptance:p1` OK (**12/12 checks ✅**; build + **113/113** tests + business + console E2E).
> B1: 3 candidate business lines (sources checkable) + proposal; B2: ledger with 2 entries, all **six
> facts**; B5: promise authorization chain of **3 segments** (conversation text → mandate clause →
> project; unrecorded = unauthorized); B6: takeover `stop_ms=3` (≤10000) + **6-section takeover pack**
> (incl. credential references); B7: **18 personal-mode boundary rules**, four out-of-scope classes
> **4/4 denied** (deny), payment → human, quote → draft_only. Real browser (headed Chrome): console E2E
> **9 steps / 73 checks / 9 screenshots**, browser-measured takeover stop **88ms**; CLI-launched console
> opened in a real browser (dashboard + ledger six facts, `console-cli/ledger.png`); approval/takeover
> commands with a real human approval take effect; monthly report income ¥20000 / cost ¥0 / gross
> ¥20000 / budget left ¥50000. Tests **113/113** (Phase 1's 80 + domain 30 + phase2-cli 3, 14 test
> files); the CLI now ships **18 implemented commands + 0 placeholders** (new `business`,
> `boundary-check`, `console`, `approve`, `takeover`). **B3/B4 pending P2 fault drills, B8 pending P3
> enterprise edition.** Evidence:
> `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.{md,json}` +
> `docs/test-evidence/evidence-p1-2026-10-25_14-18-54/` (39 files: business-run / boundary-run /
> console-e2e / console-cli / takeover-result / unit-tests.log, sanitized).

## B. Phase 2 (doc 2 — 8 items)

> P1 (personal-edition MVP) covers **B1 / B2 / B5 / B6 / B7** (all pass); **B3 / B4 → P2 fault drills**,
> **B8 → P3 enterprise edition**.

| # | Acceptance | Scenario | Evidence | Status |
|---|---|---|---|---|
| B1 | Topic selection: ≥3 business lines under ¥50k/30d, sources open in 30s | simulated proposal | `evidence-p1-2026-10-25_14-18-54/business-run/proposal.json` (3 qualified, sources checkable, proposal=true; business command 157ms); run `run-20261025-221904-b56b1a` | ✅ pass (2026-10-25, P1) |
| B2 | Bookkeeping: one expense shows 6 facts within 30s | ledger detail | `evidence-p1-2026-10-25_14-18-54/business-run/ledger-facts.json` (2 entries × 6 facts); console `/ledger` detail drawer + `console-e2e/screenshots/004-ledger-facts.png` | ✅ pass (2026-10-25, P1) |
| B3 | 2h offline produces no new promises; recovery reconciles in 10min | real network-off drill | gap list + reconciliation log | todo (P2 fault drills) |
| B4 | Platform B ban → all actions stop in 15min + alternatives | ban fault injection | stop event + alternatives | todo (P2 fault drills) |
| B5 | Any external promise traces to conversation text and authorization | promise trace | `evidence-p1-.../business-run/promise-traces.json` (3-segment chain: conversation text → mandate clause → project; unrecorded returns "unauthorized") | ✅ pass (2026-10-25, P1) |
| B6 | Takeover key stops in 10s + pack within 30min | takeover drill | `evidence-p1-.../takeover-result.json` (`stop_ms=3` ≤10000) + `business-run/takeover-pack.json` (6 sections: open orders / pending threads / payables / credentials / risks / coverage); console E2E `006-takeover-stop.png` / `007-takeover-resume.png` (browser-measured 88ms) | ✅ pass (2026-10-25, P1) |
| B7 | Four out-of-scope request classes denied 100% with readable reasons | boundary tests | `evidence-p1-.../business-run/boundary-check.json` + `boundary-run/boundary-rules.json` (18 personal-mode rules; 4/4 out-of-scope denied, payment → human, quote → draft_only, each with a readable user_message) | ✅ pass (2026-10-25, P1) |
| B8 | Personal and enterprise modes each run one order; mismatches blocked | dual-mode e2e | evidence for both | todo (P3 enterprise edition) |

## C. User requirements (U1–U8)

| # | Requirement | Evidence | Status |
|---|---|---|---|
| U1 | All UI tests are real browser/real desktop, never API substitutes | E2E screenshots (M1 A2/A4/A5, M2 A3, P1 console `tests/e2e-console` 9 steps/73 checks) + CI headless real-browser E2E | ✅ met (Phase 1 + P1; CI rule check can be strengthened in P2) |
| U2 | Notifications & assistance (approval card/handoff/takeover) | notification log + card screenshots | partial (P1 ships approval cards, takeover key and pack; Toast/email/webhook pending P3/P4) |
| U3 | IoT reserved (contract + simulated fixture) | contract doc + fixture tests | todo (P3/P4 stub) |
| U4 | GitHub minzzj release, NC-SA license, bilingual docs | https://github.com/minzzj/daizhang-steward + LICENSE (CC BY-NC-SA 4.0) + bilingual docs + v0.5.0 Release | ✅ done (2026-10-25, v0.5.0) |
| U5 | Promo video (real screenshots, two versions) | video + STORYBOARD/FACTS | todo (P4; real-command demo script for now) |
| U6 | Phase 1 ends with HANDOFF and session stop | [HANDOFF.md](../../HANDOFF.md) updated to "Phase 2 P1 complete, v0.6.0"; Phase 1 handed over as agreed | ✅ done (2026-10-25) |
| U7 | Test key never committed, logs redacted, rotatable | `npm run check:secrets` passes; evidence bundles sanitized | ✅ met |
| U8 | Built on DSH plugin ecosystem with reuse | reuse matrix + pinned deps | designed (MCP/plugin integration in P3/P4) |

## D. Evidence rules

- Every evidence path must be openable from inside the repository; screenshots come from E2E runs
  (never hand-captured).
- Before release, re-run everything from a clean neutral path and update the "latest result" column.
- Numbers in docs must match evidence; `docs/test-evidence/test-result-<stamp>.{md,json}` is generated
  by `npm run evidence` and never hand-edited; cross-doc number/link verification is currently done by
  manual grep + link checks in the release-docs task (`npm run verify:docs` is not implemented yet and
  could be a good first issue).
