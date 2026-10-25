# 代掌 Steward

**A composable, evidence-first operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations.

> Status: **M0 complete** — minimal kernel loop verified (2026-10-25): the `steward` CLI runs an
> end-to-end empty loop with MockHarness (no paid API), **30/30** unit + integration tests pass, and
> **4** versioned runtime prompts ship with a sha256-checked manifest. Acceptance items A1/A6/A12
> pass — see [ROADMAP.md](ROADMAP.md) and the evidence in
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
            steward-harness: MockHarness)
apps/       CLI entry (steward: demo/run/branch/report/stop/version/help)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness, scout-fixtures, demo-business
tests/      unit tests (30 implemented at M0); contract / e2e / fault drills land later
docs/       bilingual docs (en/ and zh-CN/) + test evidence
scripts/    check/build helpers, secret scan, evidence bundle, delivery sync
runs/       per-run artifacts (gitignored; evidence lives here)
dist/       build output (gitignored; single-package build)
```

## Quickstart (M0)

M0 runs offline once cloned — no paid API (MockHarness):

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm
npm install
npm run check          # repo/config check
npm run check:secrets  # secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 30/30 unit + integration tests
npm run demo           # empty loop → runs/<run-id>/ + report.md (MockHarness)
npm run test:prompts   # prompt versioning/safety tests (acceptance A12)
npm run evidence       # evidence bundle → docs/test-evidence/test-result-<stamp>.{md,json}
```

What M0 can do: the CLI implements `demo`, `run`, `branch`, `report`, `stop`, `version` and `help`
(`takeover` and `approve` are placeholders for Phase 2 / M1). Every run writes its evidence bundle to
`runs/<run-id>/`: `prompt.md`, `report.md`, `console.log`, `meta.json`, `events.jsonl` (hash-chained
ledger), plus `patch.diff`, `test.log`, `code-task.json` and `code-result.json` from the MockHarness
loop, and an (empty until M1) `screenshots/` directory. The built CLI can also be invoked directly:
`node dist/apps/cli/src/index.js demo`.

Latest verified M0 run: `runs/run-20261025-172017-eb9116/` — evidence in
[`docs/test-evidence/test-result-2026-10-25_09-20-15.md`](docs/test-evidence/test-result-2026-10-25_09-20-15.md).

## Real-test pledge

- UI acceptance runs against **real Chromium/Edge (headed)** and **real Windows windows with real
  mouse/keyboard input** — never API calls or fake DOM as a stand-in.
- Every external action is screenshotted; failures keep their scene; at most two retries, then
  escalation to a human.
- CI uses a mock harness (no paid keys). Before release, the full suite is re-run from a clean path.

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
- [docs/test-evidence/](docs/test-evidence/) — evidence archive (`test-result-*.{md,json}`)
- [docs/en/architecture.md](docs/en/architecture.md) · [docs/en/contracts.md](docs/en/contracts.md)
  · [docs/en/threat-model.md](docs/en/threat-model.md)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — assumptions and known gaps
- [HANDOFF.md](HANDOFF.md) — current handoff status

## Acknowledgements

Architecture and tooling build on **DeepSeek Harness** (MIT). The real-test and open-source release
process follows lessons from the author's earlier projects `asset-lineage` and `DramaCore`.

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted and handed over — not sold._
