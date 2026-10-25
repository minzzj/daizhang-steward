# 代掌 Steward

**可托管的 AI 经营代理 / A composable operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations · evidence-first.

> 状态：**M0 已完成** — 内核最小闭环已验证（2026-10-25）：`steward` CLI 用 MockHarness 跑通端到端空回路
> （**无需付费 API**），**30/30** 单元+集成测试通过，**4** 份运行时提示词带 sha256 校验的 manifest；
> 验收 **A1 / A6 / A12 通过**（见 [ROADMAP.md](ROADMAP.md) 与
> [`docs/zh-CN/delivery-checklist.md`](docs/zh-CN/delivery-checklist.md) 中的证据）。
> Status: **M0 complete** — minimal kernel loop verified (2026-10-25): the `steward` CLI runs an
> end-to-end empty loop with MockHarness (no paid API), 30/30 unit + integration tests pass, and
> 4 versioned runtime prompts ship with a sha256-checked manifest; acceptance A1/A6/A12 pass.

---

## 它是什么 / What it is

代掌（Steward）是一个**可组合的操作型 AI**：

1. **Operator**（手）— 用真实浏览器与真实桌面软件完成任务：观察、操作、验证、留证。
2. **Conductor**（脑）— 决定方向：拆目标、派生分支、分配预算、验收与汇总。
3. **Harness loop**（代码来源）— 失败时写 CodeTask 交给 DeepSeek Harness 生成补丁，隔离应用、跑测试、最多两轮，超限交人。
4. **Scout**（客户分支）— 只在公开合规来源找线索、评分、起草外联，人类批准后才发送。

所有对外动作写入只追加的事件账本（`events.jsonl` + 哈希链），每步有截图/日志/回执；
高风险动作默认拒绝，验证码、2FA、人脸核验一律停止交人。

A composable operating-AI core: **Operator** drives real browsers and desktop apps, **Conductor**
sets direction and spawns branches, a **Harness loop** turns failures into reproducible CodeTasks
and patches, and **Scout** drafts compliant outreach (human approval required). Every external
action is appended to a tamper-evident event ledger with screenshot/log evidence; high-risk actions
are denied by default and CAPTCHAs/2FA/human-verification always hand off to a human.

## 不是什么 / What it is not

- 不是自动签约、自动付款、自动开票的工具；这些默认拒绝或只出草稿。
- 不绕过验证码、风控、平台规则；不抓登录后页面；不批量外呼。
- 不替代法律主体：不担任法定代表人、股东、董事、监事或高级管理人员。
- 阶段一不做多租户 SaaS、计费与复杂前端。

## 两阶段路线 / Two phases

| 阶段 | 内容 | 依据 |
|---|---|---|
| Phase 1 | 开源「操作型 AI 内核」：Operator + Harness 编码回路 + Scout + Conductor；12 条可复现验收 | DeepSeek 开发提示词 |
| Phase 2 | 代掌经营代理：**个人版优先**（一条仿真业务线跑通），再企业版；8 条验收 + 30 条边界 | 代掌产品愿景 |

## 架构一览 / Architecture at a glance

```text
人 (owner) ── 审批卡 / 接管键 / 月报 ──┐
                                       ▼
                     Conductor (direction, branches, budget)
                                       │
              ┌────────────────────────┼────────────────────────┐
        Operator (browser/desktop)  Scout (leads)        Reviewer (evidence)
              │                        │                        │
       Playwright real browser   public-source fixtures   policy + audit
       Windows UIA real desktop  scoring + drafts         events.jsonl
              └─────────── CodeTask → Harness → patch → tests ──────────┘
```

更完整的设计见 [`docs/zh-CN/architecture.md`](docs/zh-CN/architecture.md) / [`docs/en/architecture.md`](docs/en/architecture.md)。

## 仓库结构 / Repository layout

本仓库为**单包布局**（无 pnpm workspace）：`tsconfig.json` 把 `packages/*/src` 与
`apps/cli/src` 用 `tsc -p tsconfig.json` 编译到 `dist/`；命令一律用 npm。

```text
packages/   core packages (steward-core: runtime/policy/events/artifacts/prompts;
            steward-harness: MockHarness)
apps/       CLI entry (steward: demo/run/branch/report/stop/version/help)
prompts/    versioned runtime prompts (4 roles, loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness, scout-fixtures, demo-business
tests/      unit tests (M0 实现 30 条); contract / e2e / fault drills 后续里程碑
docs/       双语文档（en/ 与 zh-CN/）+ 测试证据
scripts/    校验/构建辅助、密钥扫描、证据包、交付同步
runs/       每次运行的产物（gitignored；证据在此）
dist/       构建输出（gitignored；单包构建）
```

## 快速开始 / Quickstart（M0）

> 克隆后即可离线运行，无需付费 API（MockHarness）：
> M0 runs offline once cloned — no paid API (MockHarness):

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, npm
npm install
npm run check          # 校验仓库配置 / repo-config check
npm run check:secrets  # 密钥扫描 / secret scan
npm run build          # tsc -p tsconfig.json → dist/
npm test               # 30/30 单元+集成测试 / unit + integration tests
npm run demo           # 空回路 → runs/<run-id>/ + report.md（MockHarness）
npm run test:prompts   # 提示词版本/安全测试（验收 A12）
npm run evidence       # 证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
```

M0 能跑什么：CLI 已实现 `demo`、`run`、`branch`、`report`、`stop`、`version`、`help`
（`takeover`、`approve` 为 M1/阶段二占位）。每次运行把证据写入 `runs/<run-id>/`：
`prompt.md`、`report.md`、`console.log`、`meta.json`、`events.jsonl`（哈希链账本），以及
MockHarness 回路产生的 `patch.diff`、`test.log`、`code-task.json`、`code-result.json`，
另有 `screenshots/` 目录（M1 起由真实 E2E 填充）。也可直接调用构建产物：
`node dist/apps/cli/src/index.js demo`。

最新验证运行：`runs/run-20261025-172017-eb9116/` — 证据见
[`docs/test-evidence/test-result-2026-10-25_09-20-15.md`](docs/test-evidence/test-result-2026-10-25_09-20-15.md)。

## 真实测试承诺 / Real-test pledge

- UI 验收使用**真实 Chromium/Edge（有头）**与**真实 Windows 窗口真实键鼠**，不用 API 或假 DOM 代替；
- 每个对外动作自动截图，失败保留现场；重试最多两轮，超限升级人类；
- CI 使用 MockHarness，无需付费密钥；发布前在干净路径重跑全量。

## 许可证 / License

自有代码按 **[CC BY-NC-SA 4.0](LICENSE)**：允许下载、使用、修改与分发；**禁止商业用途**；
分发修改后的作品必须采用相同许可证。这不是 OSI 定义的开源许可，准确说法是
**source-available（非商业共享）**。商用授权见 [`COMMERCIAL.md`](COMMERCIAL.md)。
第三方组件（DeepSeek Harness、dsh-browser、dsh-computer-use 等，均为 MIT）保留各自许可证，
见 [`NOTICE`](NOTICE)。

The project's own code is licensed **CC BY-NC-SA 4.0** — source-available, **non-commercial**,
share-alike on distribution. Third-party components keep their MIT/Apache-2.0 licenses (see `NOTICE`).

## 安全 / Security

无遥测；密钥只从环境变量读取；日志脱敏；提交前密钥扫描。报告方式见 [`SECURITY.md`](SECURITY.md)。

## 文档索引 / Docs index

- [ROADMAP.md](ROADMAP.md) — 里程碑与批准门
- [docs/zh-CN/delivery-checklist.md](docs/zh-CN/delivery-checklist.md) / [docs/en/delivery-checklist.md](docs/en/delivery-checklist.md) — 验收条目与证据
- [docs/test-evidence/](docs/test-evidence/) — 测试证据归档（`test-result-*.{md,json}`）
- [docs/zh-CN/architecture.md](docs/zh-CN/architecture.md) / [docs/en/architecture.md](docs/en/architecture.md)
- [docs/zh-CN/contracts.md](docs/zh-CN/contracts.md) / [docs/en/contracts.md](docs/en/contracts.md)
- [docs/zh-CN/threat-model.md](docs/zh-CN/threat-model.md) / [docs/en/threat-model.md](docs/en/threat-model.md)
- [ASSUMPTIONS.md](ASSUMPTIONS.md) — 假设与未覆盖清单
- [HANDOFF.md](HANDOFF.md) — 当前交接状态

## 致谢 / Acknowledgements

架构与工具链大量借鉴 **DeepSeek Harness** 的插件体系（MIT）；真实测试与开源发布流程沿用
作者既有项目 `asset-lineage` / `DramaCore` 的经验。感谢开源社区。

---

_© 2026 minzzj. Own code: CC BY-NC-SA 4.0. Built to be inspected, adapted, and handed over — not sold._
