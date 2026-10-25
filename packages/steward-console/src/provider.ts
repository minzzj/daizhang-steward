/**
 * packages/steward-console/src/provider.ts
 *
 * 本地 Web 控制台的数据提供者契约（ConsoleDataProvider）与内置仿真实现。
 *
 * 设计要点：
 * 1. **不依赖 `steward-domain`**（并行开发解耦）：控制台只认本文件的接口；
 *    Lead/后续任务用 `createDomainConsoleProvider(domain)` 适配真实经营域即可。
 * 2. 所有方法允许同步或异步（`MaybePromise<T>`）返回，服务端统一 `await`；
 *    仿真实现全同步，真实 domain 适配器可直接返回 Promise。
 * 3. 字段「只增不减」：核心字段与阶段二契约一致，额外提供 `project_budget`、
 *    `takeoverStatus()`、`resume()`、`evidenceDetail()` 用于页面渲染（见 README）。
 * 4. 仿真数据只在本包内嵌（不读 fixtures），全部为虚构示例；审批/接管会真实修改
 *    内存状态，页面与 API 均能观察到变化。
 */

/** 允许同步或异步实现。 */
export type MaybePromise<T> = T | Promise<T>;

// ---------------------------------------------------------------------------
// 看板 / 项目 / 任务 / 代理 / 预算
// ---------------------------------------------------------------------------

export interface ConsoleProject {
  id: string;
  name: string;
  status: string;
  client: string;
  /** 0-100 */
  progress: number;
}

export interface ConsoleTask {
  id: string;
  project_id: string;
  agent_role: string;
  goal: string;
  status: string;
}

export interface ConsoleAgent {
  role: string;
  status: string;
}

export interface ConsoleProjectBudget {
  month_cny: number;
  spent_cny: number;
  left_cny: number;
}

export interface ConsoleBudget {
  month_cny: number;
  spent_cny: number;
  left_cny: number;
  per_txn_cny: number;
  /** 扩展：项目级预算（页面「预算条：月 / 项目 / 单笔」用）。 */
  project_budget?: ConsoleProjectBudget;
}

export interface ConsoleOverview {
  asOf: string;
  projects: ConsoleProject[];
  tasks: ConsoleTask[];
  agents: ConsoleAgent[];
  budget: ConsoleBudget;
}

// ---------------------------------------------------------------------------
// 项目时间线 / 证据
// ---------------------------------------------------------------------------

export interface ConsoleTimelineItem {
  ts: string;
  /** message / task / evidence / delivery / risk … */
  kind: string;
  text: string;
  /** 证据引用 id；有值时页面可点开查看路径/类型/置信度。 */
  evidence_ref?: string;
}

export interface ConsoleEvidence {
  id: string;
  /** screenshot / report / json / log / file … */
  kind: string;
  path: string;
  confidence: string;
  captured_at?: string;
}

// ---------------------------------------------------------------------------
// 账本（B2：一笔支出 30 秒看到 6 要素）
// ---------------------------------------------------------------------------

export interface ConsoleLedgerEntry {
  id: string;
  project_id: string;
  /** 支出 / 收入 … */
  type: string;
  amount_cny: number;
  payee_or_payer: string;
  basis: string;
  approved_by: string;
  receipt_ref: string;
  occurred_at: string;
}

/** B2 验收的 6 要素（页面详情抽屉逐项展示）。 */
export interface ConsoleLedgerFacts {
  amount_cny: number;
  payee_or_payer: string;
  basis: string;
  approved_by: string;
  receipt_ref: string;
  project_id: string;
}

export interface ConsoleLedgerFilter {
  project_id?: string;
  type?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// 审批卡
// ---------------------------------------------------------------------------

export interface ConsoleApproval {
  id: string;
  /** purchase / outreach / payment … */
  kind: string;
  summary: string;
  amount_cny?: number;
  evidence_ids: string[];
  expires_at: string;
  /** pending / approved / rejected */
  status: string;
}

export interface ConsoleApprovalDecision {
  ok: boolean;
  status: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 接管键（B6：≤10 秒停止 + 6 类接管包）
// ---------------------------------------------------------------------------

export interface ConsoleTakeoverPack {
  open_orders: string[];
  pending_threads: string[];
  payables: string[];
  /** 只允许出现「凭据引用」，禁止明文。 */
  credentials: string[];
  risks: string[];
  coverage: string;
}

export interface ConsoleTakeoverResult {
  stopped_at: string;
  halted: boolean;
  pack: ConsoleTakeoverPack;
}

export interface ConsoleTakeoverStatus {
  halted: boolean;
  stopped_at: string | null;
  resumed_at: string | null;
  pack: ConsoleTakeoverPack | null;
  elapsed_ms: number;
}

export interface ConsoleResumeResult {
  resumed_at: string | null;
  halted: boolean;
}

// ---------------------------------------------------------------------------
// 月报 / L0-L1-L2 摘要
// ---------------------------------------------------------------------------

export interface ConsoleMonthlyReport {
  month: string;
  income_cny: number;
  cost_cny: number;
  gross_margin_cny: number;
  budget_left_cny: number;
  compliance_events: string[];
  next_proposals: string[];
  as_of: string;
  coverage: string;
}

export type ConsoleSummaryLevel = "L0" | "L1" | "L2";

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

/**
 * 控制台数据提供者。核心 9 个方法来自阶段二 P1-C 契约；末尾 3 个是页面渲染所需的扩展
 * （接管状态 / 恢复 / 证据详情），真实 domain 适配器实现成本很低。
 */
export interface ConsoleDataProvider {
  overview(): MaybePromise<ConsoleOverview>;
  projectTimeline(projectId: string): MaybePromise<ConsoleTimelineItem[]>;
  ledger(filter?: ConsoleLedgerFilter): MaybePromise<ConsoleLedgerEntry[]>;
  ledgerFacts(entryId: string): MaybePromise<ConsoleLedgerFacts | null>;
  approvals(): MaybePromise<ConsoleApproval[]>;
  decideApproval(id: string, decision: "approve" | "reject", by: string): MaybePromise<ConsoleApprovalDecision>;
  takeover(reason: string, by: string): MaybePromise<ConsoleTakeoverResult>;
  monthlyReport(): MaybePromise<ConsoleMonthlyReport>;
  summary(level: ConsoleSummaryLevel): MaybePromise<unknown>;
  /** 扩展：当前接管状态（页面刷新后仍能显示 halted / 接管包 / 计时）。 */
  takeoverStatus(): MaybePromise<ConsoleTakeoverStatus>;
  /** 扩展：恢复运行（接管页 resume 按钮）。 */
  resume(by: string): MaybePromise<ConsoleResumeResult>;
  /** 扩展：证据详情（时间线证据点开显示路径/类型/置信度）。 */
  evidenceDetail(ref: string): MaybePromise<ConsoleEvidence | null>;
}

// ---------------------------------------------------------------------------
// 内置仿真数据（与 examples/demo-business 的「仿真业务线」结构一致；全部虚构）
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 内置仿真 provider：用于 UI 开发与真实浏览器 E2E，无需读 fixtures、无需真实 domain。
 * 审批决策与接管/恢复会修改内存状态（进程内有效，重启即重置）。
 */
export function createDemoConsoleProvider(): ConsoleDataProvider {
  const now = Date.now();
  const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
  const month = iso(0).slice(0, 7);

  const projects: ConsoleProject[] = [
    { id: "prj-001", name: "示例客户官网改版", status: "active", client: "杭州示例科技有限公司", progress: 62 },
    { id: "prj-002", name: "示例贸易对账自动化", status: "at_risk", client: "宁波示例贸易有限公司", progress: 38 },
    { id: "prj-003", name: "示例发票整理交付", status: "done", client: "上海示例咨询有限公司", progress: 100 },
  ];

  const tasks: ConsoleTask[] = [
    { id: "task-001", project_id: "prj-001", agent_role: "conductor", goal: "汇总官网改版验收进度并生成下一轮计划", status: "running" },
    { id: "task-002", project_id: "prj-001", agent_role: "operator", goal: "完成移动端适配（3 个页面）", status: "running" },
    { id: "task-003", project_id: "prj-001", agent_role: "operator", goal: "修复表单校验错误提示位置", status: "done" },
    { id: "task-004", project_id: "prj-001", agent_role: "reviewer", goal: "复核首页/产品页交付证据", status: "pending" },
    { id: "task-005", project_id: "prj-002", agent_role: "operator", goal: "导入 10 月对账单并生成差异清单", status: "running" },
    { id: "task-006", project_id: "prj-002", agent_role: "conductor", goal: "评估 3 条对账差异的风险与处理建议", status: "running" },
    { id: "task-007", project_id: "prj-002", agent_role: "scout", goal: "起草客户回访草稿（待审批，不发送）", status: "pending" },
    { id: "task-008", project_id: "prj-003", agent_role: "operator", goal: "整理 10 月发票并按客户归档", status: "done" },
    { id: "task-009", project_id: "prj-003", agent_role: "reviewer", goal: "抽检 5 张发票与回执一致性", status: "done" },
    { id: "task-010", project_id: "prj-003", agent_role: "conductor", goal: "向客户交付并发起收款确认", status: "done" },
  ];

  const agents: ConsoleAgent[] = [
    { role: "conductor", status: "running" },
    { role: "operator", status: "running" },
    { role: "scout", status: "idle" },
    { role: "reviewer", status: "awaiting_approval" },
  ];

  const budget: ConsoleBudget = {
    month_cny: 50_000,
    spent_cny: 18_600,
    left_cny: 31_400,
    per_txn_cny: 15_000,
    project_budget: { month_cny: 20_000, spent_cny: 8_600, left_cny: 11_400 },
  };

  const evidence = new Map<string, ConsoleEvidence>([
    [
      "ev-001",
      { id: "ev-001", kind: "screenshot", path: "runs/run-20261023-101500-demo1/screenshots/007-homepage.png", confidence: "certain", captured_at: iso(-2 * DAY_MS) },
    ],
    [
      "ev-002",
      { id: "ev-002", kind: "report", path: "runs/run-20261023-101500-demo1/report.md", confidence: "certain", captured_at: iso(-2 * DAY_MS) },
    ],
    [
      "ev-003",
      { id: "ev-003", kind: "json", path: "runs/run-20261024-093000-demo2/reconcile-diff.json", confidence: "probable", captured_at: iso(-1 * DAY_MS) },
    ],
    [
      "ev-004",
      { id: "ev-004", kind: "log", path: "runs/run-20261022-140000-demo3/test.log", confidence: "certain", captured_at: iso(-3 * DAY_MS) },
    ],
    [
      "ev-005",
      { id: "ev-005", kind: "file", path: "runs/run-20261021-090000-demo3/invoices/checklist.md", confidence: "probable", captured_at: iso(-4 * DAY_MS) },
    ],
  ]);

  const timelines = new Map<string, ConsoleTimelineItem[]>([
    [
      "prj-001",
      [
        { ts: iso(-6 * DAY_MS), kind: "message", text: "客户确认官网改版范围与验收标准（3 个页面 + 移动端适配）" },
        { ts: iso(-5 * DAY_MS), kind: "task", text: "operator：完成首页与产品页静态改版" },
        { ts: iso(-3 * DAY_MS), kind: "evidence", text: "首页改版截图交付（1440×900）", evidence_ref: "ev-001" },
        { ts: iso(-2 * DAY_MS), kind: "delivery", text: "客户验收通过首页与产品页", evidence_ref: "ev-002" },
        { ts: iso(-1 * DAY_MS), kind: "task", text: "operator：移动端适配与表单校验修复中" },
        { ts: iso(-2 * HOUR_MS), kind: "risk", text: "审批卡 ap-001 等待批准：素材采购 ¥2,800.00（未批准不得执行）" },
      ],
    ],
    [
      "prj-002",
      [
        { ts: iso(-4 * DAY_MS), kind: "message", text: "客户提供 10 月对账单导出文件（CSV）" },
        { ts: iso(-2 * DAY_MS), kind: "task", text: "operator：导入对账单并生成差异清单" },
        { ts: iso(-1 * DAY_MS), kind: "evidence", text: "差异清单生成（3 条差异待客户确认）", evidence_ref: "ev-003" },
        { ts: iso(-3 * HOUR_MS), kind: "risk", text: "差异未闭环：暂停向客户发送新的对账结论" },
        { ts: iso(-1 * HOUR_MS), kind: "task", text: "scout：客户回访草稿已起草，等待审批（不发送）" },
      ],
    ],
    [
      "prj-003",
      [
        { ts: iso(-8 * DAY_MS), kind: "message", text: "客户委托整理 10 月发票并按客户归档" },
        { ts: iso(-6 * DAY_MS), kind: "task", text: "operator：整理 10 月发票并按客户归档" },
        { ts: iso(-4 * DAY_MS), kind: "evidence", text: "抽检 5 张发票与回执一致性通过", evidence_ref: "ev-005" },
        { ts: iso(-3 * DAY_MS), kind: "evidence", text: "交付自检日志（test.log）", evidence_ref: "ev-004" },
        { ts: iso(-2 * DAY_MS), kind: "delivery", text: "向客户交付并发起收款确认（已收款 ¥12,000.00）" },
      ],
    ],
  ]);

  const ledger: ConsoleLedgerEntry[] = [
    {
      id: "led-001",
      project_id: "prj-001",
      type: "支出",
      amount_cny: 2_800,
      payee_or_payer: "示例设计素材工作室（供应商）",
      basis: "审批卡 ap-001：官网素材采购（图标与插画包）",
      approved_by: "客户 王示例（书面确认）",
      receipt_ref: "rcpt-20261022-001",
      occurred_at: iso(-2 * DAY_MS),
    },
    {
      id: "led-002",
      project_id: "prj-001",
      type: "收入",
      amount_cny: 12_000,
      payee_or_payer: "杭州示例科技有限公司（客户）",
      basis: "合同 P1 第一期款（合同条款第 3 条）",
      approved_by: "conductor（依合同条款自动记账）",
      receipt_ref: "rcpt-20261020-002",
      occurred_at: iso(-5 * DAY_MS),
    },
    {
      id: "led-003",
      project_id: "prj-002",
      type: "支出",
      amount_cny: 3_800,
      payee_or_payer: "示例数据服务社（供应商）",
      basis: "对账数据清洗与格式转换（月度服务）",
      approved_by: "客户 李示例（邮件确认）",
      receipt_ref: "rcpt-20261023-003",
      occurred_at: iso(-1 * DAY_MS),
    },
    {
      id: "led-004",
      project_id: "prj-002",
      type: "收入",
      amount_cny: 8_000,
      payee_or_payer: "宁波示例贸易有限公司（客户）",
      basis: "对账自动化首期服务费（合同条款第 2 条）",
      approved_by: "conductor（依合同条款自动记账）",
      receipt_ref: "rcpt-20261021-004",
      occurred_at: iso(-4 * DAY_MS),
    },
    {
      id: "led-005",
      project_id: "prj-003",
      type: "支出",
      amount_cny: 12_000,
      payee_or_payer: "示例排版社（供应商）",
      basis: "发票整理外包排版费用（完工验收后付款）",
      approved_by: "客户 张示例（完工验收）",
      receipt_ref: "rcpt-20261019-005",
      occurred_at: iso(-7 * DAY_MS),
    },
  ];

  let approvals: ConsoleApproval[] = [
    {
      id: "ap-001",
      kind: "purchase",
      summary: "素材采购付款：图标与插画包（示例设计素材工作室）",
      amount_cny: 2_800,
      evidence_ids: ["ev-001"],
      expires_at: iso(2 * HOUR_MS),
      status: "pending",
    },
    {
      id: "ap-002",
      kind: "outreach",
      summary: "外发客户回访草稿（prj-002 宁波示例贸易客户，只发送摘要与链接）",
      evidence_ids: ["ev-003"],
      expires_at: iso(4 * HOUR_MS),
      status: "pending",
    },
    {
      id: "ap-003",
      kind: "payment",
      summary: "外包排版费用付款：prj-003 发票整理（示例排版社）",
      amount_cny: 12_000,
      evidence_ids: ["ev-005"],
      expires_at: iso(6 * HOUR_MS),
      status: "pending",
    },
  ];

  const approvalHistory: Array<{ id: string; decision: string; by: string; at: string; status: string }> = [];

  const pack: ConsoleTakeoverPack = {
    open_orders: [
      "prj-001 官网改版：移动端交付承诺 10-27 前完成（客户已确认）",
      "prj-002 对账自动化：10 月差异清单待客户确认（已催 1 次）",
    ],
    pending_threads: [
      "客户群 A：素材采购确认（最后消息 3 小时前）",
      "邮件：prj-003 发票抽检结果待回复（最后消息 1 天前）",
    ],
    payables: ["ap-001 素材采购 ¥2,800.00 待批准", "ap-003 排版外包 ¥12,000.00 待批准"],
    credentials: ["平台 B 登录凭据引用：vault://demo/platform-b（明文不落盘，需人工输入）"],
    risks: [
      "prj-002 存在 3 条对账差异未闭环，暂停新对外结论",
      "若 72 小时无人工接管，按墓碑规则停止新承诺",
      "近期 2 次验证码/风控拦截均已停止并交人（未绕过）",
    ],
    coverage: "partial",
  };

  let halted = false;
  let stoppedAt: string | null = null;
  let resumedAt: string | null = null;

  const monthly: ConsoleMonthlyReport = {
    month,
    income_cny: 32_000,
    cost_cny: 18_600,
    gross_margin_cny: 13_400,
    budget_left_cny: 31_400,
    compliance_events: [
      "未发生未经批准的对外承诺（0 次）",
      "2 次验证码/风控拦截 → 停止并交人，未绕过",
      "高风险动作默认拒绝：付款/外发均走审批卡",
    ],
    next_proposals: [
      "续签 prj-001 第二期（移动端 + 数据看板）",
      "把 prj-002 对账自动化扩展为月结服务",
      "为 prj-003 增加发票抽检复核（降低返工）",
    ],
    as_of: iso(0),
    coverage: "partial",
  };

  const clonePack = (): ConsoleTakeoverPack => ({
    ...pack,
    open_orders: [...pack.open_orders],
    pending_threads: [...pack.pending_threads],
    payables: [...pack.payables],
    credentials: [...pack.credentials],
    risks: [...pack.risks],
  });

  const cloneApproval = (approval: ConsoleApproval): ConsoleApproval => ({
    ...approval,
    evidence_ids: [...approval.evidence_ids],
  });

  const filterLedger = (filter?: ConsoleLedgerFilter): ConsoleLedgerEntry[] => {
    let rows = [...ledger];
    if (filter?.project_id !== undefined) rows = rows.filter((row) => row.project_id === filter.project_id);
    if (filter?.type !== undefined) rows = rows.filter((row) => row.type === filter.type);
    if (filter?.limit !== undefined && filter.limit > 0) rows = rows.slice(0, filter.limit);
    return rows.map((row) => ({ ...row }));
  };

  const statusOf = (): ConsoleTakeoverStatus => {
    let elapsedMs = 0;
    if (stoppedAt !== null) {
      const stoppedMs = Date.parse(stoppedAt);
      const endMs = halted ? Date.now() : resumedAt === null ? Date.now() : Date.parse(resumedAt);
      elapsedMs = Math.max(0, endMs - stoppedMs);
    }
    return {
      halted,
      stopped_at: stoppedAt,
      resumed_at: resumedAt,
      pack: stoppedAt === null ? null : clonePack(),
      elapsed_ms: elapsedMs,
    };
  };

  const formatCny = (value: number): string => {
    const fixed = Math.abs(Number(value) || 0).toFixed(2);
    const parts = fixed.split(".");
    const integer = (parts[0] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${value < 0 ? "-" : ""}¥${integer}.${parts[1] ?? "00"}`;
  };

  return {
    overview: () => ({
      asOf: iso(0),
      projects: projects.map((project) => ({ ...project })),
      tasks: tasks.map((task) => ({ ...task })),
      agents: agents.map((agent) => ({ ...agent })),
      budget: { ...budget, ...(budget.project_budget === undefined ? {} : { project_budget: { ...budget.project_budget } }) },
    }),
    projectTimeline: (projectId) => (timelines.get(projectId) ?? []).map((item) => ({ ...item })),
    ledger: (filter) => filterLedger(filter),
    ledgerFacts: (entryId) => {
      const entry = ledger.find((row) => row.id === entryId);
      if (entry === undefined) return null;
      return {
        amount_cny: entry.amount_cny,
        payee_or_payer: entry.payee_or_payer,
        basis: entry.basis,
        approved_by: entry.approved_by,
        receipt_ref: entry.receipt_ref,
        project_id: entry.project_id,
      };
    },
    approvals: () => approvals.map(cloneApproval),
    decideApproval: (id, decision, by) => {
      const approval = approvals.find((item) => item.id === id);
      if (approval === undefined) {
        return { ok: false, status: "not_found", reason: `审批不存在：${id}` };
      }
      if (approval.status !== "pending") {
        return { ok: false, status: approval.status, reason: `审批已处理：${approval.status}` };
      }
      const status = decision === "approve" ? "approved" : "rejected";
      approval.status = status;
      approvalHistory.push({ id, decision, by, at: iso(0), status });
      return {
        ok: true,
        status,
        reason: decision === "approve" ? "已批准（允许执行，执行人仍须留证）" : "已驳回（不得执行）",
      };
    },
    takeover: (reason, by) => {
      if (!halted) {
        halted = true;
        stoppedAt = iso(0);
        resumedAt = null;
        approvalHistory.push({ id: `takeover:${reason}`, decision: "takeover", by, at: stoppedAt, status: "halted" });
      }
      return { stopped_at: stoppedAt ?? iso(0), halted, pack: clonePack() };
    },
    monthlyReport: () => ({
      ...monthly,
      compliance_events: [...monthly.compliance_events],
      next_proposals: [...monthly.next_proposals],
    }),
    summary: (level) => {
      const base = {
        level,
        as_of: iso(0),
        halted,
        projects: projects.length,
        pending_approvals: approvals.filter((approval) => approval.status === "pending").length,
        budget_left_cny: budget.left_cny,
      };
      if (level === "L0") {
        return {
          ...base,
          one_liner: `本月 ${projects.length} 个项目；待批 ${base.pending_approvals} 张；预算余量 ${formatCny(budget.left_cny)}`,
        };
      }
      if (level === "L1") {
        return {
          ...base,
          items: projects.map((project) => `${project.name}（${project.status}，进度 ${project.progress}%）`),
        };
      }
      return {
        ...base,
        detail: {
          projects: projects.map((project) => ({ ...project })),
          tasks: tasks.map((task) => ({ ...task })),
          agents: agents.map((agent) => ({ ...agent })),
        },
      };
    },
    takeoverStatus: statusOf,
    resume: (by) => {
      if (halted) {
        halted = false;
        resumedAt = iso(0);
        approvalHistory.push({ id: "takeover:resume", decision: "resume", by, at: resumedAt, status: "running" });
      }
      return { resumed_at: resumedAt, halted };
    },
    evidenceDetail: (ref) => {
      const found = evidence.get(ref);
      return found === undefined ? null : { ...found };
    },
  };
}
