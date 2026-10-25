# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-25（GitHub 仓库已发布并验证；功能开发暂停，等低峰期启动）

## 现在能做什么

| 操作 | 命令 | 说明 |
|---|---|---|
| 校验仓库骨架 | `pnpm check` | 必需文件/许可证/密钥扫描一站式检查 |
| 密钥扫描 | `pnpm check:secrets` | 扫描 `sk-*`、`ghp_*`、私钥等；发现即失败 |
| 同步交付快照 | `pnpm sync:delivery` | 源文件复制到 H: 交付目录（排除 .git/node_modules/runs） |
| 查看路线图 | [ROADMAP.md](ROADMAP.md) | 里程碑与批准门 |

功能命令（`pnpm dev` / `pnpm demo` / `pnpm test` / `pnpm lint`）目前是占位：
会明确提示“scaffold 阶段未实现”，M0 时替换为真实实现。

## 还不能做什么

- 不能跑 Operator（浏览器/桌面操作）——M0/M1/M2 实现。
- 不能跑 Harness 编码回路——M1 实现（M0 先出 MockHarness）。
- 不能发布 GitHub——等待用户认证与 M4。
- 不能生成宣传片——Phase 2 后（阶段一可选 3 分钟演示）。

## 代码在哪

- **权威仓库（唯一开发位置）**：`C:\daizhang-build\daizhang-steward`（NTFS，支持符号链接与 pnpm）
- **交付快照**：`H:\minzzj文件\技术部\项目\官方\代掌\交付\repo\`（源文件副本，不含 .git / node_modules）
- **方案文档**：`H:\minzzj文件\技术部\项目\官方\代掌\代掌-实施总方案-v0.1.md`
- 为什么不在 H: 开发：H: 为 exFAT，不支持符号链接（pnpm workspace/AI 原子写会失败），
  且 HyperFrames 在 H: 渲染报 EISDIR（既有项目踩坑记录）。

## 发布状态（2026-10-25）

- **GitHub 公开仓库**：https://github.com/minzzj/daizhang-steward
- 默认分支 `main`，当前提交 `35c12e2`；Public；许可证识别为 `Other/NOASSERTION`（CC BY-NC-SA 4.0 属预期）。
- 验证：GitHub REST API + **真实浏览器**（dsh-browser + 本机 Chrome）双路径，README/侧栏/目录/提交记录均正常；
  证据见 [`docs/test-evidence/2026-10-25-repo-publish.md`](docs/test-evidence/2026-10-25-repo-publish.md)
  与截图 [`docs/images/repo-home-2026-10-25.png`](docs/images/repo-home-2026-10-25.png)。
- 待确认：GitHub Actions 首次运行结果 → **已完成：CI #1/#2 均 success（Windows + Ubuntu）**；Release 计划 M4/v0.1.0 创建。
- **功能开发状态**：暂停（按用户要求等低峰期）。已完成的部分 M0 实现保存在**本地**分支
  `wip/m0-core`（提交 `5d3f677`，**尚未推送**，避免公开半成品）。恢复开发第一步见「下一步」第 0 条。

## 本机踩坑（2026-10-25 实测）

1. **无 `pwsh`**：只有 Windows PowerShell 5.1。脚本一律用
   `powershell -NoProfile -ExecutionPolicy Bypass -File <script>` 调用。
2. **PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解码**：含中文路径的 `.ps1` 必须存为
   **UTF-8 with BOM**（`scripts/sync-delivery.ps1` 已加 BOM，并在文件头注明）。
3. **H: 为 exFAT**：不支持符号链接、硬链接（AI 文件工具的原子写会失败）；
   给 H: 写文件用 PowerShell `[System.IO.File]::WriteAllText` 或先写 C: 再复制。
4. `pnpm check` 在 PowerShell 中会把脚本横幅写到 stderr（`2>&1` 时显示成报错），
   直接看退出码或用 `node scripts/check-scaffold.mjs` 更清晰。
5. Playwright 直接用本机 Chrome/Edge 频道即可，无需下载 Chromium；桌面测试目标窗口用专用标题避免焦点误判。

## 下一步（低峰期继续，按序执行）

0. **恢复 M0 工作**：`git checkout wip/m0-core`（或把该分支 rebase 到 main），先跑
   `pnpm install && pnpm build && pnpm test`，补 `prompts/manifest.json`（`pnpm prompts:manifest`），
   再继续 M0 剩余项：CLI 的 `run/branch/report/stop` 命令、prompts v1 内容、单元测试、`pnpm demo` 空回路证据。
1. **M0 验收**：A1 / A6 / A12，生成第一份证据包（截图+日志+report）并汇报。
2. **M1**：Playwright Operator 真实浏览器回路（A2/A4/A5/A6）。
3. **M2**：Windows 桌面适配器 + PolicyEngine + 停止键 + 检查点（A3/A8/A9）。
4. **M3**：Scout（A7）。**M4**：双语文档 + GitHub 发布（A10/A11/A12）。
5. 阶段一完成：更新本文件 → 按用户要求自动继续阶段二（或视额度停会话）。

## 等待用户确认的事项

- [ ] 低峰期“开始/恢复目标”指令（用户已同意自动进下一阶段、自动更新仓库）
- [ ] 测试 key 仅用于联调（默认是；建议联调后轮换）
- [x] GitHub 认证（已通过本机凭据完成建仓与推送；令牌未落盘）
- [x] 仓库名（`minzzj/daizhang-steward` 已创建）
- [x] 第一阶段发布平台（GitHub public 仓库已发布）

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给阶段二的内容（届时补全）

- [ ] 阶段一 12 条验收证据索引
- [ ] 经营域数据模型与阶段二实施计划（基于方案 §5）
- [ ] 企业版边界清单人工复核记录
