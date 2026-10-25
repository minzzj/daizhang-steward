# 核心契约 / Contracts（中文）

> 原则：**字段只增不减**。所有时间用 ISO 8601（UTC 偏移），所有路径用仓库相对路径。
> 机器可读的 JSON Schema 计划在后续里程碑落到 `packages/steward-core/schemas/`；M1 以
> `packages/steward-core/src/types.ts` + 单元测试为准，本文件为权威说明。

## 1. BranchSpec（分支）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 分支唯一标识 |
| `parent_id` | string \| null | 父分支；用于追踪派生关系 |
| `role` | `conductor` \| `operator` \| `scout` \| `reviewer` \| `dummy` | 角色 |
| `goal` | string | 可验收目标 |
| `tools` | string[] | 工具白名单；不在清单里的工具不可调用 |
| `budget` | object | `{token, time_minutes, cost_cny}`；80% 告警，100% 暂停 |
| `approval_policy` | object | `{require_approval: string[], deny: string[]}` |
| `expires_at` | string \| null | 到期自动停止 |
| `prompt_ref` | string | 运行时提示词版本（如 `operator@1.0.0`） |

分支不得自行派生分支；需要时提交 `BranchRequest` 由 Conductor 决定。

## 2. CodeTask（交给 Harness 的任务）

```json
{
  "task_id": "ct-20261025-001",
  "repo": "github.com/minzzj/daizhang-steward",
  "branch": "fix/login-timeout",
  "goal": "修复 demo-web 登录页在慢网路径下超时后不显示错误提示",
  "reproduction": ["启动 demo-web（127.0.0.1:4173）", "打开慢网路径 /login?timeout=1", "输入任意账号并点击登录", "等待 4 秒（该路径服务端 4 秒后返回）"],
  "expected": "显示“请求超时，请重试”，按钮恢复可点击",
  "actual": "按钮一直转圈，无提示",
  "files": ["examples/demo-web/app.js"],
  "acceptance": ["node tests/e2e-browser/login-flow.mjs --case login-timeout"],
  "constraints": ["不改公共 API", "不新增付费依赖"],
  "forbidden": ["packages/steward-core/auth/**"],
  "output": "unified_diff"
}
```

没有验收标准的任务不进入编码回路。

## 3. CodeResult（Harness 的返回）

```json
{
  "task_id": "ct-20261025-001",
  "patch": "diff --git a/... b/...",
  "summary": "在 examples/demo-web/app.js 增加超时恢复分支并渲染错误提示",
  "tests_run": ["node tests/e2e-browser/login-flow.mjs --case login-timeout"],
  "risks": ["未覆盖移动端布局"],
  "uncovered": ["真实网络抖动"]
}
```

补丁在隔离 git worktree 应用并测试（M1 已实现：`patch.ts` + `runCodeLoop`）；通过出 TestReport +
PR 草稿，失败最多两轮后升级人类（`escalated=true` / exit 1）；不自动合并主分支。

## 4. Lead（客户线索）

| 字段 | 说明 |
|---|---|
| `lead_id` / `org` / `role` | 标识、组织、角色 |
| `source_url` | 必填；无来源丢弃 |
| `signal` | 需求信号原文摘要 |
| `fit_score` | 0–1，需求强度 40% + 预算/规模 20% + 可触达性 20% + 合规风险 20% |
| `channel` | email / 平台私信 等 |
| `consent_basis` | 合规依据（公开商务邮箱、明确寻求工具等） |
| `status` | drafted / approved / sent / replied / unsubscribed / archived |

外联只起草；审批后发送；每日每渠道 ≤10；支持退订；不冒充人类。

## 5. ApprovalCard（审批卡）

`id, branch, action, target, amount_cny?, risk_level(low/medium/high/critical), evidence[], options[approve/revise/reject], expires_at, decided_by, decided_at, decision`

三出口：批准 / 驳回 / 超时挂起（不自动放行）。高风险动作缺审批即 `deny`。

## 6. TakeoverPack（接管包）

`open_orders[], pending_threads[], payable[], credentials[], risks[], generated_at, coverage(完整/部分/未收录)`
四类体检结果（阻断/警告/提示/无法判定）都必须生成接管包。

## 7. Event（事件，events.jsonl 一行一条）

| 字段 | 说明 |
|---|---|
| `seq` | 单调递增 |
| `prev_hash` / `hash` | 哈希链，防篡改 |
| `ts` | ISO 8601 |
| `branch_id` / `tool` | 来源分支与工具 |
| `target` | 操作对象（URL/窗口/账号/文件） |
| `input_digest` | 输入摘要（脱敏） |
| `policy_decision` | allow / deny / approve / unknown |
| `result` | success / failure / unknown |
| `evidence_path` | 证据路径（相对仓库） |
| `confidence` | 确定 / 可能 / 未知 / 墓碑 |

只追加、不删除；密钥与个人信息脱敏；至少保留 90 天。
