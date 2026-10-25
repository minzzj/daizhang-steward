# HANDOFF / 交接状态

> 给下一次会话（或下一位执行者）的现状交接。每次里程碑结束更新。
> 最后更新：2026-10-25（S0 脚手架完成，等待低峰期批准）

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

## 下一步（用户批准后按序执行）

1. **M0**：`steward-core` 最小内核 + CLI + MockHarness + demo fixtures + prompts v1 + 证据目录。
2. 跑通文档 1 验收 **A1 / A6 / A12**，生成第一份证据包（截图 + 日志 + report）。
3. **M1**：Playwright Operator 真实浏览器回路（A2/A4/A5/A6）。
4. **M2**：Windows 桌面适配器 + PolicyEngine + 停止键 + 检查点（A3/A8/A9）。
5. **M3**：Scout（A7）。**M4**：双语文档 + GitHub 发布（A10/A11/A12）。
6. 阶段一完成：更新本文件 → **结束会话**（省额度）→ 阶段二新会话从这里继续。

## 等待用户确认的事项

- [ ] 低峰期批准“开始阶段一 M0”
- [ ] GitHub 认证方式（fine-grained PAT 放 `STEWARD_GH_TOKEN`，或 device flow）
- [ ] 仓库名最终确认（默认 `daizhang-steward`）
- [ ] “第一阶段发布平台”准确含义（默认 GitHub public + Release）
- [ ] 测试 key 是否仅用于联调（默认是；建议联调后轮换）

## 已知风险

见 [ASSUMPTIONS.md](ASSUMPTIONS.md) 与方案 §11：DSH RC 版本漂移、Windows 桌面自动化稳定性、
GitHub 认证、非商用许可预期、法律边界需人工复核、额度控制。

## 交接给阶段二的内容（届时补全）

- [ ] 阶段一 12 条验收证据索引
- [ ] 经营域数据模型与阶段二实施计划（基于方案 §5）
- [ ] 企业版边界清单人工复核记录
