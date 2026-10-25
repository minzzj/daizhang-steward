# Apps

> 状态：**阶段一 v0.5.0 已完成**：`apps/cli` 已实现 `steward` 命令（**13 个可用 + 2 个占位**）；
> `profile`（DSH 驾驶舱）仍为规划（可选，阶段二接入即可）。

| App | 说明 | 状态 |
|---|---|---|
| `cli` | `steward` 命令：`demo` / `browser-flow` / `desktop-flow` / `scout` / `dummy-branch` / `code-loop` / `run` / `branch` / `report` / `stop` / `safety-check` / `version` / `help`（`takeover`、`approve` 为占位；别名 `demo-browser` / `demo-code-loop` / `demo-desktop` / `demo-dummy`）。`run` 支持 `--resume <runId>` 从检查点恢复，`scout` 支持 `--fixture <path>`（只起草、不发送），`dummy-branch` 演示「只读分支只靠配置 + 已有提示词」（A10）。阶段一主接口。 | ✅ M0–M4 已实现（v0.5.0） |
| `profile` | 可选「DSH 驾驶舱」：`dsh --profile daizhang web`，挂载 `steward-mcp` + `dsh-browser` + `dsh-computer-use` + Agent Teams，供人观察/审批/接管。 | 规划（阶段二可选） |

v0.5.0 构建与运行（单包布局，命令用 npm，不用 pnpm）：

```bash
npm run build                                    # tsc -p tsconfig.json → dist/
node dist/apps/cli/src/index.js demo             # M0 空回路（MockHarness，无付费 API）
node dist/apps/cli/src/index.js browser-flow     # M1 真实浏览器流程（有头默认，A2）
node dist/apps/cli/src/index.js desktop-flow     # M2 真实 Windows 桌面流程（真实键鼠，A3）
node dist/apps/cli/src/index.js scout            # M3 Scout：fixture → ICP/评分/3 草稿/审批队列（不发送，A7）
node dist/apps/cli/src/index.js scout --json     # 机读输出（验收脚本用）
node dist/apps/cli/src/index.js dummy-branch     # M4/A10 只读 dummy 分支（仅配置 + reviewer 提示词）
node dist/apps/cli/src/index.js code-loop        # M1 编码回路（A4）
node dist/apps/cli/src/index.js code-loop --fail # M1 两轮失败升级（A5，exit 1 属预期）
node dist/apps/cli/src/index.js safety-check     # M2 停止键/检查点/分支隔离自检（A8/A9）
node dist/apps/cli/src/index.js run --goal "目标" --resume <runId>  # 从检查点恢复
node dist/apps/cli/src/index.js help             # 命令帮助
npm run acceptance                               # M1 本机有头一键验收（A2/A4/A5 → docs/test-evidence/）
npm run acceptance:m2                            # M2 本机真实桌面一键验收（A3/A8/A9 → docs/test-evidence/）
npm run acceptance:m3                            # M3 Scout 一键验收（A7 → docs/test-evidence/）
npm run acceptance:m4                            # M4 发布就绪验收（A10/A11 → docs/test-evidence/）
```

约定：

- CLI 只负责参数解析与输出，业务逻辑在 `packages/*`。
- profile 只是可选集成，不参与核心决策；核心可在无 DSH 环境运行（MockHarness）。
- `demo` / `browser-flow` / `desktop-flow` / `scout` / `dummy-branch` / `code-loop` / `run` / `branch` /
  `report` / `safety-check` 支持 `--json` 输出（便于测试与自动化取证）。
