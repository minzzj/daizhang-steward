# 总调度对话 / 项目 / 证据（v1.3）

## 1. 两层总调度

```
L1 系统总控（supervisor）—— 最高权限：受管程序/插件、模型与提示词、全部日志、委派项目、危险动作二次确认
        │ 委派项目
        ▼
L2 项目总调度（conductor）—— 拆计划、派任务、控预算、汇总证据、验收
        │ 派发
        ▼
L3 专项智能体：operator / harness / customer / finance / reviewer / backend / scout / content / research
```

## 2. 控制台对话（/chat）

1. 打开 `http://127.0.0.1:4180/chat`；
2. 在输入框对总调度说目标（例：「帮我做一份单页 HTML 报价单页面，并记录 10 元收款请求」）；
3. 总调度生成 4–6 步计划（含验收标准与需审批步骤），点「开始执行」；
4. 可随时 **打断**（记录断点）→ **恢复**（不重复已完成动作）；
5. 关键步骤出现审批卡：**批准 / 驳回**；
6. 完成后在 `/runs/<会话ID>` 查看时间线、证据缩略图（点开大图）、`report.md`、日志与各智能体摘要。

## 3. CLI 对话（零 UI，可脚本化）

```bash
# 项目总调度：单命令跑完一个项目（真实模型；无 key 时本地回退并标注 local_fallback）
node dist/apps/cli/src/index.js project --goal "帮我做一份报价单页面并记录10元收款请求" --json

# 超级总调度：系统级任务（列出程序/插件、启动程序、禁用插件、读日志、切换模型、委派项目）
node dist/apps/cli/src/index.js supervisor --goal "检查系统状态并委派一个项目" --json

# 打断 / 恢复 / 审批 / 查看
node dist/apps/cli/src/index.js chat --action interrupt --session <id>
node dist/apps/cli/src/index.js chat --action resume --session <id>
node dist/apps/cli/src/index.js chat --action approve --session <id> --step 4
node dist/apps/cli/src/index.js chat --action detail --session <id> --json
node dist/apps/cli/src/index.js chat --action logs --json
node dist/apps/cli/src/index.js chat --action list
```

## 4. 每个智能体、每一轮对话与摘要

- 每次调用记录 `AgentTurn`：`seq / at / agent_role / input_summary / output_summary / detail（全文）/ tokens / status / evidence_refs / model_mode`。
- 控制台 `/agents/<role>` 查看每个智能体的每轮输入摘要、输出摘要、Token、状态、证据；`/runs/<id>` 查看全流程与各 agent 摘要。
- API：`GET /api/chat/sessions`、`GET /api/chat/runs/:id`、`GET /api/chat/agents/:role/transcripts`、`GET /api/chat/evidence?run_id=`。

## 5. 证据（可打开、可核对）

每个 run 的证据目录：`runs/<session-id>/`，包含交付物（`deliverable.html`/`deliverable.md`）、`quality-check.json`、`review.json`、`payment-request.json`、`ledger-record.json`、`events.jsonl`、系统动作证据等。控制台证据灯箱直接读取真实文件（截图 base64 内联，报告渲染 markdown）。

## 6. 模型来源标注

每次模型调用标注 `model_mode`：`remote`（真实模型）或 `local_fallback`（本地规则回退，**明确标注，不假装真实模型**）。无 API key 或网络失败时自动回退并在消息/证据中标注。

## 7. 数据边界

会话与证据存本地 `runs/`（gitignore）；配置在 `.steward/`；控制台只监听 `127.0.0.1`，写操作需 token。
