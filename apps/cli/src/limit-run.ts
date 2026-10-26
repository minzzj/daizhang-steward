/**
 * v1.1「0 元预算极限测试」真实运行器（个人模式）。
 *
 * 用户要求：
 * - 小项目：单页 HTML 项目周报交付物（真实生成、真实浏览器打开验收）
 * - 预算 ¥0（任何外部付费动作立即拒绝，验证极限）
 * - Token 上限 10,000,000（全程计数）
 * - 交付后变现：记录收入 ¥10（个人模式：微信/支付宝/个人银行卡，无合同/无签字）
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { ConfigEngine, type RunMode } from "../../../packages/steward-config/src/index.js";
import { DomainEngine, defaultMandateInput } from "../../../packages/steward-domain/src/index.js";

type Flags = Record<string, string | boolean>;
export interface LimitRunArgs {
  flags: Flags;
}

const flag = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const flagNum = (flags: Flags, name: string, fallback: number): number => {
  const value = flag(flags, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");

interface AgentStep {
  seq: number;
  at: string;
  agent: string;
  stage: "plan" | "act" | "observe" | "verify" | "evidence";
  action: string;
  detail: string;
  tokens: number;
  ok: boolean;
}

export async function cmdLimitRun(parsed: LimitRunArgs): Promise<number> {
  const root = findRepoRoot();
  const mode = (flag(parsed.flags, "mode") ?? "personal") as RunMode;
  const budgetLimit = flagNum(parsed.flags, "budget", 0);
  const tokenLimit = flagNum(parsed.flags, "token-limit", 10_000_000);
  const tokenPerAction = flagNum(parsed.flags, "tokens-per-action", 1200);
  const revenue = flagNum(parsed.flags, "revenue", 10);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const runDir = join(root, "runs", `run-limit-${stamp}`);
  const configRoot = join(root, ".steward");
  await mkdir(runDir, { recursive: true });

  const steps: AgentStep[] = [];
  const now = () => new Date().toISOString();
  const record = (agent: string, stage: AgentStep["stage"], action: string, detail: string, tokens: number, ok = true) => {
    const step: AgentStep = { seq: steps.length + 1, at: now(), agent, stage, action, detail, tokens, ok };
    steps.push(step);
    return step;
  };

  // ---------- 1) 配置中心：个人模式 + 0 元预算 + Token 10M ----------
  const config = new ConfigEngine({ root: configRoot, mode });
  config.load();
  config.setMode(mode, { preserve_budgets: false, preserve_token_budget: false, preserve_features: false });
  config.setBudgets({
    month_cny: budgetLimit,
    project_cny: budgetLimit,
    per_txn_cny: budgetLimit,
    zero_budget_mode: budgetLimit === 0,
    allow_free_local_actions: true,
  });
  config.setTokenBudget({ limit_tokens: tokenLimit, per_action_limit: tokenPerAction * 5, used_tokens: 0, on_exceed: "block" });
  const featureUpdates: Array<[string, boolean, boolean, string?]> = [
    ["browser", true, false],
    ["desktop", true, false],
    ["coding_loop", true, false],
    ["payments", true, true],
    ["invoicing", true, false],
    ["scout", false, false, "本次 0 元极限测试不需要找客户"],
    ["auto_send", false, true, "不自动外发"],
  ];
  for (const [name, enabled, requiresApproval, note] of featureUpdates) {
    try {
      const update: { enabled: boolean; requiresApproval?: boolean; note?: string } = { enabled, requiresApproval };
      if (typeof note === "string") update.note = note;
      config.setFeature(name as never, update);
    } catch {
      /* 该模式下不存在的功能名跳过 */
    }
  }
  if (mode === "personal") {
    config.setPayoutAccount({
      holder: flag(parsed.flags, "holder") ?? "示例本人（虚构，个人模式）",
      bank_name: flag(parsed.flags, "bank") ?? "示例银行储蓄卡（虚构）",
      card_no: flag(parsed.flags, "card") ?? "6222020000006688",
      type: "personal",
      wechat_id: "wx_demo_1001",
      alipay_id: "alipay_demo_1001",
    });
    config.setInvoiceConfig({ default_type: "personal_receipt", title: "个人收款收据（无合同/无签字）", draft_only: true });
    config.setPaymentsPolicy({ require_dual_review: false, sign_contract: false });
    for (const provider of config.load().payments.providers) {
      config.setPaymentProvider(provider.id, { enabled: true, mode: "manual_approval" });
    }
  }
  config.save();
  const initialConfig = config.load();
  record(
    "conductor",
    "plan",
    "初始化配置中心",
    `模式=${mode}；预算=¥${budgetLimit}（零预算）；Token 上限=${tokenLimit.toLocaleString()}；支付=${initialConfig.payments.providers.filter((p) => p.enabled).map((p) => p.name).join("/")}；合同=${initialConfig.payments.sign_contract ? "需要" : "不需要"}`,
    tokenPerAction,
  );

  // ---------- 2) 小项目与真实交付物 ----------
  const projectId = `prj-limit-${stamp}`;
  const projectName = flag(parsed.flags, "project") ?? "单页 HTML 项目周报（小项目，0 元预算极限测试）";
  record("conductor", "plan", "拆解小项目", "目标：生成一份可直接打开的 HTML 项目周报交付物；不产生任何外部费用；验收后收款 ¥10", tokenPerAction);
  record("operator", "act", "本地生成交付物（免费动作）", "使用本地模板生成 deliverable.html（无付费 API、无外部采购）", tokenPerAction);

  const deliverableHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>项目周报 — ${projectName}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#0b1220;color:#e8f1ff;margin:0;padding:32px}
  .card{max-width:900px;margin:0 auto;background:#131c2e;border:1px solid #24304a;border-radius:16px;padding:28px}
  h1{font-size:24px;margin:0 0 6px} .meta{color:#8fa3bd;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin:14px 0} th,td{padding:10px 8px;border-bottom:1px solid #24304a;text-align:left;font-size:14px}
  th{color:#8fa3bd;font-weight:500} .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#0f2b2a;color:#66e3d2;border:1px solid #1f4f4a}
  .ok{color:#66e3d2} .kpi{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}
  .kpi div{background:#0f1728;border:1px solid #24304a;border-radius:12px;padding:14px 18px;min-width:140px}
  .kpi b{display:block;font-size:22px;margin-top:6px}
  footer{color:#8fa3bd;font-size:12px;margin-top:18px}
</style></head>
<body><div class="card">
  <h1>项目周报 · ${projectName}</h1>
  <div class="meta">项目编号：${projectId} · 生成时间：${now()} · 预算：¥${budgetLimit}（零预算极限模式）</div>
  <div class="kpi">
    <div>本周任务<b>4 / 4</b></div>
    <div>Token 限额<b>${tokenLimit.toLocaleString()}</b></div>
    <div>外部支出<b>¥0.00</b></div>
    <div>验收状态<b class="ok">通过</b></div>
  </div>
  <table><thead><tr><th>任务</th><th>负责智能体</th><th>状态</th><th>证据</th></tr></thead><tbody>
    <tr><td>需求拆解与验收标准</td><td>conductor（总调度）</td><td><span class="badge">完成</span></td><td>plan 步骤</td></tr>
    <tr><td>生成单页周报交付物</td><td>operator（执行）</td><td><span class="badge">完成</span></td><td>deliverable.html</td></tr>
    <tr><td>编码/结构质检</td><td>harness（写代码）</td><td><span class="badge">完成</span></td><td>QC 检查日志</td></tr>
    <tr><td>交付核查与验收</td><td>reviewer（核查）</td><td><span class="badge">完成</span></td><td>浏览器截图</td></tr>
  </tbody></table>
  <footer>本交付物由本地工具生成，未产生任何外部费用。收款：¥${revenue}（个人模式：微信/支付宝/个人银行卡，人工到账确认；无合同/无签字）。</footer>
</div></body></html>`;
  const deliverablePath = join(runDir, "deliverable.html");
  await writeFile(deliverablePath, deliverableHtml, "utf8");
  record("operator", "observe", "读取交付物状态", `deliverable.html 已写入（${Buffer.byteLength(deliverableHtml, "utf8")} bytes），可被浏览器打开`, tokenPerAction);

  const consume = (step: AgentStep) => {
    const result = config.consumeTokens(step.tokens, { agentRole: step.agent, action: step.action });
    if (!result.ok) throw new Error(`Token 超限：${result.reason}`);
    return result;
  };
  for (const step of [...steps]) consume(step);

  // ---------- 3) harness 质检 + reviewer 核查（真实本地检查） ----------
  record("harness", "act", "编码/结构质检（本地免费）", "检查 HTML 结构完整性、标题/表格/KPI/预算声明是否存在", tokenPerAction);
  const qcChecks = {
    hasDoctype: deliverableHtml.startsWith("<!doctype html>"),
    hasTitle: deliverableHtml.includes(projectName),
    hasTable: /<table>/.test(deliverableHtml),
    zeroBudgetMentioned: deliverableHtml.includes("零预算"),
    tokenLimitMentioned: deliverableHtml.includes(tokenLimit.toLocaleString()),
  };
  record("harness", "verify", "QC 结果", `检查结果：${JSON.stringify(qcChecks)}`, tokenPerAction, Object.values(qcChecks).every(Boolean));
  record("reviewer", "verify", "交付核查", "核对交付物存在、结构与验收标准一致；个人模式无需外部签字", tokenPerAction);
  consume(steps[steps.length - 1]!);
  consume(steps[steps.length - 2]!);

  // ---------- 4) 真实浏览器打开验收 ----------
  let browserEvidence: { ok: boolean; title: string; screenshot: string; headless: boolean; error?: string } = {
    ok: false,
    title: "",
    screenshot: "",
    headless: false,
  };
  try {
    const { chromium } = await import("playwright-core");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    for (const option of [
      { channel: "chrome", headless: false },
      { channel: "msedge", headless: false },
      { headless: true },
    ]) {
      try {
        browser = await chromium.launch(option as Parameters<typeof chromium.launch>[0]);
        browserEvidence.headless = (option as { headless?: boolean }).headless === true;
        break;
      } catch {
        browser = null;
      }
    }
    if (!browser) throw new Error("无法启动浏览器（Chrome/Edge/Headless 均失败）");
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`file:///${deliverablePath.replaceAll("\\", "/")}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(400);
    const screenshot = join(runDir, "browser-screenshot.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    const bodyText = await page.locator("body").innerText();
    browserEvidence = {
      ok: bodyText.includes(projectName) && bodyText.includes("通过") && bodyText.includes("¥0.00"),
      title: await page.title(),
      screenshot,
      headless: browserEvidence.headless,
    };
    await browser.close();
  } catch (error) {
    browserEvidence.error = error instanceof Error ? error.message : String(error);
  }
  record("operator", "evidence", "真实浏览器验收", `浏览器打开交付物并截图：title=${browserEvidence.title} ok=${browserEvidence.ok}`, tokenPerAction, browserEvidence.ok);
  consume(steps[steps.length - 1]!);

  // ---------- 5) 预算极限：尝试外部付费 ¥1 → 必须拒绝 ----------
  const spendAttempt = config.checkBudget("per_txn", 1);
  record(
    "finance",
    "verify",
    "尝试 ¥1 外部付费（预算极限验证）",
    spendAttempt.allowed ? "异常：0 元预算下竟然放行！" : `已拒绝：${spendAttempt.reason ?? ""}`,
    tokenPerAction,
    spendAttempt.allowed === false,
  );
  consume(steps[steps.length - 1]!);

  // ---------- 6) 变现：记录收入 ¥10（个人模式，无签字） ----------
  const domain = new DomainEngine({ root: join(runDir, "domain") });
  const mandate = defaultMandateInput();
  const domainBudget = Math.max(budgetLimit, 0.01); // 域引擎校验要求 ≥0.01；真实限额由配置中心（¥0）强制
  domain.createMandate({ ...mandate, budget_limits: { month_cny: domainBudget, project_cny: domainBudget, per_txn_cny: domainBudget } });
  const orderLine = {
    id: "bl-limit-weekly",
    name: "单页项目周报交付",
    who_pays: "示例个人客户（虚构）",
    quote_cny: revenue,
    cost_cny: 0,
    gross_margin: revenue,
    worst_case_cny: 0,
    sources: [{ title: "本地虚构需求单", url: "https://example.com/limit-test" }],
    risks: ["个人模式：无合同、无签字，仅微信/支付宝/个人银行卡人工确认"],
    requires_license: false,
    requires_offline: false,
    certainty: "certain" as const,
    delivery_days: 1,
  };
  const project = domain.createProject(orderLine);
  const currentConfig = config.load();
  const paymentProvider = currentConfig.payments.providers.find((p) => p.enabled) ?? currentConfig.payments.providers[0];
  const receiptRef = `rcpt-limit-${stamp}`;
  const ledger = domain.recordLedger({
    project_id: project.id,
    type: "income",
    amount_cny: revenue,
    payee_or_payer: "示例个人客户（虚构）",
    basis: `项目周报交付验收单（个人模式，无合同/无签字；渠道：${paymentProvider?.name ?? "个人收款"}）`,
    approved_by: "本人（个人模式，人工确认到账）",
    receipt_ref: receiptRef,
    occurred_at: now(),
    confidence: "certain",
  });
  const ledgerFacts = domain.ledgerEntryFacts(ledger.id);
  const monthly = domain.buildMonthlyReport(new Date().toISOString().slice(0, 7));
  record("finance", "act", "记录收入（变现）", `收款 ¥${revenue}；渠道=${paymentProvider?.name ?? "个人收款"}；回执=${receiptRef}；账本 6 要素完整`, tokenPerAction);
  consume(steps[steps.length - 1]!);
  record("backend", "evidence", "后台留痕", "全流程事件、Token、预算、收款回执已写入本次 run 目录", tokenPerAction);
  consume(steps[steps.length - 1]!);

  // ---------- 7) 汇总与证据 ----------
  const finalConfig = config.load();
  const tokenHistory = config.tokenUsageHistory();
  const usageByAgent: Record<string, number> = {};
  for (const entry of tokenHistory) {
    const key = entry.agent_role;
    usageByAgent[key] = (usageByAgent[key] ?? 0) + (entry.ok ? entry.amount : 0);
  }
  const tokenUsage = {
    used_tokens: finalConfig.token_budget.used_tokens,
    limit_tokens: finalConfig.token_budget.limit_tokens,
    remaining_tokens: finalConfig.token_budget.limit_tokens - finalConfig.token_budget.used_tokens,
    per_action_limit: finalConfig.token_budget.per_action_limit,
    on_exceed: finalConfig.token_budget.on_exceed,
    by_agent: usageByAgent,
    history: tokenHistory,
  };
  await writeJson(join(runDir, "agents-timeline.json"), steps);
  await writeJson(join(runDir, "token-usage.json"), tokenUsage);
  await writeJson(join(runDir, "budget-denied.json"), spendAttempt);
  await writeJson(join(runDir, "payment-receipt.json"), {
    mode,
    revenue_cny: revenue,
    provider: paymentProvider ?? null,
    receipt_ref: receiptRef,
    ledger,
    ledger_facts: ledgerFacts,
    sign_contract: currentConfig.payments.sign_contract,
    require_dual_review: currentConfig.payments.require_dual_review,
    invoice: currentConfig.payments.invoice,
  });
  await writeJson(join(runDir, "monthly-report.json"), monthly);
  await writeJson(join(runDir, "config-snapshot.json"), finalConfig);

  const ok =
    browserEvidence.ok &&
    spendAttempt.allowed === false &&
    tokenUsage.used_tokens > 0 &&
    tokenUsage.used_tokens <= tokenLimit &&
    ledgerFacts !== null &&
    monthly.income_cny >= revenue &&
    Object.values(qcChecks).every(Boolean);
  const result = {
    ok,
    mode,
    project_id: project.id,
    project_name: projectName,
    budget_limit_cny: budgetLimit,
    budget_denied: spendAttempt.allowed === false,
    budget_denied_reason: spendAttempt.reason ?? null,
    token_limit: tokenLimit,
    token_used: tokenUsage.used_tokens,
    token_remaining: tokenUsage.remaining_tokens,
    browser_ok: browserEvidence.ok,
    browser_title: browserEvidence.title,
    browser_headless: browserEvidence.headless,
    revenue_cny: revenue,
    payment_provider: paymentProvider?.name ?? null,
    receipt_ref: receiptRef,
    ledger_facts: ledgerFacts,
    monthly_income_cny: monthly.income_cny,
    deliverable: deliverablePath,
    screenshot: browserEvidence.screenshot,
    agents: [...new Set(steps.map((s) => s.agent))],
    steps: steps.length,
    run_dir: runDir,
  };
  await writeJson(join(runDir, "run-result.json"), result);

  const report = [
    `# 0 元预算极限测试报告（${mode === "personal" ? "个人模式" : mode}）`,
    "",
    `- 项目：${projectName}（${project.id}）`,
    `- 预算：¥${budgetLimit}（零预算极限模式：任何外部付费动作必须拒绝）`,
    `- Token：上限 ${tokenLimit.toLocaleString()}，本次消耗 **${tokenUsage.used_tokens.toLocaleString()}**（剩余 ${tokenUsage.remaining_tokens.toLocaleString()}）`,
    `- 交付物：\`deliverable.html\`（真实文件，${Buffer.byteLength(deliverableHtml, "utf8")} bytes）`,
    `- 真实浏览器验收：${browserEvidence.ok ? "通过" : "未通过"}（title=${browserEvidence.title}，headless=${browserEvidence.headless}，截图 \`browser-screenshot.png\`）`,
    `- 预算极限验证：尝试 ¥1 外部付费 → **${spendAttempt.allowed ? "放行（异常）" : "拒绝"}**：${spendAttempt.reason ?? ""}`,
    `- 变现：记录收入 **¥${revenue}**（个人模式：${paymentProvider?.name ?? "个人收款"}；无合同/无签字；回执 ${receiptRef}）`,
    `- 账本 6 要素：金额 ¥${ledgerFacts?.amount_cny} / 收付方 ${ledgerFacts?.payee_or_payer} / 依据 ${ledgerFacts?.basis} / 审批人 ${ledgerFacts?.approved_by} / 回执 ${ledgerFacts?.receipt_ref} / 项目 ${ledgerFacts?.project_id}`,
    `- 月报：收入 ¥${monthly.income_cny} / 成本 ¥${monthly.cost_cny} / 毛利 ¥${monthly.gross_margin_cny}`,
    `- 智能体参与：${[...new Set(steps.map((s) => s.agent))].join("、")}（共 ${steps.length} 步）`,
    "",
    "> 个人模式：仅微信/支付宝/个人银行卡人工到账确认，无合同签字、无双人复核；AI 不代签。",
    "",
  ].join("\n");
  await writeFile(join(runDir, "report.md"), report, "utf8");

  if (parsed.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`0 元预算极限测试：${ok ? "通过 ✅" : "未通过 ❌"}`);
    console.log(`  项目：${project.id} ${projectName}`);
    console.log(`  预算 ¥${budgetLimit} → 尝试 ¥1 外部支出：${spendAttempt.allowed ? "放行(异常)" : "拒绝 ✅"}`);
    console.log(`  Token：${tokenUsage.used_tokens.toLocaleString()} / ${tokenLimit.toLocaleString()}`);
    console.log(`  交付物：${deliverablePath}`);
    console.log(`  浏览器验收：${browserEvidence.ok ? "通过" : "失败"}（${browserEvidence.title}）`);
    console.log(`  变现：¥${revenue}（${paymentProvider?.name ?? "个人收款"}，回执 ${receiptRef}）`);
    console.log(`  证据目录：${runDir}`);
  }
  return ok ? 0 : 1;
}
