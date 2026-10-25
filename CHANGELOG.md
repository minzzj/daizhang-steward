# Changelog / 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned — Phase 1 (M2–M4)
- M2 桌面与安全：Windows 桌面适配器、PolicyEngine、停止键、审计、检查点
- M3 客户分支：Scout、来源清单、评分、外联草稿、审批队列、ScoutReport
- M4 开源发布：双语文档、LICENSE/COMMERCIAL/NOTICE、CI 绿、Release、5 个 good-first-issue

### Planned — Phase 2 (personal → enterprise)
- 经营域：委托/预算/项目/任务/代理/证据/账本/墓碑 + 置信度 + L0/L1/L2 摘要
- 本地 Web 控制台：看板、审批卡、接管键、月报
- 通知与协助：Windows Toast / 邮件 / Webhook / 交接流程
- 30 条法律与合规边界规则 + 个人/企业两种模式
- IoT 适配器契约（stub）+ MCP server
- v1.0.0 发布 + 宣传片（BGM/静音双版本）

## [0.2.0] — 2026-10-25

### Added — M1 真实浏览器回路（验收 A2 / A4 / A5 / A6 通过）

- **真实浏览器适配器 `packages/steward-browser`**：Playwright 驱动本机 Chrome/Edge，**有头默认**、
  `chrome → msedge` 回退；每次运行独立 `userDataDir`；每步截图 / DOM / console 证据；5 类失败分类；
  风控关键词命中 → `RiskControlStopError` 停止交人；adapter-smoke **28/28 PASS**。
- **编码回路 `packages/steward-harness/src/patch.ts` + `loop.ts`**：`patch.ts` 在隔离 git worktree
  应用 unified diff；`loop.ts` 的 `runCodeLoop` 最多两轮，超限升级（`escalated=true`，退出码 1，不无限重试）。
- **CLI 新增命令**：`browser-flow`（真实浏览器登录→提交→校验，逐步截图）、`code-loop`（CodeTask→
  补丁→worktree→真实浏览器验收，`--fail` 注入坏补丁）；兼容别名 `demo-browser` / `demo-code-loop`。
  命令数 7 → **9 个已实现 + 2 个占位**（`takeover`、`approve`）。
- **真实浏览器 E2E `tests/e2e-browser/`**：`login-flow.mjs` 支持 `normal`（应绿）/ `login-timeout`
  （修复前应红，复现预置缺陷）/ `--expect-red` 模式；`adapter-smoke.mjs` 适配器冒烟 28/28 PASS。
- **脚本化补丁**：`examples/mock-harness/fix-login-timeout.patch`（真实修复）与
  `broken-login-timeout.patch`（失败注入）。
- **`npm run acceptance`**：一键本机有头验收（build + A2 + A4 + A5），生成
  `docs/test-evidence/m1-acceptance-<stamp>.{md,json}` 并把截图/日志/结果复制到
  `docs/test-evidence/evidence-m1-<stamp>/`（本次 45 文件：A2/A4/A5 三组）。
- **测试**：30 → **35/35** 通过（新增 `tests/unit/code-loop.test.mjs` 5 条，含 Windows CRLF 补丁归一化回归）。
- **CI**：新增无头真实浏览器 E2E（`login-flow.mjs --case normal --headless 1`）；有头验收仅本机。

### Changed
- `steward-harness` 由 MockHarness 扩展为含补丁应用与两轮编码回路；
  `tests/unit` 覆盖编码回路的成功、失败与升级路径。
- 验收：A2 / A4 / A5 / A6 通过；证据 `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}`
  + `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`；runs `run-20261025-175213-9ea8ab`（A2）、
  `run-20261025-175216-fe8759`（A4）、`run-20261025-175223-de0b95`（A5）。

### Fixed
- **Windows CI**（提交 `b4ed316`）：Windows runner 曾把 `*.patch` 转成 CRLF 导致 `git apply` 失败；
  `.gitattributes` 改为全仓 `eol=lf`（`*.patch` / `*.diff` 显式 `eol=lf`），`patch.ts` 归一化 CRLF，
  并新增 CRLF 回归测试（测试数 34 → 35）。
- **证据脱敏**：新增 `scripts/sanitize.mjs` / `scripts/sanitize-evidence.mjs`，M1 acceptance bundle
  已脱敏（无本机绝对路径）；当前证据 `m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `evidence-m1-2026-10-25_09-52-12/`（45 文件）。

## [0.1.0] — 2026-10-25

### Added — M0 内核最小闭环（验收 A1 / A6 / A12 通过）

- **AgentRuntime 内核**：`AgentRuntime`（计划→行动→观察→反思→报告）、`BranchSpec` / `BranchManager`、
  `PolicyEngine`（allow / deny / approve / unknown，高风险默认拒绝）、`ArtifactBus`、`PromptManager`、
  `EventLog`（只追加 + seq + 哈希链 + 密钥脱敏）、`BudgetGuard`（80% 告警 / 100% 暂停）、`StopSignal`。
- **CLI（7 命令 + 2 占位）**：`steward demo`（空回路，MockHarness，无付费 API）、`run`、`branch`、
  `report`、`stop`、`version`、`help`；`takeover`（阶段二）、`approve`（M1）为占位。
- **MockHarness + 代码回路骨架**：`CodeTask` 校验 → MockHarness 生成 unified diff → 保存
  `code-task.json` / `code-result.json` / `patch.diff` / `test.log`。
- **prompts v1**：conductor / operator / scout / reviewer 4 份运行时提示词，`prompts/manifest.json`
  记录版本与 sha256，安全条款 + 禁止项 + 无密钥/本机路径测试覆盖（`npm run test:prompts`）。
- **演示素材**：`examples/demo-web`（Node 内置 http，预置“登录超时无提示”缺陷）与
  `examples/demo-desktop`（tkinter 真窗口表单），供 M1/M2 真实浏览器/桌面验收使用。
- **工程布局**：从 pnpm workspace 改为**单包布局**（H: exFAT 不支持符号链接），`tsc -p tsconfig.json`
  编译 `packages/*/src` + `apps/cli/src` → `dist/`；全部命令改用 npm。
- **测试**：30/30 单元 + 集成测试通过（`npm test`：build + `node --test "tests/unit/*.test.mjs"`）。
- **证据脚本**：`npm run evidence` 自动 build + tests + demo，生成
  `docs/test-evidence/test-result-<stamp>.{md,json}`；每次运行产物写入 `runs/<run-id>/`
  （prompt.md / report.md / console.log / meta.json / events.jsonl / patch.diff / test.log 等）。
- **文档**：README（中英）、ROADMAP、HANDOFF、ASSUMPTIONS、验收清单更新为 M0 完成状态；
  新增 `docs/test-evidence/test-result-2026-10-25_09-52-08.{md,json}` 与
  `docs/test-evidence/2026-10-25-repo-publish.md`。

### Changed
- 开发命令从 pnpm 全面切换为 npm；构建改为单包 `tsc`（无 workspace）。

## [0.0.1] — 2026-10-25

### Added
- **GitHub 公开仓库发布**：https://github.com/minzzj/daizhang-steward（2026-10-25，public，许可证显示 Other 属预期）
- 发布验证证据：`docs/test-evidence/2026-10-25-repo-publish.md` + 真实浏览器截图 `docs/images/repo-home-2026-10-25.png`
- 仓库脚手架：目录结构、pnpm workspace、tsconfig、GitHub Actions CI 骨架
- 许可证 **CC BY-NC-SA 4.0**、`COMMERCIAL.md`、`NOTICE`（第三方 MIT 组件声明）
- 双语 README、ROADMAP、ASSUMPTIONS、HANDOFF、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT
- 双语文档骨架：architecture / contracts / threat-model / adapters / runtime-prompts / delivery-checklist
- 脚手架自检 `pnpm check`、密钥扫描 `pnpm check:secrets`、交付同步脚本 `scripts/sync-delivery.ps1`

[Unreleased]: https://github.com/minzzj/daizhang-steward/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.2.0
[0.1.0]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.1.0
[0.0.1]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.0.1
