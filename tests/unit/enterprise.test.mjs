/**
 * 阶段二 P3-A / 企业版引擎单元测试（≥18 条）。
 *
 * 全部内存/临时目录：不写仓库 runs/、不联网、无真实资金/开票/税务/银行动作。
 * 覆盖：主体认证校验；7 类模式冲突（B8）；blocked 不产生发票/收款；个人/企业正常订单；
 * 开票三项一致性；双人复核（1 人/2 角色/重复/拒绝）；组织审批链分档；用印 AI 不代签；
 * 申报草稿；30 条边界（数量/双模式标注/四类越界双模式 deny/用工 human）；B8 双模式 checks +
 * 6 个 mismatch 全部阻断；审计追加；无网络调用。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  APPROVAL_TIER_MEDIUM_CNY,
  APPROVAL_TIER_SMALL_CNY,
  DUAL_REVIEW_REQUIRED_COUNT,
  DualReviewRequiredError,
  EnterpriseEngine,
  EnterpriseValidationError,
  InvalidInvoiceError,
  MODE_CONFLICT_CODES,
  ModeConflictError,
  isAiLikeSigner,
} from "../../dist/packages/steward-enterprise/src/index.js";

const FIXED_NOW = new Date("2026-10-25T08:00:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();

function makeEngine(options = {}) {
  return new EnterpriseEngine({ now: () => FIXED_NOW, ...options });
}

/** 企业模式正常订单（基于当前档案默认值，可按需覆盖）。 */
function enterpriseOrder(engine, overrides = {}) {
  const profile = engine.currentProfile;
  return {
    mode: "enterprise",
    client_type: "company",
    quote_cny: 20_000,
    invoice_type_requested: "vat_special",
    payment_method: "corporate_account",
    client_invoice_title: profile.invoice_defaults.title,
    client_tax_no: profile.invoice_defaults.tax_no,
    signatory: profile.entity.agent_name,
    seal_required: true,
    ...overrides,
  };
}

/** 个人模式正常订单（个人主体 + 个人收款 + 普票 + 个人客户）。 */
function personalOrder(engine, overrides = {}) {
  const entity = engine.currentPersonalEntity;
  return {
    mode: "personal",
    client_type: "individual",
    quote_cny: 3_000,
    invoice_type_requested: "vat_general",
    payment_method: "personal_account",
    client_invoice_title: entity.name,
    signatory: "示例个人客户（虚构，本人签署）",
    seal_required: false,
    ...overrides,
  };
}

function blockCodes(conflicts) {
  return conflicts.filter((conflict) => conflict.severity === "block").map((conflict) => conflict.code);
}

function hasBlock(conflicts, code) {
  return conflicts.some((conflict) => conflict.severity === "block" && conflict.code === code);
}

// ---------------------------------------------------------------------------
// 1) 企业主体认证
// ---------------------------------------------------------------------------

test("defaultProfile + validateEntity：默认虚构企业四项认证齐全，缺项可读地报出", () => {
  const engine = makeEngine();
  const profile = engine.defaultProfile();
  assert.equal(profile.entity.kind, "company");
  assert.ok(profile.entity.license_no && profile.entity.license_no.length > 0);
  assert.equal(profile.entity.authorization_letter?.status, "signed");
  assert.equal(profile.entity.bank_account.type, "corporate");
  assert.ok(profile.entity.tax_no && profile.entity.tax_no.length > 0);
  assert.equal(profile.invoice_defaults.type, "vat_special");
  assert.ok(profile.review_policy.dual_review_roles.length >= 2);
  assert.equal(profile.multi_agent_serial, true);

  const valid = engine.validateEntity();
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.entity_id, profile.entity.id);

  const missingLicense = engine.validateEntity({ ...profile.entity, license_no: undefined });
  assert.equal(missingLicense.ok, false);
  assert.ok(missingLicense.issues.some((issue) => issue.includes("license_no")));

  const missingTax = engine.validateEntity({ ...profile.entity, tax_no: undefined });
  assert.equal(missingTax.ok, false);
  assert.ok(missingTax.issues.some((issue) => issue.includes("tax_no")));

  const authPending = engine.validateEntity({
    ...profile.entity,
    authorization_letter: { status: "pending_human" },
  });
  assert.equal(authPending.ok, false);
  assert.ok(authPending.issues.some((issue) => issue.includes("授权书")));

  const personalAccount = engine.validateEntity({
    ...profile.entity,
    bank_account: { ...profile.entity.bank_account, type: "personal" },
  });
  assert.equal(personalAccount.ok, false);
  assert.ok(personalAccount.issues.some((issue) => issue.includes("对公账户")));

  // 个人主体：不需要执照/授权书，但必须是个人账户
  const personalEntity = engine.currentPersonalEntity;
  assert.equal(engine.validateEntity(personalEntity).ok, true);
  const badPersonal = engine.validateEntity({
    ...personalEntity,
    bank_account: { ...personalEntity.bank_account, type: "corporate" },
  });
  assert.equal(badPersonal.ok, false);
  assert.ok(badPersonal.issues.some((issue) => issue.includes("个人账户")));

  // AI 不能作为授权书/用印签署人
  const aiProfile = engine.defaultProfile();
  aiProfile.entity.authorization_letter = { status: "signed", signed_by: "AI-Agent" };
  const aiEngine = makeEngine({ profile: aiProfile });
  const aiValidation = aiEngine.validateEntity();
  assert.equal(aiValidation.ok, false);
  assert.ok(aiValidation.issues.some((issue) => /AI|机器人/u.test(issue)));
  assert.throws(() => aiEngine.assertValidEntity(), EnterpriseValidationError);
});

// ---------------------------------------------------------------------------
// 2) B8 模式冲突（6 类不一致 + 用印）
// ---------------------------------------------------------------------------

test("checkModeConsistency：7 类不一致逐一产生 block 冲突且理由可读", () => {
  const engine = makeEngine();
  assert.equal(blockCodes(engine.checkModeConsistency(enterpriseOrder(engine))).length, 0, "正常企业单不应有冲突");
  assert.equal(blockCodes(engine.checkModeConsistency(personalOrder(engine))).length, 0, "正常个人单不应有冲突");

  const cases = [
    {
      name: "客户主体类型不一致",
      order: personalOrder(engine, { client_type: "company", invoice_type_requested: "none" }),
      codes: [MODE_CONFLICT_CODES.CLIENT_TYPE_MISMATCH],
    },
    {
      name: "发票类型不一致（个人模式申请专票）",
      order: personalOrder(engine, { invoice_type_requested: "vat_special" }),
      codes: [MODE_CONFLICT_CODES.INVOICE_TYPE_MISMATCH],
    },
    {
      name: "收款方式不一致（企业模式用个人账户）",
      order: enterpriseOrder(engine, { payment_method: "personal_account" }),
      codes: [MODE_CONFLICT_CODES.PAYMENT_METHOD_MISMATCH],
    },
    {
      name: "授权书未人签",
      order: enterpriseOrder(engine, { authorization_letter_status: "pending_human" }),
      codes: [MODE_CONFLICT_CODES.AUTHORIZATION_LETTER_NOT_SIGNED],
    },
    {
      name: "发票抬头与主体不一致",
      order: enterpriseOrder(engine, { client_invoice_title: "另一家公司（虚构）" }),
      codes: [MODE_CONFLICT_CODES.INVOICE_TITLE_MISMATCH],
    },
    {
      name: "税号与主体不一致",
      order: enterpriseOrder(engine, { client_tax_no: "TAX-WRONG-0000" }),
      codes: [MODE_CONFLICT_CODES.TAX_NO_MISMATCH],
    },
    {
      name: "签署人非授权经办人",
      order: enterpriseOrder(engine, { signatory: "路人甲（未授权）" }),
      codes: [MODE_CONFLICT_CODES.SIGNATORY_NOT_AUTHORIZED],
    },
    {
      name: "需用印但用印未人签",
      order: enterpriseOrder(engine, { seal_required: true, seal_status: "pending_human" }),
      codes: [MODE_CONFLICT_CODES.SEAL_NOT_SIGNED],
    },
  ];

  for (const item of cases) {
    const conflicts = engine.checkModeConsistency(item.order);
    for (const code of item.codes) {
      assert.ok(hasBlock(conflicts, code), `${item.name} 应命中 ${code}，实际 ${JSON.stringify(blockCodes(conflicts))}`);
    }
    for (const conflict of conflicts.filter((entry) => entry.severity === "block")) {
      assert.equal(typeof conflict.field, "string");
      assert.ok(conflict.field.length > 0);
      assert.ok(conflict.message.length >= 10, `${item.name} 的冲突文案必须可读`);
    }
  }

  // 断言版：存在 block 冲突时抛 ModeConflictError，并带完整冲突列表
  assert.throws(
    () => engine.assertNoModeConflict(personalOrder(engine, { invoice_type_requested: "vat_special" })),
    (error) => {
      assert.ok(error instanceof ModeConflictError);
      assert.equal(error.code, "MODE_CONFLICT");
      assert.ok(Array.isArray(error.conflicts) && error.conflicts.length > 0);
      return true;
    },
  );
});

test("runOrder：6 类不一致全部 blocked，且不产生发票、不发生收款动作（只留审计）", () => {
  const scenarios = [
    {
      name: "① 个人模式 + 企业客户 + 专票",
      order: (engine) => personalOrder(engine, { client_type: "company", invoice_type_requested: "vat_special" }),
      expectCodes: [MODE_CONFLICT_CODES.CLIENT_TYPE_MISMATCH, MODE_CONFLICT_CODES.INVOICE_TYPE_MISMATCH],
    },
    {
      name: "② 企业模式 + 个人账户收款",
      order: (engine) => enterpriseOrder(engine, { payment_method: "personal_account" }),
      expectCodes: [MODE_CONFLICT_CODES.PAYMENT_METHOD_MISMATCH],
    },
    {
      name: "③ 企业授权书未人签",
      order: (engine) => enterpriseOrder(engine, { authorization_letter_status: "none" }),
      expectCodes: [MODE_CONFLICT_CODES.AUTHORIZATION_LETTER_NOT_SIGNED],
    },
    {
      name: "④ 抬头/税号与主体不一致",
      order: (engine) =>
        enterpriseOrder(engine, { client_invoice_title: "另一家公司（虚构）", client_tax_no: "TAX-WRONG-0000" }),
      expectCodes: [MODE_CONFLICT_CODES.INVOICE_TITLE_MISMATCH, MODE_CONFLICT_CODES.TAX_NO_MISMATCH],
    },
    {
      name: "⑤ 签署人非授权经办人",
      order: (engine) => enterpriseOrder(engine, { signatory: "路人甲（未授权）" }),
      expectCodes: [MODE_CONFLICT_CODES.SIGNATORY_NOT_AUTHORIZED],
    },
    {
      name: "⑥ 需用印但未人签",
      order: (engine) => enterpriseOrder(engine, { seal_required: true, seal_status: "pending_human" }),
      expectCodes: [MODE_CONFLICT_CODES.SEAL_NOT_SIGNED],
    },
  ];

  for (const scenario of scenarios) {
    const engine = makeEngine();
    const result = engine.runOrder(scenario.order(engine));
    assert.equal(result.blocked, true, `${scenario.name} 必须阻断`);
    assert.equal(result.invoice, undefined, `${scenario.name} 不得产生发票`);
    assert.equal(result.payment.ok, false, `${scenario.name} 不得发生收款动作`);
    assert.equal(typeof result.payment.message, "string");
    assert.match(result.payment.message, /未产生任何收款/u);
    assert.equal(result.signature.ai_may_sign, false);
    for (const code of scenario.expectCodes) {
      assert.ok(hasBlock(result.conflicts, code), `${scenario.name} 应命中 ${code}`);
    }
    assert.ok(
      result.audit.some((entry) => entry.action === "order.run" && entry.result === "blocked"),
      `${scenario.name} 必须在审计中留痕`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3) 正常订单与开票校验
// ---------------------------------------------------------------------------

test("runOrder：个人/企业正常订单通过，开票草稿均为 draft_pending_human（不自动提交）", () => {
  const engine = makeEngine();

  const personal = engine.runOrder(personalOrder(engine));
  assert.equal(personal.blocked, false);
  assert.equal(personal.payment.ok, true);
  assert.equal(personal.payment.account_type, "personal");
  assert.ok(personal.invoice);
  assert.equal(personal.invoice.invoice_type, "vat_general");
  assert.equal(personal.invoice.ok, true);
  assert.equal(personal.invoice.draft_status, "draft_pending_human");
  assert.equal(personal.signature.ai_may_sign, false);

  const enterprise = engine.runOrder(enterpriseOrder(engine));
  assert.equal(enterprise.blocked, false);
  assert.equal(enterprise.payment.ok, true);
  assert.equal(enterprise.payment.account_type, "corporate");
  assert.ok(enterprise.invoice);
  assert.equal(enterprise.invoice.invoice_type, "vat_special");
  assert.equal(enterprise.invoice.ok, true);
  assert.equal(enterprise.invoice.draft_status, "draft_pending_human");
  assert.equal(enterprise.signature.required, true);
  assert.equal(enterprise.signature.signatory_ok, true);
  assert.equal(enterprise.signature.ai_may_sign, false);
});

test("createInvoiceDraft：抬头/税号/合同三项一致性校验（不通过不生成可提交发票）", () => {
  const engine = makeEngine();

  const good = engine.createInvoiceDraft(enterpriseOrder(engine));
  assert.equal(good.ok, true);
  assert.deepEqual(good.checks, { title_matches: true, tax_no_matches: true, contract_matches: true });
  assert.equal(good.draft_status, "draft_pending_human");
  assert.match(good.message, /人工确认提交/u);

  const badTitle = engine.createInvoiceDraft(enterpriseOrder(engine, { client_invoice_title: "错误抬头（虚构）" }));
  assert.equal(badTitle.ok, false);
  assert.equal(badTitle.checks.title_matches, false);
  assert.equal(badTitle.checks.contract_matches, false);
  assert.match(badTitle.message, /抬头不一致/u);

  const badTax = engine.createInvoiceDraft(enterpriseOrder(engine, { client_tax_no: "TAX-WRONG-0000" }));
  assert.equal(badTax.ok, false);
  assert.equal(badTax.checks.tax_no_matches, false);
  assert.match(badTax.message, /税号不一致/u);

  const wrongType = engine.createInvoiceDraft(enterpriseOrder(engine, { invoice_type_requested: "vat_general" }));
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.checks.contract_matches, false, "发票类型须与合同约定（默认专票）一致");

  assert.throws(
    () => engine.createInvoiceDraft(personalOrder(engine, { invoice_type_requested: "vat_special" })),
    InvalidInvoiceError,
  );

  const noInvoice = engine.createInvoiceDraft(personalOrder(engine, { invoice_type_requested: "none" }));
  assert.equal(noInvoice.ok, true);
  assert.equal(noInvoice.invoice_type, "none");
});

// ---------------------------------------------------------------------------
// 4) 双人复核（收款账户变更）
// ---------------------------------------------------------------------------

test("双人复核：1 人批准不生效，2 个不同角色批准后生效并切换收款账户", () => {
  const engine = makeEngine();
  const change = engine.requestAccountChange({
    from_account: "示例银行 **** 8888（虚构）",
    to_account: "示例银行 **** 9999（虚构）",
    requested_by: "示例财务（虚构）",
  });
  assert.equal(change.status, "pending_dual_review");
  assert.equal(change.applied, false);
  assert.deepEqual(change.reviews, []);
  assert.equal(change.created_at, FIXED_ISO);

  const first = engine.reviewAccountChange(change.id, "示例财务负责人（虚构，finance）", "approve");
  assert.equal(first.status, "pending_dual_review");
  assert.equal(first.applied, false, "1 人批准不生效");
  assert.equal(first.reviews.length, 1);
  assert.equal(engine.currentProfile.entity.bank_account.account_no_masked, "**** **** **** 8888");

  const second = engine.reviewAccountChange(change.id, "示例法务（虚构，legal）", "approve");
  assert.equal(second.status, "approved");
  assert.equal(second.applied, true, "2 个不同角色批准才生效");
  assert.equal(second.reviews.length, 2);
  assert.equal(engine.currentProfile.entity.bank_account.account_no_masked, "示例银行 **** 9999（虚构）");

  // 已生效后不能再复核
  assert.throws(
    () => engine.reviewAccountChange(change.id, "示例财务负责人（虚构，finance）", "approve"),
    DualReviewRequiredError,
  );
});

test("双人复核：重复 reviewer/同一角色无效，拒绝不生效且不能继续复核", () => {
  const engine = makeEngine();
  const dup = engine.requestAccountChange({ from: "A-8888", to: "A-9999", requested_by: "财务（虚构）" });
  engine.reviewAccountChange(dup.id, "财务负责人（finance）", "approve");
  assert.throws(
    () => engine.reviewAccountChange(dup.id, "财务复核（finance）", "approve"),
    (error) => error instanceof DualReviewRequiredError && /重复复核/u.test(error.message),
  );
  assert.equal(engine.accountChangesList().find((item) => item.id === dup.id).applied, false);

  const rejected = engine.requestAccountChange({ from: "B-8888", to: "B-9999", requested_by: "财务（虚构）" });
  const rejectedResult = engine.reviewAccountChange(rejected.id, "财务负责人（finance）", "reject");
  assert.equal(rejectedResult.status, "rejected");
  assert.equal(rejectedResult.applied, false, "拒绝不生效");
  assert.equal(engine.currentProfile.entity.bank_account.account_no_masked, "**** **** **** 8888");
  assert.throws(
    () => engine.reviewAccountChange(rejected.id, "法务（legal）", "approve"),
    DualReviewRequiredError,
  );
  assert.equal(DUAL_REVIEW_REQUIRED_COUNT, 2);

  assert.throws(
    () => engine.reviewAccountChange("acr-999", "财务负责人（finance）", "approve"),
    EnterpriseValidationError,
  );
});

// ---------------------------------------------------------------------------
// 5) 组织级审批链 / 申报草稿 / 多代理串行
// ---------------------------------------------------------------------------

test("approvalChainFor：按金额分档（≤5000 / 5000–50000 / >50000），submitForApproval 仅 pending", () => {
  const engine = makeEngine();
  const tiers = [
    [1_000, 1],
    [APPROVAL_TIER_SMALL_CNY, 1],
    [APPROVAL_TIER_SMALL_CNY + 1, 2],
    [20_000, 2],
    [APPROVAL_TIER_MEDIUM_CNY, 2],
    [APPROVAL_TIER_MEDIUM_CNY + 1, 3],
    [80_000, 3],
  ];
  for (const [amount, expectedLength] of tiers) {
    const chain = engine.approvalChainFor(amount);
    assert.equal(chain.amount_cny, amount);
    assert.equal(chain.chain.length, expectedLength, `金额 ${amount} 应 ${expectedLength} 级审批`);
    assert.deepEqual(chain.roles, chain.chain);
  }
  assert.throws(() => engine.approvalChainFor(-1), EnterpriseValidationError);
  assert.throws(() => engine.approvalChainFor(Number.NaN), EnterpriseValidationError);

  const submission = engine.submitForApproval(enterpriseOrder(engine, { quote_cny: 20_000 }));
  assert.equal(submission.status, "pending");
  assert.equal(submission.amount_cny, 20_000);
  assert.equal(submission.chain.length, 2);
  assert.equal(submission.submitted_at, FIXED_ISO);
  assert.match(submission.id, /^apv-\d{3}$/u);

  const draft = engine.createTaxFilingDraft("2026-10");
  assert.equal(draft.status, "draft_pending_human");
  assert.equal(draft.ai_may_submit, false);
  assert.ok(draft.next_action.length > 0);
  assert.throws(() => engine.createTaxFilingDraft("2026-13"), EnterpriseValidationError);
});

test("多代理/多账号串行：同 profile 同时只允许一个代理，释放后可切换", () => {
  const engine = makeEngine();
  const first = engine.acquireAgentSlot("agent-a");
  assert.equal(first.ok, true);
  assert.equal(first.holder, "agent-a");
  const second = engine.acquireAgentSlot("agent-b");
  assert.equal(second.ok, false, "不允许并发占用");
  assert.equal(second.holder, "agent-a");
  assert.match(second.message, /串行|占用/u);
  assert.equal(engine.releaseAgentSlot("agent-b").ok, false);
  assert.equal(engine.releaseAgentSlot("agent-a").ok, true);
  assert.equal(engine.acquireAgentSlot("agent-b").ok, true);

  const profile = engine.defaultProfile();
  profile.multi_agent_serial = false;
  const single = makeEngine({ profile });
  assert.equal(single.acquireAgentSlot("only-agent").ok, true);
});

// ---------------------------------------------------------------------------
// 6) 用印流程（AI 不代签）
// ---------------------------------------------------------------------------

test("用印：只生成待签草案并定位签署页；AI 署名被拒，仅自然人可置 signed", () => {
  const engine = makeEngine();
  const flow = engine.sealFlow({ doc_id: "doc-demo-001", title: "示例企业服务合同（虚构）" });
  assert.equal(flow.status, "pending_human");
  assert.equal(flow.ai_may_sign, false);
  assert.match(flow.signing_page_hint, /示例企业服务合同/u);
  assert.ok(flow.next_action.length > 0);
  assert.equal(engine.sealFlow("doc-demo-001").status, "pending_human", "重复调用幂等");

  assert.throws(
    () => engine.markSealSignedByHuman("doc-demo-001", "AI-Agent"),
    (error) => error instanceof EnterpriseValidationError && /AI|代签/u.test(error.message),
  );
  assert.throws(() => engine.markSealSignedByHuman("doc-demo-001", "机器人小助手"), EnterpriseValidationError);
  assert.throws(
    () => engine.markSealSignedByHuman("doc-missing", "示例法人（虚构，人签）"),
    EnterpriseValidationError,
  );

  const signed = engine.markSealSignedByHuman("doc-demo-001", "示例法人（虚构，人签）");
  assert.equal(signed.status, "signed");
  assert.equal(signed.ai_may_sign, false);
  assert.equal(signed.signed_by, "示例法人（虚构，人签）");
  assert.equal(signed.signed_at, FIXED_ISO);
  assert.equal(engine.sealFlows().length, 1);
  assert.equal(isAiLikeSigner("AI-Agent"), true);
  assert.equal(isAiLikeSigner("示例法人（虚构，人签）"), false);
});

// ---------------------------------------------------------------------------
// 7) 30 条边界规则 + 双模式标注表
// ---------------------------------------------------------------------------

test("boundaryRules30：恰好 30 条、字段完整、双模式标注齐全、四类重点 deny+已实现", () => {
  const engine = makeEngine();
  const rows = engine.boundaryRules30();
  assert.equal(rows.length, 30, "必须恰好 30 条边界");
  assert.equal(engine.boundaryRuleCount(), 30);

  const ids = new Set();
  for (const row of rows) {
    assert.ok(row.rule_id.length > 0);
    assert.ok(row.trigger.length > 0);
    assert.ok(row.user_message.length >= 10, `规则 ${row.rule_id} 的用户文案必须可读`);
    assert.ok(["deny", "human", "draft_only"].includes(row.must));
    assert.ok(["personal", "enterprise", "both"].includes(row.mode));
    assert.ok(["implemented", "human", "not_applicable"].includes(row.personal));
    assert.ok(["implemented", "human", "not_applicable"].includes(row.enterprise));
    assert.ok(row.test_case_id.length > 0);
    assert.ok(row.evidence.length > 0);
    assert.ok(!ids.has(row.rule_id), `rule_id 重复：${row.rule_id}`);
    ids.add(row.rule_id);
  }

  // 四类重点越界：无证 / 借资质 / 陌生外呼 / 超预算
  const fourKey = [
    ["EB-01", "无证业务"],
    ["EB-02", "借用资质"],
    ["EB-03", "陌生外呼"],
    ["EB-04", "超预算"],
  ];
  for (const [ruleId, keyword] of fourKey) {
    const row = rows.find((item) => item.rule_id === ruleId);
    assert.ok(row, `缺少四类重点规则 ${ruleId}`);
    assert.equal(row.must, "deny");
    assert.equal(row.mode, "both");
    assert.equal(row.personal, "implemented");
    assert.equal(row.enterprise, "implemented");
    assert.ok(
      row.trigger.includes(keyword) || row.user_message.includes(keyword),
      `规则 ${ruleId} 应包含关键词「${keyword}」`,
    );
  }

  // 用工/派遣/资质类必须是 human
  for (const ruleId of ["EB-26", "EB-27"]) {
    const row = rows.find((item) => item.rule_id === ruleId);
    assert.ok(row);
    assert.equal(row.must, "human");
  }
});

test("boundaryTableMarkdown：中文表头、30 行数据、可直接入库", () => {
  const engine = makeEngine();
  const markdown = engine.boundaryTableMarkdown();
  assert.match(markdown, /# 30 条边界规则双模式标注表/u);
  assert.ok(
    markdown.includes("| 规则 | 触发 | 必须行为 | 用户文案 | 模式 | 个人 | 企业 | 测试 | 证据 |"),
    "必须包含约定的中文表头",
  );
  const dataRows = markdown.split("\n").filter((line) => /^\| EB-\d{2} \|/u.test(line));
  assert.equal(dataRows.length, 30, "表格必须恰好 30 行规则");
  assert.ok(markdown.includes("已实现"));
  assert.ok(markdown.includes("人工"));
  assert.ok(markdown.includes("不适用"));
});

test("checkBoundary：四类越界个人+企业双模式都 deny；用工/派遣/资质类转人工", () => {
  const engine = makeEngine();
  const denyCases = [
    {
      name: "无证业务",
      request: { kind: "business_scope", text: "承接无证业务", requires_license: true },
      ruleId: "EB-01",
    },
    {
      name: "借用资质",
      request: { kind: "other", text: "借用朋友的营业执照接单" },
      ruleId: "EB-02",
    },
    {
      name: "陌生外呼",
      request: { kind: "outreach", text: "购买名单做陌生外呼", is_unknown_outreach: true },
      ruleId: "EB-03",
    },
    {
      name: "超预算",
      request: { kind: "payment", text: "给供应商付款", amount_cny: 60_000, budget_cny: 50_000 },
      ruleId: "EB-04",
    },
  ];
  const before = engine.auditCount;
  for (const mode of ["personal", "enterprise"]) {
    for (const item of denyCases) {
      const result = engine.checkBoundary({ ...item.request, mode });
      assert.equal(result.decision, "deny", `${mode} 模式 ${item.name} 必须 deny`);
      assert.equal(result.rule_id, item.ruleId);
      assert.equal(result.mode, mode);
      assert.ok(result.user_message.length >= 10);
    }
  }
  assert.ok(engine.auditCount > before, "边界判定必须留痕");

  const humanCases = [
    { kind: "employment_dispatch", text: "招聘用工与劳务派遣", ruleId: "EB-26" },
    { kind: "qualification", text: "代办许可证", ruleId: "EB-27" },
    { kind: "tax", text: "税务申报", ruleId: "EB-21" },
    { kind: "contract", text: "签合同盖章", ruleId: "EB-16" },
  ];
  for (const item of humanCases) {
    const result = engine.checkBoundary({ kind: item.kind, text: item.text, mode: "enterprise" });
    assert.equal(result.decision, "human", `${item.kind} 必须转人工`);
    assert.equal(result.rule_id, item.ruleId);
  }
  assert.equal(
    engine.checkBoundary({ kind: "employment_dispatch", text: "劳务派遣", mode: "personal" }).decision,
    "human",
  );
  assert.equal(
    engine.checkBoundary({ kind: "other", text: "超范围业务", out_of_scope: true, mode: "enterprise" }).decision,
    "deny",
  );
  assert.equal(
    engine.checkBoundary({ kind: "promise", text: "保证全额退款", mode: "enterprise" }).decision,
    "deny",
  );
});

// ---------------------------------------------------------------------------
// 8) B8 双模式（runDualModeOrders）
// ---------------------------------------------------------------------------

test("runDualModeOrders：个人/企业各跑一单 checks 全 true，6 个 mismatch 全部阻断且无发票/收款", () => {
  const engine = makeEngine();
  const dual = engine.runDualModeOrders();

  assert.equal(dual.ok, true);
  assert.deepEqual(dual.checks, {
    subject_consistent: true,
    invoice_consistent: true,
    payment_consistent: true,
    all_mismatches_blocked: true,
  });

  assert.equal(dual.personal.block, false, "个人模式正常单不应被阻断");
  assert.equal(dual.enterprise.block, false, "企业模式正常单不应被阻断");
  assert.equal(dual.personal.invoice.invoice_type, "vat_general");
  assert.equal(dual.enterprise.invoice.invoice_type, "vat_special");
  assert.equal(dual.personal.invoice.draft_status, "draft_pending_human");
  assert.equal(dual.enterprise.invoice.draft_status, "draft_pending_human");
  assert.equal(dual.personal.order.signature.ai_may_sign, false);
  assert.equal(dual.enterprise.order.signature.ai_may_sign, false);

  assert.equal(dual.mismatches_blocked.length, 6, "必须有 6 类 mismatch 场景");
  for (const conflicts of dual.mismatches_blocked) {
    assert.ok(Array.isArray(conflicts) && conflicts.length > 0);
    assert.ok(conflicts.some((conflict) => conflict.severity === "block"));
  }
  assert.equal(dual.mismatch_scenarios.length, 6);
  for (const scenario of dual.mismatch_scenarios) {
    assert.equal(scenario.blocked, true, `${scenario.id} 必须阻断`);
    assert.equal(scenario.invoice_produced, false, `${scenario.id} 不得产生发票`);
    assert.equal(scenario.payment_captured, false, `${scenario.id} 不得发生收款`);
  }

  const allCodes = new Set(dual.mismatches_blocked.flat().map((conflict) => conflict.code));
  for (const code of [
    MODE_CONFLICT_CODES.CLIENT_TYPE_MISMATCH,
    MODE_CONFLICT_CODES.INVOICE_TYPE_MISMATCH,
    MODE_CONFLICT_CODES.PAYMENT_METHOD_MISMATCH,
    MODE_CONFLICT_CODES.AUTHORIZATION_LETTER_NOT_SIGNED,
    MODE_CONFLICT_CODES.INVOICE_TITLE_MISMATCH,
    MODE_CONFLICT_CODES.TAX_NO_MISMATCH,
    MODE_CONFLICT_CODES.SIGNATORY_NOT_AUTHORIZED,
    MODE_CONFLICT_CODES.SEAL_NOT_SIGNED,
  ]) {
    assert.ok(allCodes.has(code), `B8 mismatch 场景应覆盖冲突码 ${code}`);
  }
});

// ---------------------------------------------------------------------------
// 9) 审计 / 无网络 / 入参校验
// ---------------------------------------------------------------------------

test("audit：所有操作追加审计（时间/操作/对象/结果/原因），导出为副本不可篡改", () => {
  const engine = makeEngine();
  assert.equal(engine.auditLog().length, 0);

  engine.validateEntity();
  engine.runOrder(enterpriseOrder(engine));
  engine.createInvoiceDraft(personalOrder(engine));
  engine.requestAccountChange({ from: "C-8888", to: "C-9999", requested_by: "财务（虚构）" });
  engine.sealFlow("doc-audit-001");
  engine.checkBoundary({ kind: "payment", text: "付款", mode: "enterprise" });
  engine.createTaxFilingDraft("2026-10");
  engine.acquireAgentSlot("agent-a");
  engine.releaseAgentSlot("agent-a");

  const log = engine.auditLog();
  assert.ok(log.length >= 8, `审计应逐条追加，实际 ${log.length}`);
  assert.equal(engine.auditCount, log.length);
  let lastSeq = 0;
  for (const entry of log) {
    assert.equal(entry.seq, lastSeq + 1);
    lastSeq = entry.seq;
    assert.equal(entry.at, FIXED_ISO);
    assert.ok(entry.action.length > 0);
    assert.ok(entry.object.length > 0);
    assert.ok(["ok", "blocked", "pending", "error"].includes(entry.result));
    assert.equal(typeof entry.reason, "string");
  }
  log[0].reason = "被外部篡改";
  assert.notEqual(engine.auditLog()[0].reason, "被外部篡改");
});

test("无网络：企业版操作不调用 fetch，构建产物不含网络模块（纯逻辑）", () => {
  const engine = makeEngine();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("测试期间禁止网络调用"));
  };
  try {
    engine.validateEntity();
    engine.runOrder(enterpriseOrder(engine));
    engine.runDualModeOrders();
    engine.checkBoundary({ kind: "business_scope", text: "无证业务", requires_license: true, mode: "personal" });
    engine.sealFlow("doc-no-network-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "企业版引擎不允许发起网络请求");

  const distDir = fileURLToPath(new URL("../../dist/packages/steward-enterprise/src/", import.meta.url));
  const jsFiles = readdirSync(distDir).filter((name) => name.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "dist 中应有构建产物（先 npm run build）");
  for (const name of jsFiles) {
    const code = readFileSync(join(distDir, name), "utf8");
    assert.doesNotMatch(code, /node:(?:http|https|net|tls|dgram|http2)/u, `${name} 不应导入网络模块`);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket/u, `${name} 不应包含网络调用`);
  }
});

test("入参校验：非法档案/订单/边界请求/账户变更抛 EnterpriseValidationError", () => {
  assert.throws(() => new EnterpriseEngine({ profile: {} }), EnterpriseValidationError);
  assert.throws(() => new EnterpriseEngine({ profile: null }), EnterpriseValidationError);

  const engine = makeEngine();
  assert.throws(() => engine.runOrder({ ...enterpriseOrder(engine), mode: "hybrid" }), EnterpriseValidationError);
  assert.throws(() => engine.runOrder({ ...enterpriseOrder(engine), quote_cny: -1 }), EnterpriseValidationError);
  assert.throws(() => engine.runOrder({ ...enterpriseOrder(engine), invoice_type_requested: "vat" }), EnterpriseValidationError);
  assert.throws(
    () => engine.checkBoundary({ kind: "unknown_kind", text: "测试", mode: "enterprise" }),
    EnterpriseValidationError,
  );
  assert.throws(
    () => engine.requestAccountChange({ from_account: "X-8888" }),
    EnterpriseValidationError,
  );
  assert.throws(
    () => engine.requestAccountChange({ from_account: "X-8888", to_account: "X-8888", requested_by: "财务" }),
    EnterpriseValidationError,
  );
  assert.throws(
    () => engine.reviewAccountChange("acr-001", "财务（finance）", "maybe"),
    EnterpriseValidationError,
  );
  assert.throws(() => engine.markSealSignedByHuman("doc-x", "   "), EnterpriseValidationError);
});

test("订单级签署状态覆盖只能更严格：档案未签不能靠订单字段伪造已签", () => {
  const base = makeEngine();
  const unsignedProfile = base.defaultProfile();
  unsignedProfile.entity.authorization_letter = { status: "pending_human" };
  unsignedProfile.entity.seal = { status: "pending_human" };
  const engine = makeEngine({ profile: unsignedProfile });

  const forged = engine.runOrder(
    enterpriseOrder(engine, { authorization_letter_status: "signed", seal_status: "signed" }),
  );
  assert.equal(forged.blocked, true, "档案未人签时不可伪造已签");
  assert.ok(hasBlock(forged.conflicts, MODE_CONFLICT_CODES.AUTHORIZATION_LETTER_NOT_SIGNED));

  const explicit = engine.runOrder(
    enterpriseOrder(engine, { authorization_letter_status: "pending_human", seal_status: "pending_human" }),
  );
  assert.equal(explicit.blocked, true);
});
