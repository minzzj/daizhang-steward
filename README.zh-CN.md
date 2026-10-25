# 代掌 Steward

**可托管的 AI 经营代理 / A composable operating-AI steward.**
Source-available · non-commercial · real browser & real desktop operations · evidence-first.

> 状态：**脚手架（scaffold）** — 2026-10-25。本仓库目前只包含地基：许可证、治理文件、双语文档骨架、
> 路线图与脚手架自检。**功能代码按里程碑 M0–M4 实现**（见 [ROADMAP.md](ROADMAP.md)）。
> Status: **scaffold** — foundation only (license, governance, bilingual doc skeleton, roadmap,
> scaffold checks). Feature code lands milestone by milestone (see [ROADMAP.md](ROADMAP.md)).

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

```text
packages/   core packages (steward-core, steward-conductor, steward-operator, ...)
apps/       CLI and optional DSH profile ("cockpit")
prompts/    versioned runtime prompts (loaded by PromptManager, tested)
examples/   demo-web, demo-desktop, mock-harness, scout-fixtures, demo-business
tests/      unit / contract / e2e-browser / e2e-desktop / fault drills
docs/       bilingual docs (en/ and zh-CN/)
scripts/    dev/demo/test/lint, secret scan, delivery sync
runs/       runtime artifacts (gitignored; evidence lives here)
```

## 快速开始 / Quickstart

> 目前只有脚手架自检可运行（无需网络、无需付费 API）：
> Only scaffold checks run today (no network, no paid API needed):

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
# Node.js >= 22.18, pnpm >= 10
pnpm check          # 校验仓库骨架 / verify scaffold
pnpm check:secrets  # 密钥扫描 / secret scan
```

功能与演示将在 M0 完成后可用（`pnpm dev` / `pnpm demo` / `pnpm test`）。

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
