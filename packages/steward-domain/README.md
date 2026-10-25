# `@daizhang/steward-domain` — 经营域引擎（阶段二 P1 个人版）

代掌 Steward 阶段二「个人版 MVP」的**经营域核心**：把「接单—交付—收款—开票—月报」这条个人经营链路做成
可审计、可接管、边界先行的纯逻辑引擎。

- 纯逻辑、零第三方依赖、无网络、无真实资金/平台账号；
- 文件持久化：`<root>/domain/state.json`（tmp + rename 原子写）+ `<root>/domain/events.jsonl`（只追加审计）；
- 同步 API（本地小状态，便于 CLI / 本地 Web 控制台直接调用）；
- 安全默认：接管态停止写操作、审批超时挂起不自动放行、四类越界 100% 拒绝、账本 6 要素缺一不可。

> 阶段定位：P1-A（M2-B 之后的阶段二核心）。真实浏览器/桌面/客户分支（Scout）在阶段一已交付，
> 本包只做「经营域数据模型与引擎」，由 Lead 在 CLI / 控制台集成。

---

## 1. 八概念映射（工程字段 → 业务含义）

| # | 概念 | 类型 | 说明 |
|---|---|---|---|
| 1 | 委托 Mandate | `Mandate` | 授权人、范围 `scope[]`、期限 `valid_from/valid_to`、额度 `budget_limits`（月/项目/单笔）、禁止项 `prohibited[]`、状态 `active/expired/revoked` |
| 2 | 预算三层 | `MandateBudgetLimits` | `month_cny ≥ project_cny ≥ per_txn_cny`；`checkBudget()` 单笔 → 项目 → 月逐层校验 |
| 3 | 项目 Project | `Project` | 业务线来源、客户、状态 `proposed/active/delivered/closed/tombstoned`、`timeline[]` 统一时间线 |
| 4 | 任务 Task | `Task` | 所属项目、代理角色 `AgentRole`、状态、关联 `evidence[]` |
| 5 | 代理 AgentRole | `AgentRole` | `conductor/developer/customer/finance/content/research` |
| 6 | 证据 Evidence | `Evidence` | `screenshot/log/email/receipt/delivery/invoice/commit` + 路径 + 置信度；支持墓碑 |
| 7 | 账本 LedgerEntry | `LedgerEntry` | 6 要素：金额/收付方/依据/审批人/回执/所属项目；`income/expense/refund/receivable/invoice` |
| 8 | 墓碑 tombstone | `confidence: "tombstone"` | 不删除历史（账本/事件保留），只标记不可逆：`tombstoneProject()` / `tombstoneEvidence()` |

**置信度**四档：`certain`（确定）/ `probable`（可能）/ `unknown`（未知）/ `tombstone`（墓碑）。
每条关系（项目、证据、时间线条目、账本条目、承诺）都带置信度；墓碑项默认不出现在摘要/证据视图。

---

## 2. 快速开始

```ts
import { DomainEngine, DEFAULT_BUSINESS_LINES } from "@daizhang/steward-domain";

// 持久化模式（<root>/domain/state.json + events.jsonl）；测试可用 { persist: false }
const engine = new DomainEngine({ root: process.cwd(), credentials: ["env:DEMO_API_KEY"] });

// 1) 委托（授权人 + 范围 + 期限 + 预算三层 + 禁止项）
engine.createMandate({
  principal: "本人",
  scope: ["承接无需资质的小额自动化订单", "对外报价需本人审批"],
  valid_to: "2027-12-31T00:00:00.000Z",
  budget_limits: { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000 },
  prohibited: ["借用资质", "陌生外呼"],
});

// 2) 选题：5 万预算 / 30 天，≥3 条业务线输出 proposal（来源缺失丢弃、超预算拒绝、需资质转人工）
const proposal = engine.proposeBusinessLines(DEFAULT_BUSINESS_LINES, { budget_cny: 50_000, days: 30 });
console.log(proposal.proposal?.summary);

// 3) 建项目 → 任务 → 交付证据 → 验收 → 收款 → 开票
const project = engine.createProject(proposal.ranked[0]!);
const task = engine.addTask({ project_id: project.id, agent_role: "developer", goal: "交付 demo" });
const done = engine.completeTask(task.id, [{ kind: "delivery", path: "runs/sim/delivery.zip" }]);
engine.recordLedger({
  project_id: project.id,
  type: "income",
  amount_cny: 12_000,
  payee_or_payer: project.client,
  basis: `验收单 + 交付证据 ${done.evidence.join(",")}`,
  approved_by: "本人",
  receipt_ref: "receipt-001",
});

// 4) 审批 / 接管 / 月报 / 边界
const card = engine.createApprovalCard({ kind: "quote", summary: "对外报价 ¥12,000", amount_cny: 12_000 });
engine.decideApproval(card.id, "approve", "本人"); // 超时后调用返回 status="expired"（不自动放行）
const report = engine.buildMonthlyReport("2026-10");
const boundary = engine.checkBoundary({ kind: "payment", text: "直接给客户转账", amount_cny: 8_000 });
// → { decision: "human", rule_id: "B-08", user_message: "支付、退款与转账必须由授权人本人..." }
```

### 一条命令跑完整仿真业务线

```ts
const engine = new DomainEngine({ persist: false });
const run = engine.runSimulatedBusinessLine();
// run.project.status === "delivered"
// run.tasks 全部 done；run.timeline 含 created/note/quoted/task/delivery/acceptance/income/invoice
// run.ledger = [income, invoice]；run.invoice_status === "issued"
// run.report = 当月月报（收支/毛利/预算余量/合规事件）
```

---

## 3. API 摘要（`DomainEngine`）

| 分组 | 方法 | 说明 |
|---|---|---|
| 委托 | `createMandate(input)` / `activeMandate()` / `revokeMandate(reason)` | 同一时刻仅一个生效；新委托自动吊销旧委托；过期自动置 expired |
| 选题 | `proposeBusinessLines(lines, {budget_cny, days})` / `businessLines()` | 三类校验（`rejected` / `needs_human`）+ 按毛利/确定性排序 + ≥3 条时 `proposal` |
| 预算 | `checkBudget(kind, amount_cny, project_id?)` / `budgetSnapshot()` | 三层任一超限 → `{allowed:false, requiresHumanApproval:true, layer, reason}`；通过则累计消耗 |
| 项目 | `createProject(businessLine, client?)` / `projectTimeline(id)` / `getProject(id)` | 项目时间线统一记录对话/报价/任务/交付/验收/收款/开票 |
| 任务 | `addTask({project_id, agent_role, goal})` / `completeTask(id, evidence)` / `getTask(id)` | 完成时登记证据（`EvidenceInput[]`），幂等 |
| 证据 | `addEvidence(projectId, input)` / `evidence({project_id?, include_tombstone?})` / `tombstoneEvidence(id)` | 默认过滤墓碑 |
| 账本 | `recordLedger(input)` / `ledgerEntryFacts(id)` / `ledger(filter?)` / `exportLedgerCsv()` | 6 要素齐全才允许记账；同回执同项目同类型拒重复 |
| 承诺 | `recordPromise(project_id, text, source_message_id, mandate_clause)` / `tracePromise(id)` | 追溯「对话原文 → 授权条款 → 项目」；找不到/未授权/委托失效 → `{authorized:false, reason:"未授权"}` |
| 审批 | `createApprovalCard(input)` / `decideApproval(id, decision, by)` / `approvalQueue()` / `getApproval(id)` | 默认 pending + `expires_at`；超时 → `expired`（不自动放行）；决策人和时间必填 |
| 接管 | `takeover(reason, by)` / `resume(by?)` / `lastTakeoverPack` / `isHalted` | takeover 同步置 `halted=true`（所有写操作抛 `SystemHaltedError`），并生成 6 段接管包 |
| 摘要/月报 | `summaries()` / `buildMonthlyReport("YYYY-MM")` | L0 动作卡 / L1 项目摘要 / L2 月报 |
| 边界 | `boundaryRules(mode?)` / `boundaryRuleTotal()` / `checkBoundary(request)` / `assertRequestAllowed(request)` | 默认个人模式可枚举 18 条（全目录 20 条，企业模式 19 条）；deny/human/draft_only 均留痕 |
| 仿真 | `runSimulatedBusinessLine()` | 端到端跑一条订单并返回 `{project, tasks, timeline, ledger, invoice_status, report, ...}` |

错误类型（`errors.ts`）：`DomainValidationError`（含 `code` / `field`）、`BudgetExceededError`、
`SystemHaltedError`（含 `halted_at/reason`）、`BoundaryDeniedError`（含 `rule_id`）。

**持久化与事件**：

```
<root>/domain/state.json    # 原子写（tmp+rename），可重启恢复
<root>/domain/events.jsonl  # 只追加：{seq, ts, action, object_type, object_id, result, evidence_refs, detail?}
```

`detail` 写入前脱敏（sk-/ghp_/长 hex → `[REDACTED]`），原文只存摘要。事件日志只追加不覆盖，重启后 `seq` 继续递增。
测试建议 `{ persist: false }` 或 `mkdtemp` 临时 root。

---

## 4. 边界规则（个人模式 ≥12 条，全目录 20 条）

`boundaryRules("personal")` 返回 18 条（`personal` + `both`）；`boundaryRuleTotal()` = 20（含企业模式 2 条）。
每条含 `rule_id / trigger / must / user_message / mode / test_case_id`，供 UI 展示与边界核对表逐条标注。

| 分组 | 规则 | 行为 |
|---|---|---|
| **四类越界（100% deny）** | B-01 无证业务；B-02 借用/挂靠资质；B-03 陌生外呼；B-04 超预算 | `deny`，理由可读并写合规事件 |
| 其他红线 | B-05 未授权承诺；B-06 垫资/借贷；B-07 代实名/刷单 | `deny` |
| 人工必过 | B-08 支付/退款/转账；B-09 合同签署；B-10 账号权限；B-11 验证码/2FA/人脸；B-12 线下到场；B-13 开票；B-14 投诉纠纷；B-15 隐私数据导出；B-16/B-17（企业模式） | `human` |
| 仅起草 | B-18 对外报价；B-19 对外触达；B-20 交付物发送 | `draft_only` |
| 未命中 | — | `allow`（`rule_id: "ALLOW"`） |

判定顺序：deny 组在前 → human 组 → draft_only 组（第一条命中即返回），保证「四类越界第 1 步拒绝」。
`checkBoundary` 会把非 allow 判定写入 `state.compliance_events`（月报 `compliance_events`）与 `events.jsonl`。

---

## 5. 安全与验收对应

| 验收（文档 2） | 引擎能力 | 单测 |
|---|---|---|
| B1 选题：5 万/30 天 ≥3 条，来源可核 | `proposeBusinessLines` + 来源硬校验 + 提案 | `domain.test.mjs` |
| B2 记账：30 秒看到 6 要素 | `recordLedger` + `ledgerEntryFacts` + CSV | 同上 |
| B5 承诺追溯：对话原文 + 授权条款，找不到显示未授权 | `recordPromise` / `tracePromise` | 同上 |
| B6 接管键 10 秒停止 + 接管包 | `takeover`（同步 halted）/ `resume` / 6 段包 | 同上 |
| B7 四类越界 100% 拒绝、理由可读、留痕 | `checkBoundary` + 规则目录 + 合规事件 | 同上 |
| 审批超时挂起不自动放行 | `createApprovalCard` / `decideApproval` / `approvalQueue` | 同上 |
| 月报可对账 | `buildMonthlyReport`（收支/毛利/预算余量/合规事件/下月提案） | 同上 |
| 账本不重复（断网补记） | 同 `receipt_ref` + 项目 + 类型拒绝重复 | 同上 |

---

## 6. CLI / 控制台集成建议（给 Lead）

```ts
// apps/cli/src/index.ts（示意）
import {
  DomainEngine, BoundaryDeniedError, SystemHaltedError,
  DEFAULT_BUSINESS_LINES,
} from "../../../packages/steward-domain/src/index.js";

function openEngine(root: string, memory = false): DomainEngine {
  return new DomainEngine({ root, persist: memory ? false : undefined });
}

case "domain-sim": {
  const engine = openEngine(root, true);
  const run = engine.runSimulatedBusinessLine();
  console.log(JSON.stringify({
    ok: true, project: run.project.id, status: run.project.status,
    ledger: run.ledger.map((e) => e.id), invoice: run.invoice_status,
    income_cny: run.report.income_cny, budget_left_cny: run.report.budget_left_cny,
  }, null, 2));
  return 0;
}

case "domain-approve": {
  const engine = openEngine(root);
  const id = process.argv[3];
  const card = engine.decideApproval(id, "approve", "cli-user");
  console.log(card.status === "pending" ? "仍待审批" : `审批结果：${card.status}`);
  return card.status === "approved" ? 0 : 1;
}

case "domain-takeover": {
  const engine = openEngine(root);
  const pack = engine.takeover("CLI 接管键", "cli-user");
  console.log(JSON.stringify(pack, null, 2));
  return 0;
}

case "domain-resume": { openEngine(root).resume("cli-user"); return 0; }

case "domain-report": {
  const month = process.argv[3] ?? new Date().toISOString().slice(0, 7);
  const report = openEngine(root).buildMonthlyReport(month);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

case "domain-boundary-check": {
  const result = openEngine(root).checkBoundary({ kind: "payment", text: "直接转账给客户", amount_cny: 8000 });
  console.log(JSON.stringify(result, null, 2));
  return result.decision === "allow" ? 0 : 2; // deny → 非零退出码
}
```

建议 CLI 命令映射：`steward domain-sim`（离线跑仿真业务线）、`steward domain-report [YYYY-MM]`、
`steward domain-approve <card-id>`、`steward takeover` / `resume`（接到现有 takeover 命令）、
`steward domain-boundary-check`（CI 可断言四类越界 100% deny）。

控制台（本地 Web，127.0.0.1）可直接读 `summaries()`：L0 动作卡渲染待办/审批/接管，L1 渲染项目看板，
L2 渲染月报；`ledgerEntryFacts()` 支撑「任一支出 30 秒看到 6 要素」。

---

## 7. 非目标（本包不做）

- 不连接真实客户、平台账号、支付/开票系统；不发起真实资金/合同动作；
- 不做网络请求、不启动浏览器/桌面进程（由 steward-browser / steward-desktop 负责）；
- 不提供 HTTP 服务/UI（控制台在 apps/ 层，Lead 集成）；
- 仿真业务线的审批使用 `SIMULATED_HUMAN_APPROVER` 标识（明确非真人），真实使用时必须由人调用
  `decideApproval(..., by: <自然人标识>)`。

## 8. 测试

```bash
npm run build
node --test tests/unit/domain.test.mjs   # 本包单测（不写仓库 runs/，全部 mkdtemp / 内存模式）
```
