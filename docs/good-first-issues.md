# Good First Issues / 新手任务（v0.5.0）

> 阶段一 v0.5.0 发布时开放的 5 个 good-first-issue 候选。每个任务都**可离线验证**：不需要付费
> API、不需要真实外网、不需要真实客户数据；全部基于仓库内的 fixtures / demo 素材与单元测试。
> Five good-first-issue candidates for the v0.5.0 release. Every task is **offline-verifiable**: no paid
> API, no real external network, no real customer data — all based on in-repo fixtures, demos and unit tests.
>
> 仓库 / Repo：https://github.com/minzzj/daizhang-steward · 协作规则见 `CONTRIBUTING.md` /
> `CODE_OF_CONDUCT.md`；许可证 CC BY-NC-SA 4.0（非商业）。开始前请先在对应 issue 下留言认领。

## 通用验收流程 / Common checklist

1. 从 `main` 拉分支，实现 + 测试 + 文档同步，一个 PR 只做一个 GFI（one GFI per PR）。
2. 本地必须通过：`npm run build`、`npm test`（当前 **80/80**）、`npm run check`、`npm run check:secrets`。
3. 不提交 `runs/`、密钥、本机绝对路径；证据只放 `docs/test-evidence/` 的约定位置。
4. 文档数字必须可追溯；改源码行为时同步更新对应 README / docs（中英配对）。

| 编号 | 标题（中 / EN） | 涉及目录 | 难度 |
|---|---|---|---|
| GFI-1 | `steward browser-flow` 支持自定义用例脚本 / custom case scripts for `browser-flow` | `apps/cli/src/`、`tests/e2e-browser/` | 中等 |
| GFI-2 | Scout 评分权重改为配置项 / make Scout scoring weights configurable | `packages/steward-scout/` | 中等 |
| GFI-3 | 桌面适配器补充滚轮 / 拖拽 / add scroll & drag to the desktop adapter | `packages/steward-desktop/` | 中等偏高 |
| GFI-4 | 补充英文版 runtime-prompts 示例 / English runtime-prompt examples | `docs/en/`、`prompts/` | 简单 |
| GFI-5 | CI 增加 Node 22/24 双版本矩阵与兼容性报告 / Node 22/24 CI matrix + compatibility report | `.github/workflows/`、`docs/` | 简单–中等 |

---

## GFI-1 · `steward browser-flow` 支持自定义用例脚本 / custom case scripts for `browser-flow`

**背景 / Background**
`steward browser-flow` 目前只有内置的两个 demo-web 用例（`--case normal|login-timeout`）。想对新页面
做真实浏览器回归时，只能改 CLI 源码或复制 `tests/e2e-browser/login-flow.mjs`，扩展成本高。
`steward browser-flow` only ships two built-in demo-web cases (`--case normal|login-timeout`). Adding a
real-browser regression for a new page currently means editing the CLI source or forking
`tests/e2e-browser/login-flow.mjs`.

**验收标准 / Acceptance criteria**
- 新增 `--case-file <path.mjs>`（或等价 flag）：从文件加载用例模块，模块导出 `name` 与
  `run(browser, context)`（context 提供 evidence 目录、runId 等），异常即用例失败。
- 内置 `--case normal|login-timeout` 行为、截图与证据布局保持不变；`--case` 与 `--case-file` 二选一，
  冲突时给出明确报错。
- 新增 1 个离线 fixture 用例（基于 `examples/demo-web`）与对应单元/集成测试；`npm test`（80/80 基线 + 新增）全绿。
- `apps/README.md`、根 README 命令说明与 docs 同步；每个步骤仍自动截图留证。
- Add `--case-file <path.mjs>` (or equivalent): the module exports `name` and `run(browser, context)`.
  Built-in cases keep identical behavior/evidence; a missing/conflicting case returns a clear error; add one
  offline fixture case + tests; docs updated; per-step screenshots preserved.

**涉及目录 / Files**: `apps/cli/src/index.ts`、`tests/e2e-browser/`（新增 `cases/` fixture 可选）、
`tests/unit/cli-demo.test.mjs`、`apps/README.md`、`README.md` / `README.zh-CN.md`。

**难度 / Difficulty**: 中等（Medium）。
**离线可验证 / Offline**: 使用仓库 `examples/demo-web` 本地服务与本机 Chrome/Edge，无需外网、无需付费 API。

---

## GFI-2 · Scout 评分权重改为配置项 / make Scout scoring weights configurable

**背景 / Background**
Scout 的四因子权重（需求 40% / 预算 20% / 可触达 20% / 合规 20%）目前写死在
`packages/steward-scout` 里，只有 `qualifiedThreshold`、`dailyPerChannelLimit` 可配置。
The four scoring weights (need 40% / budget 20% / reachability 20% / compliance 20%) are hard-coded;
only `qualifiedThreshold` and `dailyPerChannelLimit` are configurable today.

**验收标准 / Acceptance criteria**
- `ScoutEngine` 构造参数新增 `weights?: { need; budget; reachability; compliance }`，默认值与当前完全一致
  （0.4 / 0.2 / 0.2 / 0.2），并对非法权重（负数、非数字、总和不为 1）给出明确校验错误。
- 新增测试证明：自定义权重会改变排序/合格集；默认配置下 A7 结果保持不变
  （14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿 → 审批全 pending、0 发送）。
- `packages/steward-scout/README.md` 更新评分口径与配置说明；`git diff docs/` 中英文口径一致。
- Add a `weights` option with the exact current defaults, validation for invalid weights, tests proving
  custom weights change ranking while default A7 results stay identical, and README updates.

**涉及目录 / Files**: `packages/steward-scout/src/engine.ts`（及 `types.ts` / `heuristics.ts`）、
`tests/unit/scout.test.mjs`、`packages/steward-scout/README.md`。

**难度 / Difficulty**: 中等（Medium）。
**离线可验证 / Offline**: 全部为内存 fixture 单元测试，无需网络、无需付费 API。

---

## GFI-3 · 桌面适配器补充滚轮 / 拖拽 / add scroll & drag to the desktop adapter

**背景 / Background**
`packages/steward-desktop` 已实现真实窗口、真实键鼠、截图与白名单，但滚轮、拖拽、右键菜单语义等仍在
“已知限制”里（见其 README §9）。这是最高频的桌面操作缺口之一。
The desktop adapter already does real windows, real keyboard/mouse, screenshots and an allowlist, but
scrolling, dragging and right-click semantics are still listed as known limitations (README §9).

**验收标准 / Acceptance criteria**
- `WindowsDesktop` 新增 `scroll(x, y, delta)` 与 `drag(from, to)`，通过 Python ctypes 侧车用真实
  `SendInput` 事件实现；沿用白名单 + 前台/焦点双重校验（非白名单窗口必须拒绝并留证）。
- 每个动作产生结构化步骤结果与截图证据，失败分类复用现有 5 类（`window-not-found` / `focus-lost` /
  `timeout` / `allowlist-denied` / `unknown`）。
- `tests/e2e-desktop/run.mjs` 增加可选场景（仅在真实 Windows 交互会话运行；无桌面 CI 自动跳过），
  或在 README 写明手工验收步骤；文档（包 README + `docs/*/adapters.md`）同步。
- Add `scroll` / `drag` using real `SendInput` through the Python sidecar, keep allowlist + focus
  guards, per-step evidence and the 5 failure classes; document and test on a real Windows session
  (skip on headless CI).

**涉及目录 / Files**: `packages/steward-desktop/src/index.ts`、
`packages/steward-desktop/scripts/desktop_sidecar.py`、`packages/steward-desktop/README.md`、
`tests/e2e-desktop/`（可选）、`docs/zh-CN/adapters.md` + `docs/en/adapters.md`。

**难度 / Difficulty**: 中等偏高（Medium–hard；有 Python ctypes / Win32 经验更佳）。
**离线可验证 / Offline**: 需本机 Windows 真实交互桌面 + Python ≥ 3.8；无需外网、无需付费 API。

---

## GFI-4 · 补充英文版 runtime-prompts 示例 / English runtime-prompt examples

**背景 / Background**
`docs/en/runtime-prompts.md` 已有英文说明，但 `prompts/` 下的 4 份运行时提示词均为中文，英文读者缺少
可对照的示例；这是文档类任务中价值最高、风险最低的一个。
`docs/en/runtime-prompts.md` is in English but all four runtime prompts under `prompts/` are Chinese, so
English readers lack comparable examples — low risk, high documentation value.

**验收标准 / Acceptance criteria**
- 在 `docs/en/runtime-prompts.md` 增加至少 2 个可对照示例：一份完整 `CodeTask` 示例、一份
  `BranchSpec`（工具白名单/预算/审批策略）示例，字段与 `docs/*/contracts.md` 一致。
- 若同时给 `prompts/*.md` 增加英文对照片段：必须保持中文原文语义不变；任何 `prompts/*.md` 改动后
  运行 `npm run prompts:manifest` 并提交更新后的 `prompts/manifest.json`（`npm run test:prompts` 全绿）。
- `docs/zh-CN/runtime-prompts.md` 与英文版结构保持配对；相对链接可解析；不写入本机路径/密钥。
- Add ≥2 comparable English examples (a full `CodeTask`, a `BranchSpec`) matching the contracts docs;
  if prompts are touched, regenerate `prompts/manifest.json` and keep `npm run test:prompts` green.

**涉及目录 / Files**: `docs/en/runtime-prompts.md`、`docs/zh-CN/runtime-prompts.md`（配对）；
可选 `prompts/*.md` + `prompts/README.md`。

**难度 / Difficulty**: 简单（Easy；需要仔细读契约）。
**离线可验证 / Offline**: 纯文档 + `npm run test:prompts`，无需网络、无需付费 API。

---

## GFI-5 · CI 增加 Node 22/24 双版本矩阵与兼容性报告 / Node 22/24 CI matrix + compatibility report

**背景 / Background**
当前 `.github/workflows/ci.yml` 是单 Node 版本（`22.18.0`）× Windows/Ubuntu，没有 Node 24 的兼容性
数据；`package.json` 的 `engines` 为 `node >= 22.18.0`。
CI currently uses a single Node version (`22.18.0`) × Windows/Ubuntu with no Node 24 compatibility
data, while `engines` declares `node >= 22.18.0`.

**验收标准 / Acceptance criteria**
- `matrix` 增加 `node-version: ["22.18.0", "24"]`，保持现有全部步骤（check / secrets / build /
  tests / evidence / Scout demo / dummy-branch / safety-check / headless browser E2E）在两个版本上通过。
- 新增一份兼容性报告（建议 `docs/test-evidence/ci-node-compat.md` 或 `docs/ci-compat.md`），记录：
  运行日期、OS、Node 版本、各步骤结果、Job/run 链接、已知差异与结论；在 README 的 CI 段落引用。
- 不改测试断言以“通过”不兼容项；若发现真实不兼容，按 issue 记录并可拆分为后续任务。
- Extend the matrix to Node 22.18.0 + 24 keeping every existing step, add a dated compatibility report
  (OS / Node / step results / run links / differences / conclusion) and reference it from the README.

**涉及目录 / Files**: `.github/workflows/ci.yml`、`docs/test-evidence/README.md`（或新增
`docs/ci-compat.md`）、`README.md` / `README.zh-CN.md`（CI 段落）。

**难度 / Difficulty**: 简单–中等（Easy–Medium；注意 Windows runner 的 LF/CRLF 与 Playwright 频道差异）。
**离线可验证 / Offline**: 本地可先用本机 Node 22/24 跑 `npm test`（80/80）；CI 侧由 GitHub-hosted
runner 提供公共网络，不需要付费 API、不访问真实业务外网。

---

## 如何认领 / How to claim

1. 在 GitHub issue 下留言“我要做 GFI-N”（或 “claim GFI-N”），等待维护者确认。
2. Fork → 分支 → 实现 + 测试 + 文档，PR 描述里贴：改动摘要、测试输出、证据路径、未做事项。
3. 维护者复核 diff 与真实测试结果后合并；合并即计入 `CONTRIBUTING.md` 的贡献者名单。

_最后更新：2026-10-25（v0.5.0 发布）。/ Last updated: 2026-10-25 (v0.5.0 release)._
