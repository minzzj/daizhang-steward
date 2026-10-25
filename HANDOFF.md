# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-25（M2 完成并验收；真实 Windows 桌面 + 停止键/检查点/分支隔离；下一步 M3）

## 当前状态（一句话）

M2 真实 Windows 桌面 + 安全模块已完成并验收：真实窗口 + 真实键鼠（SendInput）跑通 A3 桌面流程
（打开→填表→保存→校验→截图，36/36 检查、20 张截图）、停止键 ≤5s（实测 305ms）+ 检查点
save/load/resume（A8）、分支凭据/profile 锁/工具白名单隔离（A9）；**53/53** 测试通过，
CLI **11 命令 + 2 占位**。累计 A1/A2/A3/A4/A5/A6/A8/A9/A12 验收通过。代码在 GitHub `main`
分支（M2 已推送 `6603b04`；M1 最后 `25ef167`）。

## M0 已完成清单（2026-10-25）

- [x] 内核：AgentRuntime / BranchSpec / PolicyEngine / ArtifactBus / PromptManager / EventLog / BudgetGuard / StopSignal
- [x] CLI：`demo` / `run` / `branch` / `report` / `stop` / `version` / `help`（`takeover`、`approve` 为占位）
- [x] MockHarness + CodeTask/CodeResult 骨架，`patch.diff`、`test.log` 落盘
- [x] prompts v1（4 角色）+ `prompts/manifest.json` sha256 + 提示词测试
- [x] 30/30 单元+集成测试通过；`npm run check`、`npm run check:secrets`、`npm test`、
      `npm run demo`、`npm run evidence` 全部通过
- [x] 单包构建（`tsc -p tsconfig.json` → `dist/`）+ 全部命令改用 npm；C: 旧副本转为归档
- [x] 验收 A1 / A6 / A12 通过（见 [ROADMAP.md](ROADMAP.md) 与 `docs/*/delivery-checklist.md`）
- 代码状态：已在 GitHub `main` 分支（后续提交见仓库历史；M4 统一发版）

## M1 已完成清单（2026-10-25）

- [x] `packages/steward-browser`：Playwright 真实浏览器适配器（有头默认、`chrome→msedge` 回退、
      每 run 独立 `userDataDir`、每步截图/DOM/console、5 类失败分类、风控关键词 → 停交人；
      adapter-smoke 28/28 PASS）
- [x] `packages/steward-harness/src/patch.ts`（隔离 git worktree 应用补丁）+
      `loop.ts`（`runCodeLoop` 最多两轮、超限升级，`escalated=true` / exit 1）
- [x] CLI 新增 `browser-flow` / `code-loop`（别名 `demo-browser` / `demo-code-loop`）→ 9 命令 + 2 占位
- [x] `tests/e2e-browser/`：真实浏览器 E2E（normal 绿 / login-timeout 红 / `--expect-red`）+ adapter-smoke
- [x] 脚本化补丁 `examples/mock-harness/fix-login-timeout.patch`（真实修复）与
      `broken-login-timeout.patch`（失败注入）
- [x] `npm run acceptance` 一键本机有头验收；证据
      `docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
      `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2/A4/A5 三组）
- [x] 测试 30 → **35/35**（新增 `tests/unit/code-loop.test.mjs` 5 条，含 Windows CRLF 补丁归一化回归）
- [x] **Windows CI 修复**（提交 `b4ed316`）：`.gitattributes` 全仓 `eol=lf`（`*.patch` / `*.diff` 也强制 LF）
      + `patch.ts` 归一化 CRLF，修复 Windows runner 把补丁转 CRLF 导致 `git apply` 失败；新增 CRLF 回归测试
- [x] **GitHub Actions CI #5（提交 `b4ed316`）Windows + Ubuntu 全绿**（build / 35 测试 / demo 证据 / 无头真实浏览器 E2E）
- [x] CI 增加无头真实浏览器 E2E（`login-flow.mjs --case normal --headless 1`）
- [x] 验收 **A2 / A4 / A5 / A6 通过**（runs `run-20261025-175213-9ea8ab` /
      `run-20261025-175216-fe8759` / `run-20261025-175223-de0b95`）

## M2 已完成清单（2026-10-25）

- [x] `packages/steward-desktop`：**真实 Windows 桌面适配器**——Python ctypes 侧车（长驻；
  `EnumWindows`/`SetForegroundWindow`/`BitBlt` 截图 + 自写 PNG 编码/`SendInput` 真实鼠标与
  Unicode 真实键盘）、白名单默认拒绝、Per-Monitor V2 DPI 感知、5 类失败分类
  （`window-not-found`/`focus-lost`/`timeout`/`allowlist-denied`/`unknown`）、每步截图证据、
  凭据/安全提示命中即停止交人；10 个 `desktop.*` ToolSpec + 编排级 `desktop.flow`
- [x] `tests/e2e-desktop/`：真实桌面 E2E（`run.mjs`，真实键鼠 + 每步截图 + JSON 内容断言）；
  A3 实测 **36/36 检查通过、20 张逐步截图、15 个交互步骤全部有截图**
- [x] `packages/steward-core/src/stop-controller.ts`：停止键 ≤5s（200ms watchdog +
  `AbortController` + `withAbort` 超时兜底；停止实测 **305ms**）
- [x] `packages/steward-core/src/checkpoint.ts`：检查点原子写、`listResumable`、
  `markStepDone`/`markCompleted`；`run --resume <runId>` 跳过已完成步骤、不重复执行
- [x] `packages/steward-core/src/isolation.ts`：`CredentialVault` 跨分支隔离 + 脱敏
  （`CrossBranchAccessError`）、`ProfileLock` 同一 profile 独占（`ProfileBusyError`）、
  `assertBranchToolsAllowed` 白名单断言
- [x] runtime 集成：StopController 运行中抢占、每步 checkpoint、resume、`ToolContext` 提供
  `signal`/`locks`/`vault`
- [x] CLI 新增 `desktop-flow`（别名 `demo-desktop`）、`safety-check`、`run --resume <runId>`
  → **11 个已实现命令 + 2 个占位**（`takeover`/`approve` 仍为占位）
- [x] 测试 35 → **53/53**（新增 `tests/unit/m2-safety.test.mjs` 14 条 + `tests/unit/m2-runtime.test.mjs`
  4 条；10 个测试文件）
- [x] `npm run acceptance:m2` 一键本机真实验收（build + 53 测试 + A3 + A8 停止键/检查点 +
  A8 resume runtime + A9 隔离）；证据 `docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}`
  + `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件，已脱敏）
- [x] CI 增加 `safety-check` 步骤；真实桌面 E2E 只能本机跑（托管 CI 无交互桌面）
- [x] 验收 **A3 / A8 / A9 通过**（A3 run `run-20261025-185100-6a4d70`；A8/A9 自检
  `evidence-m2-…/A8-A9-safety-check/safety-check-result.json`）

## 现在能做什么

| 操作 | 命令 | 说明 |
|---|---|---|
| 安装依赖 | `npm install` | Node.js ≥ 22.18；用 npm（不是 pnpm） |
| 构建 | `npm run build` | `tsc -p tsconfig.json` → `dist/`（单包布局） |
| 类型检查 / lint | `npm run lint` | `tsc --noEmit` |
| 单元+集成测试 | `npm test` | 先 build 再 `node --test "tests/unit/*.test.mjs"`；M2 共 **53/53** 通过 |
| 只跑测试（不 build） | `npm run test:unit` | `node --test "tests/unit/*.test.mjs"` |
| 提示词测试（A12） | `npm run test:prompts` | 4 角色安全条款、禁止项、无密钥/本机路径、sha256 校验 |
| M0 空回路演示 | `npm run demo` | MockHarness，无付费 API；产物写入 `runs/<run-id>/` |
| 证据包 | `npm run evidence` | 自动 build + tests + demo，输出 `docs/test-evidence/test-result-<stamp>.{md,json}` |
| 真实浏览器流程（A2） | `node dist/apps/cli/src/index.js browser-flow [--case normal\|login-timeout] [--headless]` | 本机有头默认；产物 `runs/<run-id>/e2e/...` + 每步截图 |
| 真实桌面流程（A3） | `node dist/apps/cli/src/index.js desktop-flow [--json]` | 本机真实 Windows 桌面；真实键鼠（SendInput）+ 每步截图，产物 `runs/<run-id>/e2e-desktop/` |
| 编码回路（A4） | `node dist/apps/cli/src/index.js code-loop [--json]` | CodeTask→补丁→隔离 worktree→真实浏览器红转绿 |
| 编码回路失败注入（A5） | `node dist/apps/cli/src/index.js code-loop --fail [--json]` | 坏补丁两轮失败后停止升级（exit 1，不无限重试） |
| 停止键 / 检查点 / 隔离自检（A8/A9） | `node dist/apps/cli/src/index.js safety-check [--json]` | 停止键 ≤5s（实测 305ms）、检查点 save/load/resume、凭据/ProfileLock/工具白名单隔离自检 |
| 检查点恢复运行（A8） | `node dist/apps/cli/src/index.js run --goal "<目标>" --resume <runId>` | 从最近检查点跳过已完成步骤、不重复执行 |
| M1 一键验收 | `npm run acceptance` | 本机有头真实浏览器；生成 `docs/test-evidence/m1-acceptance-<stamp>.*` + `evidence-m1-<stamp>/` |
| M2 一键验收 | `npm run acceptance:m2` | 本机真实 Windows 桌面；生成 `docs/test-evidence/m2-acceptance-<stamp>.*` + `evidence-m2-<stamp>/` |
| 真实浏览器 E2E | `node tests/e2e-browser/login-flow.mjs --case normal\|login-timeout\|all [--expect-red login-timeout] [--headless 1]` | normal 应绿；login-timeout 修复前应红；`adapter-smoke.mjs` 28/28 |
| 真实桌面 E2E（A3） | `node tests/e2e-desktop/run.mjs [--evidence-dir <目录>]` | 真实 Windows 窗口 + 真实键鼠 + 20 张截图 + JSON 内容断言；需先 `npm run build` |
| 重新生成提示词 manifest | `npm run prompts:manifest` | 修改 `prompts/*.md` 后必须执行（sha256 会变） |
| 校验仓库配置 | `npm run check` | 必需文件/许可证一站式检查 |
| 密钥扫描 | `npm run check:secrets` | 扫描 `sk-*`、`ghp_*`、私钥等；发现即失败 |
| 同步交付快照（旧流程） | `npm run sync:delivery` | 原用于 C: → H: 交付目录复制；现在权威仓库就在 H:，一般不需要 |
| 查看路线图 | [ROADMAP.md](ROADMAP.md) | 里程碑与批准门 |

CLI 子命令：`demo` / `browser-flow` / `desktop-flow` / `code-loop` / `run` / `branch` / `report` /
`stop` / `safety-check` / `version` / `help` 已实现（共 11 个）；别名 `demo-browser` /
`demo-code-loop` / `demo-desktop` 保留；`takeover`、`approve` 为占位（阶段二 / 后续里程碑）。
`run` 支持 `--resume <runId>` 从检查点恢复。

## 还不能做什么

- 桌面适配器暂无 **UIA 可访问性树**、拖拽、滚轮/触控板手势、右键菜单语义、剪贴板、多窗口批处理
  会话编排——M2 已实现真实键鼠 + 截图 + 白名单的核心能力，其余按契约留待后续迭代。
- 真实桌面 E2E 只能在未锁屏的真实交互 Windows 会话跑；托管 CI/无桌面环境不能跑（CI 只跑
  `safety-check` 与 build）。
- 不能调用真实 DSH / DeepSeek Harness——目前用 MockHarness + 脚本化补丁（真实浏览器/桌面验收已跑通）。
- 没有 `approve` 审批队列与 `takeover` 接管包——当前 CLI 为占位命令（M3/M4 或阶段二）。
- 不能发布 GitHub Release——M4；代码已推送 `main`（M2 `6603b04`，M1 `25ef167`）。
- 不能生成宣传片——Phase 2 后（阶段一可选 3 分钟演示）。

## 代码在哪

- **权威仓库（唯一开发位置）**：`H:\minzzj文件\技术部\项目\官方\代掌\daizhang-steward`
  （GitHub `main` 分支；M2 已推送 `6603b04`；不要 git commit，除非用户明确要求）
- **C: 旧副本为归档**：`C:\daizhang-build\daizhang-steward` 只读参考，**不要再在这里改文件**。
- **方案文档**：`H:\minzzj文件\技术部\项目\官方\代掌\代掌-实施总方案-v0.1.md`
- 工程已从 pnpm workspace 改为**单包布局**（H: 为 exFAT，不支持符号链接，pnpm workspace 装不起来）：
  `tsconfig.json` 把 `packages/*/src` + `apps/cli/src` 编译到 `dist/`，所有命令用 **npm**。
- H: exFAT 的写入限制见下方「本机踩坑」第 3/4 条。

## 发布状态（2026-10-25）

- **GitHub 公开仓库**：https://github.com/minzzj/daizhang-steward（2026-10-25 发布验证，见
  [`docs/test-evidence/2026-10-25-repo-publish.md`](docs/test-evidence/2026-10-25-repo-publish.md)；
  当时 CI #1/#2 均 success，许可证识别 `Other/NOASSERTION` 属预期）
- **代码位置**：GitHub `main` 分支（M2 已推送 `6603b04`；M4 统一发版；
  当前 `package.json` 版本 `0.3.0`）。
- **M0 验证证据**：`runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md /
  events.jsonl / code-task.json / code-result.json 等）与
  [`docs/test-evidence/test-result-2026-10-25_09-52-08.md`](docs/test-evidence/test-result-2026-10-25_09-52-08.md)
  （该文件为 Windows CI 修复前快照，tests 34；**当前测试数为 53**，以 `npm test` 为准）；
  `npm run check` / `npm run check:secrets` / `npm run demo` / `npm run evidence` 均通过。
- **M1 验证证据**：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（45 文件：A2 / A4 / A5 三组截图与日志；
  已用 `scripts/sanitize.mjs` 脱敏，无本机绝对路径）；`npm run acceptance` OK（本机有头真实 Chrome）。
- **M2 验证证据**：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（34 文件：A3 真实桌面 20 张截图 +
  `result.json`/`steps.json`/`project.json`/`checkpoint.json`，A8/A9 `safety-check-result.json`，
  `unit-tests.log`、`m2-runtime-tests.log`；已脱敏）；`npm run acceptance:m2` OK（本机真实 Windows
  桌面）；A3/A8/A9 通过；`npm test` **53/53**。

## 本机踩坑（2026-10-25 实测）

1. **无 `pwsh`**：只有 Windows PowerShell 5.1。脚本一律用
   `powershell -NoProfile -ExecutionPolicy Bypass -File <script>` 调用。
2. **PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解码**：含中文路径的 `.ps1` 必须存为
   **UTF-8 with BOM**（`scripts/sync-delivery.ps1` 已加 BOM，并在文件头注明）。
3. **H: 为 exFAT，符号链接/硬链接不可用**：pnpm workspace 与部分 AI 文件工具的原子写会失败。
   `edit` 可改已有文件，但 **`write` 工具在 H: exFAT 下无法新建文件**（会 EISDIR）——
   新建文件先写到 `C:\daizhang-build\staging\...`，再用 PowerShell `Copy-Item` 复制到 H:。
4. **H: 只能用 npm 单包构建**：`npm install` + `tsc -p tsconfig.json` 正常；不要用 pnpm workspace。
5. `npm run check` 在 PowerShell 中会把脚本横幅写到 stderr（`2>&1` 时显示成报错），
   直接看退出码或用 `node scripts/check-scaffold.mjs` 更清晰。
6. Playwright 直接用本机 Chrome/Edge 频道即可，无需下载 Chromium；桌面测试目标窗口用专用标题避免焦点误判。
7. **M1 真实浏览器验收**：本机有头 Chrome 实测通过；适配器默认有头、`chrome → msedge` 回退；
   托管 CI 无交互桌面，只能跑 `login-flow.mjs --case normal --headless 1`（开发自测），
   产品验收用本机 `npm run acceptance`。
8. **Windows CI 的 CRLF 风险**：Windows runner 曾把 `*.patch` 转成 CRLF 导致 `git apply` 失败
   （提交 `b4ed316` 修复：`.gitattributes` 全仓 `eol=lf` + `patch.ts` 归一化 CRLF + CRLF 回归测试）。
   修改 patch/diff 时注意行尾；`.ps1` 保持 CRLF。
9. **证据脱敏**：验收证据复制进仓库前用 `scripts/sanitize.mjs` 替换本机路径与临时 worktree 路径
   （M1/M2 acceptance bundle 已脱敏）；自动生成的证据文件不要手改。
10. **M2 真实桌面验收**：必须在本机**真实交互桌面会话**（未锁屏）运行，`SendInput`/`BitBlt` 依赖前台
    会话；Session 0 / 托管 CI / RDP 断开 / UAC 安全桌面会失败。需要 **Python ≥ 3.8** 在 `PATH`
    （可用 `STEWARD_PYTHON` 或 `pythonCommand` 指定）。桌面 E2E 会先等真人输入空闲 ≥800ms 再操作，
    避免与真人抢焦点；焦点被抢会按白名单拒绝并留证，不会把键鼠打进其他窗口。
11. **桌面坐标与 DPI**：侧车是 Per-Monitor V2 DPI 感知进程，`click(x,y)` 用**屏幕物理像素**；
    操作 tkinter 等 DPI 未感知程序需按 `clientRect.width / 逻辑宽度` 换算（`tests/e2e-desktop/run.mjs`
    已内置换算）。真实桌面共享资源，不要与真人操作并行跑。

## 下一步（按序执行）

0. **推送状态**：M0/M1/M2 已推送 GitHub `main`（最新 `6603b04`）；GitHub Release 留给 M4。
1. **M3 客户分支（下一步）**：Scout——ICP、来源清单、评分、外联草稿、审批队列、ScoutReport（A7）；
   保留真实浏览器/真实桌面 E2E 回归。
2. **M4**：双语文档刷新 + GitHub Release + CI（A10/A11/A12）；`main` 继续按里程碑推送。
3. 阶段一完成：更新本文件 → 按用户要求继续阶段二（或视额度停会话）。

## 等待用户确认的事项

- [ ] 是否继续 M3（客户分支 Scout）——默认按 ROADMAP 继续
- [ ] 测试 key 仅用于联调（默认是；建议联调后轮换）
- [x] GitHub 认证（已通过本机凭据完成建仓与推送；令牌未落盘）
- [x] 仓库名（`minzzj/daizhang-steward` 已创建）
- [x] 第一阶段发布平台（GitHub public 仓库已发布）
- [x] M0 验收（2026-10-25：A1/A6/A12 通过）
- [x] M1 验收（2026-10-25：A2/A4/A5/A6 通过；`npm run acceptance` OK）
- [x] M2 验收（2026-10-25：A3/A8/A9 通过；`npm run acceptance:m2` OK，53/53 测试）

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给阶段二的内容（届时补全）

- [x] M0 验收证据索引：`runs/run-20261025-172017-eb9116/` + `docs/test-evidence/test-result-2026-10-25_09-52-08.md`
- [x] M1 验收证据索引：`docs/test-evidence/m1-acceptance-2026-10-25_09-52-12.{md,json}` +
  `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/`（A2/A4/A5 三组 45 文件）
- [x] M2 验收证据索引：`docs/test-evidence/m2-acceptance-2026-10-25_10-50-51.{md,json}` +
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/`（A3 桌面 20 张截图 + A8/A9 自检 + 测试日志，34 文件）
- [ ] 阶段一 12 条验收证据索引（M3–M4 完成后补齐）
- [ ] 经营域数据模型与阶段二实施计划（基于方案 §5）
- [ ] 企业版边界清单人工复核记录
