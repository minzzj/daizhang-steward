/**
 * v1.1-A + v1.2-A + v1.3-A + v1.4-C / 配置中心单元测试。
 *
 * v1.1：三模式默认值差异、模式切换、14 个功能开关逐项禁用、0 元极限预算、预算三层、
 * Token 预算、银行卡/微信/支付宝掩码、支付渠道过滤、保存/加载/导入导出/校验、reset、
 * resetData（白名单+防穿越）、审计、个人模式禁令、企业模式主体必填。
 * v1.2：多模型路由/各 agent 不同模型、API 密钥引用（env/本地 secrets，绝不入库）、
 * 一键同步同一密钥、密钥掩码、系统提示词（总调度管理）、旧配置迁移。
 * v1.3：两层总调度（supervisor 系统总控第 11 角色）、易支付 epay、系统动作策略
 * （受管程序/插件/危险动作二次确认）。
 * v1.4：运行时设置（发消息自动执行/审批策略 auto_low_risk|auto_all|manual/
 * full_auto/步骤上限/返工/事件保留）+ 迁移、校验与审计。
 *
 * 全部使用 mkdtemp 临时目录或纯内存模式；不写仓库 runs/。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_ROLES,
  BudgetLimitError,
  CONFIG_VERSION,
  ConfigEngine,
  ConfigIOError,
  ConfigValidationError,
  DEFAULT_CONDUCTOR_PROMPT,
  FeatureDisabledError,
  FEATURE_NAMES,
  RESETTABLE_SUBDIRS,
  SYSTEM_PROMPT_ROLES,
  TokenLimitError,
  defaultsForMode,
  hasSafetyKeyword,
  isValidApiKeyRef,
  maskAccount,
  maskApiKeyRef,
  validateConfig,
} from "../../dist/packages/steward-config/src/index.js";

const FIXED_ISO = "2026-10-26T08:00:00.000Z";

function makeClock(iso = FIXED_ISO) {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
    iso: () => current.toISOString(),
  };
}

function makeEngine(options = {}) {
  const clock = options.clock ?? makeClock();
  return new ConfigEngine({ persist: false, now: clock.now, ...options, clock: undefined });
}

function makePersistEngine(root, options = {}) {
  const clock = options.clock ?? makeClock();
  return new ConfigEngine({ root, now: clock.now, ...options, clock: undefined });
}

async function makeTmp(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function readConfigFile(root) {
  return JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
}

function readAuditFile(root) {
  const file = join(root, "config-audit.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// 1) 三模式默认值
// ---------------------------------------------------------------------------

test("默认值：demo 体验模式（演示数据/支付人工确认/预算 5 万/token 1M/企业能力关闭）", () => {
  const engine = makeEngine({ mode: "demo" });
  const config = engine.config;
  assert.equal(config.profile.mode, "demo");
  assert.equal(config.profile.operator_type, "individual");
  assert.equal(config.features.demo_data.enabled, true);
  assert.equal(config.features.enterprise.enabled, false);
  assert.equal(config.features.payments.enabled, true);
  assert.equal(config.features.auto_send.enabled, false, "对外自动发送默认必须关闭");
  assert.equal(config.budgets.month_cny, 50_000);
  assert.equal(config.token_budget.limit_tokens, 1_000_000);
  assert.equal(config.payments.providers.length, 1);
  assert.equal(config.payments.providers[0].kind, "manual");
  assert.equal(config.payments.providers[0].mode, "manual_approval");
  assert.equal(engine.validate().ok, true);
});

test("默认值：personal 个人模式（微信/支付宝/个人银行卡、无签字/无双人复核、token 2M）", () => {
  const engine = makeEngine({ mode: "personal" });
  const config = engine.config;
  assert.equal(config.profile.mode, "personal");
  assert.equal(config.profile.operator_type, "individual");
  const kinds = config.payments.providers.map((provider) => provider.kind).sort();
  assert.deepEqual(kinds, ["alipay", "personal_bank_card", "wechat_pay"]);
  for (const provider of config.payments.providers) {
    assert.equal(provider.enabled, true);
    assert.equal(provider.mode, "manual_approval");
  }
  assert.equal(config.payments.payout_account.type, "personal");
  assert.match(config.payments.payout_account.card_no_masked, /6789$/u);
  assert.equal(config.payments.payout_account.wechat_id_masked.includes("*"), true);
  assert.equal(config.payments.sign_contract, false, "个人模式无需合同签署流程");
  assert.equal(config.payments.require_dual_review, false, "个人模式无需双人复核");
  assert.equal(config.payments.ai_may_sign, false);
  assert.ok(["none", "personal_receipt"].includes(config.payments.invoice.default_type));
  assert.equal(config.budgets.month_cny, 5_000);
  assert.equal(config.budgets.project_cny, 2_000);
  assert.equal(config.budgets.per_txn_cny, 500);
  assert.equal(config.token_budget.limit_tokens, 2_000_000);
  assert.equal(engine.validate().ok, true);
});

test("默认值：enterprise 企业模式（对公/专票/双人复核/主体必填/token 10,000,000）", () => {
  const engine = makeEngine({ mode: "enterprise" });
  const config = engine.config;
  assert.equal(config.profile.mode, "enterprise");
  assert.equal(config.profile.operator_type, "company");
  assert.ok(config.profile.company !== undefined);
  for (const field of ["name", "license_no_masked", "tax_no_masked", "legal_representative", "agent_name"]) {
    assert.equal(typeof config.profile.company[field], "string");
    assert.ok(config.profile.company[field].length > 0);
    assert.ok(config.profile.company[field].includes("*") || !/no/.test(field));
  }
  assert.ok(config.payments.providers.some((provider) => provider.kind === "corporate_account" && provider.enabled));
  assert.equal(config.payments.payout_account.type, "corporate");
  assert.equal(config.payments.invoice.default_type, "vat_special");
  assert.equal(config.payments.require_dual_review, true);
  assert.equal(config.payments.sign_contract, true);
  assert.equal(config.payments.ai_may_sign, false);
  assert.equal(config.budgets.month_cny, 50_000);
  assert.equal(config.budgets.project_cny, 20_000);
  assert.equal(config.budgets.per_txn_cny, 5_000);
  assert.equal(config.token_budget.limit_tokens, 10_000_000, "本次测试值 10,000,000 tokens");
  assert.equal(engine.validate().ok, true);
});

test("defaultsForMode：纯函数与引擎方法一致，三种模式默认值都能通过 validate", () => {
  const now = makeClock().now;
  for (const mode of ["demo", "personal", "enterprise"]) {
    const pure = defaultsForMode(mode, { now });
    const viaEngine = makeEngine({ mode }).defaultsForMode(mode);
    assert.equal(pure.profile.mode, mode);
    assert.deepEqual(viaEngine.features, pure.features);
    const validation = validateConfig(pure);
    assert.equal(validation.ok, true, `${mode} 默认值必须通过校验：${JSON.stringify(validation.errors)}`);
    assert.equal(pure.version, CONFIG_VERSION);
  }
  const engine = makeEngine({ mode: "personal" });
  assert.equal(engine.defaultAgents().length, AGENT_ROLES.length);
});

// ---------------------------------------------------------------------------
// 2) 模式切换
// ---------------------------------------------------------------------------

test("setMode：personal → enterprise 应用支付/发票/审批/主体默认值，保留自定义预算，返回 diff", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setBudgets({ month_cny: 8_888, project_cny: 4_000, per_txn_cny: 900 });
  const diff = engine.setMode("enterprise");
  assert.equal(diff.from, "personal");
  assert.equal(diff.to, "enterprise");
  assert.ok(diff.changed.length > 0);
  assert.ok(diff.changed.includes("profile.mode"));
  assert.ok(diff.changed.some((path) => path.startsWith("payments")));
  assert.equal(diff.changed.some((path) => path.startsWith("budgets")), false, "默认保留自定义预算");
  assert.equal(engine.config.profile.mode, "enterprise");
  assert.equal(engine.config.profile.operator_type, "company");
  assert.ok(engine.config.profile.company !== undefined);
  assert.equal(engine.config.payments.invoice.default_type, "vat_special");
  assert.equal(engine.config.payments.require_dual_review, true);
  assert.equal(engine.config.payments.sign_contract, true);
  assert.ok(engine.config.payments.providers.some((provider) => provider.kind === "corporate_account"));
  assert.equal(engine.config.budgets.month_cny, 8_888, "自定义预算被保留");
  assert.equal(engine.validate().ok, true);
  assert.ok(engine.auditTrail().some((entry) => entry.action === "mode.switch"));
});

test("setMode：enterprise → personal 去掉企业主体/专票/双人复核；显式 preserve_budgets:false 重置预算", () => {
  const engine = makeEngine({ mode: "enterprise" });
  engine.setBudgets({ month_cny: 12_345, project_cny: 6_000, per_txn_cny: 1_000 });
  const diff = engine.setMode("personal", { preserve_budgets: false });
  assert.ok(diff.changed.includes("profile.mode"));
  assert.equal(engine.config.profile.operator_type, "individual");
  assert.equal(engine.config.profile.company, undefined, "个人模式不应带企业主体");
  assert.equal(engine.config.payments.invoice.default_type, "none");
  assert.equal(engine.config.payments.require_dual_review, false);
  assert.equal(engine.config.payments.sign_contract, false);
  assert.deepEqual(
    engine.config.payments.providers.map((provider) => provider.kind).sort(),
    ["alipay", "personal_bank_card", "wechat_pay"],
  );
  assert.equal(engine.config.budgets.month_cny, 5_000, "显式重置为目标模式默认预算");
  assert.equal(engine.validate().ok, true);
});

test("setMode：同模式返回空 diff；非法模式抛 ConfigValidationError", () => {
  const engine = makeEngine({ mode: "personal" });
  const diff = engine.setMode("personal");
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.from, "personal");
  assert.throws(() => engine.setMode("unknown"), (error) => error instanceof ConfigValidationError);
});

// ---------------------------------------------------------------------------
// 3) 功能开关（所有功能可逐项禁用）
// ---------------------------------------------------------------------------

test("setFeature：禁用后 checkFeature 返回 allowed:false + 可读原因（含“该功能已被用户禁用”）", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.equal(engine.checkFeature("scout").allowed, true);
  engine.setFeature("scout", { enabled: false });
  const result = engine.checkFeature("scout");
  assert.equal(result.allowed, false);
  assert.equal(result.feature, "scout");
  assert.match(result.reason, /该功能已被用户禁用/u);
  engine.setFeature("scout", { enabled: true });
  assert.equal(engine.checkFeature("scout").allowed, true);
});

test("setFeature：requires_approval 可配置；缺省保留原值；未知功能名抛错", () => {
  const engine = makeEngine({ mode: "personal" });
  const toggle = engine.setFeature("auto_send", { enabled: true, requiresApproval: true });
  assert.equal(toggle.enabled, true);
  assert.equal(toggle.requires_approval, true);
  const check = engine.checkFeature("auto_send");
  assert.equal(check.allowed, true);
  assert.equal(check.requires_approval, true);
  engine.setFeature("payments", { enabled: false });
  assert.throws(() => engine.setFeature("not-a-feature", { enabled: true }), (error) => error instanceof ConfigValidationError);
  assert.throws(() => engine.checkFeature("not-a-feature"), (error) => error instanceof ConfigValidationError);
});

test("assertFeature：禁用时抛 FeatureDisabledError；14 项功能名齐全且默认 auto_send 关闭", () => {
  const engine = makeEngine({ mode: "demo" });
  assert.equal(Object.keys(engine.config.features).length, FEATURE_NAMES.length);
  assert.equal(engine.checkFeature("auto_send").allowed, false);
  assert.throws(
    () => engine.assertFeature("auto_send"),
    (error) => error instanceof FeatureDisabledError && error.feature === "auto_send" && /禁用/u.test(error.message),
  );
  const enabled = engine.assertFeature("browser");
  assert.equal(enabled.allowed, true);
});

test("checkFeature：个人模式下企业能力即使开启也被模式限制（原因含企业模式）", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setFeature("enterprise", { enabled: true });
  const result = engine.checkFeature("enterprise");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /企业模式/u);
});

// ---------------------------------------------------------------------------
// 4) 预算三层 + 0 元极限模式
// ---------------------------------------------------------------------------

test("0 元极限模式：任何 amount>0 一律拒绝（requiresHuman:true），免费本地动作按开关放行", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setBudgets({ zero_budget_mode: true });
  const denied = engine.checkBudget("per_txn", 100);
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiresHuman, true);
  assert.match(denied.reason, /0 元极限模式/u);
  assert.equal(denied.zero_budget_mode, true);
  const free = engine.checkBudget("per_txn", 0);
  assert.equal(free.allowed, true, "allow_free_local_actions=true 时 0 元免费动作放行");
  assert.equal(free.requiresHuman, false);
  engine.setBudgets({ allow_free_local_actions: false });
  const freeDenied = engine.checkBudget("per_txn", 0);
  assert.equal(freeDenied.allowed, false);
  assert.match(freeDenied.reason, /allow_free_local_actions/u);
});

test("预算三层：单笔/项目/月任一超限都拒绝（requiresHuman:true），不超限放行", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setBudgets({ month_cny: 2_500, project_cny: 2_000, per_txn_cny: 1_000 });
  const perTxn = engine.checkBudget("per_txn", 1_500);
  assert.equal(perTxn.allowed, false);
  assert.match(perTxn.reason, /单笔/u);
  assert.equal(perTxn.requiresHuman, true);
  assert.equal(engine.checkBudget("per_txn", 1_000).allowed, true);

  engine.setBudgets({ project_cny: 800, per_txn_cny: 500 });
  const project = engine.checkBudget("project", 800 > 0 ? 900 : 0);
  assert.equal(project.allowed, false);
  assert.match(project.reason, /项目/u);
  assert.equal(project.requiresHuman, true);

  engine.setBudgets({ month_cny: 1_500, project_cny: 1_000, per_txn_cny: 500 });
  assert.equal(engine.checkBudget("month", 1_500).allowed, true);
  const month = engine.checkBudget("month", 1_501);
  assert.equal(month.allowed, false);
  assert.match(month.reason, /月/u);
  assert.equal(month.remaining_cny >= 0, true);
});

test("预算：非法金额/非法层级抛 ConfigValidationError；assertBudget 抛 BudgetLimitError", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.throws(() => engine.checkBudget("per_txn", -1), (error) => error instanceof ConfigValidationError);
  assert.throws(() => engine.checkBudget("unknown", 10), (error) => error instanceof ConfigValidationError);
  engine.setBudgets({ per_txn_cny: 10 });
  assert.throws(
    () => engine.assertBudget("per_txn", 100),
    (error) => error instanceof BudgetLimitError && error.kind === "per_txn" && error.limit_cny === 10 && error.amount_cny === 100,
  );
  assert.equal(engine.assertBudget("per_txn", 5).allowed, true);
  // 非法三层关系（单笔 > 项目）应拒绝更新并保留原配置
  const before = engine.config.budgets;
  assert.throws(() => engine.setBudgets({ per_txn_cny: 9_999 }), (error) => error instanceof ConfigValidationError);
  assert.deepEqual(engine.config.budgets, before);
});

// ---------------------------------------------------------------------------
// 5) Token 预算（可配置 10,000,000）
// ---------------------------------------------------------------------------

test("Token：配置 10,000,000 后累计/剩余/按 agent 统计/历史正确", () => {
  const engine = makeEngine({ mode: "personal" });
  const tokenConfig = engine.setTokenBudget({ limit_tokens: 10_000_000, per_action_limit: 200_000 });
  assert.equal(tokenConfig.limit_tokens, 10_000_000);
  assert.equal(engine.tokenBudget.remaining(), 10_000_000);
  const result = engine.tokenBudget.consume(1_500, { agentRole: "conductor", action: "browser.flow" });
  assert.equal(result.ok, true);
  assert.equal(result.used_tokens, 1_500);
  assert.equal(result.remaining_tokens, 9_998_500);
  assert.equal(engine.tokenBudget.remaining(), 9_998_500);
  const usage = engine.tokenBudget.usageByAgent();
  const conductor = usage.find((item) => item.role === "conductor");
  assert.ok(conductor !== undefined);
  assert.equal(conductor.tokens, 1_500);
  assert.equal(conductor.calls, 1);
  const history = engine.tokenBudget.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].agent_role, "conductor");
  assert.equal(history[0].action, "browser.flow");
  assert.equal(history[0].amount, 1_500);
  assert.equal(history[0].ok, true);
  assert.equal(engine.config.token_budget.used_tokens, 1_500);
});

test("Token：单步上限超限拒绝（不扣减，ok:false + 可读原因）", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setTokenBudget({ limit_tokens: 10_000_000, per_action_limit: 200_000 });
  const result = engine.tokenBudget.consume(200_001, { agentRole: "operator", action: "desktop.flow" });
  assert.equal(result.ok, false);
  assert.equal(result.per_action_exceeded, true);
  assert.match(result.reason, /单步/u);
  assert.equal(engine.config.token_budget.used_tokens, 0, "超限不得扣减");
});

test("Token：总量超限拒绝；on_exceed=block 时 blocked=true 且 consumeOrThrow 抛 TokenLimitError", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setTokenBudget({ limit_tokens: 1_000, per_action_limit: 5_000, on_exceed: "block" });
  assert.equal(engine.tokenBudget.consume(600, { agentRole: "finance", action: "ledger.record" }).ok, true);
  const denied = engine.tokenBudget.consume(600, { agentRole: "finance", action: "ledger.record" });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /总量/u);
  assert.equal(denied.blocked, true);
  assert.equal(engine.config.token_budget.used_tokens, 600);
  assert.throws(
    () => engine.tokenBudget.consumeOrThrow(600, { agentRole: "finance", action: "ledger.record" }),
    (error) => error instanceof TokenLimitError && error.layer === "total" && error.used_tokens === 600,
  );
});

test("Token：on_exceed=notify 时超限不标记 block；0 token 免费动作放行", () => {
  const engine = makeEngine({ mode: "demo" });
  engine.setTokenBudget({ limit_tokens: 100, per_action_limit: 100, on_exceed: "notify" });
  assert.equal(engine.tokenBudget.consume(0, { agentRole: "conductor", action: "noop" }).ok, true);
  assert.equal(engine.tokenBudget.consume(100, { agentRole: "conductor", action: "noop" }).ok, true);
  const denied = engine.tokenBudget.consume(10, { agentRole: "conductor", action: "noop" });
  assert.equal(denied.ok, false);
  assert.equal(denied.blocked, false);
});

test("Token：used_tokens 与用量历史随 config.json 持久化（重启恢复）", async () => {
  const root = await makeTmp("steward-config-token-");
  try {
    const engine = makePersistEngine(root);
    engine.setTokenBudget({ limit_tokens: 10_000_000, per_action_limit: 200_000 });
    engine.tokenBudget.consume(2_500, { agentRole: "harness", action: "harness.request" });
    const reloaded = makePersistEngine(root);
    assert.equal(reloaded.config.token_budget.used_tokens, 2_500);
    assert.equal(reloaded.tokenBudget.remaining(), 9_997_500);
    assert.equal(reloaded.tokenBudget.history().length, 1);
    assert.equal(reloaded.tokenBudget.history()[0].agent_role, "harness");
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 6) 银行卡 / 微信 / 支付宝掩码
// ---------------------------------------------------------------------------

test("掩码：setPayoutAccount 自动打码，config.json 不出现明文卡号/微信/支付宝 id", async () => {
  const root = await makeTmp("steward-config-mask-");
  try {
    const engine = makePersistEngine(root, { mode: "personal" });
    const payout = engine.setPayoutAccount({
      holder: "张三",
      bank_name: "招商银行",
      card_no: "6222021234567890",
      wechat_id: "wx_abc123456",
      alipay_id: "alipay_9988776655",
    });
    assert.equal(payout.card_no_masked, "**** **** **** 7890");
    assert.equal(payout.card_no_masked.includes("6222"), false);
    assert.match(payout.wechat_id_masked, /\*/u);
    assert.equal(payout.wechat_id_masked.includes("abc123456"), false);
    assert.match(payout.alipay_id_masked, /\*/u);
    assert.equal(payout.alipay_id_masked.includes("9988776655"), false);
    const raw = await readFile(join(root, "config.json"), "utf8");
    assert.equal(raw.includes("6222021234567890"), false, "配置文件不得出现明文卡号");
    assert.equal(raw.includes("wx_abc123456"), false, "配置文件不得出现明文微信 id");
    assert.equal(raw.includes("alipay_9988776655"), false, "配置文件不得出现明文支付宝 id");
  } finally {
    await cleanup(root);
  }
});

test("掩码：maskAccount 自动区分银行卡与账号 id；支付渠道 account 直接传明文也会掩码", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.equal(engine.maskAccount("6222021234567890"), "**** **** **** 7890");
  assert.equal(engine.maskAccount("wxid_abcdefg").includes("abcdefg"), false);
  assert.match(engine.maskBankCard("6222 0212 3456 7890"), /\*{4} \*{4} \*{4} 7890/u);
  assert.match(engine.maskTaxNo("91330100MA2ABCDE12"), /\*{6}/u);
  const provider = engine.setPaymentProvider("personal-card", { account: "6222021234567890" });
  assert.equal(provider.account_masked, "**** **** **** 7890");
  assert.equal(provider.account_masked.includes("6222"), false);
});

// ---------------------------------------------------------------------------
// 7) 支付渠道
// ---------------------------------------------------------------------------

test("paymentProviders：enabledOnly 过滤；禁用/disabled 渠道被排除", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.equal(engine.paymentProviders().length, 3);
  assert.equal(engine.paymentProviders({ enabledOnly: true }).length, 3);
  engine.setPaymentProvider("wechat", { enabled: false });
  assert.equal(engine.paymentProviders({ enabledOnly: true }).length, 2);
  assert.ok(engine.paymentProviders({ enabledOnly: true }).every((provider) => provider.id !== "wechat"));
  engine.setPaymentProvider("alipay", { mode: "disabled" });
  assert.ok(engine.paymentProviders({ enabledOnly: true }).every((provider) => provider.id !== "alipay"));
  assert.throws(() => engine.setPaymentProvider("nope", { enabled: true }), (error) => error instanceof ConfigValidationError);
});

test("setInvoiceConfig / setPaymentsPolicy：个人模式拒绝专票/合同签署；企业模式要求双人复核", () => {
  const personal = makeEngine({ mode: "personal" });
  assert.throws(
    () => personal.setInvoiceConfig({ default_type: "vat_special", title: "示例公司", tax_no_masked: "9133******20" }),
    (error) => error instanceof ConfigValidationError && /专票|校验失败/u.test(error.message),
  );
  const invoice = personal.setInvoiceConfig({ default_type: "personal_receipt", title: "个人抬头" });
  assert.equal(invoice.default_type, "personal_receipt");
  assert.throws(() => personal.setPaymentsPolicy({ sign_contract: true }), (error) => error instanceof ConfigValidationError);
  assert.throws(() => personal.setPaymentsPolicy({ require_dual_review: true }), (error) => error instanceof ConfigValidationError);

  const enterprise = makeEngine({ mode: "enterprise" });
  assert.throws(
    () => enterprise.setPaymentsPolicy({ require_dual_review: false }),
    (error) => error instanceof ConfigValidationError && /双人复核/u.test(error.message),
  );
  assert.throws(
    () => enterprise.setInvoiceConfig({ default_type: "none" }),
    (error) => error instanceof ConfigValidationError && /发票类型/u.test(error.message),
  );
});

// ---------------------------------------------------------------------------
// 8) 保存 / 加载 / 导入导出 / 校验
// ---------------------------------------------------------------------------

test("save/load：持久化到 config.json（原子 JSON），重启后配置恢复", async () => {
  const root = await makeTmp("steward-config-save-");
  try {
    const engine = makePersistEngine(root);
    assert.ok(existsSync(join(root, "config.json")), "构造时应生成默认配置文件");
    engine.setFeature("scout", { enabled: false });
    engine.setBudgets({ month_cny: 7_000, project_cny: 3_000, per_txn_cny: 600 });
    engine.setTokenBudget({ limit_tokens: 10_000_000 });
    engine.save();
    const raw = readConfigFile(root);
    assert.equal(raw.version, CONFIG_VERSION);
    assert.equal(typeof raw.updated_at, "string");
    assert.equal(raw.features.scout.enabled, false);

    const reloaded = makePersistEngine(root);
    assert.equal(reloaded.config.features.scout.enabled, false);
    assert.equal(reloaded.config.budgets.month_cny, 7_000);
    assert.equal(reloaded.config.token_budget.limit_tokens, 10_000_000);
    assert.equal(reloaded.validate().ok, true);
  } finally {
    await cleanup(root);
  }
});

test("export/import：JSON 往返一致；非法 JSON/非法配置抛 ConfigValidationError", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setFeature("content", { enabled: false });
  engine.setBudgets({ month_cny: 1_234, project_cny: 1_000, per_txn_cny: 100 });
  const exported = engine.export();
  assert.equal(typeof exported, "string");
  const parsed = JSON.parse(exported);
  assert.equal(parsed.features.content.enabled, false);

  const target = makeEngine({ mode: "demo" });
  const imported = target.import(exported);
  assert.equal(imported.profile.mode, "personal");
  assert.equal(imported.features.content.enabled, false);
  assert.equal(imported.budgets.month_cny, 1_234);

  assert.throws(() => engine.import("{ not json"), (error) => error instanceof ConfigValidationError && /JSON/u.test(error.message));
  const invalid = JSON.parse(exported);
  invalid.budgets.per_txn_cny = -100;
  assert.throws(() => engine.import(JSON.stringify(invalid)), (error) => error instanceof ConfigValidationError);
  const inconsistent = JSON.parse(exported);
  inconsistent.payments.invoice.default_type = "vat_special";
  inconsistent.payments.invoice.title = "示例公司";
  inconsistent.payments.invoice.tax_no_masked = "9133******20";
  assert.throws(() => engine.import(JSON.stringify(inconsistent)), (error) => error instanceof ConfigValidationError && /专用发票|专票/u.test(error.message));
});

test("validate：个人模式禁止企业专票/对公账户；企业模式缺主体字段报错", () => {
  const base = defaultsForMode("personal", { now: makeClock().now });
  const specialInvoice = JSON.parse(JSON.stringify(base));
  specialInvoice.payments.invoice = { default_type: "vat_special", title: "示例公司", tax_no_masked: "9133******20", draft_only: true };
  const invoiceResult = validateConfig(specialInvoice);
  assert.equal(invoiceResult.ok, false);
  assert.ok(invoiceResult.errors.some((item) => /专用发票|专票/u.test(item.message)));

  const corporate = JSON.parse(JSON.stringify(base));
  corporate.payments.providers = [
    { id: "corp", kind: "corporate_account", name: "对公", enabled: true, mode: "manual_approval", account_masked: "**** 5678" },
  ];
  corporate.payments.payout_account.type = "corporate";
  const corporateResult = validateConfig(corporate);
  assert.equal(corporateResult.ok, false);
  assert.ok(corporateResult.errors.some((item) => /对公账户/u.test(item.message)));

  const enterprise = defaultsForMode("enterprise", { now: makeClock().now });
  const missingCompany = JSON.parse(JSON.stringify(enterprise));
  delete missingCompany.profile.company;
  const companyResult = validateConfig(missingCompany);
  assert.equal(companyResult.ok, false);
  assert.ok(companyResult.errors.some((item) => /企业主体字段/u.test(item.message)));

  const individualOperator = JSON.parse(JSON.stringify(enterprise));
  individualOperator.profile.operator_type = "individual";
  const operatorResult = validateConfig(individualOperator);
  assert.equal(operatorResult.ok, false);
  assert.ok(operatorResult.errors.some((item) => /operator_type/u.test(item.message)));
});

// ---------------------------------------------------------------------------
// 9) reset / resetData / 审计
// ---------------------------------------------------------------------------

test("reset：恢复指定模式默认值、清空 token 用量，并写审计", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setFeature("browser", { enabled: false });
  engine.setTokenBudget({ limit_tokens: 10_000_000 });
  engine.tokenBudget.consume(500, { agentRole: "conductor", action: "browser.flow" });
  const reset = engine.reset("enterprise");
  assert.equal(reset.profile.mode, "enterprise");
  assert.equal(reset.features.browser.enabled, true, "恢复默认后功能重新开启");
  assert.equal(reset.token_budget.limit_tokens, 10_000_000, "企业模式默认 token 10M");
  assert.equal(reset.token_budget.used_tokens, 0);
  assert.equal(engine.tokenBudget.history().length, 0);
  assert.ok(engine.auditTrail().some((entry) => entry.action === "config.reset"));
});

test("resetData：只删白名单子目录，保留 config/非白名单目录，统计正确且不越出 dataRoot", async () => {
  const base = await makeTmp("steward-config-resetdata-");
  try {
    const dataRoot = join(base, "data");
    const engine = makePersistEngine(dataRoot);
    // 白名单子目录（有文件）
    for (const dir of ["runs", "domain", "evidence", "ledger", "events"]) {
      await mkdir(join(dataRoot, "x".repeat(0) + dir), { recursive: true });
      await writeFile(join(dataRoot, dir, "file.txt"), `content-${dir}`, "utf8");
    }
    // 非白名单目录与兄弟目录（必须保留）
    await mkdir(join(dataRoot, "keepdir"), { recursive: true });
    await writeFile(join(dataRoot, "keepdir", "keep.txt"), "keep", "utf8");
    await mkdir(join(base, "outside"), { recursive: true });
    await writeFile(join(base, "outside", "outside.txt"), "outside", "utf8");
    const configBefore = await readFile(join(dataRoot, "config.json"), "utf8");

    const result = engine.resetData(dataRoot);
    assert.equal(result.data_root.includes("data"), true);
    assert.equal(result.deleted.length, 5);
    assert.ok(result.deleted.every((path) => path.startsWith(dataRoot)));
    assert.ok(result.files_deleted >= 5);
    assert.ok(result.bytes_freed > 0);
    assert.ok(result.missing.some((path) => path.endsWith("notifications")));
    assert.ok(RESETTABLE_SUBDIRS.length >= 5);
    for (const dir of ["runs", "domain", "evidence", "ledger", "events"]) {
      assert.equal(existsSync(join(dataRoot, dir)), false);
    }
    assert.equal(existsSync(join(dataRoot, "keepdir", "keep.txt")), true, "非白名单目录必须保留");
    assert.equal(existsSync(join(dataRoot, "config.json")), true, "配置文件必须保留");
    assert.equal(await readFile(join(dataRoot, "config.json"), "utf8"), configBefore);
    assert.equal(existsSync(join(base, "outside", "outside.txt")), true, "不得越出 dataRoot 删除");
    assert.throws(() => engine.resetData(""), (error) => error instanceof ConfigValidationError);
    const nonexistent = engine.resetData(join(base, "no-such-dir"));
    assert.equal(nonexistent.deleted.length, 0);
    assert.ok(nonexistent.preserved.length > 0);
  } finally {
    await cleanup(base);
  }
});

test("审计：配置变更 / 预算拒绝 / Token 超限都留痕（时间/操作/对象/结果/原因，seq 递增）", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setFeature("scout", { enabled: false });
  engine.checkFeature("scout");
  engine.checkBudget("per_txn", 99_999);
  engine.setTokenBudget({ limit_tokens: 100, per_action_limit: 100 });
  engine.tokenBudget.consume(500, { agentRole: "operator", action: "browser.flow" });
  const audit = engine.auditTrail();
  assert.ok(audit.length >= 4);
  const actions = audit.map((entry) => entry.action);
  for (const expected of ["feature.update", "feature.check", "budget.deny", "token.exceed"]) {
    assert.ok(actions.includes(expected), `审计缺少 ${expected}`);
  }
  for (const entry of audit) {
    assert.equal(typeof entry.seq, "number");
    assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(typeof entry.action, "string");
    assert.equal(typeof entry.object, "string");
    assert.ok(["ok", "blocked", "failed"].includes(entry.result));
    assert.equal(typeof entry.reason, "string");
  }
  const seqs = audit.map((entry) => entry.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "seq 必须递增");
  const last = engine.auditTrail(1);
  assert.equal(last.length, 1);
  assert.equal(last[0].seq, seqs[seqs.length - 1]);
});

// ---------------------------------------------------------------------------
// 10) 代理注册表
// ---------------------------------------------------------------------------

test("AgentRegistry：11 个角色齐全，可逐项禁用/配置，用量按 agent 统计", () => {
  const engine = makeEngine({ mode: "personal" });
  const agents = engine.listAgents();
  assert.equal(agents.length, AGENT_ROLES.length);
  for (const role of AGENT_ROLES) assert.ok(agents.some((agent) => agent.role === role), `缺少角色 ${role}`);
  assert.ok(agents.every((agent) => agent.enabled === true));

  const disabled = engine.setAgentEnabled("scout", false);
  assert.equal(disabled.enabled, false);
  assert.equal(engine.listAgents().find((agent) => agent.role === "scout").enabled, false);
  assert.throws(
    () => engine.setAgentConfig("scout", { autonomy: "god-mode" }),
    (error) => error instanceof ConfigValidationError,
  );
  const updated = engine.setAgentConfig("scout", { autonomy: "readonly", token_limit: 500_000, model_ref: "deepseek-chat@v2" });
  assert.equal(updated.autonomy, "readonly");
  assert.equal(updated.token_limit, 500_000);
  engine.tokenBudget.consume(2_000, { agentRole: "conductor", action: "agent.dispatch" });
  const usage = engine.agentUsage("conductor");
  assert.equal(usage.tokens, 2_000);
  assert.equal(engine.agentUsage("not-a-role"), null);
  assert.equal(engine.defaultAgents("enterprise").length, AGENT_ROLES.length);
});

// ---------------------------------------------------------------------------
// 11) 其余参数可配置 + 内存模式 + 错误恢复
// ---------------------------------------------------------------------------

test("setProfile / setApprovalPolicy / setData：全部参数可配置，切换模式必须用 setMode", () => {
  const engine = makeEngine({ mode: "personal" });
  const profile = engine.setProfile({ principal_name: "张三", language: "en", timezone: "UTC" });
  assert.equal(profile.principal_name, "张三");
  assert.equal(profile.language, "en");
  assert.throws(() => engine.setProfile({ mode: "demo" }), (error) => error instanceof ConfigValidationError && /setMode/u.test(error.message));

  const approval = engine.setApprovalPolicy({ timeout_minutes: 30, dual_review_threshold_cny: 8_000, takeover_shortcut: "Ctrl+Shift+S" });
  assert.equal(approval.timeout_minutes, 30);
  assert.throws(() => engine.setApprovalPolicy({ auto_approve: true }), (error) => error instanceof ConfigValidationError);

  const data = engine.setData({ retention_days: 45 });
  assert.equal(data.retention_days, 45);
  assert.throws(() => engine.setData({ telemetry: true }), (error) => error instanceof ConfigValidationError);
  assert.equal(engine.config.data.telemetry, false);
});

test("内存模式：persist:false 不落盘，save/export/import/审计仍可用", async () => {
  const engine = new ConfigEngine({ persist: false, mode: "demo", now: makeClock().now });
  assert.equal(engine.persist, false);
  assert.equal(engine.root, null);
  assert.equal(engine.configPath, null);
  engine.save();
  assert.equal(typeof engine.export(), "string");
  const imported = engine.import(engine.export());
  assert.equal(imported.profile.mode, "demo");
  assert.ok(engine.auditTrail().length >= 1);
  const dir = await makeTmp("steward-config-memory-");
  try {
    assert.equal(existsSync(join(dir, "config.json")), false);
  } finally {
    await cleanup(dir);
  }
});

test("配置文件损坏/语义非法：构造引擎时明确报错（ConfigIOError / ConfigValidationError）", async () => {
  const brokenRoot = await makeTmp("steward-config-broken-");
  const invalidRoot = await makeTmp("steward-config-invalid-");
  try {
    await writeFile(join(brokenRoot, "config.json"), "{ this is not json", "utf8");
    assert.throws(() => new ConfigEngine({ root: brokenRoot }), (error) => error instanceof ConfigIOError && /损坏/u.test(error.message));

    const invalid = defaultsForMode("personal", { now: makeClock().now });
    invalid.budgets.per_txn_cny = 99_999;
    invalid.budgets.project_cny = 2_000;
    await writeFile(join(invalidRoot, "config.json"), JSON.stringify(invalid), "utf8");
    assert.throws(() => new ConfigEngine({ root: invalidRoot }), (error) => error instanceof ConfigValidationError);
  } finally {
    await cleanup(brokenRoot);
    await cleanup(invalidRoot);
  }
});

test("模式切换后企业主体字段/个人模式禁令仍生效（setMode 后 validate 通过）", () => {
  const engine = makeEngine({ mode: "demo" });
  const toEnterprise = engine.setMode("enterprise");
  assert.equal(toEnterprise.config.profile.operator_type, "company");
  assert.ok(toEnterprise.config.profile.company.legal_representative.length > 0);
  assert.equal(engine.validate().ok, true);
  const toPersonal = engine.setMode("personal");
  assert.equal(toPersonal.config.payments.sign_contract, false);
  assert.equal(toPersonal.config.payments.require_dual_review, false);
  assert.equal(engine.validate().ok, true);
});

// ===========================================================================
// v1.2-A：多模型 / API 密钥引用 / 一键同步 / 系统提示词
// ===========================================================================

test("v1.2 默认模型路由：4 个服务商、默认 DeepSeek、11 个 agent 绑定且可不同模型", () => {
  const personal = makeEngine({ mode: "personal" });
  const models = personal.config.models;
  assert.equal(models.providers.length, 4);
  assert.equal(models.default_provider_id, "deepseek");
  const deepseek = models.providers.find((provider) => provider.id === "deepseek");
  assert.ok(deepseek !== undefined);
  assert.equal(deepseek.kind, "deepseek");
  assert.equal(deepseek.enabled, true);
  assert.equal(deepseek.api_key_ref, "env:DEEPSEEK_API_KEY");
  assert.match(deepseek.base_url, /^https:\/\//u);
  assert.equal(models.sync_mode, "single_key_all", "个人模式默认一键同步同一密钥");
  const refs = new Set(models.providers.map((provider) => provider.api_key_ref));
  assert.equal(refs.size, 1, "single_key_all 模式下默认所有服务商引用一致");
  for (const role of AGENT_ROLES) assert.ok(models.agent_models[role] !== undefined, `缺少角色绑定 ${role}`);
  assert.equal(models.agent_models.conductor.model, "deepseek-reasoner");
  assert.equal(models.agent_models.operator.model, "deepseek-chat");
  const modelNames = new Set(Object.values(models.agent_models).map((binding) => binding.model));
  assert.ok(modelNames.size >= 2, "各 agent 默认可用不同模型");
  assert.ok(models.agent_models.conductor.temperature !== undefined);

  const enterprise = makeEngine({ mode: "enterprise" });
  assert.equal(enterprise.config.models.sync_mode, "per_provider", "企业模式默认各服务商独立密钥");
  assert.equal(enterprise.validate().ok, true);
  assert.equal(personal.validate().ok, true);
});

test("v1.2 默认系统提示词：11 个 agent 专业提示词（含安全关键词）+ 总调度核心提示词，总调度设置默认", () => {
  const engine = makeEngine({ mode: "personal" });
  const prompts = engine.listSystemPrompts();
  // 11 个角色（supervisor 系统总控 + conductor + operator/harness/customer/finance/reviewer/backend/scout/content/research）
  assert.equal(prompts.length, AGENT_ROLES.length);
  assert.equal(prompts.length + 1, AGENT_ROLES.length + 1, "11 个 agent 提示词 + 1 个总调度核心提示词（conductor_prompt）");
  for (const role of SYSTEM_PROMPT_ROLES) assert.ok(prompts.some((entry) => entry.role === role), `缺少 ${role} 提示词`);
  for (const entry of prompts) {
    assert.ok([...entry.system_prompt].length >= 20);
    assert.equal(hasSafetyKeyword(entry.system_prompt), true, `${entry.role} 提示词应含安全关键词`);
    assert.equal(typeof entry.updated_at, "string");
  }
  const conductor = engine.getConductorPrompt();
  assert.equal(conductor, DEFAULT_CONDUCTOR_PROMPT);
  for (const keyword of ["总调度", "证据", "审批", "不越界", "失败升级"]) {
    assert.ok(conductor.includes(keyword), `总调度提示词应包含 ${keyword}`);
  }
  const settings = engine.getOrchestratorSettings();
  assert.equal(settings.auto_plan, true);
  assert.equal(settings.max_steps_per_run, 20);
  assert.equal(settings.ask_before_commit, true);
  assert.equal(makeEngine({ mode: "demo" }).getOrchestratorSettings().max_steps_per_run, 10);
  assert.equal(makeEngine({ mode: "enterprise" }).getOrchestratorSettings().max_steps_per_run, 50);
});

test("v1.2 旧配置迁移：v1.1 config 缺 models/orchestrator 时自动补默认且保留已有字段", async () => {
  const root = await makeTmp("steward-config-migrate-");
  try {
    const oldConfig = defaultsForMode("personal", { now: makeClock().now });
    delete oldConfig.models;
    delete oldConfig.orchestrator;
    oldConfig.budgets.month_cny = 7_777;
    oldConfig.budgets.project_cny = 3_000;
    oldConfig.budgets.per_txn_cny = 600;
    oldConfig.features.scout.enabled = false;
    await writeFile(join(root, "config.json"), JSON.stringify(oldConfig, null, 2), "utf8");

    const engine = new ConfigEngine({ root, now: makeClock().now });
    assert.equal(engine.validate().ok, true);
    assert.equal(engine.config.budgets.month_cny, 7_777, "旧字段必须保留");
    assert.equal(engine.config.features.scout.enabled, false);
    assert.equal(engine.config.models.providers.length, 4, "缺失 models 自动补默认");
    assert.equal(engine.config.orchestrator.system_prompts.length, AGENT_ROLES.length, "缺失 orchestrator 自动补默认");
    engine.save();
    const persisted = readConfigFile(root);
    assert.ok(persisted.models !== undefined);
    assert.ok(persisted.orchestrator !== undefined);
    const reloaded = new ConfigEngine({ root, now: makeClock().now });
    assert.equal(reloaded.validate().ok, true);
  } finally {
    await cleanup(root);
  }
});

test("v1.2 upsertModelProvider：新增/更新服务商；非法 base_url/kind/空模型/id 抛错", () => {
  const engine = makeEngine({ mode: "personal" });
  const created = engine.upsertModelProvider({
    id: "my-openai",
    name: "自定义 OpenAI 兼容",
    kind: "openai_compatible",
    base_url: "https://api.example.com/v1",
    api_key_ref: "",
    enabled: true,
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  });
  assert.equal(created.id, "my-openai");
  assert.equal(created.api_key_ref, "env:DEEPSEEK_API_KEY", "一键同步模式下新服务商引用自动对齐");
  assert.equal(engine.listModelProviders().length, 5);
  const updated = engine.upsertModelProvider({ ...created, name: "改名后的服务商" });
  assert.equal(updated.name, "改名后的服务商");
  assert.equal(engine.listModelProviders().length, 5, "同 id 为更新而非新增");

  assert.throws(
    () => engine.upsertModelProvider({ ...created, id: "bad-url", base_url: "ftp://example.com" }),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(
    () => engine.upsertModelProvider({ ...created, id: "bad-kind", kind: "magic" }),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(
    () => engine.upsertModelProvider({ ...created, id: "empty-models", models: [] }),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(
    () => engine.upsertModelProvider({ ...created, id: "Bad ID" }),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(
    () => engine.upsertModelProvider({ ...created, id: "plain-key", api_key_ref: "sk-plaintext-key-123" }),
    (error) => error instanceof ConfigValidationError && /引用格式非法|明文/u.test(error.message),
  );
});

test("v1.2 removeModelProvider：不能删默认，删除自定义后 agent 自动改绑默认服务商", () => {
  const engine = makeEngine({ mode: "enterprise" });
  engine.upsertModelProvider({
    id: "custom-x",
    name: "临时服务商",
    kind: "openai_compatible",
    base_url: "https://api.example.com/v1",
    api_key_ref: "",
    enabled: true,
    default_model: "m1",
    models: ["m1"],
  });
  engine.setAgentModel("content", { provider_id: "custom-x", model: "m1" });
  assert.equal(engine.resolveAgentModel("content").provider_id, "custom-x");
  const removal = engine.removeModelProvider("custom-x");
  assert.equal(removal.removed_provider_id, "custom-x");
  assert.ok(removal.rebound_roles.includes("content"));
  assert.equal(engine.resolveAgentModel("content").provider_id, "deepseek");
  assert.throws(
    () => engine.removeModelProvider("deepseek"),
    (error) => error instanceof ConfigValidationError && /默认服务商/u.test(error.message),
  );
});

test("v1.2 setDefaultProvider：必须存在且启用；切换后校验通过", () => {
  const engine = makeEngine({ mode: "enterprise" });
  const custom = engine.upsertModelProvider({
    id: "backup",
    name: "备用服务商",
    kind: "openai_compatible",
    base_url: "https://api.example.com/v1",
    api_key_ref: "env:BACKUP_KEY",
    enabled: true,
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
  });
  assert.equal(custom.enabled, true);
  const provider = engine.setDefaultProvider("backup");
  assert.equal(provider.id, "backup");
  assert.equal(engine.config.models.default_provider_id, "backup");
  assert.equal(engine.validate().ok, true);
  assert.throws(() => engine.setDefaultProvider("not-exist"), (error) => error instanceof ConfigValidationError);
  engine.upsertModelProvider({ ...custom, id: "disabled-provider", enabled: false });
  assert.throws(
    () => engine.setDefaultProvider("disabled-provider"),
    (error) => error instanceof ConfigValidationError && /未启用/u.test(error.message),
  );
});

test("v1.2 setModelSyncMode：切到 single_key_all 立即统一所有引用；per_provider 可独立", () => {
  const engine = makeEngine({ mode: "enterprise" });
  assert.equal(engine.config.models.sync_mode, "per_provider");
  engine.setProviderApiKeyRef("openai", "env:OPENAI_KEY_TEST");
  const openai = engine.listModelProviders().find((provider) => provider.id === "openai");
  assert.equal(openai.api_key_ref, "env:OPENAI_KEY_TEST", "per_provider 模式只改单个服务商");
  const deepseekBefore = engine.listModelProviders().find((provider) => provider.id === "deepseek").api_key_ref;
  const switched = engine.setModelSyncMode("single_key_all");
  assert.equal(switched.sync_mode, "single_key_all");
  assert.ok(switched.synced_provider_ids.includes("openai"));
  const refs = new Set(engine.listModelProviders().map((provider) => provider.api_key_ref));
  assert.equal(refs.size, 1, "single_key_all 下所有引用必须一致");
  assert.equal(engine.listModelProviders().find((provider) => provider.id === "deepseek").api_key_ref, deepseekBefore);
  assert.equal(engine.validate().ok, true);
});

test("v1.2 syncApiKey：一键同步同一引用到所有功能；拒绝明文/非法引用", () => {
  const engine = makeEngine({ mode: "personal" });
  const synced = engine.syncApiKey("env:MY_SHARED_KEY");
  assert.equal(synced.api_key_ref, "env:MY_SHARED_KEY");
  assert.equal(synced.affected_provider_ids.length, 4);
  assert.equal(synced.already_consistent, false);
  assert.equal(synced.api_key_ref_masked.includes("MY_SHARED_KEY"), false, "掩码不得展示完整引用名");
  for (const provider of engine.listModelProviders()) assert.equal(provider.api_key_ref, "env:MY_SHARED_KEY");
  assert.equal(engine.validate().ok, true);
  const again = engine.syncApiKey("env:MY_SHARED_KEY");
  assert.equal(again.already_consistent, true);
  assert.deepEqual(again.affected_provider_ids, []);
  engine.syncApiKey("");
  assert.ok(engine.listModelProviders().every((provider) => provider.api_key_ref === ""));
  assert.throws(
    () => engine.syncApiKey("sk-plaintext-key-abcdef"),
    (error) => error instanceof ConfigValidationError && /引用格式非法|明文/u.test(error.message),
  );
});

test("v1.2 setProviderApiKeyRef：env/file 格式合法、明文拒绝；single 模式传播到所有", () => {
  const personal = makeEngine({ mode: "personal" });
  const update = personal.setProviderApiKeyRef("deepseek", "file:secrets.json#deepseek");
  assert.equal(update.api_key_ref, "file:secrets.json#deepseek");
  assert.equal(update.api_key_ref_masked.includes("#deepseek"), false);
  assert.equal(update.affected_provider_ids.length, 4, "single_key_all 模式传播到所有服务商");
  assert.throws(
    () => personal.setProviderApiKeyRef("deepseek", "plaintext-key"),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(() => personal.setProviderApiKeyRef("not-exist", "env:X"), (error) => error instanceof ConfigValidationError);

  const enterprise = makeEngine({ mode: "enterprise" });
  const single = enterprise.setProviderApiKeyRef("openai", "env:ONLY_OPENAI");
  assert.deepEqual(single.affected_provider_ids, ["openai"], "per_provider 模式只影响单个服务商");
  assert.equal(enterprise.listModelProviders().find((provider) => provider.id === "deepseek").api_key_ref, "env:DEEPSEEK_API_KEY");
});

test("v1.2 各 agent 不同模型：setAgentModel/resolveAgentModel 的 has_key 与不泄露密钥", () => {
  const envName = "STEWARD_TEST_OPENAI_KEY";
  delete process.env[envName];
  const engine = makeEngine({ mode: "personal" });
  engine.upsertModelProvider({
    id: "openai",
    name: "OpenAI 兼容",
    kind: "openai_compatible",
    base_url: "https://api.openai.com/v1",
    api_key_ref: `env:${envName}`,
    enabled: true,
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  });
  engine.setAgentModel("operator", { provider_id: "openai", model: "gpt-4o-mini", temperature: 0.5, max_tokens: 2_048 });
  const before = engine.resolveAgentModel("operator");
  assert.equal(before.provider_id, "openai");
  assert.equal(before.model, "gpt-4o-mini");
  assert.equal(before.binding.temperature, 0.5);
  assert.equal(before.binding.max_tokens, 2_048);
  assert.equal(before.has_key, false, "未设置环境变量时 has_key=false");
  assert.equal(before.key_source, "missing");

  process.env[envName] = "sk-secret-value-should-not-leak";
  try {
    const after = engine.resolveAgentModel("operator");
    assert.equal(after.has_key, true);
    assert.equal(after.key_source, "env");
    assert.equal(JSON.stringify(after).includes("sk-secret-value-should-not-leak"), false, "resolveAgentModel 不得返回明文密钥");
    assert.equal(engine.getApiKeyForProvider("openai").ok, true);
    assert.equal(engine.getApiKeyForProvider("openai").value, "sk-secret-value-should-not-leak", "运行时解析可用于调用");
    const other = engine.resolveAgentModel("conductor");
    assert.equal(other.provider_id, "deepseek", "不同 agent 可绑定不同服务商/模型");
  } finally {
    delete process.env[envName];
  }
});

test("v1.2 本地密钥：只写 secrets.json（config.json 无明文），resolve has_key=true，清除后恢复", async () => {
  const root = await makeTmp("steward-config-secrets-");
  try {
    const plaintext = "sk-local-test-key-123456";
    const engine = makePersistEngine(root, { mode: "personal" });
    const result = engine.setLocalApiKey("deepseek", plaintext);
    assert.equal(result.api_key_ref, "file:secrets.json#deepseek");
    assert.equal(engine.secretsFilePath(), join(root, "secrets.json"));
    assert.ok(existsSync(join(root, "secrets.json")));
    const secrets = JSON.parse(readFileSync(join(root, "secrets.json"), "utf8"));
    assert.equal(secrets.deepseek.api_key, plaintext, "明文只允许存在本地 secrets 文件");
    const configRaw = readFileSync(join(root, "config.json"), "utf8");
    assert.equal(configRaw.includes(plaintext), false, "config.json 绝不能出现明文密钥");
    assert.ok(configRaw.includes("file:secrets.json#deepseek"));

    const resolved = engine.resolveAgentModel("conductor");
    assert.equal(resolved.has_key, true);
    assert.equal(resolved.key_source, "file");
    assert.equal(JSON.stringify(resolved).includes(plaintext), false, "resolve 只返回 has_key，不返回明文");
    assert.equal(engine.getApiKeyForProvider("deepseek").value, plaintext);

    assert.equal(engine.clearLocalApiKey("deepseek"), true);
    const secretsAfter = JSON.parse(readFileSync(join(root, "secrets.json"), "utf8"));
    assert.equal("deepseek" in secretsAfter, false);
    assert.equal(engine.resolveAgentModel("conductor").has_key, false);
    assert.equal(engine.config.models.providers.find((provider) => provider.id === "deepseek").api_key_ref, "");

    const memoryEngine = makeEngine({ mode: "personal" });
    assert.throws(
      () => memoryEngine.setLocalApiKey("deepseek", plaintext),
      (error) => error instanceof ConfigValidationError && /纯内存模式/u.test(error.message),
    );
  } finally {
    await cleanup(root);
  }
});

test("v1.2 引用工具：isValidApiKeyRef 格式校验 / maskApiKeyRef 掩码", () => {
  for (const ref of ["env:DEEPSEEK_API_KEY", "file:secrets.json#deepseek", ""]) {
    assert.equal(isValidApiKeyRef(ref), true, `${ref} 应合法`);
  }
  for (const ref of ["sk-plaintext", "env:", "file:#x", "file:../escape#k", "http://x", "file:/abs/path#k"]) {
    assert.equal(isValidApiKeyRef(ref), false, `${ref} 应非法`);
  }
  const masked = maskApiKeyRef("env:DEEPSEEK_API_KEY");
  assert.match(masked, /^env:/u);
  assert.equal(masked.includes("DEEPSEEK_API_KEY"), false);
  assert.match(masked, /\*/u);
  const fileMasked = maskApiKeyRef("file:secrets.json#deepseek");
  assert.equal(fileMasked.includes("deepseek"), false);
  assert.equal(maskApiKeyRef(""), "（未配置）");
});

test("v1.2 系统提示词：修改/校验/重置（过短与未知角色抛错）", () => {
  const engine = makeEngine({ mode: "personal" });
  const prompt = "你是核查代理：每次结论必须附证据，涉及支付/合同必须走审批，不越界；失败升级给人工。";
  const updated = engine.setSystemPrompt("reviewer", prompt);
  assert.equal(updated.system_prompt, prompt);
  assert.match(updated.updated_at, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(engine.listSystemPrompts().find((entry) => entry.role === "reviewer").system_prompt, prompt);
  assert.throws(
    () => engine.setSystemPrompt("operator", "太短"),
    (error) => error instanceof ConfigValidationError && /过短/u.test(error.message),
  );
  assert.throws(
    () => engine.setSystemPrompt("not-a-role", prompt),
    (error) => error instanceof ConfigValidationError && /未知系统提示词角色/u.test(error.message),
  );
  assert.equal(engine.validateSystemPrompt("证据 审批 不越界 失败升级 人工").ok, false);
  assert.equal(engine.validateSystemPrompt(prompt).ok, true);
  const reset = engine.resetSystemPrompts();
  assert.equal(reset.length, AGENT_ROLES.length);
  assert.ok(/办公执行|operator/.test(reset.find((entry) => entry.role === "operator").system_prompt));
});

test("v1.2 总调度：核心提示词默认专业/可修改/过短拒绝；总调度可管理其他 agent 提示词", () => {
  const engine = makeEngine({ mode: "personal" });
  const original = engine.getConductorPrompt();
  assert.ok(original.includes("总调度"));
  const custom = "你是总调度：先计划再分配；每个结论必须有证据，支付/合同必须先审批，不越界；失败升级人工。";
  assert.equal(engine.setConductorPrompt(custom), custom);
  assert.equal(engine.getConductorPrompt(), custom);
  assert.throws(
    () => engine.setConductorPrompt("太短"),
    (error) => error instanceof ConfigValidationError,
  );
  // 总调度负责管理其他智能体的系统提示词
  engine.setSystemPrompt("finance", "你是财务：每笔账必须有 6 要素；超预算暂停并审批；不越界；失败升级人工处理。");
  const audit = engine.auditTrail();
  assert.ok(audit.some((entry) => entry.action === "orchestrator.conductor.update"));
  assert.ok(audit.some((entry) => entry.action === "prompt.update" && entry.object === "finance"));
});

test("v1.2 setOrchestratorSettings：自动规划/步数上限/提交前确认可配，非法值拒绝", () => {
  const engine = makeEngine({ mode: "personal" });
  const updated = engine.setOrchestratorSettings({ auto_plan: false, max_steps_per_run: 5, ask_before_commit: false });
  assert.equal(updated.auto_plan, false);
  assert.equal(updated.max_steps_per_run, 5);
  assert.equal(updated.ask_before_commit, false);
  assert.equal(engine.getOrchestratorSettings().max_steps_per_run, 5);
  assert.throws(
    () => engine.setOrchestratorSettings({ max_steps_per_run: 0 }),
    (error) => error instanceof ConfigValidationError,
  );
  assert.throws(
    () => engine.setOrchestratorSettings({ max_steps_per_run: 1_001 }),
    (error) => error instanceof ConfigValidationError,
  );
});

test("v1.2 validate：模型/提示词一致性校验（默认服务商、绑定服务商、base_url、同步一致性、提示词过短）", () => {
  const base = defaultsForMode("personal", { now: makeClock().now });
  const missingDefault = JSON.parse(JSON.stringify(base));
  missingDefault.models.default_provider_id = "not-exist";
  const missingDefaultResult = validateConfig(missingDefault);
  assert.equal(missingDefaultResult.ok, false);
  assert.ok(missingDefaultResult.errors.some((item) => /默认服务商/u.test(item.message)));

  const badBinding = JSON.parse(JSON.stringify(base));
  badBinding.models.agent_models.operator.provider_id = "ghost";
  assert.ok(validateConfig(badBinding).errors.some((item) => /绑定的服务商不存在|ghost/u.test(item.message)));

  const badUrl = JSON.parse(JSON.stringify(base));
  badUrl.models.providers[0].base_url = "ftp://bad";
  assert.ok(validateConfig(badUrl).errors.some((item) => /base_url/u.test(item.message)));

  const inconsistent = JSON.parse(JSON.stringify(base));
  inconsistent.models.providers[1].api_key_ref = "env:DIFFERENT_KEY";
  assert.ok(validateConfig(inconsistent).errors.some((item) => /一键同步|一致/u.test(item.message)));

  const shortPrompt = JSON.parse(JSON.stringify(base));
  shortPrompt.orchestrator.system_prompts[0].system_prompt = "短";
  assert.ok(validateConfig(shortPrompt).errors.some((item) => /过短/u.test(item.message)));

  const plaintextRef = JSON.parse(JSON.stringify(base));
  plaintextRef.models.providers[0].api_key_ref = "sk-plaintext-key-123456";
  assert.ok(validateConfig(plaintextRef).errors.some((item) => /引用格式非法|明文/u.test(item.message)));
});

test("v1.2 export/import：模型/密钥引用/提示词往返保留；非法模型配置导入被拒绝", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.syncApiKey("env:ROUNDTRIP_KEY");
  engine.setAgentModel("scout", { provider_id: "deepseek", model: "deepseek-reasoner" });
  engine.setConductorPrompt("你是总调度：先计划后执行，证据齐全才可报完成；支付必须审批，不越界，失败升级人工。");
  const exported = engine.export();
  const target = makeEngine({ mode: "demo" });
  const imported = target.import(exported);
  assert.equal(imported.models.providers.find((provider) => provider.id === "deepseek").api_key_ref, "env:ROUNDTRIP_KEY");
  assert.equal(imported.models.agent_models.scout.model, "deepseek-reasoner");
  assert.ok(imported.orchestrator.conductor_prompt.includes("先计划后执行"));
  assert.equal(target.validate().ok, true);

  const invalid = JSON.parse(exported);
  invalid.models.providers[0].base_url = "ftp://bad";
  assert.throws(() => target.import(JSON.stringify(invalid)), (error) => error instanceof ConfigValidationError);
  const invalidPrompt = JSON.parse(exported);
  invalidPrompt.orchestrator.system_prompts[0].system_prompt = "短";
  assert.throws(() => target.import(JSON.stringify(invalidPrompt)), (error) => error instanceof ConfigValidationError);
});

test("v1.2 审计不含明文密钥：本地密钥/一键同步/提示词变更留痕（审计文件也无明文）", async () => {
  const root = await makeTmp("steward-config-audit-secret-");
  try {
    const plaintext = "sk-audit-secret-889900";
    const engine = makePersistEngine(root, { mode: "personal" });
    engine.setLocalApiKey("deepseek", plaintext);
    engine.syncApiKey("env:AUDIT_ENV_REF");
    engine.setConductorPrompt("你是总调度：证据先行、审批优先、不越界、失败升级人工；输出四段式结论。");
    engine.setSystemPrompt("finance", "你是财务：每笔账必须有金额/收付方/依据/审批人/回执/项目；超限暂停审批，失败升级人工。");
    const audit = engine.auditTrail();
    const actions = audit.map((entry) => entry.action);
    for (const expected of ["model.api_key.local.set", "model.api_key.sync", "orchestrator.conductor.update", "prompt.update"]) {
      assert.ok(actions.includes(expected), `审计缺少 ${expected}`);
    }
    const auditRaw = readFileSync(join(root, "config-audit.jsonl"), "utf8");
    assert.equal(auditRaw.includes(plaintext), false, "审计不得包含明文密钥");
    const configRaw = readFileSync(join(root, "config.json"), "utf8");
    assert.equal(configRaw.includes(plaintext), false, "配置不得包含明文密钥");
    const localSetEntry = audit.find((entry) => entry.action === "model.api_key.local.set");
    assert.ok(localSetEntry.reason.includes("file:") || localSetEntry.reason.includes("***"));
  } finally {
    await cleanup(root);
  }
});

test("v1.2 模式切换保留用户模型/密钥引用与提示词（不会因切模式丢密钥）", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.syncApiKey("env:MY_KEY_STAY");
  const customPrompt = "你是总调度：先计划后执行；所有结论附证据；支付/合同必须审批；不越界；失败升级人工。";
  engine.setConductorPrompt(customPrompt);
  const enterprise = engine.setMode("enterprise");
  assert.equal(enterprise.config.models.providers.find((provider) => provider.id === "deepseek").api_key_ref, "env:MY_KEY_STAY");
  assert.equal(enterprise.config.orchestrator.conductor_prompt, customPrompt);
  assert.equal(engine.validate().ok, true);
  const demo = engine.setMode("demo", { preserve_models: false, preserve_orchestrator: false });
  const demoRefs = new Set(demo.config.models.providers.map((provider) => provider.api_key_ref));
  assert.equal(demoRefs.size, 1);
  assert.equal(demo.config.models.providers.find((provider) => provider.id === "deepseek").api_key_ref, "env:DEEPSEEK_API_KEY");
  assert.equal(demo.config.orchestrator.conductor_prompt, DEFAULT_CONDUCTOR_PROMPT);
  assert.equal(engine.validate().ok, true);
});

// ===========================================================================
// v1.3-A：两层总调度 supervisor / 易支付 epay / 系统动作策略
// ===========================================================================

test("v1.3 两层总调度：supervisor 系统总控（第 11 角色）默认存在且权限/自治/Token 正确", () => {
  for (const mode of ["demo", "personal", "enterprise"]) {
    const engine = makeEngine({ mode });
    const agents = engine.listAgents();
    assert.equal(agents.length, AGENT_ROLES.length);
    assert.equal(agents.length, 11, "10 个 agent + supervisor 系统总控 = 11");
    const supervisor = agents.find((agent) => agent.role === "supervisor");
    assert.ok(supervisor !== undefined, `${mode} 模式必须包含 supervisor`);
    assert.equal(supervisor.name, "系统总控");
    assert.equal(supervisor.enabled, true);
    assert.equal(supervisor.autonomy, "approval_required", "最高权限角色必须 approval_required");
    assert.equal(supervisor.token_limit, 1_000_000);
    for (const tool of ["system.*", "agents.*", "models.*", "prompts.*", "project.delegate", "logs.read"]) {
      assert.ok(supervisor.tools.includes(tool), `supervisor 缺少权限工具 ${tool}`);
    }
    assert.equal(engine.validate().ok, true);
    const binding = engine.config.models.agent_models.supervisor;
    assert.ok(binding !== undefined, "supervisor 需要有默认模型绑定");
    assert.equal(binding.provider_id, "deepseek");
    const prompt = engine.listSystemPrompts().find((entry) => entry.role === "supervisor");
    assert.ok(prompt !== undefined);
    for (const keyword of ["系统总控", "日志", "二次确认", "不越界"]) {
      assert.ok(prompt.system_prompt.includes(keyword), `supervisor 提示词应包含 ${keyword}`);
    }
  }
  // supervisor 与 conductor 是两层：conductor 仍是业务总调度核心设置
  const personal = makeEngine({ mode: "personal" });
  assert.ok(personal.getConductorPrompt().includes("总调度"));
  const supervisorAgent = personal.listAgents().find((agent) => agent.role === "supervisor");
  assert.equal(supervisorAgent.enabled, true);
});

test("v1.3 默认易支付（epay）：demo 模式/默认 disabled、网关 https、密钥只存引用且可掩码", async () => {
  const root = await makeTmp("steward-config-epay-");
  try {
    const engine = makePersistEngine(root, { mode: "personal" });
    const epay = engine.getEpayConfig();
    assert.equal(epay.enabled, false, "未填商家信息时默认 disabled");
    assert.equal(epay.mode, "demo", "默认 demo 模式");
    assert.equal(epay.gateway_url, "https://pay.example.com/submit.php");
    assert.match(epay.gateway_url, /^https:\/\//u);
    assert.equal(epay.pid, "");
    assert.equal(epay.key_ref, "");
    assert.deepEqual(epay.pay_types, ["alipay", "wxpay"]);
    assert.equal(epay.sign_type, "MD5");
    assert.equal(engine.maskEpayKeyRef(), "（未配置）");

    const configured = engine.setEpayConfig({ enabled: true, pid: "10001", key_ref: "env:EPAY_KEY", mode: "demo" });
    assert.equal(configured.enabled, true);
    assert.equal(configured.pid, "10001");
    assert.equal(configured.key_ref, "env:EPAY_KEY");
    const masked = engine.maskEpayKeyRef();
    assert.match(masked, /^env:/u);
    assert.equal(masked.includes("EPAY_KEY"), false, "epay 密钥引用展示必须掩码");
    const raw = readFileSync(join(root, "config.json"), "utf8");
    assert.ok(raw.includes("env:EPAY_KEY"), "config 只存引用");
    assert.equal(raw.includes("sk-epay-plaintext"), false);
    // 本地密钥写入 secrets.json 后 config 仍无明文
    engine.setLocalApiKey("deepseek", "sk-local-config-test-123");
    engine.setEpayConfig({ key_ref: "file:secrets.json#epay" });
    assert.ok(readFileSync(join(root, "config.json"), "utf8").includes("file:secrets.json#epay"));
    assert.equal(engine.maskEpayKeyRef().includes("secrets.json#epay"), false);
  } finally {
    await cleanup(root);
  }
});

test("v1.3 易支付校验：gateway 必须 https；demo 可不填商家信息；live 必须补齐 pid/key_ref/回调", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.throws(
    () => engine.setEpayConfig({ gateway_url: "http://pay.example.com/submit.php" }),
    (error) => error instanceof ConfigValidationError && /gateway_url|校验失败/u.test(error.message),
  );
  assert.throws(
    () => engine.setEpayConfig({ key_ref: "sk-epay-plaintext" }),
    (error) => error instanceof ConfigValidationError && /key_ref|引用格式/u.test(error.message),
  );
  assert.throws(
    () => engine.setEpayConfig({ sign_type: "RSA" }),
    (error) => error instanceof ConfigValidationError,
  );
  // demo 模式可以 enabled（不强制商家信息）
  const demo = engine.setEpayConfig({ enabled: true, mode: "demo", pid: "", key_ref: "" });
  assert.equal(demo.mode, "demo");
  assert.equal(demo.enabled, true);
  // live 模式缺商家信息 → 拒绝
  assert.throws(
    () => engine.setEpayConfig({ enabled: true, mode: "live", pid: "", key_ref: "" }),
    (error) => error instanceof ConfigValidationError && /live 模式|商家|pid|key_ref/u.test(error.message),
  );
  // live 模式补齐后通过
  const live = engine.setEpayConfig({
    enabled: true,
    mode: "live",
    pid: "10001",
    key_ref: "env:EPAY_KEY",
    gateway_url: "https://pay.example.com/submit.php",
    notify_url: "https://example.com/api/payments/epay/notify",
    return_url: "https://example.com/api/payments/epay/return",
  });
  assert.equal(live.mode, "live");
  assert.equal(live.pid, "10001");
  assert.equal(live.key_ref, "env:EPAY_KEY");
  assert.equal(engine.validate().ok, true);
  const raw = engine.export();
  assert.equal(raw.includes("sk-"), false);
});

test("v1.3 系统动作策略默认值：内置受管应用（Node/记事本）、plugins 目录、危险动作需二次确认", () => {
  for (const mode of ["demo", "personal", "enterprise"]) {
    const engine = makeEngine({ mode });
    const policy = engine.getSystemPolicy();
    assert.ok(Array.isArray(policy.managed_apps));
    assert.ok(policy.managed_apps.length >= 2, "默认至少 2 个受管应用");
    const names = policy.managed_apps.map((app) => app.name).join("|");
    assert.match(names, /Node/u);
    assert.match(names, /记事本/u);
    for (const app of policy.managed_apps) {
      assert.equal(typeof app.id, "string");
      assert.equal(app.id.length > 0, true);
      assert.equal(typeof app.command, "string");
      assert.equal(app.command.length > 0, true);
      assert.equal(app.allow_start, true);
    }
    assert.equal(policy.plugins_dir, "plugins");
    assert.equal(policy.allow_destructive, true);
    assert.equal(policy.require_confirmation, true, "危险动作默认必须二次确认");
    assert.equal(policy.confirmation_ttl_seconds, 120);
    assert.equal(engine.validate().ok, true);
  }
});

test("v1.3 setSystemPolicy：受管应用/插件目录/TTL 可配；非法路径/关闭确认/坏应用被拒绝并留审计", async () => {
  const root = await makeTmp("steward-config-system-policy-");
  try {
    const engine = makePersistEngine(root, { mode: "personal" });
    const updated = engine.setSystemPolicy({ plugins_dir: "plugins-ext", confirmation_ttl_seconds: 60 });
    assert.equal(updated.plugins_dir, "plugins-ext");
    assert.equal(updated.confirmation_ttl_seconds, 60);
    const withApp = engine.setSystemPolicy({
      managed_apps: [
        { id: "demo-node", name: "Node 演示服务", command: "node examples/demo-web/server.mjs", allow_start: true, allow_stop: true, allow_remove: false },
        { id: "notepad", name: "记事本", command: "notepad.exe", allow_start: true, allow_stop: false, allow_remove: false },
        { id: "calc", name: "计算器", command: "calc.exe", allow_start: true, allow_stop: true, allow_remove: false },
      ],
    });
    assert.equal(withApp.managed_apps.length, 3);
    assert.equal(withApp.managed_apps.find((app) => app.id === "calc").allow_stop, true);
    assert.ok(engine.auditTrail().some((entry) => entry.action === "system.policy.update"));

    assert.throws(
      () => engine.setSystemPolicy({ plugins_dir: "../escape" }),
      (error) => error instanceof ConfigValidationError && /plugins_dir/u.test(error.message),
    );
    assert.throws(() => engine.setSystemPolicy({ confirmation_ttl_seconds: 0 }), (error) => error instanceof ConfigValidationError);
    assert.throws(
      () => engine.setSystemPolicy({ allow_destructive: true, require_confirmation: false }),
      (error) => error instanceof ConfigValidationError && /二次确认/u.test(error.message),
    );
    assert.throws(
      () =>
        engine.setSystemPolicy({
          managed_apps: [{ id: "bad-app", name: "", command: "x.exe", allow_start: true, allow_stop: true, allow_remove: false }],
        }),
      (error) => error instanceof ConfigValidationError && /name/u.test(error.message),
    );
    assert.throws(
      () =>
        engine.setSystemPolicy({
          managed_apps: [
            { id: "dup", name: "A", command: "a.exe", allow_start: true, allow_stop: true, allow_remove: false },
            { id: "dup", name: "B", command: "b.exe", allow_start: true, allow_stop: true, allow_remove: false },
          ],
        }),
      (error) => error instanceof ConfigValidationError && /重复/u.test(error.message),
    );
    // 配置文件已持久化 system_policy
    const raw = readConfigFile(root);
    assert.equal(raw.system_policy.plugins_dir, "plugins-ext");
    assert.equal(raw.system_policy.managed_apps.length, 3);
  } finally {
    await cleanup(root);
  }
});

test("v1.3 旧配置迁移：v1.2 config 缺 supervisor/epay/system_policy 时自动补默认且不丢已有字段", async () => {
  const root = await makeTmp("steward-config-migrate-v13-");
  try {
    const oldConfig = defaultsForMode("personal", { now: makeClock().now });
    delete oldConfig.system_policy;
    delete oldConfig.payments.epay;
    oldConfig.agents = oldConfig.agents.filter((agent) => agent.role !== "supervisor");
    delete oldConfig.models.agent_models.supervisor;
    const oldOrchestrator = oldConfig.orchestrator;
    oldOrchestrator.system_prompts = oldOrchestrator.system_prompts.filter((entry) => entry.role !== "supervisor");
    oldConfig.budgets.month_cny = 6_666;
    oldConfig.budgets.project_cny = 3_000;
    oldConfig.budgets.per_txn_cny = 600;
    await writeFile(join(root, "config.json"), JSON.stringify(oldConfig, null, 2), "utf8");

    const engine = new ConfigEngine({ root, now: makeClock().now });
    assert.equal(engine.validate().ok, true);
    assert.equal(engine.config.budgets.month_cny, 6_666, "旧字段保留");
    const supervisor = engine.listAgents().find((agent) => agent.role === "supervisor");
    assert.ok(supervisor !== undefined, "迁移后自动补 supervisor");
    assert.equal(supervisor.token_limit, 1_000_000);
    assert.ok(engine.listSystemPrompts().some((entry) => entry.role === "supervisor"), "迁移后补 supervisor 提示词");
    assert.equal(engine.getEpayConfig().mode, "demo", "迁移后补 epay 默认值");
    assert.equal(engine.getSystemPolicy().plugins_dir, "plugins", "迁移后补 system_policy");
    assert.equal(engine.getSystemPolicy().require_confirmation, true);
    engine.save();
    const persisted = readConfigFile(root);
    assert.ok(persisted.system_policy !== undefined);
    assert.ok(persisted.payments.epay !== undefined);
    assert.ok(persisted.agents.some((agent) => agent.role === "supervisor"));
  } finally {
    await cleanup(root);
  }
});

test("v1.3 validate：supervisor 权限/自治与 system_policy 一致性校验可发现缺失与危险配置", () => {
  const base = defaultsForMode("personal", { now: makeClock().now });
  const missingSupervisor = JSON.parse(JSON.stringify(base));
  missingSupervisor.agents = missingSupervisor.agents.filter((agent) => agent.role !== "supervisor");
  const missingResult = validateConfig(missingSupervisor);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((item) => /supervisor|系统总控/u.test(item.message)));

  const wrongAutonomy = JSON.parse(JSON.stringify(base));
  wrongAutonomy.agents.find((agent) => agent.role === "supervisor").autonomy = "autonomous_limited";
  assert.ok(validateConfig(wrongAutonomy).errors.some((item) => /approval_required/u.test(item.message)));

  const missingTool = JSON.parse(JSON.stringify(base));
  const supervisor = missingTool.agents.find((agent) => agent.role === "supervisor");
  supervisor.tools = supervisor.tools.filter((tool) => tool !== "logs.read");
  assert.ok(validateConfig(missingTool).errors.some((item) => /logs.read/u.test(item.message)));

  const dangerous = JSON.parse(JSON.stringify(base));
  dangerous.system_policy.require_confirmation = false;
  assert.ok(validateConfig(dangerous).errors.some((item) => /二次确认/u.test(item.message)));

  const badPluginDir = JSON.parse(JSON.stringify(base));
  badPluginDir.system_policy.plugins_dir = "../outside";
  assert.ok(validateConfig(badPluginDir).errors.some((item) => /plugins_dir/u.test(item.message)));

  const liveEpay = JSON.parse(JSON.stringify(base));
  liveEpay.payments.epay = { ...liveEpay.payments.epay, mode: "live", enabled: true, pid: "", key_ref: "" };
  assert.ok(validateConfig(liveEpay).errors.some((item) => /live 模式|商户|pid|key_ref/u.test(item.message)));
});

// ===========================================================================
// v1.4-C：运行时设置（自动执行 / 审批策略 / 步骤上限 / 返工 / 事件保留）
// ===========================================================================

test("v1.4 运行时默认值：三模式 auto_run/审批模式/步骤上限/返工/事件保留", () => {
  const expectedSteps = { demo: 10, personal: 20, enterprise: 50 };
  for (const mode of ["demo", "personal", "enterprise"]) {
    const engine = makeEngine({ mode });
    const runtime = engine.getRuntimeSettings();
    const fromDefaults = defaultsForMode(mode, { now: makeClock().now }).runtime;
    assert.deepEqual(runtime, fromDefaults, `${mode} 模式 defaultsForMode 与引擎一致`);
    assert.equal(runtime.auto_run, true, "默认发消息即自动执行");
    assert.equal(runtime.approval_mode, "auto_low_risk", "默认仅高风险动作暂停");
    assert.equal(runtime.full_auto, false);
    assert.equal(runtime.max_auto_steps, expectedSteps[mode]);
    assert.equal(runtime.rework_limit, 1);
    assert.equal(runtime.event_retention, 1_000);
    assert.equal(engine.validate().ok, true);
  }
});

test("v1.4 get/setRuntimeSettings：修改生效并持久化（内存模式/磁盘模式一致）", async () => {
  const memory = makeEngine({ mode: "personal" });
  const updated = memory.setRuntimeSettings({
    auto_run: false,
    approval_mode: "auto_all",
    full_auto: true,
    max_auto_steps: 50,
    rework_limit: 2,
    event_retention: 2_000,
  });
  assert.equal(updated.auto_run, false);
  assert.equal(updated.approval_mode, "auto_all");
  assert.equal(updated.full_auto, true);
  assert.equal(updated.max_auto_steps, 50);
  assert.equal(updated.rework_limit, 2);
  assert.equal(updated.event_retention, 2_000);
  assert.deepEqual(memory.getRuntimeSettings(), updated);
  assert.equal(memory.validate().ok, true);

  const root = await makeTmp("steward-config-runtime-");
  try {
    const engine = makePersistEngine(root, { mode: "personal" });
    engine.setRuntimeSettings({ approval_mode: "manual", auto_run: false, max_auto_steps: 100 });
    const raw = readConfigFile(root);
    assert.equal(raw.runtime.approval_mode, "manual");
    assert.equal(raw.runtime.auto_run, false);
    assert.equal(raw.runtime.max_auto_steps, 100);
    const reloaded = makePersistEngine(root, { mode: "personal" });
    assert.deepEqual(reloaded.getRuntimeSettings(), engine.getRuntimeSettings());
  } finally {
    await cleanup(root);
  }
});

test("v1.4 非法枚举/范围拒绝且不改变已有设置（auto_run/approval_mode/步骤/返工/保留）", () => {
  const engine = makeEngine({ mode: "personal" });
  const before = engine.getRuntimeSettings();
  const badValues = [
    { auto_run: "yes" },
    { full_auto: 1 },
    { approval_mode: "auto" },
    { max_auto_steps: 9 },
    { max_auto_steps: 201 },
    { max_auto_steps: 20.5 },
    { rework_limit: -1 },
    { rework_limit: 4 },
    { event_retention: 99 },
    { event_retention: 5_001 },
  ];
  for (const patch of badValues) {
    assert.throws(() => engine.setRuntimeSettings(patch), (error) => error instanceof ConfigValidationError, JSON.stringify(patch));
    assert.deepEqual(engine.getRuntimeSettings(), before, `非法更新不得改变状态：${JSON.stringify(patch)}`);
  }
});

test("v1.4 full_auto 与 approval_mode=manual 冲突拒绝；可单独使用 manual 或 auto_all", () => {
  const engine = makeEngine({ mode: "personal" });
  assert.throws(
    () => engine.setRuntimeSettings({ full_auto: true, approval_mode: "manual" }),
    (error) => error instanceof ConfigValidationError && /full_auto|manual|冲突/u.test(error.message),
  );
  // 先设为 manual，再打开 full_auto 也必须拒绝（并回滚）
  const manual = engine.setRuntimeSettings({ approval_mode: "manual" });
  assert.equal(manual.approval_mode, "manual");
  assert.throws(
    () => engine.setRuntimeSettings({ full_auto: true }),
    (error) => error instanceof ConfigValidationError && /全自动|manual|冲突/u.test(error.message),
  );
  assert.equal(engine.getRuntimeSettings().full_auto, false, "冲突更新必须回滚");
  assert.equal(engine.getRuntimeSettings().approval_mode, "manual");
  // manual 单独合法；auto_all + full_auto 合法
  const autoAll = engine.setRuntimeSettings({ approval_mode: "auto_all", full_auto: true });
  assert.equal(autoAll.approval_mode, "auto_all");
  assert.equal(autoAll.full_auto, true);
  assert.equal(engine.validate().ok, true);
});

test("v1.4 旧配置迁移：缺 runtime 自动补该模式默认值且不丢已有字段（写入后二次加载稳定）", async () => {
  const root = await makeTmp("steward-config-runtime-migrate-");
  try {
    const legacy = defaultsForMode("personal", { now: makeClock().now });
    delete legacy.runtime;
    legacy.budgets.month_cny = 8_888;
    legacy.budgets.project_cny = 3_000;
    legacy.budgets.per_txn_cny = 600;
    legacy.features.scout.enabled = false;
    legacy.runtime = undefined;
    await writeFile(join(root, "config.json"), JSON.stringify(legacy, null, 2), "utf8");

    const engine = makePersistEngine(root, { mode: "personal" });
    assert.equal(engine.validate().ok, true);
    assert.equal(engine.config.budgets.month_cny, 8_888, "旧字段必须保留");
    assert.equal(engine.config.features.scout.enabled, false);
    const runtime = engine.getRuntimeSettings();
    assert.equal(runtime.auto_run, true);
    assert.equal(runtime.approval_mode, "auto_low_risk");
    assert.equal(runtime.max_auto_steps, 20, "迁移补 personal 默认步骤上限");
    assert.equal(runtime.event_retention, 1_000);
    engine.save();
    assert.ok(readConfigFile(root).runtime !== undefined, "save 后 runtime 落盘");
    const reloaded = makePersistEngine(root, { mode: "personal" });
    assert.deepEqual(reloaded.getRuntimeSettings(), runtime);
    assert.equal(reloaded.validate().ok, true);
  } finally {
    await cleanup(root);
  }
});

test("v1.4 审计：runtime.update 留痕（含新值、不含敏感信息），导出可见 runtime", async () => {
  const root = await makeTmp("steward-config-runtime-audit-");
  try {
    const engine = makePersistEngine(root, { mode: "personal" });
    engine.setRuntimeSettings({ auto_run: false, approval_mode: "manual", max_auto_steps: 60 });
    const audit = engine.auditTrail();
    const entry = audit.find((item) => item.action === "runtime.update");
    assert.ok(entry !== undefined, "审计缺少 runtime.update");
    assert.equal(entry.result, "ok");
    assert.match(entry.reason, /auto_run=false/u);
    assert.match(entry.reason, /approval_mode=manual/u);
    assert.match(entry.reason, /max_auto_steps=60/u);
    const rawAudit = readAuditFile(root).filter((item) => item.action === "runtime.update");
    assert.ok(rawAudit.length >= 1, "runtime.update 必须写入 config-audit.jsonl");
    const exported = JSON.parse(engine.export());
    assert.equal(exported.runtime.approval_mode, "manual");
    assert.equal(exported.runtime.max_auto_steps, 60);
  } finally {
    await cleanup(root);
  }
});

test("v1.4 validate：runtime 范围/枚举/冲突/缺失均可被发现", () => {
  const base = defaultsForMode("personal", { now: makeClock().now });
  const missing = JSON.parse(JSON.stringify(base));
  delete missing.runtime;
  assert.ok(validateConfig(missing).errors.some((item) => /runtime/u.test(item.message)));

  const badMode = JSON.parse(JSON.stringify(base));
  badMode.runtime.approval_mode = "auto";
  assert.ok(validateConfig(badMode).errors.some((item) => /approval_mode/u.test(item.message)));

  const badSteps = JSON.parse(JSON.stringify(base));
  badSteps.runtime.max_auto_steps = 5;
  assert.ok(validateConfig(badSteps).errors.some((item) => /max_auto_steps/u.test(item.message)));

  const badRework = JSON.parse(JSON.stringify(base));
  badRework.runtime.rework_limit = 9;
  assert.ok(validateConfig(badRework).errors.some((item) => /rework_limit/u.test(item.message)));

  const badRetention = JSON.parse(JSON.stringify(base));
  badRetention.runtime.event_retention = 99;
  assert.ok(validateConfig(badRetention).errors.some((item) => /event_retention/u.test(item.message)));

  const conflict = JSON.parse(JSON.stringify(base));
  conflict.runtime.full_auto = true;
  conflict.runtime.approval_mode = "manual";
  assert.ok(validateConfig(conflict).errors.some((item) => /full_auto|manual|冲突/u.test(item.message)));
});

test("v1.4 与 Token/预算并存：修改 runtime 不影响 token/budget，导出导入往返保留", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setTokenBudget({ limit_tokens: 5_000_000 });
  engine.setBudgets({ month_cny: 12_345, project_cny: 4_000, per_txn_cny: 800 });
  const consumed = engine.consumeTokens(100, { agentRole: "operator", action: "runtime-test" });
  assert.equal(consumed.ok, true);
  engine.setRuntimeSettings({ max_auto_steps: 80, event_retention: 2_500 });
  const tokenBudget = engine.config.token_budget;
  const budgets = engine.config.budgets;
  assert.equal(tokenBudget.limit_tokens, 5_000_000);
  assert.ok(tokenBudget.used_tokens >= 100);
  assert.equal(budgets.month_cny, 12_345);
  assert.equal(budgets.project_cny, 4_000);
  assert.equal(budgets.per_txn_cny, 800);
  assert.equal(engine.checkBudget("per_txn", 500).allowed, true);
  assert.equal(engine.checkBudget("per_txn", 900).allowed, false);
  const exported = engine.export();
  const target = makeEngine({ mode: "demo" });
  const imported = target.import(exported);
  assert.equal(imported.runtime.max_auto_steps, 80);
  assert.equal(imported.runtime.event_retention, 2_500);
  assert.equal(target.validate().ok, true);
});

test("v1.4 setMode：默认保留用户 runtime；preserve_runtime:false 重置为目标模式默认值", () => {
  const engine = makeEngine({ mode: "personal" });
  engine.setRuntimeSettings({ auto_run: false, max_auto_steps: 60, approval_mode: "auto_all" });
  const enterprise = engine.setMode("enterprise");
  assert.equal(enterprise.config.runtime.max_auto_steps, 60, "切模式默认保留用户设置");
  assert.equal(enterprise.config.runtime.auto_run, false);
  const demo = engine.setMode("demo", { preserve_runtime: false });
  assert.equal(demo.config.runtime.max_auto_steps, 10, "显式重置为 demo 默认");
  assert.equal(demo.config.runtime.auto_run, true);
  assert.equal(demo.config.runtime.approval_mode, "auto_low_risk");
  assert.equal(engine.validate().ok, true);
});
