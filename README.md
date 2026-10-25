# 代掌 Steward

**A composable, evidence-first operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations.

> Status: **M1 complete** — real-browser code loop verified (2026-10-25): headed Chrome runs the
> demo-web flow (A2), repairs the seeded login-timeout defect through CodeTask → patch → isolated
> worktree → real browser red→green (A4), and escalates after two failed rounds (A5). **35/35** unit +
> integration tests pass; the CLI ships **9 commands + 2 placeholders**. Acceptance A1/A2/A4/A5/A6 and
> A12 pass — see [ROADMAP.md](ROADMAP.md) and
> [`docs/en/delivery-checklist.md`](docs/en/delivery-checklist.md).
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

| Phase | Scope | Source of truth |
|---|---|---|
| Phase 1 | Open-source "operating-AI core": Operator + Harness code loop + Scout + Conductor; 12 reproducible acceptance checks | DeepSeek build prompt |
| Phase 2 | Steward business agent: **personal edition first** (one simulated business line end-to-end), then enterprise edition; 8 acceptance checks + 30 legal/compliance boundaries | Steward product vision |

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
     Windows UIA real desktop  scoring + drafts         events.jsonl
            └────────── CodeTask → Harness → patch → tests ─────────┘
```

See [`docs/en/architecture.md`](docs/en/architecture.md) / [`docs/zh-CN/architecture.md`](docs/zh-CN/architecture.md).

## Repository layout

The repository is a **single package** (no pnpm workspace): `tsconfig.json` compiles
`packages/*/src` and `apps/cli/src` into `dist/` with `tsc -p tsconfig.json`. All commands use npm.

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts;
            steward-harness: MockHarness + isolated-worktree patch + two-round code loop;
            steward-browser: Playwright real-browser adapter)
apps/       CLI entry (steward: demo/browser-flow/code-loop/run/branch/report/stop/version/help)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness (scripted patches), scout-fixtures, demo-business
tests/      unit tests (35 at M1) + e2e-browser real-browser E2E; contract / desktop / fault drills later
docs/       bilingual docs (en/ and zh-CN/) + test evidence
scripts/    check/build helpers, secret scan, evidence + acceptance runners, delivery sync
runs/       per-run artifacts (gitignored; evidence lives here)
dist/       build output (gitignored; single-package build)
```

## Quickstart (M0 → M1)

M0 runs offline once cloned — no paid API (MockHarness); M1 adds a real-browser loop:

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm; local Chrome/Edge for real-browser acceptance
npm install
npm run check          # repo/config check
npm run check:secrets  # secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 35/35 unit + integration tests
npm run demo           # M0 empty loop → runs/<run-id>/ + report.md (MockHarness)
npm run test:prompts   # prompt versioning/safety tests (acceptance A12)
npm run evidence       # offline evidence bundle → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 headed real-browser acceptance (A2/A4/A5) → docs/test-evidence/m1-acceptance-<stamp>.*
```

CI runs the headless real-browser normal flow (`node tests/e2e-browser/login-flow.mjs --case normal
--headless 1`); headed `npm run acceptance` is local-only (hosted CI has no interactive desktop).

What M1 can do: the CLI implements `demo`, `browser-flow`, `code-loop`, `run`, `branch`, `report`,
`stop`, `version` and `help` (`takeover` and `approve` are placeholders). `browser-flow` drives the
real demo-web login/project flow in headed Chrome with per-step screenshots; `code-loop` runs
CodeTask → patch → isolated git worktree → real-browser acceptance, and `code-loop --fail` injects a
broken patch and escalates after two rounds. Every run writes its evidence bundle to
`runs/<run-id>/`: `prompt.md`, `report.md`, `console.log`, `meta.json`, `events.jsonl`
(hash-chained ledger), plus `patch.diff`, `test.log`, `code-task.json`, `code-result.json` and
`e2e/<case>/screenshots/`. The built CLI can also be invoked directly:
`node dist/apps/cli/src/index.js help`.

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
  mouse/keyboard input** — never API calls or fake DOM as a stand-in.
- Every external action is screenshotted; failures keep their scene; at most two retries, then
  escalation to a human.
- CI uses a mock harness (no paid keys) and runs the headless real-browser normal flow; headed
  acceptance (`npm run acceptance`) is local-only. Before release, the full suite is re-run from a
  clean path.

## License

Project code: **[CC BY-NC-SA 4.0](LICENSE)** — source-available, **non-commercial**, share-alike on
distribution. This is not an OSI license; "source-available" is the accurate term. Commercial use
requires a separate license: see [`COMMERCIAL.md`](COMMERCIAL.md). Third-party components
(DeepSeek Harness, dsh-browser, dsh-computer-use — MIT) keep their own licenses: see [`NOTICE`](NOTICE).

## Security

No telemetry. Secrets are read from environment variables only; logs are redacted; a secret scan
runs before every commit/CI. See [`SECURITY.md`](SECURITY.md).

## Docs

- [ROADMAP.md](ROADMAP.md) — milestones and approval gates
- [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — acceptance items with evidence
- [docs/test-evidence/](docs/test-evidence/) — evidence archive (`test-result-*`, `m1-acceptance-*`, `evidence-m1-*`)
- [docs/en/architecture.md](docs/en/architecture.md) · [docs/en/contracts.md](docs/en/contracts.md)
  · [docs/en/threat-model.md](docs/en/threat-model.md)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — assumptions and known gaps
- [HANDOFF.md](HANDOFF.md) — current handoff status

## Acknowledgements

Architecture and tooling build on **DeepSeek Harness** (MIT). The real-test and open-source release
process follows lessons from the author's earlier projects `asset-lineage` and `DramaCore`.

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted and handed over — not sold._
