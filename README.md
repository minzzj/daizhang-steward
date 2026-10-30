# 代掌 Steward

**A composable, evidence-first operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations.

> Status: **v1.0.0 released — two-phase delivery complete (Latest, 2026-10-26)**. Steward is a
> composable, evidence-first operating-AI steward delivered in two phases.
> **Phase 1 — open-source operating-AI core** (v0.5.0): real headed browser operator (A2/A4/A5), real
> Windows desktop operator (A3), safety modules (A8/A9), Scout customer branch (A7), A10 dummy branch,
> A11 release readiness and A12 prompts — **A1–A12 all pass**.
> **Phase 2 — business steward** (v0.6.0 / v0.8.0, shipped in the final v1.0.0): the **personal-edition MVP** (P1: business-domain engine,
> simulated business line, local-only web console, approvals/takeover/monthly report; B1/B2/B5/B6/B7,
> v0.6.0), the **real fault drills** (P2: short run + **real 120-minute outage / 15-minute ban long run** —
> outage: **1435 promises blocked / 0 new**, 1435 actions queued and **all replayed**,
> **`duplicates_found=0`**; ban: detected in **9 ms**, **180 attempts / 0 successes**, **5 alternatives**,
> notifications, recovery; B3/B4) and the **enterprise edition** (P3: entity/authorization/human seal,
> corporate account, VAT special invoices with validation, invoice & tax-filing drafts the AI never
> submits, dual review, org approval chain, **the AI never signs**, **B8 dual-mode consistency with all
> 6 mismatch classes blocked**, **30-rule dual-mode boundary table**) — **B1–B8 all pass**.
> **151/151** unit + integration tests pass (16 test files); the CLI ships **19 implemented commands +
> `help`** (0 placeholders).
> **GitHub Release [v1.0.0](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0) (Latest,
> two-phase delivery complete)** ships the real-screenshot promo video as release assets:
> [`daizhang-steward-promo-v1.0-bgm.mp4`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-bgm.mp4) ·
> [`silent`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-silent.mp4) ·
> [`poster`](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-poster.jpg)
> (110 s, 1280×720 @30 fps, real E2E screenshots only; project & storyboard in
> [`docs/media/promo/`](docs/media/promo/)). See
> [`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md) / [`docs/en/enterprise.md`](docs/en/enterprise.md),
> [ROADMAP.md](ROADMAP.md) and [`docs/en/delivery-checklist.md`](docs/en/delivery-checklist.md).
> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

---


> **v1.3.0（2026-10-26）**：配置中心支持**多模型与 API 密钥**（一键同步、各智能体独立选模型、密钥只存引用）；新增**两层总调度**（系统总控 supervisor + 项目总调度 conductor）、**控制台对话/每轮摘要/证据灯箱/系统总控/变现&易支付**页面；CLI 新增 `chat` / `supervisor` / `project` / `system` / `money`；290/290 单测 + 真实浏览器 E2E 25 步全绿。详见 `docs/RELEASE_NOTES_v1.3.0.md` 与 `docs/zh-CN/{configuration,chat,system,money}.md`。

> **v1.4.0（2026-10-30）**：**发送即执行 + SSE 实时事件流**——在 `/chat` 输入目标发送后自动执行，实时看到思考/计划/每步/每轮摘要/审批，无需手动点「开始执行」；新增 `steward runtime` CLI、审批策略配置（`/settings` 自动执行与审批策略）、模型输出兜底（未实现动作不再阻断，自动生成 deliverable）、系统总控扩展（文件/应用/服务/定时任务/安装卸载）。339/339 单测 + 真实浏览器 E2E 31 步/338 检查全绿。详见 `docs/RELEASE_NOTES_v1.4.0.md` 与 `docs/zh-CN/runtime.md`。
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
| Phase 1 | Open-source "operating-AI core": Operator + Harness code loop + Scout + Conductor; 12 reproducible acceptance checks | ✅ **Complete (v0.5.0, A1–A12 all pass)** |
| Phase 2 | Steward business agent: **personal edition first** (one simulated business line end-to-end), then enterprise edition; 8 acceptance checks + 30 legal/compliance boundaries | ✅ **Complete (v0.8.0, B1–B8 all pass) — P1 personal edition (v0.6.0); P2 fault drills incl. real 120-min outage + 15-min ban long run; P3 enterprise edition (B8 + 30 boundaries)** |
| Release | Final release v1.0.0 with bilingual docs, real-screenshot promo video, evidence index | ✅ **Released (v1.0.0, Latest — two-phase delivery complete)** |

Both phases are complete: phase 1 was released as **v0.5.0**, phase 2 as **v0.6.0 (P1)** and **v0.8.0
(P2+P3)**, and the final **v1.0.0** release
([GitHub Release, Latest](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0)) ships the
two-phase delivery with **A1–A12 and B1–B8 all passing**, bilingual docs, an evidence archive and a
**real-screenshot promo video** (3 release assets; project & storyboard in [`docs/media/promo/`](docs/media/promo/)).

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

Phase 2 P2 adds the **fault-drill module** (`steward-fault`): it injects **real** localhost HTTP faults
(`examples/demo-platform` can be switched to a real `ECONNREFUSED` outage, or return a real
`403 + x-platform-ban: true`), blocks new promises while offline, queues actions in an **idempotent
outbox**, replays them on recovery (ledger duplicates = 0), and generates a readable **alternative plan**
plus local notifications when platform B bans the account. `steward fault-drill --case net-outage |
platform-ban` runs the drills; the short acceptance run measured `outage=120007 ms`, 25 blocked promises,
25 queued/replayed actions, 0 duplicates, ban detected in 11 ms with 5 alternative items.

Phase 2 P3 adds the **enterprise edition** (`steward-enterprise`): entity/authorization checks,
corporate account, VAT special invoices with title/tax/contract validation (drafts pending a human),
tax-filing drafts (never auto-submitted), dual review (2 different roles), org approval chain by amount,
human-only seal (`ai_may_sign=false`), employment/qualification hand-offs, multi-agent serialization,
**B8 dual-mode consistency** (one personal order + one enterprise order, 6 mismatch classes 100% blocked)
and the **30-rule dual-mode boundary table** — see
[`docs/en/enterprise.md`](docs/en/enterprise.md) / [`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md).

## Repository layout

The repository is a **single package** (no pnpm workspace): `tsconfig.json` compiles
`packages/*/src` and `apps/cli/src` into `dist/` with `tsc -p tsconfig.json`. All commands use npm.

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts + M2
            stop-controller/checkpoint/isolation; steward-harness: MockHarness + isolated-worktree
            patch + two-round code loop; steward-browser: Playwright real-browser adapter;
            steward-desktop: real Windows desktop adapter — ctypes sidecar + SendInput;
            steward-scout: customer-branch engine — ICP/scoring/drafts/approval queue, no network;
            steward-domain: phase-2 business-domain engine; steward-console: local web console;
            steward-fault: P2 real-fault drills (outage gate, idempotent outbox, ban detection,
            alternative plans); steward-enterprise: P3 enterprise edition — entity/auth/seal,
            corporate invoices, dual review, org approval chain, 30 dual-mode boundary rules)
apps/       CLI entry (steward: demo/browser-flow/desktop-flow/scout/dummy-branch/business/console/
            boundary-check/fault-drill/enterprise-demo/approve/takeover/code-loop/run/branch/report/
            stop/safety-check/version/help — 19 implemented commands, 0 placeholders)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness (scripted patches), scout-fixtures (14 fictional
            compliant leads), demo-business (personal-edition business line), demo-platform (P2 real
            localhost fault-injection platform), demo-enterprise (P3 8 enterprise orders: 2 normal + 6
            mismatch)
tests/      unit tests (16 files / 151 at v0.8.0) + e2e-browser + e2e-desktop + e2e-console
docs/       bilingual docs (en/ and zh-CN/) + test evidence
scripts/    check/build helpers, secret scan, evidence + acceptance runners, delivery sync
runs/       per-run artifacts (gitignored; evidence lives here)
dist/       build output (gitignored; single-package build)
```

## Quickstart (M0 → v1.0.0)

Both phases are complete and the final **v1.0.0** is released (Latest); every milestone can be reproduced
locally and offline. M0 runs with no paid API (MockHarness); M1 adds a real-browser loop;
M2 adds the real Windows desktop loop and safety modules; M3 adds the fixture-driven Scout customer
branch; M4 adds the A10 read-only dummy branch and release-readiness acceptance; **P1 adds the business
domain, the local web console and the simulated business line (B1/B2/B5/B6/B7)**; **P2 adds real
localhost fault drills (B3/B4 short run + real 120-min/15-min long run)**; **P3 adds the enterprise
edition, B8 and the 30-rule dual-mode boundary table**:

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm; Chrome/Edge for real-browser acceptance;
# Python >= 3.8 on PATH for the real-desktop acceptance
npm install
npm run check          # repo/config check
npm run check:secrets  # secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 151/151 unit + integration tests (16 files)
npm run demo           # M0 empty loop → runs/<run-id>/ + report.md (MockHarness)
npm run test:prompts   # prompt versioning/safety tests (acceptance A12)
npm run evidence       # offline evidence bundle → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance     # M1 headed real-browser acceptance (A2/A4/A5) → docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2  # M2 real-desktop + stop/checkpoint/isolation acceptance (A3/A8/A9), local-only
npm run acceptance:m3  # M3 Scout acceptance (A7: 14 leads → 4 discarded → 8 qualified → 3 drafts, 0 sent)
npm run acceptance:m4  # M4 (phase-1) release readiness (version check is dynamic; re-runnable on later commits)
npm run acceptance:p1  # P1 personal-edition MVP acceptance (B1/B2/B5/B6/B7 + console E2E + 113 tests), local-only
npm run acceptance:p2  # P2 fault drills SHORT run (B3/B4; ~2 min outage + ~2 min ban, real localhost HTTP), local-only
npm run drill:long     # P2 REAL long run (B3: 120-min outage / B4: 15-min ban, true duration), local-only; writes long-drill-* evidence
npm run acceptance:p3  # P3 enterprise acceptance (B8 + 30 boundaries + dual review/seal/invoice/org chain), local-only
# phase-2 P1 tour (offline, fictional data):
node dist/apps/cli/src/index.js business       # proposal + simulated business line + ledger 6 facts + promise trace + takeover pack + monthly report + boundaries
node dist/apps/cli/src/index.js boundary-check # 18 personal-mode boundary rules; 4 out-of-scope classes denied
node dist/apps/cli/src/index.js console        # local web console at http://127.0.0.1:4180 (token-protected writes)
node dist/apps/cli/src/index.js approve --json    # human approval queue (expires = suspend, never auto-approve)
node dist/apps/cli/src/index.js takeover --json   # takeover key: halt + 6-section takeover pack; --resume to continue
# phase-2 P2/P3 tour:
node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 0.2 --json   # real outage drill (short)
node dist/apps/cli/src/index.js fault-drill --case platform-ban --ban-minutes 0.2 --json   # real 403 ban drill (short)
node dist/apps/cli/src/index.js enterprise-demo --json  # B8 dual-mode orders + 6 mismatch blocks + 30 boundaries table
```

CI runs the repository self-check, secret scan, build, 151 tests, demo evidence, the fixture-driven
`scout` demo (drafts only, never auto-sent), the phase-2 `business`/`boundary-check` demos, the A10
`dummy-branch` demo, `safety-check`, **real localhost fault drills (B3/B4 short)**, the **P3 enterprise
demo (B8 + 30 boundaries)**, the **headless real-browser console E2E** and the headless real-browser
demo-web E2E; headed acceptance (`npm run acceptance` / `acceptance:p1` / `acceptance:p2` /
`acceptance:p3`) and the real-desktop `npm run acceptance:m2` are local-only (hosted CI has no
interactive desktop).

What v0.8.0 can do: the CLI implements `demo`, `browser-flow`, `desktop-flow`, `scout`, `dummy-branch`,
`business`, `console`, `boundary-check`, `fault-drill`, `enterprise-demo`, `approve`, `takeover`,
`code-loop`, `run`, `branch`, `report`, `stop`, `safety-check` and `version` (**19 business commands,
0 placeholders**; `steward help` lists them).
`browser-flow` drives the real demo-web login/project flow in headed Chrome with per-step screenshots;
`desktop-flow` drives the real `demo-desktop` window with real mouse/keyboard input (SendInput, Unicode
typing) and per-step screenshots; `scout` loads the fictional compliant fixtures, builds the ICP + 3
high-value scenarios, four-factor scores the leads (need 40% / budget 20% / reachability 20% /
compliance 20%), hard-checks and dedupes sources, drafts at most 3 outreach drafts (≤150 chars, each
citing a concrete signal) and queues them for **human approval** (all `pending`, `sent=0`; daily
per-channel limit 10; unsubscribe honored; no network I/O); `dummy-branch` shows A10 — a new read-only
branch needs only a BranchSpec + an existing prompt (`reviewer@1.0.0`), with no core change;
**`business`** runs the personal-edition business steward end to end on the fictional fixture — topic
selection (3 candidate lines with checkable sources), one simulated business line (project → tasks →
deliverables → acceptance → income/invoice), ledger with mandatory **six facts**, **promise traces**
(conversation source → mandate clause → project; unrecorded = unauthorized), a **6-section takeover
pack**, a monthly report and the 18 personal-mode boundary rules; **`console`** serves the local web
control panel (binding **only 127.0.0.1**, writes protected by an `X-Steward-Token`, no CDN/external
links; dashboard, project timeline, ledger six-facts drawer, approval cards, takeover key, monthly
report); **`boundary-check`** self-checks the boundary rules (4 out-of-scope classes → 100% deny;
payment → human; quote → draft-only); **`approve`** and **`takeover`** are real human commands
(approval expires = suspend, never auto-approve; takeover halts all new writes and produces the pack,
`--resume` continues) — the real console E2E (headed Chrome in acceptance) measured the takeover stop in
the browser at **88 ms** (limit 10000 ms); **`fault-drill --case net-outage`** and **`--case platform-ban`**
inject **real** localhost HTTP faults against `examples/demo-platform`: no new promises while offline,
actions queue in an idempotent outbox and replay on recovery with **0 duplicate ledger entries**, and a
real `403+x-platform-ban` stops actions (detected in 11 ms) and produces an alternative plan + local
notifications; **`enterprise-demo`** runs the P3 enterprise flow — entity/authorization checks, corporate
account, VAT special invoice validation (draft pending human), dual review (1 reviewer ineffective, 2
different roles effective), org approval chain by amount, human-only seal (`ai_may_sign=false`),
**B8 dual-mode consistency with all 6 mismatch classes blocked** and the **30-rule dual-mode boundary
table** (payment/invoice/tax filing never automatic).

Latest P1 personal-edition MVP acceptance (2026-10-25, local headed Chrome, `npm run acceptance:p1` OK,
12/12 checks): [`docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.md)
(· [`.json`](docs/test-evidence/p1-acceptance-2026-10-25_14-18-54.json)); evidence bundle
[`docs/test-evidence/evidence-p1-2026-10-25_14-18-54/`](docs/test-evidence/evidence-p1-2026-10-25_14-18-54/)
(39 files, sanitized: `business-run/` including `proposal.json`, `ledger-facts.json` (2 entries ×
6 facts), `promise-traces.json` (3-segment authorized chain), `takeover-pack.json` (6 sections),
`boundary-check.json` (18 rules; 4/4 deny + human + draft-only), `monthly-report.{json,md}`;
`console-e2e/` with 9 step screenshots / 73 checks / browser takeover stop **88 ms**; `console-cli/`
real-browser screenshots of the CLI-launched console; `unit-tests.log` 113/113). B1/B2/B5/B6/B7 pass.

Latest P3 enterprise MVP acceptance (2026-10-25, local-only, `npm run acceptance:p3` OK, **12/12 checks**):
[`docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.md`](docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.md)
(· [`.json`](docs/test-evidence/p3-acceptance-2026-10-25_15-23-46.json)); evidence bundle
[`docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`](docs/test-evidence/evidence-p3-2026-10-25_15-23-46/)
(18 files, sanitized, enterprise run `run-20261025-232357-2ce6f6`): B8 dual-mode orders
(`subject/invoice/payment consistent` + **6/6 mismatch classes blocked**, blocked orders produce no
invoice/payment), **30-row dual-mode boundary table** (4 key out-of-scope classes denied in both modes),
dual review (1 reviewer `applied=false`, 2 different roles `applied=true`), seal `ai_may_sign=false`
(human-signed), VAT special invoice validation with `draft_pending_human`, tax-filing draft
(`ai_may_submit=false`), org approval chain 1/2/3 levels (3000/20000/80000), employment/qualification
hand-off, enterprise fixture cross-check 8/8; **151/151** tests. Details:
[`docs/en/enterprise.md`](docs/en/enterprise.md) / [`docs/zh-CN/enterprise.md`](docs/zh-CN/enterprise.md).
B8 passes; see also the 30-rule table.

Latest P2 fault-drill acceptance — **complete: short run + real long run both passed** (2026-10-26,
`npm run acceptance:p2` OK, **11/11 checks** on the short run; real long run via `npm run drill:long`):
short-run evidence [`docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.md`](docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.md)
(· [`.json`](docs/test-evidence/p2-acceptance-2026-10-25_15-02-52.json)) +
[`docs/test-evidence/evidence-p2-2026-10-25_15-02-52/`](docs/test-evidence/evidence-p2-2026-10-25_15-02-52/)
(10 files, sanitized: short run — 25 blocked promises / 25 queued-replayed actions / 0 duplicates;
ban detected in 11 ms, 5 alternative items).
**Real long run** (true duration, no acceleration):
[`docs/test-evidence/long-drill-2026-10-25_15-02-52.md`](docs/test-evidence/long-drill-2026-10-25_15-02-52.md)
(· [`.json`](docs/test-evidence/long-drill-2026-10-25_15-02-52.json)) +
[`docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/`](docs/test-evidence/evidence-long-drill-2026-10-25_15-02-52/)
(11 files, sanitized): **B3 real outage 120 min / 7215 s** → **1435 promises blocked, 0 new**, 1435 actions
queued in the outbox and **all replayed** on recovery, **`duplicates_found=0`**, second reconciliation
`entries_added=0`; **B4 real ban 15 min / 900 s** → detected in **9 ms**, **180 attempts, 0 successes**,
actions stopped, **5 alternative items**, notifications, recovery after unban. **B1–B8 all pass.**

Final **v1.0.0** release — **two-phase delivery complete** (2026-10-26, Latest):
[GitHub Release v1.0.0](https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0) ships the
real-screenshot promo video (HyperFrames + code-synthesized BGM, real M1/M2/P1 E2E screenshots; 110 s,
1280×720 @30 fps; `hyperframes check` ok:true with WCAG AA contrast 45/45):
[**BGM version**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-bgm.mp4)
(12,947,989 B) ·
[**silent version**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-silent.mp4)
(10,169,266 B) ·
[**poster**](https://github.com/minzzj/daizhang-steward/releases/download/v1.0.0/daizhang-steward-promo-v1.0-poster.jpg)
(85,200 B); project & storyboard in [`docs/media/promo/`](docs/media/promo/). Release notes:
[`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md); release verification:
[`docs/test-evidence/release-v1.0.0-check.md`](docs/test-evidence/release-v1.0.0-check.md) +
[`docs/images/release-v1.0.0.png`](docs/images/release-v1.0.0.png).

Latest M4 phase-1 release acceptance (2026-10-25, `npm run acceptance:m4` OK, 10/10 checks): checks A10
read-only `dummy-branch`, A11 release readiness (CC BY-NC-SA 4.0 license text, third-party NOTICE,
commercial notice, bilingual docs, no telemetry, `package.json`/CLI version consistency, release docs)
and the full **80/80** suite. Evidence:
[`docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.md)
(· [`.json`](docs/test-evidence/m4-acceptance-2026-10-25_13-43-07.json)) +
[`docs/test-evidence/evidence-m4-2026-10-25_13-43-07/`](docs/test-evidence/evidence-m4-2026-10-25_13-43-07/).
Release notes: [`docs/RELEASE_NOTES_v0.5.0.md`](docs/RELEASE_NOTES_v0.5.0.md) (later releases:
[`v0.6.0`](docs/RELEASE_NOTES_v0.6.0.md) P1, [`v0.8.0`](docs/RELEASE_NOTES_v0.8.0.md) P2+P3,
[`v1.0.0`](docs/RELEASE_NOTES_v1.0.0.md) final).

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
- **P2 fault drills use real network faults, not mocks**: the drill starts a real localhost platform and
  injects a real `ECONNREFUSED` outage or a real `403 + x-platform-ban` ban; no new promises are made
  while offline, actions queue in an idempotent outbox and replay on recovery (0 duplicate ledger
  entries), and a ban stops actions and produces a readable alternative plan with local notifications.
- **P3 enterprise edition is human-controlled**: all enterprise data is fictional (license/tax number/
  bank account/signers are invented), no real bank/tax/CA/e-signature system is connected, invoices and
  tax filings are **drafts only**, and the AI **never signs** (`ai_may_sign=false`), never issues
  invoices, never submits filings and never changes accounts; dual review needs two different roles and
  the org approval chain is executed by humans. B8 dual-mode consistency blocks all 6 mismatch classes
  before any invoice or payment is produced.
- CI uses a mock harness (no paid keys) and runs: self-check, secret scan, build, 151 tests, demo
  evidence, the fixture-driven `scout` demo (drafts only, never auto-sent), the phase-2
  `business`/`boundary-check` demos, the A10 `dummy-branch` demo, `safety-check`, **real localhost fault
  drills (B3/B4 short run)**, the **P3 enterprise demo (B8 + 30 boundaries)**, the headless real-browser
  **console E2E** and the headless real-browser demo-web E2E; headed acceptance (`npm run acceptance`,
  `acceptance:p1`, `acceptance:p2`, `acceptance:p3`) and real-desktop acceptance (`npm run acceptance:m2`)
  are local-only. Before release, the full suite is re-run from a clean path.

## License

Project code: **[CC BY-NC-SA 4.0](LICENSE)** — source-available, **non-commercial**, share-alike on
distribution. This is not an OSI license; "source-available" is the accurate term. Commercial use
requires a separate license: see [`COMMERCIAL.md`](COMMERCIAL.md). Third-party components
(DeepSeek Harness, dsh-browser, dsh-computer-use — MIT) keep their own licenses: see [`NOTICE`](NOTICE).

## Security

No telemetry. Secrets are read from environment variables only; logs are redacted; a secret scan
runs before every commit/CI. See [`SECURITY.md`](SECURITY.md).

## Docs

- [ROADMAP.md](ROADMAP.md) — milestones and approval gates (both phases complete; **v1.0.0 released**)
- [docs/RELEASE_NOTES_v0.5.0.md](docs/RELEASE_NOTES_v0.5.0.md) · [v0.6.0](docs/RELEASE_NOTES_v0.6.0.md) · [v0.8.0](docs/RELEASE_NOTES_v0.8.0.md) · [**v1.0.0**](docs/RELEASE_NOTES_v1.0.0.md) — release notes (bilingual; v1.0.0 is the final release)
- [docs/zh-CN/enterprise.md](docs/zh-CN/enterprise.md) · [docs/en/enterprise.md](docs/en/enterprise.md) — P3 enterprise edition + the 30-rule dual-mode boundary table
- [docs/media/promo/README.md](docs/media/promo/README.md) — **v1.0.0 real-screenshot promo video** (assets on the GitHub Release; storyboard & facts here)
- [docs/demo-script.md](docs/demo-script.md) · [docs/demo-script.zh-CN.md](docs/demo-script.zh-CN.md) — 3-minute demo script
- [docs/good-first-issues.md](docs/good-first-issues.md) — 5 good first issues (bilingual)
- [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — acceptance items with evidence
  (**A1–A12 + B1–B8 all pass**; final v1.0.0 verdict)
- [docs/test-evidence/](docs/test-evidence/) — evidence archive (`test-result-*`, `m1-acceptance-*` …
  `m4-acceptance-*`, `p1-acceptance-*` + `evidence-p1-*`, `p2-acceptance-*` + `evidence-p2-*` (short run),
  `long-drill-2026-10-25_15-02-52.*` + `evidence-long-drill-2026-10-25_15-02-52/` (real long run),
  `p3-acceptance-*` + `evidence-p3-*`, and `release-v0.5.0/v0.6.0/v0.8.0/v1.0.0-check.md`)
- [docs/en/architecture.md](docs/en/architecture.md) · [docs/en/adapters.md](docs/en/adapters.md)
  · [docs/en/contracts.md](docs/en/contracts.md) · [docs/en/threat-model.md](docs/en/threat-model.md)
- [packages/steward-desktop/README.md](packages/steward-desktop/README.md) — real Windows desktop adapter
- [packages/steward-scout/README.md](packages/steward-scout/README.md) — Scout customer-branch engine
- [packages/steward-domain/README.md](packages/steward-domain/README.md) — phase-2 business-domain engine
- [packages/steward-console/README.md](packages/steward-console/README.md) — local web console
- [packages/steward-fault/README.md](packages/steward-fault/README.md) — P2 fault-drill module (B3/B4)
- [packages/steward-enterprise/README.md](packages/steward-enterprise/README.md) — P3 enterprise edition
- [examples/scout-fixtures/README.zh-CN.md](examples/scout-fixtures/README.zh-CN.md) — 14 fictional compliant leads
- [examples/demo-business/README.zh-CN.md](examples/demo-business/README.zh-CN.md) — simulated personal-edition business line
- [examples/demo-platform/README.zh-CN.md](examples/demo-platform/README.zh-CN.md) — P2 real localhost fault-injection platform
- [examples/demo-enterprise/README.zh-CN.md](examples/demo-enterprise/README.zh-CN.md) — P3 enterprise fixtures (8 orders)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — assumptions and known gaps
- [HANDOFF.md](HANDOFF.md) — current handoff status

## Acknowledgements

Architecture and tooling build on **DeepSeek Harness** (MIT). The real-test and open-source release
process follows lessons from the author's earlier projects `asset-lineage` and `DramaCore`.

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted and handed over — not sold._
