# v1.5.1 发布说明 / Release Notes — DeepSeek Harness Agents + ChatGPT 式对话总控

> 发布日期：2026-10-30 · 版本：v1.5.1 · 基线：v1.4.0
> 主题：**每个智能体换成真实 DeepSeek Harness 代理；控制台变成 ChatGPT 式对话总控；产物/报告/数据/思考全部内嵌可见；加入长期记忆。**

## 1. 这次解决了什么（对应用户反馈）

用户反馈："明显不对，看不到明显的产物、数据、报告、思考等过程复杂；借鉴 openclaw 和 deepseek harness，然后同步更换一下各个 agent。"
以及："我要的是和对话一样的，那个怎么调出去就可以去系统里查任何东西，而且不通过其他的 agent，他自己查，或者直接调用其他的人查。现在看不到报告，我要和对话一样，他自己去干。要有记忆。"

v1.5.1 交付：
1. **所有专项智能体换成真实 DeepSeek Harness 代理**（会思考、会用工具、写真实文件、出报告、留证据），不再是模板动作。
2. **/chat 变成 ChatGPT 式对话总控**：一个输入框控制全部；问系统/run/产物/报告/日志/配置/账本/智能体，AI 自己查并回答（0 token）；任务类自动执行；危险动作只给审批卡，人类只确认/签字。
3. **过程与结果内嵌在对话里**：thinking 折叠块、工具调用/结果卡片、产物卡片（HTML/Markdown/JSON/图片预览+下载）、报告卡片（Markdown 渲染）、数据卡片（Token/工具/耗时）、审批卡、错误卡——不用跳页面。
4. **长期记忆 + 多会话**：对话历史持久化（新建/切换/重命名/删除），自动积累记忆（偏好/项目/决策/run/产物/报告），可查看/搜索/删除，并在回复时引用；刷新/重启不丢。
5. **真实数据 + 演示数据混合测试**：真实 Harness run 证据保留为测试样本，demo provider 提供假数据覆盖 UI/边界；页面标注数据源（真实/演示/混合）。

## 2. 新增能力

### 2.1 DeepSeek Harness 真实执行
- 新包 `packages/steward-harness-runtime`：`HarnessAgentRunner` 通过 `dsh --profile headless --json` 执行，实时解析 thinking/tool_call/tool_result/text/usage/final；隔离工作区、产物清单（sha256/kind/size）、自动 report.md、并发池、超时/取消、失败回退。
- 编排层注入 `agentExecutor`：10 个业务智能体步骤优先真实 Harness 执行，产物/报告/思考/工具事件写入 `runs/<sessionId>/harness/` 并实时推送控制台；失败回退旧本地动作。
- 配置中心新增 `harness`（总开关/profile/dsh_bin/timeout/并发/产物保留/report_required/11 角色开关；supervisor 固定关闭）。
- 11 个 agent 的 harness 元数据（profile/workspace/tools）。
- 修复：真实密钥解析 bug（此前误判无 key → 全部 local_fallback）；单步 Token 上限 20 万→可配（默认 200 万）；超限仍保留产物/报告/证据；Harness 工作区移到系统临时盘（修复 exFAT 上 write 工具异常）。

### 2.2 对话式总控（`steward-chat`）
- `ChatEngine` + `ChatStore`：18 类中文意图规则；查询类 0 token 直连真实数据工具；任务类流式回报；危险动作只返回审批卡；长期记忆抽取/召回/去重；多会话。
- CLI：`steward ai "系统现在怎么样"`、`steward ai --history`、`steward ai --memory`、`steward ai --conversation <id> "..."`、`steward ai --delete-memory <id>`；实时打印思考/工具/产物/报告/数据。
- 控制台 `/chat` 重做为对话页：左侧会话历史 + 记忆抽屉；中间消息流 + 内嵌卡片；底部输入框；顶部数据源/运行状态 + 9 个快捷查询 chips；SSE 逐段渲染；刷新恢复。
- 新 API：`/api/chat/conversations`、`/api/chat/conversations/:id/messages`、SSE `/api/chat/conversations/:id/stream`、`/api/chat/memory`、`/api/chat/status`、`/api/chat/conversations/:id/approvals`。
- 保留深度视图：`/runs/:id`（过程/产物/数据/报告四 Tabs）、`/artifacts`、`/reports`、`/chat/:id` 实时运行页。

### 2.3 产物/报告/数据（v1.5 延续）
- `/runs/:id` 四 Tabs：过程（thinking/tool 时间线）、产物（预览/下载）、数据（Token/工具/耗时/事件）、报告（Markdown）。
- 新增 `/artifacts` 产物中心、`/reports` 报告中心；`/agents` 显示「DeepSeek Harness 真实执行」徽章与最近会话/产物/报告。
- 真实 Provider：`listArtifacts/listReports/getRunMetrics/getArtifactContent/getArtifactFilePath` + harness 事件 SSE 轮询。

## 3. 测试与证据（无截图，按要求）

- 单元测试：**404/404 通过**（原 339 + Harness 19 + 配置 v3/harness 16 + 对话 19 + 真实数据 fixture 9 + 其他）。
- 真实 Harness 运行证据：`docs/test-evidence/evidence-v15-harness-real/`（真实 4 步 run：事件/产物/报告/metrics；Token 926,392；脱敏）。
- 控制台 E2E（有头 Chrome，**0 截图**）：
  - ChatGPT 式对话小 E2E：8/8 步、35/35 检查、8.1s、退出码 0。
  - 原回归 E2E：38/38 步、413/413 检查、31.6s、退出码 0。
- 真实数据 + 假数据混合：真实 run 证据作为 fixture 测试；demo provider 覆盖 UI/安全/边界。

## 4. 成本与安全

- 查询/闲聊 0 token；任务类才走 Harness，单步 token/超时上限可配。
- 真实 Harness 成本参考：4 步小任务约 92.6 万 tokens。
- Harness 不注入密钥（使用本机 DSH 凭据）；危险动作（删除程序/插件、付款、对外发送）永不自动执行，需人工确认/签字；工作区隔离、审计留存。

## 5. 升级说明

- 旧配置自动迁移（补 `harness` 默认值与 11 角色）。
- 默认 `harness.enabled=true`（本机有 dsh 时生效；无 dsh 自动回退旧本地动作）。
- 对话数据保存于 `.steward/chat/`、run 证据在 `runs/<sessionId>/`（均 gitignore）。
- 启动：`steward console --port 4180` → 打开 `http://127.0.0.1:4180/chat`。

## 6. 已知限制

- 意图为规则分类（18 类常见中文句式），更复杂自然语言后续可加 LLM 分类（会有 token 成本）。
- 记忆为本地关键词召回（中文 bigram），语义改写可能召不回。
- `/runs/:id` 为快照视图；实时流在 `/chat` 与 `/chat/:id`。
- 机群/多机控制：当前仅本机（127.0.0.1）单机模式。
