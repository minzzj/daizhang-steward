/**
 * M3-A / A7：Scout（客户分支）核心模块单元测试。
 *
 * 全部使用内存 fixture：不读 examples/、不写仓库 runs/、不产生任何网络调用。
 * 覆盖：ICP/三场景、四因子评分、来源硬校验与去重、合格阈值、起草合规（≤150 字符/引用 signal/
 * 不冒充人类/不群发）、审批队列（未批准不可发送）、每日每渠道频控、退订、ScoutReport 一致性。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  DRAFT_BODY_MAX_CHARS,
  DRAFT_SUBJECT_MAX_CHARS,
  MAX_AUTO_DRAFTS,
  ScoutComplianceError,
  ScoutEngine,
  ScoutValidationError,
} from "../../dist/packages/steward-scout/src/index.js";

const FIXED_NOW = new Date("2026-10-25T08:00:00.000Z");
const SIGNAL =
  "每周手动整理各平台销售报表太麻烦，需要自动化工具帮忙，重复录入也很耗时";

/** 内存线索 fixture 工厂：默认是一条“高质量、可触达、低风险”的合格线索。 */
function makeLead(overrides = {}) {
  return {
    lead_id: "lead-001",
    org: "杭州某某电商有限公司",
    role: "运营负责人",
    source_url: "https://example.com/forum/thread-1001",
    signal: SIGNAL,
    channel: "email",
    consent_basis: "公开商务邮箱，帖子中明确寻求自动化工具",
    needs_strength: 0.9,
    budget_range: "medium",
    company_size: 120,
    reachability: 0.8,
    compliance_risk: 0.1,
    company_name: "某某电商",
    ...overrides,
  };
}

function makeEngine(leads, options = {}) {
  return new ScoutEngine({ leads, now: () => FIXED_NOW, ...options });
}

/** 生成 n 条互不重复、分数为 1、渠道相同的合格线索（用于频控测试）。 */
function makeDistinctLeads(count, channel = "email") {
  return Array.from({ length: count }, (_unused, index) =>
    makeLead({
      lead_id: `lead-${String(index + 1).padStart(3, "0")}`,
      org: `示例组织 ${index + 1}`,
      source_url: `https://example.com/leads/${index + 1}`,
      signal: `第 ${index + 1} 家：每周手动整理报表太麻烦，需要自动化工具，重复耗时`,
      channel,
      needs_strength: 1,
      budget_range: "high",
      reachability: 1,
      compliance_risk: 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// 1) ICP 与三个高价值场景
// ---------------------------------------------------------------------------

test("buildIcp/listScenarios：ICP 字段齐全，场景恰好 3 个且内容非空", () => {
  const engine = makeEngine([]);
  const icp = engine.buildIcp();
  assert.equal(typeof icp.segment, "string");
  assert.ok(icp.segment.length > 0);
  assert.ok(Array.isArray(icp.pain_points) && icp.pain_points.length >= 3);
  assert.equal(typeof icp.budget, "string");
  assert.ok(icp.budget.length > 0);
  assert.ok(Array.isArray(icp.channels) && icp.channels.length >= 1);
  assert.ok(Array.isArray(icp.disqualifiers) && icp.disqualifiers.length >= 3);

  const scenarios = engine.listScenarios();
  assert.equal(scenarios.length, 3, "必须恰好 3 个高价值场景");
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  assert.equal(ids.size, 3, "场景 id 不允许重复");
  for (const scenario of scenarios) {
    for (const field of ["id", "name", "who_hurts", "pain", "current_workaround", "why_us"]) {
      assert.equal(typeof scenario[field], "string", `场景缺少字段 ${field}`);
      assert.ok(scenario[field].length > 0, `场景字段 ${field} 不能为空`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2) 四因子评分
// ---------------------------------------------------------------------------

test("scoreLead：四因子权重 40/20/20/20，fit_score ∈ [0,1] 且夹取到边界", () => {
  const engine = makeEngine([]);

  const perfect = engine.scoreLead(
    makeLead({ needs_strength: 1, budget_range: "high", reachability: 1, compliance_risk: 0 }),
  );
  assert.equal(perfect.score_breakdown.need, 1);
  assert.equal(perfect.score_breakdown.budget, 1);
  assert.equal(perfect.score_breakdown.reachability, 1);
  assert.equal(perfect.score_breakdown.compliance, 1);
  assert.equal(perfect.fit_score, 1, "0.4+0.2+0.2+0.2 应夹取为 1");
  assert.equal(perfect.qualified, true);
  assert.ok(perfect.reason.length > 0);

  const floor = engine.scoreLead(
    makeLead({ needs_strength: 0, budget_range: "low", reachability: 0, compliance_risk: 1 }),
  );
  // 0.4*0 + 0.2*0.3(low) + 0.2*0 + 0.2*(1-1) = 0.06
  assert.ok(Math.abs(floor.fit_score - 0.06) < 1e-12, `floor fit 应为 0.06，实际 ${floor.fit_score}`);
  assert.equal(floor.qualified, false);

  const half = engine.scoreLead(
    makeLead({ needs_strength: 0.5, budget_range: "low", reachability: 0, compliance_risk: 1 }),
  );
  assert.ok(Math.abs(half.fit_score - 0.26) < 1e-12, "0.4*0.5 + 0.2*0.3 = 0.26");

  // 显式值优先且全部夹取到 [0,1]
  const clamped = engine.scoreLead(
    makeLead({ needs_strength: 7, reachability: -3, compliance_risk: -1 }),
  );
  assert.equal(clamped.score_breakdown.need, 1);
  assert.equal(clamped.score_breakdown.reachability, 0);
  assert.equal(clamped.score_breakdown.compliance, 1);
  assert.ok(clamped.fit_score >= 0 && clamped.fit_score <= 1);
});

test("scoreLead：缺省启发式（signal 关键词/长度、budget_range、company_size、渠道、合规）", () => {
  const engine = makeEngine([]);

  const keywordLead = engine.scoreLead(makeLead({ needs_strength: undefined }));
  const blandLead = engine.scoreLead(
    makeLead({
      needs_strength: undefined,
      signal: "你好，了解一下",
      consent_basis: "公开帖子留言",
      channel: "form",
      budget_range: undefined,
      company_size: undefined,
      reachability: undefined,
      compliance_risk: undefined,
    }),
  );
  assert.ok(
    keywordLead.score_breakdown.need > blandLead.score_breakdown.need,
    "含“每周/手动/麻烦/需要/自动化/重复/耗时”的 signal 需求强度应更高",
  );
  assert.ok(keywordLead.score_breakdown.need <= 1 && keywordLead.score_breakdown.need >= 0);

  // budget_range 映射 0.3 / 0.6 / 1
  assert.equal(engine.scoreLead(makeLead()).score_breakdown.budget, 0.6);
  assert.equal(engine.scoreLead(makeLead({ budget_range: "low" })).score_breakdown.budget, 0.3);
  assert.equal(engine.scoreLead(makeLead({ budget_range: "high" })).score_breakdown.budget, 1);

  // 无 budget_range 时按 company_size 启发式
  assert.equal(
    engine.scoreLead(makeLead({ budget_range: undefined, company_size: 5 })).score_breakdown.budget,
    0.4,
  );
  assert.equal(
    engine.scoreLead(makeLead({ budget_range: undefined, company_size: 500 })).score_breakdown.budget,
    1,
  );

  // 合规因子按 1 - compliance_risk 计分
  assert.ok(
    Math.abs(engine.scoreLead(makeLead({ compliance_risk: 0.25 })).score_breakdown.compliance - 0.75) <
      1e-12,
  );

  for (const lead of [keywordLead, blandLead]) {
    for (const value of Object.values(lead.score_breakdown)) {
      assert.ok(value >= 0 && value <= 1, "评分明细必须在 [0,1]");
    }
    assert.ok(lead.fit_score >= 0 && lead.fit_score <= 1, "fit_score 必须在 [0,1]");
  }
});

// ---------------------------------------------------------------------------
// 3) 来源硬校验（无来源即丢弃，不补造）
// ---------------------------------------------------------------------------

test("scoredLeads：缺少 source_url 的线索被丢弃并记入 rejected_reasons", () => {
  for (const sourceUrl of [undefined, "", "   "]) {
    const engine = makeEngine([makeLead({ source_url: sourceUrl })]);
    assert.equal(engine.scoredLeads().length, 0);
    assert.equal(engine.qualifiedLeads().length, 0);
    const report = engine.buildReport();
    assert.equal(report.leads_total, 1);
    assert.equal(report.leads_discarded, 1);
    assert.equal(report.rejected_reasons.length, 1);
    assert.match(report.rejected_reasons[0].reason, /source_url/);
    assert.equal(report.rejected_reasons[0].lead_id, "lead-001");
  }
});

test("scoredLeads：非 http(s) 的 source_url 被丢弃", () => {
  for (const sourceUrl of ["ftp://example.com/list", "javascript:alert(1)", "example.com/x", "https://"]) {
    const engine = makeEngine([makeLead({ source_url: sourceUrl })]);
    assert.equal(engine.scoredLeads().length, 0, `应丢弃 ${sourceUrl}`);
    const [rejection] = engine.buildReport().rejected_reasons;
    assert.match(rejection.reason, /source_url/);
  }
});

test("scoredLeads：空 consent_basis 被丢弃（无合规依据不入库）", () => {
  for (const consentBasis of [undefined, "", "   "]) {
    const engine = makeEngine([makeLead({ consent_basis: consentBasis })]);
    assert.equal(engine.scoredLeads().length, 0);
    const [rejection] = engine.buildReport().rejected_reasons;
    assert.match(rejection.reason, /consent_basis/);
  }
});

test("scoredLeads：org+signal 归一化后相同则去重，只留 fit_score 更高的一条", () => {
  const engine = makeEngine([
    makeLead({ lead_id: "lead-a" }),
    // 大小写/空白/标点不同，归一化后与 lead-a 相同；分数更低 → 丢弃
    makeLead({
      lead_id: "lead-b",
      org: "杭州 某某 电商 有限公司",
      signal: `${SIGNAL}。`,
      needs_strength: 0.5,
    }),
    // 同样归一化相同，但分数最高 → 保留
    makeLead({ lead_id: "lead-c", needs_strength: 0.95 }),
  ]);

  const scored = engine.scoredLeads();
  assert.equal(scored.length, 1, "去重后只剩 1 条");
  assert.equal(scored[0].lead_id, "lead-c", "保留分数最高的那条");
  assert.ok(scored[0].fit_score > 0.8);

  const report = engine.buildReport();
  assert.equal(report.leads_discarded, 2);
  assert.equal(report.rejected_reasons.length, 2);
  assert.ok(report.rejected_reasons.every((entry) => /重复线索/.test(entry.reason)));
});

// ---------------------------------------------------------------------------
// 4) 合格阈值
// ---------------------------------------------------------------------------

test("qualifiedThreshold：构造函数阈值决定 qualified 集合", () => {
  const leads = [
    makeLead({ lead_id: "lead-hi" }),
    makeLead({
      lead_id: "lead-lo",
      org: "低分组织",
      source_url: "https://example.com/lo",
      needs_strength: 0.2,
      budget_range: "low",
      reachability: 0.1,
      compliance_risk: 0.8,
    }),
  ];

  const strict = makeEngine(leads, { qualifiedThreshold: 0.7 });
  assert.deepEqual(
    strict.qualifiedLeads().map((lead) => lead.lead_id),
    ["lead-hi"],
  );

  const tooStrict = makeEngine(leads, { qualifiedThreshold: 0.99 });
  assert.equal(tooStrict.qualifiedLeads().length, 0);

  const loose = makeEngine(leads, { qualifiedThreshold: 0.1 });
  assert.equal(loose.qualifiedLeads().length, 2);
});

// ---------------------------------------------------------------------------
// 5) 外联草稿（只起草，不发送）
// ---------------------------------------------------------------------------

test("draftOutreach：body ≤150 字符、必须引用 signal 片段、subject ≤30、状态 drafted", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();

  assert.equal(draft.lead_id, "lead-001");
  assert.equal(draft.channel, "email");
  assert.equal(draft.status, "drafted");
  assert.equal(draft.created_at, FIXED_NOW.toISOString());
  assert.ok(draft.chars <= DRAFT_BODY_MAX_CHARS, `body 超长：${draft.chars}`);
  assert.equal(draft.chars, Array.from(draft.body).length, "chars 必须等于正文码点数（中文按 1 计）");
  assert.ok(Array.from(draft.subject).length <= DRAFT_SUBJECT_MAX_CHARS, "subject 超长");
  assert.equal(draft.cites_signal, true);
  assert.ok(
    draft.body.includes(Array.from(SIGNAL).slice(0, 20).join("")),
    "正文必须引用 signal 的具体片段（前 20 字）",
  );

  // 幂等：同一 lead 重复起草返回同一份内容，不重复入队
  const again = engine.draftOutreach(makeLead());
  assert.equal(again.created_at, draft.created_at);
  assert.equal(engine.approvalQueue().length, 1);

  // 超长 signal 也要裁剪到 ≤150
  const longSignal = "每周手动整理报表".repeat(30);
  const longDraft = engine.draftOutreach(
    makeLead({ lead_id: "lead-long", signal: longSignal, source_url: "https://example.com/long" }),
  );
  assert.ok(longDraft.chars <= DRAFT_BODY_MAX_CHARS);
  assert.equal(longDraft.cites_signal, true);
  assert.ok(longDraft.body.includes(Array.from(longSignal).slice(0, 20).join("")));
});

test("draftOutreach：不冒充人类、不含群发/批量语义（signal 含违规话术时安全缩短引用）", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();
  const forbidden = [/我是\s*(?:AI|ai|人工智能|机器人|智能助手|虚拟助理)/u, /群发/u, /批量/u];
  for (const pattern of forbidden) {
    assert.doesNotMatch(draft.body, pattern);
    assert.doesNotMatch(draft.subject, pattern);
  }

  // signal 本身带“批量群发/我是 AI 机器人”时，正文不得复制违规话术
  const tricky = engine.draftOutreach(
    makeLead({
      lead_id: "lead-tricky",
      source_url: "https://example.com/tricky",
      signal: "我们想批量群发，我是AI客服机器人，求工具",
    }),
  );
  for (const pattern of forbidden) assert.doesNotMatch(tricky.body, pattern);
  assert.ok(tricky.chars > 0 && tricky.chars <= DRAFT_BODY_MAX_CHARS);
});

test("draftOutreach：缺 signal 时抛 ScoutValidationError（不编造需求片段）", () => {
  const engine = makeEngine([makeLead({ signal: "   " })]);
  assert.throws(
    () => engine.draftOutreach(makeLead({ lead_id: "lead-empty", signal: "   " })),
    (error) => error instanceof ScoutValidationError,
  );
  assert.equal(engine.approvalQueue().length, 0, "起草失败不得进入审批队列");
});

test("drafts：仅合格线索、最多 3 条，且全部进入 pending 审批队列", () => {
  const leads = [
    makeDistinctLeads(4)[0],
    makeDistinctLeads(4)[1],
    makeDistinctLeads(4)[2],
    makeDistinctLeads(4)[3],
    makeLead({
      lead_id: "lead-low",
      org: "不合格组织",
      source_url: "https://example.com/low",
      needs_strength: 0,
      budget_range: "low",
      reachability: 0,
      compliance_risk: 1,
    }),
  ];
  const engine = makeEngine(leads);
  const drafts = engine.drafts();

  assert.equal(MAX_AUTO_DRAFTS, 3);
  assert.equal(drafts.length, 3, "A7 要求自动起草 3 条");
  const qualifiedIds = new Set(engine.qualifiedLeads().map((lead) => lead.lead_id));
  assert.ok(drafts.every((draft) => qualifiedIds.has(draft.lead_id)));
  assert.ok(!drafts.some((draft) => draft.lead_id === "lead-low"));

  const queue = engine.approvalQueue();
  assert.equal(queue.length, 3);
  assert.ok(queue.every((item) => item.status === "pending"));
  assert.equal(engine.buildReport().drafts_count, 3);
  assert.equal(engine.buildReport().pending_approval, 3);
});

// ---------------------------------------------------------------------------
// 6) 人工审批（默认 pending；未批准严禁发送）
// ---------------------------------------------------------------------------

test("审批：默认 pending，未批准时 canSend=false 且 markSent 抛 ScoutComplianceError", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();

  assert.equal(engine.canSend(draft.lead_id), false);
  assert.equal(engine.approvalQueue()[0].status, "pending");
  assert.throws(
    () => engine.markSent(draft.lead_id),
    (error) => {
      assert.ok(error instanceof ScoutComplianceError, "必须是 ScoutComplianceError");
      assert.equal(error.code, "NOT_APPROVED");
      return true;
    },
  );
  assert.equal(engine.buildReport().sent_count, 0, "未批准不得产生任何 sent 记录");
});

test("审批：approve 记录 decided_by/decided_at，批准后可发送，重复发送被拒绝", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();

  const approved = engine.approve(draft.lead_id, "human:boss");
  assert.equal(approved.status, "approved");
  assert.equal(approved.decided_by, "human:boss");
  assert.equal(approved.decided_at, FIXED_NOW.toISOString());
  assert.equal(engine.approvalQueue()[0].status, "approved");
  assert.equal(engine.canSend(draft.lead_id), true);

  engine.markSent(draft.lead_id);
  assert.equal(engine.canSend(draft.lead_id), false, "已发送后不可再次发送");
  assert.equal(engine.buildReport().sent_count, 1);
  assert.throws(
    () => engine.markSent(draft.lead_id),
    (error) => error instanceof ScoutComplianceError && error.code === "ALREADY_SENT",
  );

  // 审批/驳回不存在的草稿要报参数错误，而不是静默成功
  assert.throws(() => engine.approve("lead-ghost", "human:boss"), ScoutValidationError);
  assert.throws(() => engine.reject("lead-ghost", "human:boss"), ScoutValidationError);
  assert.throws(() => engine.approve(draft.lead_id, "   "), ScoutValidationError);
});

test("审批：reject 记录原因后不可发送", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();
  const rejected = engine.reject(draft.lead_id, "human:boss", "ICP 不匹配");

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.decided_by, "human:boss");
  assert.equal(rejected.decided_at, FIXED_NOW.toISOString());
  assert.equal(rejected.reason, "ICP 不匹配");
  assert.equal(engine.canSend(draft.lead_id), false);
  assert.throws(
    () => engine.markSent(draft.lead_id),
    (error) => error instanceof ScoutComplianceError && error.code === "NOT_APPROVED",
  );
  assert.equal(engine.approvalQueue()[0].status, "rejected");
});

// ---------------------------------------------------------------------------
// 7) 每日每渠道频控
// ---------------------------------------------------------------------------

test("markSent：默认每日每渠道第 11 条被拒绝，次日额度恢复", () => {
  const leads = makeDistinctLeads(11, "email");
  const clock = { current: new Date(FIXED_NOW.getTime()) };
  const engine = new ScoutEngine({ leads, now: () => new Date(clock.current.getTime()) });

  for (const lead of leads) engine.draftOutreach(lead);
  const queue = engine.approvalQueue();
  assert.equal(queue.length, 11);
  for (const item of queue) engine.approve(item.lead_id, "human:ops");

  for (let index = 0; index < 10; index += 1) engine.markSent(leads[index].lead_id);
  assert.throws(
    () => engine.markSent(leads[10].lead_id),
    (error) => error instanceof ScoutComplianceError && error.code === "DAILY_LIMIT_EXCEEDED",
  );
  const blocked = engine.buildReport();
  assert.equal(blocked.sent_count, 10);
  assert.equal(blocked.channels.email.sent, 10);
  assert.equal(blocked.daily_limit_per_channel, 10);

  // 次日（UTC 日期变化）额度恢复，第 11 条可发送
  clock.current = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);
  engine.markSent(leads[10].lead_id);
  assert.equal(engine.buildReport().sent_count, 11);
});

test("markSent：自定义每日每渠道上限生效（limit=2 时第 3 条被拒绝）", () => {
  const leads = makeDistinctLeads(3, "email");
  const engine = makeEngine(leads, { dailyPerChannelLimit: 2 });
  const drafts = engine.drafts();
  for (const draft of drafts) engine.approve(draft.lead_id, "human:boss");

  engine.markSent(drafts[0].lead_id);
  engine.markSent(drafts[1].lead_id);
  assert.throws(
    () => engine.markSent(drafts[2].lead_id),
    (error) => error instanceof ScoutComplianceError && error.code === "DAILY_LIMIT_EXCEEDED",
  );
  assert.equal(engine.buildReport().daily_limit_per_channel, 2);
  assert.equal(engine.buildReport().sent_count, 2);
});

// ---------------------------------------------------------------------------
// 8) 退订
// ---------------------------------------------------------------------------

test("unsubscribe：退订后 canSend=false，markSent 抛 ScoutComplianceError（含已批准线索）", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();
  engine.approve(draft.lead_id, "human:boss");
  assert.equal(engine.canSend(draft.lead_id), true);

  engine.unsubscribe(draft.lead_id, "客户邮件回复退订");
  assert.equal(engine.canSend(draft.lead_id), false);
  assert.throws(
    () => engine.markSent(draft.lead_id),
    (error) => {
      assert.ok(error instanceof ScoutComplianceError);
      assert.equal(error.code, "UNSUBSCRIBED");
      return true;
    },
  );

  // 未退订的其他线索不受影响
  const other = engine.draftOutreach(
    makeLead({ lead_id: "lead-other", source_url: "https://example.com/other" }),
  );
  engine.approve(other.lead_id, "human:boss");
  assert.equal(engine.canSend(other.lead_id), true);
});

// ---------------------------------------------------------------------------
// 9) ScoutReport 一致性
// ---------------------------------------------------------------------------

test("buildReport：计数与内部状态一致（rejected_reasons/channels/pending/sent/replies/meetings）", () => {
  const leads = [
    makeLead({ lead_id: "lead-001" }),
    makeLead({
      lead_id: "lead-002",
      org: "上海某某贸易有限公司",
      source_url: "https://example.com/thread-1002",
      signal: "每天手动对账太麻烦，需要自动化对账工具，重复耗时",
    }),
    makeLead({
      lead_id: "lead-003",
      org: "深圳某某软件有限公司",
      source_url: "https://example.com/thread-1003",
      channel: "platform_dm",
      signal: "客服回复重复，求工具自动化处理，每天耗时",
    }),
    // 3 条不合规（无 source_url / 非 http(s) / 空 consent_basis）
    makeLead({ lead_id: "lead-004", source_url: "" }),
    makeLead({ lead_id: "lead-005", org: "非法来源组织", source_url: "ftp://example.com/list" }),
    makeLead({
      lead_id: "lead-006",
      org: "空依据组织",
      source_url: "https://example.com/thread-1006",
      consent_basis: "   ",
    }),
    // 1 条与 lead-001 重复（分数更低 → 丢弃）
    makeLead({ lead_id: "lead-007", needs_strength: 0.3 }),
  ];

  const engine = makeEngine(leads);
  const drafts = engine.drafts();
  assert.equal(drafts.length, 3);

  engine.approve(drafts[0].lead_id, "human:boss");
  engine.reject(drafts[1].lead_id, "human:boss", "暂不匹配");
  engine.markSent(drafts[0].lead_id);
  engine.addReply(drafts[0].lead_id);
  engine.addReply(drafts[0].lead_id); // 同一线索去重计数
  engine.addMeeting(drafts[0].lead_id);
  engine.unsubscribe(drafts[2].lead_id, "客户明确拒绝");

  const report = engine.buildReport();
  assert.equal(report.generated_at, FIXED_NOW.toISOString());
  assert.equal(report.scenarios.length, 3);
  assert.equal(report.icp.segment, engine.buildIcp().segment);

  assert.equal(report.leads_total, 7);
  assert.equal(report.leads_discarded, 4);
  assert.equal(report.rejected_reasons.length, 4);
  assert.deepEqual(
    report.rejected_reasons.map((entry) => entry.lead_id).sort(),
    ["lead-004", "lead-005", "lead-006", "lead-007"],
  );
  assert.equal(report.qualified_count, engine.qualifiedLeads().length);
  assert.equal(report.qualified_count, 3);
  assert.equal(report.drafts_count, engine.drafts().length);
  assert.equal(report.drafts_count, 3);
  assert.equal(report.sent_count, 1);
  assert.equal(report.replies, 1, "同一线索多次回复按线索去重");
  assert.equal(report.meetings, 1);
  assert.equal(report.daily_limit_per_channel, 10);

  const queue = engine.approvalQueue();
  assert.equal(report.pending_approval, queue.filter((item) => item.status === "pending").length);
  assert.equal(report.pending_approval, 1, "approved/rejected 之外只剩 1 条 pending");
  assert.equal(
    report.leads_total,
    report.leads_discarded + engine.scoredLeads().length,
    "总数 = 丢弃数 + 去重后评分数",
  );

  assert.deepEqual(report.channels, {
    email: { drafts: 2, sent: 1 },
    platform_dm: { drafts: 1, sent: 0 },
  });
  const channelDrafts = Object.values(report.channels).reduce((sum, item) => sum + item.drafts, 0);
  const channelSent = Object.values(report.channels).reduce((sum, item) => sum + item.sent, 0);
  assert.equal(channelDrafts, report.drafts_count);
  assert.equal(channelSent, report.sent_count);
});

// ---------------------------------------------------------------------------
// 10) 纯状态：markSent 不产生任何网络调用
// ---------------------------------------------------------------------------

test("markSent 只记录内存状态：不调用 fetch，构建产物不含网络模块依赖", () => {
  const engine = makeEngine([makeLead()]);
  const [draft] = engine.drafts();
  engine.approve(draft.lead_id, "human:boss");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("测试期间禁止网络调用"));
  };
  try {
    engine.markSent(draft.lead_id);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "markSent 不允许发起网络请求");
  assert.equal(engine.buildReport().sent_count, 1, "只应产生内部状态记录");

  // 静态核对：构建产物不导入任何网络模块（防止未来误加真实外发实现）
  const distDir = fileURLToPath(new URL("../../dist/packages/steward-scout/src/", import.meta.url));
  const jsFiles = readdirSync(distDir).filter((name) => name.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "dist 中应有构建产物（先 npm run build）");
  for (const name of jsFiles) {
    const code = readFileSync(join(distDir, name), "utf8");
    assert.doesNotMatch(code, /node:(?:http|https|net|tls|dgram|http2)/, `${name} 不应导入网络模块`);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket/, `${name} 不应包含网络调用`);
  }
});

// ---------------------------------------------------------------------------
// 11) 构造参数校验 / 自定义错误类型
// ---------------------------------------------------------------------------

test("构造参数校验：leads 非数组、非法频控上限/阈值抛 ScoutValidationError", () => {
  assert.throws(() => new ScoutEngine(), ScoutValidationError);
  assert.throws(() => new ScoutEngine({}), ScoutValidationError);
  assert.throws(() => new ScoutEngine({ leads: "not-an-array" }), ScoutValidationError);
  assert.throws(() => new ScoutEngine({ leads: [], dailyPerChannelLimit: 0 }), ScoutValidationError);
  assert.throws(
    () => new ScoutEngine({ leads: [], dailyPerChannelLimit: 2.5 }),
    ScoutValidationError,
  );
  assert.throws(() => new ScoutEngine({ leads: [], qualifiedThreshold: 1.5 }), ScoutValidationError);
  assert.throws(() => new ScoutEngine({ leads: [], qualifiedThreshold: -0.1 }), ScoutValidationError);

  // 自定义错误都带 name + code，便于 CLI 区分处理
  const error = new ScoutComplianceError("测试", "NOT_APPROVED");
  assert.equal(error.name, "ScoutComplianceError");
  assert.equal(error.code, "NOT_APPROVED");
  assert.ok(error instanceof Error);
  const validation = new ScoutValidationError("测试");
  assert.equal(validation.name, "ScoutValidationError");
  assert.equal(validation.code, "INVALID_INPUT");
});
