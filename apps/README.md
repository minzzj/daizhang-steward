# Apps

> 状态：**M2 已完成**：`apps/cli` 已实现 `steward` 命令（**11 个可用 + 2 个占位**）；
> `profile`（DSH 驾驶舱）仍为规划（可选，M4 前接入即可）。

| App | 说明 | 状态 |
|---|---|---|
| `cli` | `steward` 命令：`demo` / `browser-flow` / `desktop-flow` / `code-loop` / `run` / `branch` / `report` / `stop` / `safety-check` / `version` / `help`（`takeover`、`approve` 为占位；别名 `demo-browser` / `demo-code-loop` / `demo-desktop`）。`run` 支持 `--resume <runId>` 从检查点恢复。阶段一主接口。 | ✅ M0/M1/M2 已实现 |
| `profile` | 可选「DSH 驾驶舱」：`dsh --profile daizhang web`，挂载 `steward-mcp` + `dsh-browser` + `dsh-computer-use` + Agent Teams，供人观察/审批/接管。 | 规划（M4 前可选） |

M2 构建与运行（单包布局，命令用 npm，不用 pnpm）：

```bash
npm run build                                    # tsc -p tsconfig.json → dist/
node dist/apps/cli/src/index.js demo             # M0 空回路（MockHarness，无付费 API）
node dist/apps/cli/src/index.js browser-flow     # M1 真实浏览器流程（有头默认，A2）
node dist/apps/cli/src/index.js desktop-flow     # M2 真实 Windows 桌面流程（真实键鼠，A3）
node dist/apps/cli/src/index.js code-loop        # M1 编码回路（A4）
node dist/apps/cli/src/index.js code-loop --fail # M1 两轮失败升级（A5，exit 1 属预期）
node dist/apps/cli/src/index.js safety-check     # M2 停止键/检查点/分支隔离自检（A8/A9）
node dist/apps/cli/src/index.js run --goal "目标" --resume <runId>  # 从检查点恢复
node dist/apps/cli/src/index.js help             # 命令帮助
npm run acceptance                               # M1 本机有头一键验收（A2/A4/A5 → docs/test-evidence/）
npm run acceptance:m2                            # M2 本机真实桌面一键验收（A3/A8/A9 → docs/test-evidence/）
```

约定：

- CLI 只负责参数解析与输出，业务逻辑在 `packages/*`。
- profile 只是可选集成，不参与核心决策；核心可在无 DSH 环境运行（MockHarness）。
- `demo` / `browser-flow` / `desktop-flow` / `code-loop` / `run` / `branch` / `report` /
  `safety-check` 支持 `--json` 输出（便于测试与自动化取证）。
