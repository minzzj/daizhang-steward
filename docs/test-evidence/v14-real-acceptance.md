# v1.4 真实自动执行验收 / Real Auto-Execution Acceptance

- 日期：2026-10-30
- 模型：**DeepSeek 真实 API**（用户自配密钥，仅本地 `.steward/secrets.json`，不入库；本目录已脱敏）
- 浏览器：真实有头 Chrome（控制台页面）
- 关键修复：配置中心密钥解析 `{ok,value}` 与 resolver 期望字符串不匹配 → 真实模型全部被误判为无 key 走本地回退；已修复并验证 `remote`。

## 1. 发送即执行（无需点「开始执行」）
- 控制台 `/chat` 输入目标 → 点击「发送并自动执行」→ 服务端 `POST /api/chat/runs` 立即创建 Run 并自动开始。
- 实测会话：`sess-20261030123250-0016`（见 `sessions-*.json`、`runs/`）
  - 计划 5 步（content → operator → operator → harness → reviewer 等）
  - **全部步骤 `mode=remote`（真实 DeepSeek 模型）**
  - 状态 `done`，交付物真实生成：`deliverable.html`（3,339 bytes）、`deliverable.md`、`content-draft.md`、`quality-check.json`、`review.json`
  - Token 由真实 usage 累计（记录在 turn/model 事件中）
- 证据截图：`screenshots/v140-live-running.png`（执行中：SSE 已连接、实时 agent 轮次）、`screenshots/v140-live-completed.png`（完成卡）、`screenshots/v140-run-evidence.png`（run 详情/证据）、`screenshots/v140-settings-runtime.png`（审批策略设置）。

## 2. SSE 实时事件流
- `GET /api/chat/runs/:id/stream?since=seq` 实时推送：run.queued → run.started → plan.generating → plan.ready → step.started → agent.turn → token.updated → step.completed → run.completed。
- 页面刷新可恢复（快照 + since=0 回放 + EventSource 重连 Last-Event-ID）。
- 证据：`runtime-events.jsonl`、`console-api-snapshot.json`、`screenshots/v140-live-running.png`。

## 3. 审批策略
- 默认 `auto_low_risk`：低/中风险自动执行；高风险/危险动作暂停等人工确认（`approval.required` 事件 + 审批卡）。
- `/settings` 可视化配置：自动执行、审批模式、完全自动开关、步骤上限、返工次数、事件保留（校验 full_auto 与 manual 互斥）。
- 截图：`screenshots/v140-settings-runtime.png`。

## 4. 稳定性修复（用户痛点）
- 模型计划出现未实现动作（如 `harness.build_deliverable`）时，本地动作失败不再阻断整条 Run：自动保存模型输出为证据；模型输出含 HTML 时提取为 `deliverable.html`（本次实测文件 3,339 bytes）。
- 因此「帮我写一个简单的项目方案」不再卡住，5 步自动完成并真实产出方案 HTML。

## 5. 控制台真实浏览器 E2E（另见 evidence-console-v14-*）
- 31/31 步、338/338 检查、35 张截图、退出码 0（有头 Chrome），覆盖发送即执行/实时事件/刷新恢复/审批暂停/SSE sanity。

## 6. 说明
- 密钥未入库；config 快照只含引用（`file:secrets.json#deepseek`）。
- 自动执行 ≠ 无限制：预算/Token/步骤上限 + 审批策略三层保护；危险动作永远二次确认 + 回收站备份 + 审计。