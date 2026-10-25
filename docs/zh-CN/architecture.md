# 架构 / Architecture（中文）

> 状态：设计定稿；**M0 内核 + M1 真实浏览器回路已实现并验证（2026-10-25）**，其余随 M2–M4 落地，细节改动以 PR 为准。
> 配套：`docs/zh-CN/contracts.md`、`docs/zh-CN/threat-model.md`、`docs/zh-CN/adapters.md`。

## 1. 设计原则

1. **可组合优先**：Operator、Scout、Reviewer 都是 `AgentRuntime` 的配置（BranchSpec），不是硬编码类；
   新增分支只增加配置、提示词与工具白名单。
2. **证据优先**：每个对外动作必须落到 `events.jsonl` 与 `runs/<id>/` 证据目录；没有证据的成功视为未完成。
3. **默认拒绝**：高风险动作先由 PolicyEngine 判定 `allow / deny / approve / unknown`；超时挂起不自动放行。
4. **人是最终责任主体**：审批、接管、例外、月度对账由人完成；AI 不担任法律主体。
5. **底座可替换**：核心不硬依赖 DeepSeek Harness；通过 HarnessAdapter 隔离，MockHarness 保证离线可演示。

## 2. 分层

```text
┌ 接口层 ─ 阶段一 CLI / 阶段二 本地 Web 控制台 / 通知通道 / MCP（给 DSH 驾驶舱、物联软件）
├ 编排层 ─ Conductor（目标拆解、分支生命周期、预算、验收）
├ 执行层 ─ AgentRuntime（计划-行动-观察-反思-报告）→ Operator / Scout / Reviewer
├ 能力层 ─ ToolRegistry（浏览器、桌面、文件、HTTP、消息、代码执行、支付[禁用]）
│          HarnessAdapter（mock / DSH headless / DeepSeek API）
├ 治理层 ─ PolicyEngine、预算门、停止键、检查点、审计
└ 数据层 ─ SQLite（WAL）+ events.jsonl（哈希链）+ runs/ 产物 + prompts/ 版本化提示词
```

## 3. 运行形态

| 形态 | 命令 | 用途 |
|---|---|---|
| 内核 CLI | `node dist/apps/cli/src/index.js demo/browser-flow/code-loop/run/branch/report/stop/version/help` | 24h 运行、演示、验收 |
| DSH 驾驶舱（可选） | `dsh --profile daizhang web` | 人用 DSH GUI 观察/审批/接管；挂 `steward-mcp` 与 `dsh-browser`/`dsh-computer-use` |

内核是独立 Node/TS 进程；驾驶舱只是可选的“人机接口”，不参与核心决策。

工程为**单包布局**（无 pnpm workspace）：`packages/*/src` + `apps/cli/src` 由
`tsc -p tsconfig.json` 编译到 `dist/`，命令一律用 npm（`npm run build` / `npm test` / `npm run demo` /
`npm run acceptance`）。`takeover` 与 `approve` 仍为占位命令（阶段二 / 后续里程碑）。

**M1 实现现状**：`packages/steward-browser` 提供 Playwright 真实浏览器适配器（有头默认、
`chrome→msedge` 回退、每 run 独立 `userDataDir`、每步截图/DOM/console、5 类失败分类、
风控关键词 → 停止交人）；`packages/steward-harness/src/patch.ts` 在隔离 git worktree 应用补丁，
`loop.ts` 的 `runCodeLoop` 最多两轮、超限升级；`tests/e2e-browser/` 提供真实浏览器 E2E
（normal 绿 / login-timeout 红）。Conductor / Reviewer / Scout 分支仍为规划（M2–M3）。

## 4. 分支生命周期

```text
目标 → Conductor 生成 BranchSpec → PolicyEngine 校验预算/工具/审批策略
     → AgentRuntime 执行（计划→行动→观察→反思）→ 产物与事件
     → Reviewer 校验证据 → Conductor 验收 → 终止/到期（保留产物与事件，不删除）
```

分支不得自行再开分支；需要扩展时提交 `BranchRequest` 由 Conductor 决定。过期自动停止。

M1 现状：CLI 直接装配 operator 分支（BranchSpec + 工具白名单）跑 `browser-flow` / `code-loop`；
Conductor 的分支派生、Reviewer 证据复核与 Conductor 验收接口仍是规划（M2+）。

## 5. 证据与账本

- `events.jsonl`：只追加、带 `seq` 与哈希链，字段见 contracts.md；密钥脱敏。
- `runs/<run-id>/`：M0 产物为 `prompt.md`、`report.md`、`console.log`、`meta.json`、`events.jsonl`，
  以及 MockHarness 回路的 `code-task.json`、`code-result.json`、`patch.diff`、`test.log`；M1 起
  真实浏览器运行另含 `e2e/<case>/screenshots/`、`e2e/<case>/result.json`、`e2e/server.log`；
  验收时复制到 `docs/test-evidence/evidence-m1-<stamp>/`。`approval.json` 随 M2 落地。
- SQLite 索引可从事件重放重建；崩溃后用检查点恢复，不重复发送/扣款。

## 6. 摘要层级

- **L0 动作卡**：谁、对谁、做了什么、依据哪条授权、证据在哪、结果如何。
- **L1 项目摘要**：目标、进度、花费、收入、未结事项、风险、下次验收。
- **L2 经营月报**：收支、毛利、回款率、预算余量、项目组合、合规事件、下月提案。

每层标注“截至何时、覆盖多少（完整/部分/未收录）”。

## 7. 扩展点

| 要加什么 | 只改什么 |
|---|---|
| 新分支（如支持/交付/财务） | BranchSpec + 提示词 + 工具白名单 |
| 新工具 | ToolRegistry 注册（参数、风险级别、审批要求、证据类型） |
| 新通知通道 | NotifyAdapter 实现 |
| 新业务线 | 项目模板 + 提示词 |
| 新模型 | LLM 路由 + 预算门 |
| 物联设备 | IoTAdapter（MQTT / HTTP JSON-RPC） |

## 8. 明确不做

多租户 SaaS、计费系统、复杂前端（阶段一）、无审批的支付/合同/账号权限、绕过验证码与风控。
