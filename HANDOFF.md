# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-25（M0 完成并验证；权威仓库已迁到 H:；下一步 M1）

## 当前状态（一句话）

M0 内核最小闭环已完成并验证：`steward` CLI 跑通空回路，30/30 测试通过，4 份运行时提示词 v1 +
sha256 manifest，A1/A6/A12 验收通过。代码在本地分支 `wip/m0-core`，**尚未推送**（避免公开半成品）。

## M0 已完成清单（2026-10-25）

- [x] 内核：AgentRuntime / BranchSpec / PolicyEngine / ArtifactBus / PromptManager / EventLog / BudgetGuard / StopSignal
- [x] CLI：`demo` / `run` / `branch` / `report` / `stop` / `version` / `help`（`takeover`、`approve` 为占位）
- [x] MockHarness + CodeTask/CodeResult 骨架，`patch.diff`、`test.log` 落盘
- [x] prompts v1（4 角色）+ `prompts/manifest.json` sha256 + 提示词测试
- [x] 30/30 单元+集成测试通过；`npm run check`、`npm run check:secrets`、`npm test`、
      `npm run demo`、`npm run evidence` 全部通过
- [x] 单包构建（`tsc -p tsconfig.json` → `dist/`）+ 全部命令改用 npm；C: 旧副本转为归档
- [x] 验收 A1 / A6 / A12 通过（见 [ROADMAP.md](ROADMAP.md) 与 `docs/*/delivery-checklist.md`）
- 代码状态：本地分支 `wip/m0-core`（**未推送**，M4 统一发布 v0.1.0）

## 现在能做什么

| 操作 | 命令 | 说明 |
|---|---|---|
| 安装依赖 | `npm install` | Node.js ≥ 22.18；用 npm（不是 pnpm） |
| 构建 | `npm run build` | `tsc -p tsconfig.json` → `dist/`（单包布局） |
| 类型检查 / lint | `npm run lint` | `tsc --noEmit` |
| 单元+集成测试 | `npm test` | 先 build 再 `node --test "tests/unit/*.test.mjs"`；M0 共 **30/30** 通过 |
| 只跑测试（不 build） | `npm run test:unit` | `node --test "tests/unit/*.test.mjs"` |
| 提示词测试（A12） | `npm run test:prompts` | 4 角色安全条款、禁止项、无密钥/本机路径、sha256 校验 |
| M0 空回路演示 | `npm run demo` | MockHarness，无付费 API；产物写入 `runs/<run-id>/` |
| 证据包 | `npm run evidence` | 自动 build + tests + demo，输出 `docs/test-evidence/test-result-<stamp>.{md,json}` |
| 重新生成提示词 manifest | `npm run prompts:manifest` | 修改 `prompts/*.md` 后必须执行（sha256 会变） |
| 校验仓库配置 | `npm run check` | 必需文件/许可证一站式检查 |
| 密钥扫描 | `npm run check:secrets` | 扫描 `sk-*`、`ghp_*`、私钥等；发现即失败 |
| 同步交付快照（旧流程） | `npm run sync:delivery` | 原用于 C: → H: 交付目录复制；现在权威仓库就在 H:，一般不需要 |
| 查看路线图 | [ROADMAP.md](ROADMAP.md) | 里程碑与批准门 |

CLI 子命令：`demo` / `run` / `branch` / `report` / `stop` / `version` / `help` 已实现；
`takeover`、`approve` 为占位（M1 / 阶段二）。

## 还不能做什么

- 不能跑真实 Operator（浏览器/桌面操作）——M0 只有 Mock 工具与 MockHarness；真实 Playwright/Windows 适配器在 M1/M2。
- 不能跑真实 Harness 编码回路——M1 实现（M0 的 MockHarness 只返回示例补丁，不调用 DSH/DeepSeek）。
- 没有 `approve` 审批队列（M1）与 `takeover` 接管包（阶段二）——当前 CLI 为占位命令。
- 不能发布 GitHub Release——M4；M0 分支尚未推送。
- 不能生成宣传片——Phase 2 后（阶段一可选 3 分钟演示）。

## 代码在哪

- **权威仓库（唯一开发位置）**：`H:\minzzj文件\技术部\项目\官方\代掌\daizhang-steward`
  （当前分支 `wip/m0-core`；不要切换分支、不要 git commit，除非用户明确要求）
- **C: 旧副本为归档**：`C:\daizhang-build\daizhang-steward` 只读参考，**不要再在这里改文件**。
- **方案文档**：`H:\minzzj文件\技术部\项目\官方\代掌\代掌-实施总方案-v0.1.md`
- 工程已从 pnpm workspace 改为**单包布局**（H: 为 exFAT，不支持符号链接，pnpm workspace 装不起来）：
  `tsconfig.json` 把 `packages/*/src` + `apps/cli/src` 编译到 `dist/`，所有命令用 **npm**。
- H: exFAT 的写入限制见下方「本机踩坑」第 3/4 条。

## 发布状态（2026-10-25）

- **GitHub 公开仓库**：https://github.com/minzzj/daizhang-steward（2026-10-25 发布验证，见
  [`docs/test-evidence/2026-10-25-repo-publish.md`](docs/test-evidence/2026-10-25-repo-publish.md)；
  当时 CI #1/#2 均 success，许可证识别 `Other/NOASSERTION` 属预期）
- **M0 代码位置**：本地分支 `wip/m0-core`（**尚未推送**，避免公开半成品；M4 统一发布 v0.1.0）。
- **M0 验证证据**：`runs/run-20261025-172017-eb9116/`（prompt.md / patch.diff / test.log / report.md /
  events.jsonl / code-task.json / code-result.json 等）与
  [`docs/test-evidence/test-result-2026-10-25_09-20-15.md`](docs/test-evidence/test-result-2026-10-25_09-20-15.md)；
  `npm run check` / `npm run check:secrets` / `npm test`（30/30）/ `npm run demo` / `npm run evidence` 均通过。

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

## 下一步（按序执行）

0. **推送前检查**：M0 已完成并验证；推送/发版留给 M4（当前分支 `wip/m0-core` 不推送）。
1. **M1 浏览器回路（下一步）**：Playwright Operator 真实 Chromium/Edge（headed）→ demo-web 登录/填表/
   提交/校验/截图（A2）；CodeTask → CodeResult → 隔离应用补丁 → 跑测试，两轮失败升级（A4/A5/A6 真实版）。
2. **M2**：Windows 桌面适配器（demo-desktop，A3）+ PolicyEngine 风险矩阵 + 停止键 5 秒 + 检查点恢复（A8/A9）。
3. **M3**：Scout 线索来源/评分/审批队列（A7）。
4. **M4**：双语文档刷新 + 推送 `wip/m0-core` → main + GitHub Release v0.1.0 + CI（A10/A11/A12）。
5. 阶段一完成：更新本文件 → 按用户要求继续阶段二（或视额度停会话）。

## 等待用户确认的事项

- [ ] 是否继续 M1（真实浏览器回路）——默认按 ROADMAP 继续
- [ ] 测试 key 仅用于联调（默认是；建议联调后轮换）
- [x] GitHub 认证（已通过本机凭据完成建仓与推送；令牌未落盘）
- [x] 仓库名（`minzzj/daizhang-steward` 已创建）
- [x] 第一阶段发布平台（GitHub public 仓库已发布）
- [x] M0 验收（2026-10-25：A1/A6/A12 通过；`wip/m0-core` 未推送）

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给阶段二的内容（届时补全）

- [x] M0 验收证据索引：`runs/run-20261025-172017-eb9116/` + `docs/test-evidence/test-result-2026-10-25_09-20-15.md`
- [ ] 阶段一 12 条验收证据索引（M1–M4 完成后补齐）
- [ ] 经营域数据模型与阶段二实施计划（基于方案 §5）
- [ ] 企业版边界清单人工复核记录
