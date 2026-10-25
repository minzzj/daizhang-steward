# Apps

> 状态：**阶段一 v0.5.0 已完成；阶段二 P1（v0.6.0）、P2 故障演练（短跑 + 真实 120min/15min 长跑）与
> P3 企业版（v0.8.0）已全部完成并合并发布 v0.8.0**：`apps/cli` 已实现 `steward` 命令（**19 个业务命令 +
> `help` 入口，0 个占位**）；`profile`（DSH 驾驶舱）仍为规划（可选，P4 阶段接入即可）。

| App | 说明 | 状态 |
|---|---|---|
| `cli` | `steward` 命令：`demo` / `browser-flow` / `desktop-flow` / `scout` / `dummy-branch` / `business` / `console` / `boundary-check` / `fault-drill` / `enterprise-demo` / `approve` / `takeover` / `code-loop` / `run` / `branch` / `report` / `stop` / `safety-check` / `version`（别名 `demo-browser` / `demo-code-loop` / `demo-desktop` / `demo-dummy` / `demo-business` / `demo-enterprise`；`help` 为入口命令）。`run` 支持 `--resume <runId>` 从检查点恢复，`scout` 支持 `--fixture <path>`（只起草、不发送），`console` 支持 `--port <端口>`（默认 4180，只监听 127.0.0.1），`takeover --resume` 恢复运行，`fault-drill` 支持 `--case net-outage\|platform-ban` 与 `--outage-minutes`/`--ban-minutes`；`takeover`/`approve` 自 P1 起为真实人工命令。阶段一 + 阶段二主接口。 | ✅ M0–P3 已实现（v0.8.0 已发布） |
| `profile` | 可选「DSH 驾驶舱」：`dsh --profile daizhang web`，挂载 `steward-mcp` + `dsh-browser` + `dsh-computer-use` + Agent Teams，供人观察/审批/接管。 | 规划（P4 可选） |

v0.8.0（已发布）构建与运行（单包布局，命令用 npm，不用 pnpm）：

```bash
npm run build                                    # tsc -p tsconfig.json → dist/
node dist/apps/cli/src/index.js demo             # M0 空回路（MockHarness，无付费 API）
node dist/apps/cli/src/index.js browser-flow     # M1 真实浏览器流程（有头默认，A2）
node dist/apps/cli/src/index.js desktop-flow     # M2 真实 Windows 桌面流程（真实键鼠，A3）
node dist/apps/cli/src/index.js scout            # M3 Scout：fixture → ICP/评分/3 草稿/审批队列（不发送，A7）
node dist/apps/cli/src/index.js scout --json     # 机读输出（验收脚本用）
node dist/apps/cli/src/index.js dummy-branch     # M4/A10 只读 dummy 分支（仅配置 + reviewer 提示词）
node dist/apps/cli/src/index.js business         # P1 经营域：选题/仿真业务线/账本6要素/承诺追溯/接管包/月报/边界
node dist/apps/cli/src/index.js boundary-check   # P1 边界规则自检（四类越界 100% 拒绝，B7）
node dist/apps/cli/src/index.js console          # P1 本地 Web 控制台（默认 http://127.0.0.1:4180）
node dist/apps/cli/src/index.js approve --json   # P1 人工审批队列（超时挂起，不自动放行）
node dist/apps/cli/src/index.js takeover --json  # P1 接管键：停止新动作 + 6 类接管包（--resume 恢复）
node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 0.2 --json   # P2 真实断网演练（短）
node dist/apps/cli/src/index.js fault-drill --case platform-ban --ban-minutes 0.2 --json   # P2 真实 403 封禁演练（短）
node dist/apps/cli/src/index.js enterprise-demo --json  # P3 企业版：B8 双模式 + 6 类阻断 + 30 条边界表
node dist/apps/cli/src/index.js code-loop        # M1 编码回路（A4）
node dist/apps/cli/src/index.js code-loop --fail # M1 两轮失败升级（A5，exit 1 属预期）
node dist/apps/cli/src/index.js safety-check     # M2 停止键/检查点/分支隔离自检（A8/A9）
node dist/apps/cli/src/index.js run --goal "目标" --resume <runId>  # 从检查点恢复
node dist/apps/cli/src/index.js help             # 命令帮助
npm run acceptance                               # M1 本机有头一键验收（A2/A4/A5 → docs/test-evidence/）
npm run acceptance:m2                            # M2 本机真实桌面一键验收（A3/A8/A9 → docs/test-evidence/）
npm run acceptance:m3                            # M3 Scout 一键验收（A7 → docs/test-evidence/）
npm run acceptance:m4                            # M4 发布就绪验收（A10/A11 → docs/test-evidence/；v0.5.0 里程碑检查，固定 0.5.0 版本断言）
npm run acceptance:p1                            # P1 个人版 MVP 验收（B1/B2/B5/B6/B7 + 控制台 E2E → docs/test-evidence/）
npm run acceptance:p2                            # P2 故障演练**短跑**验收（B3/B4，真实 localhost HTTP → docs/test-evidence/）
npm run acceptance:p3                            # P3 企业版验收（B8 + 30 条边界 → docs/test-evidence/）
```

约定：

- CLI 只负责参数解析与输出，业务逻辑在 `packages/*`（P1 的 `business`/`console`/`approve`/`takeover`
  在 `packages/steward-domain` + `packages/steward-console`；P2 的 `fault-drill` 在
  `packages/steward-fault`；P3 的 `enterprise-demo` 在 `packages/steward-enterprise`）。
- profile 只是可选集成，不参与核心决策；核心可在无 DSH 环境运行（MockHarness）。
- `demo` / `browser-flow` / `desktop-flow` / `scout` / `dummy-branch` / `business` / `boundary-check` /
  `fault-drill` / `enterprise-demo` / `code-loop` / `run` / `branch` / `report` / `safety-check` /
  `approve` / `takeover` 支持 `--json` 输出（便于测试与自动化取证）。
