/**
 * 阶段二 P1-A / 经营域引擎单元测试（≥18 条）。
 *
 * 全部使用 mkdtemp 临时目录或 `{persist:false}` 内存模式；不写仓库 runs/、不联网、无真实资金动作。
 * 覆盖：委托（创建/过期/吊销）、选题（来源/超预算/转人工/排序）、预算三层、项目/任务/证据、
 * 账本 6 要素与防重复、承诺追溯（B5）、审批（超时不自动放行）、接管/恢复（B6）、
 * 月报对账、边界规则 ≥12 条 + 四类越界 100% deny（B7）、仿真业务线端到端、置信度/墓碑、事件日志追加。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOUNDARY_RULES,
  BoundaryDeniedError,
  DEFAULT_BUSINESS_LINES,
  DEFAULT_CUSTOMER_INQUIRY,
  DomainEngine,
  DomainValidationError,
  SystemHaltedError,
  boundaryRuleCount,
  evaluateBoundary,
  listBoundaryRules,
} from "../../dist/packages/steward-domain/src/index.js";

const FIXED_ISO = "2026-10-25T08:00:00.000Z";
const MONTH = "2026-10";

/** 可推进的固定时钟（审批过期/委托过期用）。 */
function fixedClock(iso = FIXED_ISO) {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    advanceMs(ms) {
      current = new Date(current.getTime() + ms);
    },
    set(nextIso) {
      current = new Date(nextIso);
      return current;
    },
    iso: () => current.toISOString(),
  };
}

function makeEngine(options = {}) {
  return new DomainEngine({ persist: false, ...options });
}

async function makeTmpRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/** 一条合格业务线（有来源、在预算内、无需资质/线下）。 */
function makeLine(overrides = {}) {
  return {
    id: "bl-test-automation",
    name: "测试业务线：重复流程自动化",
    who_pays: "中小商家",
    quote_cny: 12_000,
    cost_cny: 3_000,
    gross_margin: 9_000,
    worst_case_cny: 5_000,
    sources: [
      { title: "公开需求讨论（示例来源）", url: "https://example.com/sources/demand-1" },
      { title: "同类服务报价参考（示例来源）", url: "https://example.com/sources/pricing-1" },
    ],
    risks: ["需求可能变化"],
    requires_offline: false,
    requires_license: false,
    certainty: "certain",
    delivery_days: 10,
    ...overrides,
  };
}

/** 默认委托：月 5 万 / 项目 2 万 / 单笔 5 千。 */
function makeMandate(engine, overrides = {}) {
  return engine.createMandate({
    principal: "本人",
    scope: ["承接无需资质的软件/自动化小额订单", "对外报价、交付与收款须经本人审批后执行"],
    valid_to: "2027-12-31T00:00:00.000Z",
    budget_limits: { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000 },
    prohibited: ["借用资质", "陌生外呼"],
    ...overrides,
  });
}

/** 建一条项目（先在引擎里登记业务线）。 */
function makeProject(engine, options = {}) {
  const proposal = engine.proposeBusinessLines([makeLine(options.lineOverrides ?? {})], {
    budget_cny: options.budget_cny ?? 50_000,
    days: options.days ?? 30,
  });
  const line = proposal.ranked[0];
  assert.ok(line, "业务线应通过校验");
  return engine.createProject(line);
}

function readEvents(root) {
  const file = join(root, "domain", "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// 1) 委托（Mandate）
// ---------------------------------------------------------------------------

test("mandate：createMandate 后 activeMandate 返回同一条，字段完整", () => {
  const engine = makeEngine();
  const mandate = makeMandate(engine);
  assert.equal(mandate.status, "active");
  assert.equal(mandate.principal, "本人");
  assert.equal(mandate.scope.length, 2);
  assert.deepEqual(mandate.budget_limits, { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000 });
  assert.equal(mandate.confidence, "certain");
  assert.equal(mandate.valid_from < mandate.valid_to, true);
  const active = engine.activeMandate();
  assert.ok(active !== null);
  assert.equal(active.id, mandate.id);
});

test("mandate：超过 valid_to 不再生效（状态自动置 expired）", () => {
  const clock = fixedClock();
  const engine = makeEngine({ now: clock.now });
  makeMandate(engine, { valid_from: FIXED_ISO, valid_to: "2026-10-26T00:00:00.000Z" });
  assert.ok(engine.activeMandate() !== null);
  clock.advanceMs(3 * 24 * 60 * 60 * 1000);
  assert.equal(engine.activeMandate(), null);
  assert.throws(() => engine.revokeMandate("已过期"), (error) => error instanceof DomainValidationError);
});

test("mandate：revokeMandate 后 active 为空、状态 revoked 且保留理由", () => {
  const engine = makeEngine({ now: () => new Date(FIXED_ISO) });
  const mandate = makeMandate(engine);
  const revoked = engine.revokeMandate("测试吊销：终止授权");
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revoked_reason, "测试吊销：终止授权");
  assert.equal(revoked.revoked_at, FIXED_ISO);
  assert.equal(engine.activeMandate(), null);
  assert.throws(() => engine.revokeMandate("再吊销"), (error) => error instanceof DomainValidationError);
  // 新建委托自动替代旧委托
  const second = makeMandate(engine, { principal: "本人（二次授权）" });
  assert.equal(second.status, "active");
  assert.equal(engine.activeMandate().id, second.id);
});

test("mandate：非法输入（空 principal / 预算三层顺序错误）抛 DomainValidationError", () => {
  const engine = makeEngine();
  assert.throws(
    () => engine.createMandate({ principal: "", scope: ["x"], budget_limits: { month_cny: 1, project_cny: 1, per_txn_cny: 1 } }),
    (error) => error instanceof DomainValidationError,
  );
  assert.throws(
    () =>
      engine.createMandate({
        principal: "本人",
        scope: ["x"],
        budget_limits: { month_cny: 100, project_cny: 200, per_txn_cny: 500 },
      }),
    /单笔 ≤ 项目 ≤ 月/,
  );
});

// ---------------------------------------------------------------------------
// 2) 选题提案（B1）
// ---------------------------------------------------------------------------

test("proposal：三条带来源业务线输出提案，按毛利/确定性排序", () => {
  const engine = makeEngine();
  const result = engine.proposeBusinessLines(DEFAULT_BUSINESS_LINES, { budget_cny: 50_000, days: 30 });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.needs_human.length, 0);
  assert.ok(result.proposal !== null, "≥3 条必须输出 proposal");
  assert.equal(result.proposal.lines.length, 3);
  assert.equal(result.proposal.total_quote_cny, 50_000);
  assert.equal(result.proposal.total_cost_cny, 14_000);
  assert.equal(result.proposal.expected_margin_cny, 36_000);
  assert.ok(result.proposal.summary.includes("30 天"));
  // 排序：毛利率降序（同率再看确定性/毛利）
  for (let index = 0; index + 1 < result.ranked.length; index++) {
    assert.ok(
      result.ranked[index].gross_margin_rate >= result.ranked[index + 1].gross_margin_rate - 1e-9,
      "ranked 必须按毛利率降序",
    );
  }
  for (const line of result.accepted) {
    assert.ok(line.sources.length >= 1);
    assert.ok(line.sources.every((source) => source.title.length > 0 && /^https?:/u.test(source.url)));
    assert.equal(line.gross_margin, line.quote_cny - line.cost_cny);
  }
  assert.ok(engine.businessLines().length >= 3);
});

test("proposal：缺来源丢弃并记原因；超预算拒绝；需资质/线下转人工", () => {
  const engine = makeEngine();
  const lines = [
    makeLine({ id: "bl-no-source", name: "无来源业务线", sources: [] }),
    makeLine({
      id: "bl-bad-url",
      name: "来源不可打开业务线",
      sources: [{ title: "坏链接", url: "ftp://example.com/x" }],
    }),
    makeLine({ id: "bl-over-budget", name: "超预算业务线", quote_cny: 90_000, cost_cny: 60_000 }),
    makeLine({ id: "bl-over-days", name: "超周期业务线", delivery_days: 90 }),
    makeLine({ id: "bl-license", name: "需资质业务线", requires_license: true }),
    makeLine({ id: "bl-offline", name: "需线下业务线", requires_offline: true }),
    makeLine({ id: "bl-ok", name: "唯一合格业务线" }),
  ];
  const result = engine.proposeBusinessLines(lines, { budget_cny: 50_000, days: 30 });
  assert.equal(result.accepted.length, 1, "只有 bl-ok 通过");
  assert.equal(result.accepted[0].id, "bl-ok");
  assert.equal(result.proposal, null, "不足 3 条不输出 proposal");

  const categories = result.rejected.map((item) => item.category);
  assert.ok(categories.filter((category) => category === "missing_source").length === 2, "缺来源/来源不可打开各 1");
  assert.ok(categories.filter((category) => category === "over_budget").length === 2, "成本超预算/周期超窗口各 1");
  assert.equal(result.needs_human.length, 2);
  assert.deepEqual(
    result.needs_human.map((item) => item.id).sort(),
    ["bl-license", "bl-offline"],
  );
  for (const item of [...result.rejected, ...result.needs_human]) {
    assert.ok(item.reason.length >= 8, `拒绝原因必须可读：${JSON.stringify(item)}`);
  }
});

// ---------------------------------------------------------------------------
// 3) 预算三层
// ---------------------------------------------------------------------------

test("budget：单笔/项目/月三层任一超限都拒绝，且 requiresHumanApproval=true", () => {
  const clock = fixedClock();
  const engine = makeEngine({ now: clock.now });
  makeMandate(engine);
  const projectA = makeProject(engine);
  const projectB = makeProject(engine);
  const projectC = makeProject(engine);

  // 单笔层：6000 > 单笔 5000
  const perTxn = engine.checkBudget("expense", 6_000, projectA.id);
  assert.equal(perTxn.allowed, false);
  assert.equal(perTxn.layer, "per_txn");
  assert.equal(perTxn.requiresHumanApproval, true);
  assert.match(perTxn.reason, /单笔额度超限/u);

  // 项目层：A 已占用 16000，再申请 4500 → 20500 > 项目 20000
  for (let index = 0; index < 4; index++) {
    assert.equal(engine.checkBudget("expense", 4_000, projectA.id).allowed, true);
  }
  const projectLayer = engine.checkBudget("expense", 4_500, projectA.id);
  assert.equal(projectLayer.allowed, false);
  assert.equal(projectLayer.layer, "project");
  assert.equal(projectLayer.requiresHumanApproval, true);
  assert.match(projectLayer.reason, /项目额度超限/u);

  // 月层：A 16000 + B 20000 + C 13500 = 49500，再 4500 → 54000 > 月 50000
  for (let index = 0; index < 4; index++) assert.equal(engine.checkBudget("expense", 5_000, projectB.id).allowed, true);
  assert.equal(engine.checkBudget("expense", 4_500, projectC.id).allowed, true);
  assert.equal(engine.checkBudget("expense", 4_500, projectC.id).allowed, true);
  assert.equal(engine.checkBudget("expense", 4_500, projectC.id).allowed, true);
  const monthLayer = engine.checkBudget("expense", 4_500, projectC.id);
  assert.equal(monthLayer.allowed, false);
  assert.equal(monthLayer.layer, "month");
  assert.equal(monthLayer.requiresHumanApproval, true);
  assert.match(monthLayer.reason, /月额度超限/u);

  const snapshot = engine.budgetSnapshot();
  assert.equal(snapshot.month_key, MONTH);
  assert.equal(snapshot.month_spent_cny, 49_500);
  assert.equal(snapshot.month_left_cny, 500);
});

test("budget：通过时记录消耗并返回剩余额度；无委托时拒绝支出", () => {
  const engine = makeEngine();
  const noMandate = engine.checkBudget("expense", 100);
  assert.equal(noMandate.allowed, false);
  assert.match(noMandate.reason, /委托/u);

  makeMandate(engine);
  const project = makeProject(engine);
  const ok = engine.checkBudget("payment", 3_000, project.id);
  assert.equal(ok.allowed, true);
  assert.equal(ok.requiresHumanApproval, false);
  assert.equal(ok.remaining.month_cny, 47_000);
  assert.equal(ok.remaining.project_cny, 17_000);
  assert.throws(() => engine.checkBudget("expense", 0), (error) => error instanceof DomainValidationError);
  assert.throws(() => engine.checkBudget("expense", -1), (error) => error instanceof DomainValidationError);
});

// ---------------------------------------------------------------------------
// 4) 项目 / 任务 / 证据
// ---------------------------------------------------------------------------

test("project/task：创建→任务→带证据完成→时间线，重复完成幂等", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  assert.equal(project.status, "active");
  assert.equal(project.timeline.length, 1);
  assert.equal(project.timeline[0].kind, "created");

  const task = engine.addTask({ project_id: project.id, agent_role: "developer", goal: "交付可运行 demo" });
  assert.equal(task.status, "pending");
  assert.equal(task.agent_role, "developer");

  const done = engine.completeTask(task.id, [
    { kind: "delivery", path: "runs/sim/delivery.zip", note: "交付物", confidence: "certain" },
    { kind: "commit", path: "runs/sim/commit.txt", note: "提交记录" },
  ]);
  assert.equal(done.status, "done");
  assert.equal(done.evidence.length, 2);
  assert.ok(done.completed_at !== undefined);

  const again = engine.completeTask(task.id, [{ kind: "log", path: "another.log" }]);
  assert.deepEqual(again.evidence, done.evidence, "重复完成不应重复登记证据");

  const timeline = engine.projectTimeline(project.id);
  assert.ok(timeline.some((entry) => entry.kind === "task"));
  const evidence = engine.evidence({ project_id: project.id });
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every((item) => item.project_id === project.id));
  assert.throws(() => engine.projectTimeline("prj-not-exist"), (error) => error instanceof DomainValidationError);
});

test("confidence/墓碑：证据墓碑默认隐藏，项目墓碑后 L1 摘要不含但账本保留", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  const evidence = engine.addEvidence(project.id, { kind: "screenshot", path: "runs/sim/shot.png", note: "截图" });
  assert.equal(engine.evidence({ project_id: project.id }).length, 1);
  const tomb = engine.tombstoneEvidence(evidence.id, "过期证据");
  assert.equal(tomb.confidence, "tombstone");
  assert.equal(engine.evidence({ project_id: project.id }).length, 0, "默认视图不应展示墓碑证据");
  assert.equal(engine.evidence({ project_id: project.id, include_tombstone: true }).length, 1);

  const income = engine.recordLedger({
    project_id: project.id,
    type: "income",
    amount_cny: 1_000,
    payee_or_payer: project.client,
    basis: "验收单",
    approved_by: "本人",
    receipt_ref: "receipt-tomb-1",
  });
  const tombstonedProject = engine.tombstoneProject(project.id, "客户取消");
  assert.equal(tombstonedProject.status, "tombstoned");
  assert.equal(tombstonedProject.confidence, "tombstone");
  assert.equal(engine.summaries().L1.length, 0, "墓碑项目不进 L1");
  assert.ok(engine.ledger({ project_id: project.id }).some((entry) => entry.id === income.id), "账本历史必须保留");
});

// ---------------------------------------------------------------------------
// 5) 账本（6 要素 / 防重复）
// ---------------------------------------------------------------------------

test("ledger：6 要素完整（金额/收付方/依据/审批人/回执/项目）且可导出 CSV", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  const entry = engine.recordLedger({
    project_id: project.id,
    type: "income",
    amount_cny: 12_000,
    payee_or_payer: project.client,
    basis: "验收单 + 交付证据",
    approved_by: "本人",
    receipt_ref: "receipt-001",
  });
  const facts = engine.ledgerEntryFacts(entry.id);
  assert.equal(facts.amount_cny, 12_000);
  assert.equal(facts.payee_or_payer, project.client);
  assert.equal(facts.basis, "验收单 + 交付证据");
  assert.equal(facts.approved_by, "本人");
  assert.equal(facts.receipt_ref, "receipt-001");
  assert.equal(facts.project_id, project.id);

  assert.equal(engine.ledger({ project_id: project.id }).length, 1);
  assert.equal(engine.ledger({ type: "income" }).length, 1);
  assert.equal(engine.ledger({ month: MONTH }).length, 1);
  const csv = engine.exportLedgerCsv();
  assert.match(csv, /^entry_id,project_id,type,amount_cny,payee_or_payer,basis,approved_by,receipt_ref,occurred_at,confidence/u);
  assert.ok(csv.includes("receipt-001"));
  assert.ok(csv.includes("12000.00"));
});

test("ledger：缺依据/审批人/回执/项目关联一律抛 DomainValidationError；重复回执拒绝", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  const base = {
    project_id: project.id,
    type: "expense",
    amount_cny: 500,
    payee_or_payer: "供应商",
    basis: "采购单",
    approved_by: "本人",
    receipt_ref: "receipt-x",
  };
  assert.throws(() => engine.recordLedger({ ...base, basis: "" }), (error) => error instanceof DomainValidationError);
  assert.throws(() => engine.recordLedger({ ...base, approved_by: "" }), (error) => error instanceof DomainValidationError);
  assert.throws(() => engine.recordLedger({ ...base, receipt_ref: "" }), (error) => error instanceof DomainValidationError);
  assert.throws(
    () => engine.recordLedger({ ...base, project_id: "prj-not-exist" }),
    (error) => error instanceof DomainValidationError,
  );
  assert.equal(engine.recordLedger(base).amount_cny, 500);
  assert.throws(
    () => engine.recordLedger({ ...base }),
    (error) => error instanceof DomainValidationError && error.code === "DUPLICATE",
  );
  // 显式允许重复（如补记不同凭证场景）时才放行
  assert.equal(engine.recordLedger({ ...base, allow_duplicate: true }).amount_cny, 500);
  assert.equal(engine.ledger({ project_id: project.id }).length, 2);
});

// ---------------------------------------------------------------------------
// 6) 承诺追溯（B5）
// ---------------------------------------------------------------------------

test("promise：授权承诺可追溯「对话原文 → 授权条款 → 项目」", () => {
  const engine = makeEngine();
  const clause = "对外报价、交付与收款须经本人审批后执行";
  makeMandate(engine, { scope: [clause, "承接无需资质的软件/自动化小额订单"] });
  const project = makeProject(engine);
  const promise = engine.recordPromise(project.id, "承诺本周五前交付第一版 demo", "msg-20261025-001", clause);
  assert.equal(promise.status, "authorized");
  assert.equal(promise.source_message_id, "msg-20261025-001");
  const trace = engine.tracePromise(promise.id);
  assert.equal(trace.authorized, true);
  assert.equal(trace.source_message_id, "msg-20261025-001");
  assert.equal(trace.mandate_clause, clause);
  assert.ok(trace.mandate_id !== undefined);
  assert.equal(trace.chain.length, 3);
  assert.match(trace.chain[0], /对话原文/u);
  assert.match(trace.chain[1], /委托条款/u);
});

test("promise：找不到或未授权承诺返回 {authorized:false, reason:'未授权'}（B5）", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  assert.deepEqual(engine.tracePromise("prm-not-exist"), { authorized: false, reason: "未授权" });
  // 授权条款不在委托范围内 → 记录为 unauthorized，追溯也是未授权
  const untrusted = engine.recordPromise(project.id, "承诺给客户打八折", "msg-002", "随意打折条款");
  assert.equal(untrusted.status, "unauthorized");
  const trace = engine.tracePromise(untrusted.id);
  assert.equal(trace.authorized, false);
  assert.equal(trace.reason, "未授权");
  // 缺少对话原文/授权条款 → 拒绝记录
  assert.throws(
    () => engine.recordPromise(project.id, "随便承诺", "", "条款"),
    (error) => error instanceof DomainValidationError,
  );
  assert.throws(
    () => engine.recordPromise(project.id, "随便承诺", "msg-003", ""),
    (error) => error instanceof DomainValidationError,
  );
});

test("promise：委托吊销后已授权承诺追溯显示未授权（委托已失效）", () => {
  const engine = makeEngine();
  const clause = "对外报价、交付与收款须经本人审批后执行";
  makeMandate(engine, { scope: [clause] });
  const project = makeProject(engine);
  const promise = engine.recordPromise(project.id, "承诺下周交付", "msg-004", clause);
  assert.equal(promise.status, "authorized");
  engine.revokeMandate("吊销测试");
  const trace = engine.tracePromise(promise.id);
  assert.equal(trace.authorized, false);
  assert.match(trace.reason, /委托已失效/u);
});

// ---------------------------------------------------------------------------
// 7) 审批（超时挂起不自动放行）
// ---------------------------------------------------------------------------

test("approval：pending → approve / reject，队列与决策人记录正确", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const card = engine.createApprovalCard({ kind: "quote", summary: "对外报价 ¥12,000", amount_cny: 12_000 });
  assert.equal(card.status, "pending");
  assert.deepEqual(card.options, ["approve", "reject"]);
  assert.ok(card.expires_at > card.created_at);
  assert.equal(engine.approvalQueue().length, 1);

  const approved = engine.decideApproval(card.id, "approve", "本人");
  assert.equal(approved.status, "approved");
  assert.equal(approved.decided_by, "本人");
  assert.ok(approved.decided_at !== undefined);
  assert.equal(engine.approvalQueue().length, 0);
  assert.throws(() => engine.decideApproval(card.id, "reject", "本人"), /已决策/u);

  const card2 = engine.createApprovalCard({ kind: "payment", summary: "付供应商 ¥800", amount_cny: 800 });
  const rejected = engine.decideApproval(card2.id, "reject", "本人");
  assert.equal(rejected.status, "rejected");
  assert.throws(() => engine.decideApproval("apr-not-exist", "approve", "本人"), /审批卡不存在/u);
});

test("approval：超时后 approve 返回 expired（不自动放行），队列剔除", () => {
  const clock = fixedClock();
  const engine = makeEngine({ now: clock.now });
  makeMandate(engine);
  const card = engine.createApprovalCard({ kind: "payment", summary: "付款 ¥5,000", amount_cny: 5_000, ttl_hours: 1 });
  assert.equal(engine.approvalQueue().length, 1);
  clock.advanceMs(2 * 60 * 60 * 1000);
  const queued = engine.approvalQueue();
  assert.equal(queued.length, 0, "超时卡不得留在待审批队列");
  assert.equal(engine.getApproval(card.id).status, "expired");

  const another = engine.createApprovalCard({ kind: "contract", summary: "签合同" });
  clock.advanceMs(48 * 60 * 60 * 1000);
  const decision = engine.decideApproval(another.id, "approve", "本人");
  assert.equal(decision.status, "expired", "超时后 approve 必须返回 expired，而不是放行");
  assert.equal(engine.getApproval(another.id).status, "expired");
});

// ---------------------------------------------------------------------------
// 8) 接管键 / 接管包 / resume（B6）
// ---------------------------------------------------------------------------

test("takeover：接管后所有写操作抛 SystemHaltedError，接管包含 6 类字段", () => {
  const engine = makeEngine({ credentials: ["env:DEMO_API_KEY", "file:./secrets/demo-token.txt"] });
  makeMandate(engine);
  const project = makeProject(engine);
  const task = engine.addTask({ project_id: project.id, agent_role: "developer", goal: "交付 demo" });
  engine.recordLedger({
    project_id: project.id,
    type: "income",
    amount_cny: 100,
    payee_or_payer: project.client,
    basis: "验收单",
    approved_by: "本人",
    receipt_ref: "receipt-takeover",
  });
  engine.createApprovalCard({ kind: "payment", summary: "待付款 ¥900", amount_cny: 900 });
  engine.recordPromise(project.id, "承诺交付", "msg-t1", "对外报价、交付与收款须经本人审批后执行");

  const startedAt = Date.now();
  const pack = engine.takeover("人工接管演练", "owner");
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 10_000, `接管必须 10 秒内生效，实际 ${elapsed}ms`);
  assert.equal(engine.isHalted, true);
  for (const field of ["open_orders", "pending_threads", "payables", "credentials", "risks"]) {
    assert.ok(field in pack, `接管包必须有 ${field}`);
    assert.ok(Array.isArray(pack[field]), `${field} 必须是数组`);
  }
  assert.ok("coverage" in pack, "接管包必须有 coverage");
  assert.ok(["complete", "partial", "not_covered"].includes(pack.coverage));
  assert.deepEqual(pack.credentials, ["env:DEMO_API_KEY", "file:./secrets/demo-token.txt"]);
  assert.ok(pack.credentials.every((ref) => !/(?:sk-|password|明文)/u.test(ref)), "凭据只放引用");
  assert.ok(pack.open_orders.length >= 1);
  assert.ok(pack.risks.some((risk) => risk.includes("接管")));
  assert.equal(engine.lastTakeoverPack.generated_at, pack.generated_at);

  // 接管态：所有写操作抛 SystemHaltedError
  assert.throws(() => engine.createProject(project.name), (error) => error instanceof SystemHaltedError);
  assert.throws(
    () => engine.createMandate({ principal: "x", scope: ["y"], budget_limits: { month_cny: 1, project_cny: 1, per_txn_cny: 1 } }),
    (error) => error instanceof SystemHaltedError,
  );
  assert.throws(() => engine.addTask({ project_id: project.id, agent_role: "developer", goal: "不应执行" }), (error) => error instanceof SystemHaltedError);
  assert.throws(
    () =>
      engine.recordLedger({
        project_id: project.id,
        type: "expense",
        amount_cny: 1,
        payee_or_payer: "x",
        basis: "y",
        approved_by: "z",
        receipt_ref: "r",
      }),
    (error) => error instanceof SystemHaltedError,
  );
  assert.throws(() => engine.createApprovalCard({ kind: "payment", summary: "x" }), (error) => error instanceof SystemHaltedError);
  assert.throws(() => engine.decideApproval("any", "approve", "owner"), (error) => error instanceof SystemHaltedError);
  assert.throws(() => engine.recordPromise(project.id, "x", "m", "c"), (error) => error instanceof SystemHaltedError);
  assert.throws(() => engine.completeTask(task.id, []), (error) => error instanceof SystemHaltedError);
  assert.throws(() => engine.checkBudget("expense", 100, project.id), (error) => error instanceof SystemHaltedError);
  assert.throws(() => engine.revokeMandate("x"), (error) => error instanceof SystemHaltedError);
  // 只读/安全咨询仍可用（便于解释为什么停）
  assert.equal(engine.checkBoundary({ kind: "other", text: "普通经营咨询" }).decision, "allow");
  assert.equal(engine.approvalQueue().length, 1);
});

test("takeover/resume：resume 后写操作恢复，接管记录在案", () => {
  const engine = makeEngine({ credentials: ["env:DEMO"] });
  makeMandate(engine);
  const project = makeProject(engine);
  engine.takeover("演练", "owner");
  assert.equal(engine.isHalted, true);
  engine.resume("owner");
  assert.equal(engine.isHalted, false);
  const task = engine.addTask({ project_id: project.id, agent_role: "developer", goal: "恢复后继续" });
  assert.equal(task.status, "pending");
  assert.ok(engine.projectTimeline(project.id).some((entry) => entry.kind === "takeover"));
  assert.ok(engine.projectTimeline(project.id).some((entry) => entry.kind === "resume"));
});

// ---------------------------------------------------------------------------
// 9) 月报（对账）与三层摘要
// ---------------------------------------------------------------------------

test("月报：收支/毛利/预算余量/合规事件与账本和预算消耗一致", () => {
  const clock = fixedClock();
  const engine = makeEngine({ now: clock.now });
  makeMandate(engine);
  const project = makeProject(engine);
  engine.recordLedger({
    project_id: project.id,
    type: "income",
    amount_cny: 12_000,
    payee_or_payer: project.client,
    basis: "验收单",
    approved_by: "本人",
    receipt_ref: "receipt-m-1",
  });
  engine.recordLedger({
    project_id: project.id,
    type: "expense",
    amount_cny: 3_000,
    payee_or_payer: "云服务商",
    basis: "服务订阅",
    approved_by: "本人",
    receipt_ref: "receipt-m-2",
  });
  engine.checkBudget("expense", 2_000, project.id);
  engine.checkBoundary({ kind: "payment", text: "给陌生供应商转账", amount_cny: 9_999 });

  const report = engine.buildMonthlyReport(MONTH);
  assert.equal(report.month, MONTH);
  assert.equal(report.income_cny, 12_000);
  assert.equal(report.cost_cny, 3_000);
  assert.equal(report.gross_margin_cny, 9_000);
  assert.equal(report.gross_margin_rate, 0.75);
  assert.equal(report.budget_left_cny, 48_000, "预算余量 = 月额度 50000 - 已消耗 2000");
  assert.equal(report.coverage, "complete");
  assert.ok(report.compliance_events.length >= 1);
  assert.ok(report.compliance_events[0].includes("B-"));
  assert.equal(report.as_of, FIXED_ISO);
  assert.throws(() => engine.buildMonthlyReport("2026-13"), (error) => error instanceof DomainValidationError);
});

test("summaries：L0 动作卡 / L1 项目摘要 / L2 月报结构完整；接管后 L0 有 critical 卡", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const project = makeProject(engine);
  engine.addTask({ project_id: project.id, agent_role: "developer", goal: "待办任务" });
  engine.createApprovalCard({ kind: "quote", summary: "待审批报价", amount_cny: 1_000 });
  const bundle = engine.summaries();
  assert.equal(typeof bundle.generated_at, "string");
  assert.ok(Array.isArray(bundle.L0) && bundle.L0.length >= 1);
  assert.ok(bundle.L0.every((card) => ["info", "warn", "critical"].includes(card.severity)));
  assert.ok(bundle.L0.some((card) => card.kind === "approval"));
  assert.equal(bundle.L1.length, 1);
  assert.equal(bundle.L1[0].project_id, project.id);
  assert.equal(bundle.L1[0].open_tasks, 1);
  assert.equal(bundle.L2.month, MONTH);

  engine.takeover("摘要接管", "owner");
  const haltedBundle = engine.summaries();
  assert.ok(haltedBundle.L0.some((card) => card.kind === "takeover" && card.severity === "critical"));
});

// ---------------------------------------------------------------------------
// 10) 边界规则（B7）
// ---------------------------------------------------------------------------

test("boundary：个人模式 ≥12 条规则，字段完整且 rule_id 唯一", () => {
  const engine = makeEngine();
  const rules = engine.boundaryRules("personal");
  assert.ok(rules.length >= 12, `个人模式规则应 ≥12 条，实际 ${rules.length}`);
  assert.equal(engine.boundaryRuleTotal(), boundaryRuleCount());
  assert.equal(BOUNDARY_RULES.length, engine.boundaryRuleTotal());
  assert.ok(listBoundaryRules("personal").length >= 12);
  const ids = new Set();
  for (const rule of rules) {
    assert.ok(rule.rule_id.length > 0);
    assert.ok(rule.trigger.length > 0);
    assert.ok(["deny", "human", "draft_only"].includes(rule.must));
    assert.ok(rule.user_message.length >= 8, `规则 ${rule.rule_id} 的用户文案必须可读`);
    assert.ok(["personal", "enterprise", "both"].includes(rule.mode));
    assert.ok(rule.test_case_id.length > 0);
    assert.ok(!ids.has(rule.rule_id), `rule_id 重复：${rule.rule_id}`);
    ids.add(rule.rule_id);
  }
  // 四类越界规则必须在个人模式内且 must=deny
  for (const ruleId of ["B-01", "B-02", "B-03", "B-04"]) {
    const rule = rules.find((item) => item.rule_id === ruleId);
    assert.ok(rule !== undefined, `缺少四类越界规则 ${ruleId}`);
    assert.equal(rule.must, "deny");
  }
});

test("boundary：四类越界请求 100% deny、理由可读且留痕（B7）", async () => {
  const root = await makeTmpRoot("steward-domain-boundary-");
  try {
    const engine = new DomainEngine({ root, now: () => new Date(FIXED_ISO) });
    makeMandate(engine);
    const variants = [
      { name: "无证业务-1", request: { kind: "business_scope", text: "帮客户代办需要经营许可证的业务", requires_license: true } },
      { name: "无证业务-2", request: { kind: "other", text: "做二类医疗器械销售业务", requires_license: true } },
      { name: "借用资质-1", request: { kind: "other", text: "借用朋友的营业执照去接单" } },
      { name: "借用资质-2", request: { kind: "business_scope", text: "挂靠一家公司资质投标" } },
      { name: "借用资质-3", request: { kind: "other", text: "租用一张资质证书应付检查" } },
      { name: "陌生外呼-1", request: { kind: "outreach", text: "从买来的名单里挑陌生客户打电话", is_unknown_outreach: true } },
      { name: "陌生外呼-2", request: { kind: "other", text: "购买名单做陌生外呼", is_unknown_outreach: true } },
      { name: "超预算-1", request: { kind: "payment", text: "给供应商付款", amount_cny: 6_000 } },
      { name: "超预算-2", request: { kind: "expense", text: "采购设备", amount_cny: 60_000 } },
    ];
    for (const variant of variants) {
      const result = engine.checkBoundary(variant.request);
      assert.equal(result.decision, "deny", `${variant.name} 必须 deny`);
      assert.match(result.rule_id, /^B-0[1-4]$/u, `${variant.name} 命中四类拒绝规则，实际 ${result.rule_id}`);
      assert.ok(result.user_message.length >= 10, `${variant.name} 拒绝理由必须可读`);
      assert.equal(typeof result.user_message, "string");
    }

    const report = engine.buildMonthlyReport(MONTH);
    assert.ok(report.compliance_events.length >= variants.length, "月报合规事件应逐条留痕");
    const events = readEvents(root);
    const deniedEvents = events.filter((event) => event.action === "boundary.check" && event.result === "denied");
    assert.equal(deniedEvents.length, variants.length, "events.jsonl 应逐条追加拒绝事件");
    const raw = readFileSync(join(root, "domain", "events.jsonl"), "utf8");
    assert.ok(!raw.includes("借用朋友的营业执照"), "事件里不应出现未脱敏的原文");
    assert.ok(raw.includes("kind="), "事件应包含可审计的操作信息");

    // assertRequestAllowed 在 deny 时抛 BoundaryDeniedError
    assert.throws(
      () => engine.assertRequestAllowed({ kind: "other", text: "借用别人资质" }),
      (error) => error instanceof BoundaryDeniedError && error.rule_id === "B-02",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary：支付/退款/合同/权限转人工，验证码类必须 human，报价/触达仅草稿，普通请求 allow", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const cases = [
    [{ kind: "payment", text: "给客户打款" }, "human"],
    [{ kind: "refund", text: "给客户退款 500" }, "human"],
    [{ kind: "contract", text: "签合同并盖章" }, "human"],
    [{ kind: "account_permission", text: "修改管理员密码" }, "human"],
    [{ kind: "captcha", text: "登录需要短信验证码" }, "human"],
    [{ kind: "other", text: "需要人脸识别认证" }, "human"],
    [{ kind: "quote", text: "给客户报价 12000" }, "draft_only"],
    [{ kind: "outreach", text: "给老客户发一封回访邮件" }, "draft_only"],
    [{ kind: "delivery", text: "把交付物发给客户" }, "draft_only"],
    [{ kind: "other", text: "整理本周项目进度" }, "allow"],
  ];
  for (const [request, expected] of cases) {
    const result = engine.checkBoundary(request);
    assert.equal(result.decision, expected, `${request.text} 应为 ${expected}，实际 ${result.decision}（${result.rule_id}）`);
  }
  // 有授权的承诺放行；无授权承诺拒绝
  assert.equal(engine.checkBoundary({ kind: "promise", text: "承诺交付第一版", has_authorization: true }).decision, "allow");
  assert.equal(engine.checkBoundary({ kind: "promise", text: "承诺交付第一版", has_authorization: false }).decision, "deny");
  // 直接调用纯函数（无引擎上下文）也可判定
  assert.equal(evaluateBoundary({ kind: "captcha", text: "验证码" }).decision, "human");
});

// ---------------------------------------------------------------------------
// 11) 仿真业务线端到端（B1/B2/B5）
// ---------------------------------------------------------------------------

test("仿真业务线：询价→报价审批→项目/任务→交付/验收→收款/开票→月报，全程留痕", () => {
  const clock = fixedClock();
  const engine = makeEngine({ now: clock.now });
  const run = engine.runSimulatedBusinessLine();

  assert.equal(run.project.status, "delivered");
  assert.ok(run.project.id.startsWith("prj-"));
  assert.equal(run.project.client.length > 0, true);
  assert.equal(run.quote_cny > 0, true);
  assert.equal(run.customer_message, DEFAULT_CUSTOMER_INQUIRY);

  assert.equal(run.tasks.length, 2);
  assert.ok(run.tasks.every((task) => task.status === "done"));
  assert.ok(run.tasks.every((task) => task.evidence.length >= 1));

  const kinds = run.timeline.map((entry) => entry.kind);
  for (const kind of ["created", "note", "quoted", "delivery", "acceptance", "income", "invoice"]) {
    assert.ok(kinds.includes(kind), `时间线应包含 ${kind}，实际 ${kinds.join(",")}`);
  }

  assert.deepEqual(
    run.ledger.map((entry) => entry.type).sort(),
    ["income", "invoice"],
  );
  assert.equal(run.ledger.find((entry) => entry.type === "income").amount_cny, run.quote_cny);
  assert.equal(run.invoice_status, "issued");
  assert.ok(run.invoice_no.startsWith("invoice-"));

  // 账本 6 要素可查
  const facts = engine.ledgerEntryFacts(run.ledger.find((entry) => entry.type === "income").id);
  assert.equal(facts.amount_cny, run.quote_cny);
  assert.ok(facts.approved_by.length > 0);
  assert.ok(facts.receipt_ref.length > 0);

  // 验收证据置信度确定；月报与收入一致
  assert.equal(run.acceptance.kind, "email");
  assert.equal(run.acceptance.confidence, "certain");
  assert.equal(run.report.income_cny, run.quote_cny);
  assert.equal(run.report.gross_margin_cny, run.quote_cny);
  assert.equal(run.report.coverage, "complete");
  assert.ok(run.report.next_proposals.length >= 1);
});

test("仿真业务线：可在已有委托上重复跑通并保留全部历史", () => {
  const engine = makeEngine();
  makeMandate(engine);
  const first = engine.runSimulatedBusinessLine();
  const second = engine.runSimulatedBusinessLine();
  assert.notEqual(first.project.id, second.project.id);
  assert.equal(engine.ledger({ type: "income" }).length, 2);
  assert.equal(engine.ledger({ type: "invoice" }).length, 2);
  assert.equal(engine.summaries().L1.length, 2);
});

// ---------------------------------------------------------------------------
// 12) 事件日志追加 / 持久化恢复 / 内存模式
// ---------------------------------------------------------------------------

test("events.jsonl：只追加不覆盖，重启后状态恢复且 seq 继续递增", async () => {
  const root = await makeTmpRoot("steward-domain-persist-");
  try {
    const engine1 = new DomainEngine({ root, now: () => new Date(FIXED_ISO) });
    makeMandate(engine1);
    const project = makeProject(engine1);
    const entry = engine1.recordLedger({
      project_id: project.id,
      type: "income",
      amount_cny: 500,
      payee_or_payer: "客户",
      basis: "验收单",
      approved_by: "本人",
      receipt_ref: "receipt-p-1",
    });
    assert.ok(existsSync(join(root, "domain", "state.json")));
    const events1 = readEvents(root);
    assert.ok(events1.length >= 4, `应有至少 4 条事件，实际 ${events1.length}`);
    const seqs1 = events1.map((event) => event.seq);
    assert.deepEqual(seqs1, [...seqs1].sort((a, b) => a - b), "seq 必须递增");
    assert.equal(new Set(seqs1).size, seqs1.length, "seq 不得重复");
    for (const event of events1) {
      assert.equal(typeof event.ts, "string");
      assert.equal(typeof event.action, "string");
      assert.equal(typeof event.object_type, "string");
      assert.ok(["ok", "denied", "error"].includes(event.result));
      assert.ok(Array.isArray(event.evidence_refs));
    }

    // 重启：状态从 state.json 恢复
    const engine2 = new DomainEngine({ root, now: () => new Date(FIXED_ISO) });
    assert.ok(engine2.activeMandate() !== null);
    assert.equal(engine2.getProject(project.id).id, project.id);
    assert.equal(engine2.ledger({ project_id: project.id }).length, 1);
    assert.equal(engine2.ledgerEntryFacts(entry.id).receipt_ref, "receipt-p-1");

    // 追加：老事件不被覆盖，seq 从旧值继续
    engine2.addTask({ project_id: project.id, agent_role: "customer", goal: "重启后继续" });
    const events2 = readEvents(root);
    assert.ok(events2.length > events1.length, "重启后的新事件应追加到同一文件");
    assert.deepEqual(events2.slice(0, events1.length).map((event) => event.seq), seqs1, "旧事件必须原样保留");
    assert.equal(events2[events2.length - 1].seq, events2.length);

    const domainFiles = readdirSync(join(root, "domain"));
    assert.deepEqual(domainFiles.sort(), ["events.jsonl", "state.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persist:false 纯内存模式不落盘；非法 root/损坏状态文件有明确错误", async () => {
  const engine = makeEngine();
  assert.equal(engine.persist, false);
  assert.equal(engine.statePath, null);
  makeMandate(engine);
  assert.ok(engine.activeMandate() !== null);

  const root = await makeTmpRoot("steward-domain-state-");
  try {
    await mkdir(join(root, "domain"), { recursive: true });
    await writeFile(join(root, "domain", "state.json"), "{ not valid json", "utf8");
    assert.throws(() => new DomainEngine({ root }), /状态文件损坏/u);
    assert.throws(() => new DomainEngine({ persist: true }), (error) => error instanceof DomainValidationError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("错误类型：DomainValidationError/SystemHaltedError/BoundaryDeniedError 可被 instanceof 区分", () => {
  const engine = makeEngine();
  try {
    engine.addTask({ project_id: "prj-missing", agent_role: "developer", goal: "x" });
    assert.fail("应当抛出");
  } catch (error) {
    assert.ok(error instanceof DomainValidationError);
    assert.equal(error.name, "DomainValidationError");
    assert.equal(error.code, "NOT_FOUND");
  }
  makeMandate(engine);
  engine.takeover("错误类型测试", "owner");
  try {
    engine.addTask({ project_id: "x", agent_role: "developer", goal: "x" });
    assert.fail("应当抛出");
  } catch (error) {
    assert.ok(error instanceof SystemHaltedError);
    assert.equal(error.code, "SYSTEM_HALTED");
    assert.equal(typeof error.halted_at, "string");
  }
});

test("readFile 辅助自检：临时目录内不产生仓库 runs/ 写入", async () => {
  const root = await makeTmpRoot("steward-domain-clean-");
  try {
    const engine = new DomainEngine({ root, now: () => new Date(FIXED_ISO) });
    engine.runSimulatedBusinessLine();
    const files = readdirSync(join(root, "domain"));
    assert.deepEqual(files.sort(), ["events.jsonl", "state.json"]);
    const events = readEvents(root);
    assert.ok(events.some((event) => event.action === "sim.customer_inquiry"));
    assert.ok(events.some((event) => event.action === "sim.quote"));
    assert.ok(events.some((event) => event.action === "sim.acceptance"));
    // 仿真不产生真实运行目录
    assert.equal(existsSync(join(root, "runs")), false);
    // 临时文件不残留
    const raw = readFileSync(join(root, "domain", "state.json"), "utf8");
    assert.equal(JSON.parse(raw).version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
