# v1.5.4 验收记录 / Acceptance — 点名发送 + 独立智能体上下文

- 日期：2026-10-31 · 版本：v1.5.4（基线 v1.5.3）
- 按要求：不保存控制台截图，证据为 result.json 与断言。
- 数据：真实数据 + 演示数据混合（真实 Harness 证据在 evidence-v15-harness-real/）。

## 1. 单元测试
- `node --test "tests/unit/*.test.mjs"` → **414/414 通过**（新增点名路由/中英文别名/任务文本剥离测试）。
- `npm run build` exit 0；`npm run check` / `check:secrets` OK。

## 2. E2E（有头 Chrome，0 截图）
- ChatGPT 式对话 E2E：**10/10 步、42/42 检查、9.5s、退出码 0**（含 `chat-agent-route`：`?agent=operator` 预选、用户消息携带 `@operator`、工具卡片、最终结果）。
- 全量回归 E2E：**38/38 步、412/412 检查、36.4s、退出码 0**。

## 3. 真实控制台人工验证（v1.5.4 构建）
- `/chat?agent=operator`：智能体选择器预选「办公执行」。
- 发送任务后用户消息显示 `@operator …`；办公执行在**独立会话/工作区**执行（思考 8 步、工具、产物、报告），最终结果可见；总控对话上下文未进入该智能体。
- 独立历史已写入 `.steward/chat/agents/operator/history.json`（本地、gitignore），仅含该智能体自己的任务/结论。
- `/agents` 每个智能体卡片提供「点名发任务 →」。

## 4. 结论
- "点名发送发不出去"已修复：支持 @role/中文别名/选择器/agents 入口，真实路由到对应智能体执行。
- 复杂任务按角色/项目调度分发到独立智能体（conductor 拆解派发），各智能体独立上下文/工作区，避免上下污染与漂移。