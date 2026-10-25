# 代掌 Steward

**A composable, evidence-first operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations.

> Status: **Phase 2 P1 complete — personal-edition MVP (v0.6.0)** (2026-10-25). Building on the phase-1
> operating-AI core (real headed browser A2/A4/A5, real Windows desktop A3, safety modules A8/A9, Scout
> A7, A10 dummy branch, A11 release readiness, A12 prompts), P1 adds the **business steward**: an
> auditable business-domain engine (8 concepts: mandate / 3-level budget / project / task / agent /
> evidence / ledger / tombstone, with confidence levels), a simulated business line
> (`examples/demo-business`), a **local-only web console** (127.0.0.1, token-protected writes,
> dashboard / project timeline / ledger six-facts drawer / approvals / takeover key / monthly report),
> real human approval + takeover/resume, monthly report, L0/L1/L2 summaries and **18 personal-mode
> boundary rules**. **113/113** unit + integration tests pass (14 test files); the CLI ships
> **18 implemented commands + 0 placeholders**. Acceptance **A1–A12 pass**, plus phase-2
> **B1/B2/B5/B6/B7 pass** (B3/B4 deferred to P2 fault drills, B8 to P3 enterprise edition).
> P1 evidence:
> [`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md).
> See [ROADMAP.md](ROADMAP.md) and [`docs/en/delivery-checklist.md`](docs/en/delivery-checklist.md).
> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

---

## What it is

Steward is a composable operating-AI core made of four roles:

1. **Operator** (hands) — completes tasks in real browsers and real desktop apps: observe, act,
   verify, keep evidence.
2. **Conductor** (direction) — decomposes goals, spawns branches, allocates budgets, accepts and
   summarizes results.
3. **Harness loop** (code source) — on failure the Operator writes a reproducible CodeTask; the
   DeepSeek Harness returns a patch; it is applied in an isolated worktree and tested (max two
   rounds, then escalate to a human).
4. **Scout** (customer branch) — finds leads only from public, permitted sources; scores them and
   drafts outreach. **Humans approve before anything is sent.**

Every external action is appended to an append-only event ledger (`events.jsonl` with a hash
chain) together with screenshot/log/receipt evidence. High-risk actions are denied by default;
CAPTCHAs, 2FA and face verification always hand off to a human.

## What it is not

- Not an auto-signing / auto-paying / auto-invoicing tool: those are denied by default or drafted only.
- Does not bypass CAPTCHAs, risk controls or platform rules; no scraping behind logins; no bulk outreach.
- Is not a legal subject: it never acts as legal representative, shareholder, director, supervisor or
  senior manager.
- Phase 1 is not a multi-tenant SaaS, billing system or heavy frontend.

## Two phases

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Open-source "operating-AI core": Operator + Harness code loop + Scout + Conductor; 12 reproducible acceptance checks | ✅ **Complete (v0.5.0, A1–A12 pass)** |
| Phase 2 | Steward business agent: **personal edition first** (one simulated business line end-to-end), then enterprise edition; 8 acceptance checks + 30 legal/compliance boundaries | 🔄 **In progress — P1 personal-edition MVP complete (v0.6.0, B1/B2/B5/B6/B7 pass)**; P2 fault drills next |

Phase 1 is complete and released as **v0.5.0**; phase 2 has started — **P1 personal-edition MVP is
complete as v0.6.0**, and P2 (fault drills B3/B4), P3 (enterprise edition B8 + 30 boundaries) and P4
(v1.0.0 + promo video) are next — see [ROADMAP.md](ROADMAP.md).

## Architecture at a glance

```text
human owner ── approval cards / takeover key / monthly report ──┐
                                                                 ▼
                        Conductor (direction, branches, budget)
                                     │
            ┌────────────────────────┼────────────────────────┐
      Operator (browser/desktop)  Scout (leads)        Reviewer (evidence)
            │                        │                        │
     Playwright real browser   public-source fixtures   policy + audit
     Windows real desktop      scoring + drafts         events.jsonl
     (ctypes sidecar + SendInput)
            └────────── CodeTask → Harness → patch → tests ─────────┘
```

See [`docs/en/architecture.md`](docs/en/architecture.md) / [`docs/zh-CN/architecture.md`](docs/zh-CN/architecture.md).

Phase 2 P1 adds the **business steward** on top of the core: the business-domain engine
(`steward-domain`: mandate, three-level budget, project, task, agent, evidence, ledger, tombstone;
approvals, takeover pack, monthly report, L0/L1/L2 summaries, 18 personal-mode boundary rules) and a
**local-only web console** (`steward-console`, 127.0.0.1 + token-protected writes) that renders the
dashboard, project timeline, ledger six-facts drawer, approval cards and the takeover key — driven by
one fictional simulated business line (`examples/demo-business`).

## Repository layout

The repository is a **single package** (no pnpm workspace): `tsconfig.json` compiles
`packages/*/src` and `apps/cli/src` into `dist/` with `tsc -p tsconfig.json`. All commands use npm.

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts + M2
            stop-controller/checkpoint/isolation; steward-harness: MockHarness + isolated-worktree
            patch + two-round code loop; steward-browser: Playwright real-browser adapter;
            steward-desktop: real Windows desktop adapter — ctypes sidecar + SendInput;
            steward-scout: customer-branch engine — ICP/scoring/drafts/approval queue, no network;
            steward-domain: phase-2 business-domain engine; steward-console: local web console)
apps/       CLI entry (steward: demo/browser-flow/desktop-flow/scout/dummy-branch/business/console/
            boundary-check/approve/takeover/code-loop/run/branch/report/stop/safety-check/version/help)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness (scripted patches), scout-fixtures (14 fictional
            compliant leads), demo-business (simulated personal-edition business line)
tests/      unit tests (14 files / 113 at v0.6.0) + e2e-browser + e2e-desktop + e2e-console; contract / fault drills later
docs/       bilingual docs (en/ and zh-CN/) + test evidence
scripts/    check/build helpers, secret scan, evidence + acceptance runners, delivery sync
runs/       per-run artifacts (gitignored; evidence lives here)
dist/       build output (gitignored; single-package build)
```

## Quickstart (M0 → v0.6.0)

Phase 1 is complete and phase 2 P1 is delivered; every milestone can be reproduced locally and offline.
M0 runs with no paid API (MockHarness); M1 adds a real-browser loop; M2 adds the real Windows desktop
loop and safety modules; M3 adds the fixture-driven Scout customer branch; M4 adds the A10 read-only
dummy branch and release-readiness acceptance; **P1 adds the business domain, the local web console and
the simulated business line (B1/B2/B5/B6/B7)**:

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm; Chrome/Edge for real-browser acceptance;
# Python >= 3.8 on PATH for the real-desktop acceptance
npm install
npm run check          # repo/config check
npm run check:secrets  # secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 113/113 unit + integration tests (14 files)
npm run demo           # M0 empty loop → runs/<run-id>/ + report.md (MockHarness)
npm run test:prompts   # prompt versioning/safety tests (acceptance A12)
npm run evidence       # offline evidence bundle → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 headed real-browser acceptance (A2/A4/A5) → docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2  # M2 real-desktop + stop/checkpoint/isolation acceptance (A3/A8/A9), local-only
npm run acceptance:m3  # M3 Scout acceptance (A7: 14 leads → 4 discarded → 8 qualified → 3 drafts, 0 sent)
npm run acceptance:m4  # M4 (phase-1) release readiness (version check is dynamic; re-runnable on later commits; current phase-2 work uses acceptance:p1)
npm run acceptance:p1  # P1 personal-edition MVP acceptance (B1/B2/B5/B6/B7 + console E2E + 113 tests), local-only
# phase-2 P1 quick tour (all offline, fictional data):
node dist/apps/cli/src/index.js business       # proposal + simulated business line + ledger 6 facts + promise trace + takeover pack + monthly report + boundaries
node dist/apps/cli/src/index.js boundary-check # 18 personal-mode boundary rules; 4 out-of-scope classes denied
node dist/apps/cli/src/index.js console        # local web console at http://127.0.0.1:4180 (token-protected writes)
node dist/apps/cli/src/index.js approve --json    # human approval queue (expires = suspend, never auto-approve)
node dist/apps/cli/src/index.js takeover --json   # takeover key: halt + 6-section takeover pack; --resume to continue
```

CI runs the repository self-check, secret scan, build, 113 tests, demo evidence, the fixture-driven
`scout` demo (drafts only, never auto-sent), the phase-2 `business`/`boundary-check` demos, the A10
`dummy-branch` demo, `safety-check`, the **headless real-browser console E2E** and the headless
real-browser demo-web E2E; headed acceptance (`npm run acceptance`, `npm run acceptance:p1`) and the
real-desktop `npm run acceptance:m2` are local-only (hosted CI has no interactive desktop).

What v0.6.0 can do: the CLI implements `demo`, `browser-flow`, `desktop-flow`, `scout`, `dummy-branch`,
`business`, `console`, `boundary-check`, `approve`, `takeover`, `code-loop`, `run`, `branch`, `report`,
`stop`, `safety-check`, `version` and `help` (**18 commands, 0 placeholders**).
`browser-flow` drives the real demo-web login/project flow in headed Chrome with per-step screenshots;
`desktop-flow` drives the real `demo-desktop` window with real mouse/keyboard input (SendInput, Unicode
typing) and per-step screenshots; `scout` loads the fictional compliant fixtures, builds the ICP + 3
high-value scenarios, four-factor scores the leads (need 40% / budget 20% / reachability 20% /
compliance 20%), hard-checks and dedupes sources, drafts at most 3 outreach drafts (≤150 chars, each
citing a concrete signal) and queues them for **human approval** (all `pending`, `sent=0`; daily
per-channel limit 10; unsubscribe honored; no network I/O); `dummy-branch` shows A10 — a new read-only
branch needs only a BranchSpec + an existing prompt (`reviewer@1.0.0`), with no core change;
**`business`** runs the phase-2 business steward end to end on the fictional fixture — topic selection
(3 candidate lines with checkable sources), one simulated business line (project → tasks → deliverables →
acceptance → income/invoice), ledger with mandatory **six facts**, **promise traces** (conversation
source → mandate clause → project; unrecorded = unauthorized), a **6-section takeover pack**, a monthly
report and the 18 personal-mode boundary rules; **`console`** serves the local web control panel
(binding **only 127.0.0.1**, writes protected by an `X-Steward-Token`, no CDN/external links;
dashboard, project timeline, ledger six-facts drawer, approval cards, takeover key, monthly report);
**`boundary-check`** self-checks the boundary rules (4 out-of-scope classes → 100% deny; payment →
human; quote → draft-only); **`approve`** and **`takeover`** are real human commands (approval expires =
suspend, never auto-approve; takeover halts all new writes and produces the pack, `--resume` continues)
— and the real console E2E (headed Chrome in acceptance) measured the takeover stop in the browser at
**88 ms** (limit 10000 ms). `code-loop` runs CodeTask → patch → isolated git worktree → real-browser
acceptance (`code-loop --fail` injects a broken patch and escalates after two rounds); `safety-check`
self-checks the stop key (≤5s), checkpoint save/load/resume and branch isolation; `run --resume <runId>`
resumes from the last checkpoint and skips steps already completed. Every run writes its evidence bundle
to `runs/<run-id>/`: `prompt.md`, `report.md`, `console.log`, `meta.json`, `events.jsonl`
(hash-chained ledger), `checkpoint.json`, plus `patch.diff`, `test.log`, `code-task.json`,
`code-result.json`, `e2e/<case>/screenshots/`, `e2e-desktop/screenshots/`, and (for Scout)
`scout-report.md/.json`, `leads-scored.json`, `drafts.json`, `approval-queue.json`, `outreach-drafts/`;
the phase-2 `business` command also writes `proposal.json`, `business-result.json`,
`ledger-facts.json`, `promise-traces.json`, `takeover-pack.json`, `boundary-check.json`,
`monthly-report.{json,md}`, `summaries.json`. The built CLI can also be invoked directly:
`node dist/apps/cli/src/index.js help`.

Latest P1 personal-edition MVP acceptance (2026-10-25, local headed Chrome, `npm run acceptance:p1` OK,
12/12 checks): [`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md)
(· [`.json`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.json)); evidence bundle
[`docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`](docs/test-evidence/evidence-p1-2026-10-25_14-18-54/)
(39 files, sanitized: `business-run/` including `proposal.json`, `ledger-facts.json` (2 entries ×
6 facts), `promise-traces.json` (3-segment authorized chain), `takeover-pack.json` (6 sections),
`boundary-check.json` (18 rules; 4/4 deny + human + draft-only), `monthly-report.{json,md}`;
`console-e2e/` with 9 step screenshots / 73 checks / browser takeover stop **88 ms**; `console-cli/`
real-browser screenshots of the CLI-launched console; `unit-tests.log` 113/113). B1/B2/B5/B6/B7 pass;
B3/B4 are deferred to P2 fault drills and B8 to P3 enterprise edition.

Latest M4 phase-1 release acceptance (2026-10-25, `npm run acceptance:m4` OK, 10/10 checks): checks A10
read-only `dummy-branch`, A11 release readiness (CC BY-NC-SA 4.0 license text, third-party NOTICE,
commercial notice, bilingual docs, no telemetry, `package.json`/CLI version consistency, release docs)
and the full **80/80** suite. Evidence:
[`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md)
(· [`.json`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.json)) +
[`docs/test-evidence/evidence-m4-2026-10-25_13-43-07/`](docs/test-evidence/evidence-m4-2026-10-25_13-43-07/).
Release notes: [`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md).

Latest M3 acceptance (2026-10-25, local fixture-driven Scout run — no network, `npm run acceptance:m3`
OK, 12/12 checks): [`docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.md`](docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.md)
(· [`.json`](docs/test-evidence/m3-acceptance-2026-10-25_12-04-47.json)); evidence bundle
[`docs/test-evidence/evidence-m3-2026-10-25_12-04-47/`](docs/test-evidence/evidence-m3-2026-10-25_12-04-47/)
(15 files, sanitized: Scout run `run-20261025-200457-17b4e7` — 14 leads → 4 rejected → 8 qualified →
3 drafts of 110–113 chars, all pending approval, 0 sent; plus `unit-tests.log` with 74/74).

Latest M2 acceptance (2026-10-25, local real Windows desktop session, `npm run acceptance:m2` OK):
[`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.md`](docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.md)
(· [`.json`](docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.json)); evidence bundle
[`docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`](docs/test-evidence/evidence-m2-2026-10-25_10-50-51/)
(34 files, sanitized: A3 real-desktop run `run-20261025-185100-6a4d70` with 20 step screenshots +
`result.json`/`steps.json`/`project.json`, A8/A9 `safety-check-result.json`, test logs). Checks: build,
53/53 tests, A3 desktop flow 36/36 checks, A8 stop key ≈305 ms (`<5000ms`) + checkpoint/resume, A9
credential/profile/tool-allowlist isolation — all ✅.

Latest M1 acceptance (2026-10-25, local headed Chrome, `npm run acceptance` OK):
[`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.md`](docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.md)
(· [`.json`](docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.json)); evidence bundle
[`docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`](docs/test-evidence/evidence-m1-2026-10-25_09-52-12/)
(45 files: A2 / A4 / A5 screenshots + logs); runs `run-20261025-175213-9ea8ab` (A2),
`run-20261025-175216-fe8759` (A4), `run-20261025-175223-de0b95` (A5).

Latest M0 offline loop run: `runs/run-20261025-172017-eb9116/` — evidence in
[`docs/test-evidence/test-result-2026-10-25_09-52-08.md`](docs/test-evidence/test-result-2026-10-25_09-52-08.md).

## Real-test pledge

- UI acceptance runs against **real Chromium/Edge (headed)** and **real Windows windows with real
  mouse/keyboard input (SendInput)** — never API calls or fake DOM as a stand-in.
- Every external action is screenshotted; failures keep their scene; at most two retries, then
  escalation to a human.
- **Scout never sends anything by itself**: it only drafts (≤150 chars, citing a concrete signal),
  every outreach item waits in the human approval queue (`pending`), the queue is capped at 10 per
  channel per day, unsubscribe stops all further contact, and the module performs **zero network I/O**
  — `markSent` merely records state.
- **The phase-2 local console is a real browser UI, tested with a real browser**: the console binds
  **only 127.0.0.1**, needs an `X-Steward-Token` for writes, has no CDN/external links, and its E2E
  suite drives a headed real Chrome through dashboard → project timeline → ledger six-facts drawer →
  approvals → takeover stop → resume → monthly report; the browser-measured takeover stop was **88 ms**
  (limit 10000 ms). The business data is a purely fictional simulated line (no real customers, money or
  outreach), and `approve` / `takeover` are always human commands — an expired approval suspends, it is
  never auto-approved.
- CI uses a mock harness (no paid keys) and runs: self-check, secret scan, build, 113 tests, demo
  evidence, the fixture-driven `scout` demo (drafts only, never auto-sent), the phase-2
  `business`/`boundary-check` demos, the A10 `dummy-branch` demo, `safety-check`, the headless real-browser
  **console E2E** and the headless real-browser demo-web E2E; headed acceptance (`npm run acceptance`,
  `npm run acceptance:p1`) and real-desktop acceptance (`npm run acceptance:m2`) are local-only. Before
  release, the full suite is re-run from a clean path.

## License

Project code: **[CC BY-NC-SA 4.0](LICENSE)** — source-available, **non-commercial**, share-alike on
distribution. This is not an OSI license; "source-available" is the accurate term. Commercial use
requires a separate license: see [`COMMERCIAL.md`](COMMERCIAL.md). Third-party components
(DeepSeek Harness, dsh-browser, dsh-computer-use — MIT) keep their own licenses: see [`NOTICE`](NOTICE).

## Security

No telemetry. Secrets are read from environment variables only; logs are redacted; a secret scan
runs before every commit/CI. See [`SECURITY.md`](SECURITY.md).

## Docs

- [ROADMAP.md](ROADMAP.md) — milestones and approval gates (Phase 1 complete; Phase 2 P1 complete, P2 next)
- [docs/RELEASE_NOTES_v0.5.0.md](docs/RELEASE_NOTES_v0.5.0.md) — v0.5.0 (phase 1) release notes (bilingual)
- [docs/demo-script.md](docs/demo-script.md) · [docs/demo-script.zh-CN.md](docs/demo-script.zh-CN.md) — 3-minute demo script
- [docs/good-first-issues.md](docs/good-first-issues.md) — 5 good first issues (bilingual)
- [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — acceptance items with evidence
  (A1–A12 pass; phase 2 B1/B2/B5/B6/B7 pass, B3/B4/B8 pending P2/P3)
- [docs/test-evidence/](docs/test-evidence/) — evidence archive (`test-result-*`, `m1-acceptance-*` …
  `m4-acceptance-*` + `evidence-m1-*` … `evidence-m4-*`, and `p1-acceptance-2026-10-25_14-18-54.*` +
  `evidence-p1-2026-10-25_14-18-54/`)
- [docs/en/architecture.md](docs/en/architecture.md) · [docs/en/adapters.md](docs/en/adapters.md)
  · [docs/en/contracts.md](docs/en/contracts.md) · [docs/en/threat-model.md](docs/en/threat-model.md)
- [packages/steward-desktop/README.md](packages/steward-desktop/README.md) — real Windows desktop adapter
- [packages/steward-scout/README.md](packages/steward-scout/README.md) — Scout customer-branch engine
- [packages/steward-domain/README.md](packages/steward-domain/README.md) — phase-2 business-domain engine
- [packages/steward-console/README.md](packages/steward-console/README.md) — local web console
- [examples/scout-fixtures/README.zh-CN.md](examples/scout-fixtures/README.zh-CN.md) — 14 fictional compliant leads
- [examples/demo-business/README.zh-CN.md](examples/demo-business/README.zh-CN.md) — simulated personal-edition business line
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — assumptions and known gaps
- [HANDOFF.md](HANDOFF.md) — current handoff status

## Acknowledgements

Architecture and tooling build on **DeepSeek Harness** (MIT). The real-test and open-source release
process follows lessons from the author's earlier projects `asset-lineage` and `DramaCore`.

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted and handed over — not sold._
