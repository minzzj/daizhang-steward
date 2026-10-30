# 代掌 Steward v1.4.0 发布说明

**发布日期**：2026-10-30 · 许可证：CC BY-NC-SA 4.0 · 仓库：https://github.com/minzzj/daizhang-steward

v1.4 解决「发消息之后为什么不实时处理、为什么还要手动点执行、总调度为什么写不了简单方案」：**发送即执行、全程实时事件流、每轮对话与摘要可见、未实现动作由模型输出兜底**，并补齐系统级文件/应用/服务/定时任务/安装卸载与可配置审批策略。

## 核心改动

### 1. 发送即执行（无需点「开始执行」）
- `/chat` 输入目标 → 发送 → **立即创建 Run 并自动执行**到完成（或需人工确认才暂停）。
- CLI 一条命令自动执行：`steward runtime --goal "帮我写一个简单方案"`。
- 新增 `packages/steward-runtime`：Run 队列/自动执行循环/并发（默认 3）/暂停恢复打断/自动返工/持久化。

### 2. SSE 实时事件流（看得到思考与执行过程）
- `GET /api/chat/runs/:id/stream?since=<seq>`（Server-Sent Events，心跳、断线重连 `Last-Event-ID`、按 seq 回放）。
- 实时显示：总调度思考中 → 计划生成（逐步点亮）→ 每步开始/完成 → **每个智能体每轮输入/输出摘要 + Token + 模型来源** → 审批卡 → 完成/失败。
- 刷新页面恢复当前进度；`/runs/:id` 查看证据（截图/报告/日志）。

### 3. 审批策略可配置（危险动作永不自动放行）
- `/settings` 新增「自动执行与审批策略」：自动执行开关、审批模式（仅高风险暂停 / 全自动 / 逐步确认）、完全自动开关、单 Run 步骤上限、返工次数、事件保留数。
- 默认 `auto_low_risk`：低/中风险自动执行，高风险/危险动作暂停等人工确认；删除程序/插件、破坏性文件操作必须二次确认 + 回收站备份 + 审计。

### 4. 简单方案真的能写出来（模型输出兜底）
- 本地动作未实现/失败但模型已产出内容时，自动保存模型输出为证据；含 HTML 时提取为 `deliverable.html`，不再因一个未实现动作阻断整条 Run。
- 真实 DeepSeek 实测：「帮我写一个简单的项目方案（单页 HTML 方案书）」→ 5 步自动完成，产出 `deliverable.html`（3.3KB）、`content-draft.md`、`quality-check.json`、`review.json`，全程 `remote` 真实模型。

### 5. 系统总控扩展动作
- 受管工作区内文件/目录（list/read/write/mkdir/copy/move/remove，删除先备份+确认）；
- 打开受管应用/白名单 URL；服务状态只读快照；定时任务（scheduler.json）；受管程序安装/卸载（备份+确认）；
- 全部动作审计脱敏，危险动作强制二次确认。

## 真实验收
- 控制台真实有头 Chrome E2E：**31/31 步、338/338 检查、35 张截图、退出码 0**（含发送即执行/实时事件/刷新恢复/审批暂停/SSE sanity）。
- 单元测试：**339/339 通过**；build / check-scaffold / check-secrets 通过。
- 真实模型端到端：DeepSeek API（用户自配密钥，仅本地）—— 发送即执行、5 步自动完成、每轮摘要、证据落盘。
- CI：Windows + Ubuntu 全绿。

## 升级
```bash
git pull && npm run build && npm test
node dist/apps/cli/src/index.js console --port 4180
# 打开 http://127.0.0.1:4180/chat，直接输入目标发送（无需点开始执行）
```

## 证据
- `docs/test-evidence/evidence-console-v14-*/`（E2E result.json + 35 张截图）
- `docs/test-evidence/evidence-v14-real/`（真实自动执行会话、截图、事件、证据文件）
- 文档：`docs/zh-CN/runtime.md`、`docs/en/runtime.md`

## 已知限制
- 自动执行仍受预算/Token/步骤上限约束；危险动作永远人工确认。
- 重启后未完成 Run 标为 paused，需 `resume`（防止无人值守重复危险动作）；事件保留窗口外旧事件不可回放。
- SSE 为单进程内存广播（本地单机）；多实例需外部队列。
- 演示 runtime 与真实 runtime 均可用；真实模型需自配 API key（无 key 自动本地回退并明确标注 `local_fallback`）。
