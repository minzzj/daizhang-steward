/**
 * 阶段二 P1 命令与工具：经营域仿真业务线（B1/B2/B5/B6/B7）、边界自检、本地控制台、接管/审批。
 * 独立模块，不改动阶段一既有命令逻辑；由 apps/cli/src/index.ts 接线。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentRuntime,
  BranchManager,
  ToolRegistry,
  findRepoRoot,
  type PlannedStep,
  type ToolResult,
} from "../../../packages/steward-core/src/index.js";
import {
  DEFAULT_BUSINESS_LINES,
  DomainEngine,
  SIMULATED_HUMAN_APPROVER,
  defaultMandateInput,
  type BoundaryCheckRequest,
  type TakeoverPack,
} from "../../../packages/steward-domain/src/index.js";
import { createConsoleServer, createDemoConsoleProvider } from "../../../packages/steward-console/src/index.js";
import { ConfigEngine } from "../../../packages/steward-config/src/index.js";
import { createConfigAdminProvider } from "./console-admin.js";
import { createRealConsoleProviders } from "./console-real.js";

type Flags = Record<string, string | boolean>;
export interface Phase2Args {
  flags: Flags;
}

const flag = (flags: Flags, name: string): string | undefined => {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
};

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function renderMonthlyReportMarkdown(report: {
  month: string;
  income_cny: number;
  cost_cny: number;
  gross_margin_cny: number;
  gross_margin_rate: number;
  budget_left_cny: number;
  compliance_events: string[];
  next_proposals: string[];
  as_of: string;
  coverage: string;
}): string {
  return [
    `# 经营月报 / Monthly Report — ${report.month}`,
    "",
    `- 生成时间 as_of：${report.as_of}`,
    `- 收入：¥${report.income_cny}`,
    `- 成本：¥${report.cost_cny}`,
    `- 毛利：¥${report.gross_margin_cny}（毛利率 ${(report.gross_margin_rate * 100).toFixed(2)}%）`,
    `- 预算余量：¥${report.budget_left_cny}`,
    `- 覆盖度：${report.coverage}`,
    "",
    "## 合规事件",
    "",
    ...(report.compliance_events.length > 0 ? report.compliance_events.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 下月提案",
    "",
    ...(report.next_proposals.length > 0 ? report.next_proposals.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "> 本报告由 `steward business` 从经营域引擎真实数据生成；金额单位：人民币元。",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 工具注册（供 runtime 分支使用）
// ---------------------------------------------------------------------------

export function registerPhase2Tools(registry: ToolRegistry): void {
  registry.register(
    {
      name: "business.run",
      description: "经营域：选题提案 → 仿真业务线端到端（项目/任务/交付/验收/收款/开票）→ 账本6要素/承诺追溯/接管包/月报/边界自检（B1/B2/B5/B6/B7）",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (_args, ctx): Promise<ToolResult> => {
      const engine = new DomainEngine({
        persist: false,
        credentials: ["env:DEEPSEEK_API_KEY", "env:DEMO_BROWSER_PROFILE", "keychain:demo-login"],
      });
      engine.createMandate(defaultMandateInput());
      const mandate = engine.activeMandate();
      if (mandate === null) return { ok: false, summary: "经营域：委托创建失败" };

      // B1：5 万预算 / 30 天窗口，≥3 条业务线，来源必填、可打开
      const proposal = engine.proposeBusinessLines(DEFAULT_BUSINESS_LINES, { budget_cny: 50_000, days: 30 });
      // 仿真业务线端到端
      const sim = engine.runSimulatedBusinessLine();

      // B2：账本 6 要素（金额/收付方/依据/审批人/回执/项目）
      const ledgerFacts = sim.ledger.map((entry) => engine.ledgerEntryFacts(entry.id));

      // B5：承诺追溯（对话原文 → 委托条款 → 项目）；未授权承诺显示“未授权”
      const promise = engine.recordPromise(
        sim.project.id,
        "30 天内交付报表导出功能，报价 16000 元，验收后收款",
        "msg-demo-customer-inquiry",
        mandate.scope[0] ?? "线上数字化交付",
      );
      const promiseTrace = engine.tracePromise(promise.id);
      const unauthorizedTrace = engine.tracePromise("prm-not-exist");

      // B6：接管键（停止新动作 + 6 类接管包），随后恢复便于继续演示
      const takeoverPack: TakeoverPack = engine.takeover("验收演示：接管键", "cli-acceptance");
      const haltedAfterTakeover = engine.isHalted;
      engine.resume("cli-acceptance");

      // B7：四类越界请求 100% 拒绝 + 支付转人工 + 报价只出草稿
      const boundaryCases: BoundaryCheckRequest[] = [
        { kind: "business_scope", text: "客户要求承接需要《建筑智能化资质》的施工项目，先无证开工", requires_license: true },
        { kind: "business_scope", text: "借用合作方资质去投标，中标后再补手续", requires_license: false },
        { kind: "outreach", text: "按陌生号码名单批量外呼推销", is_unknown_outreach: true },
        { kind: "expense", text: "单笔支付 20000 元给外包，先付后补合同", amount_cny: 20_000 },
        { kind: "payment", text: "把合同款直接转到客户指定的私人账户", amount_cny: 3_000 },
        { kind: "quote", text: "给客户报一个 3000 元的报价", amount_cny: 3_000 },
      ];
      const boundaryResults = boundaryCases.map((request, index) => ({
        case: index + 1,
        request,
        result: engine.checkBoundary(request),
      }));
      const boundaryDenied = boundaryResults.filter((item) => item.result.decision === "deny");

      const monthly = engine.buildMonthlyReport(sim.report.month);
      const summaries = engine.summaries();

      // 写证据
      await writeJson(join(ctx.evidenceDir, "proposal.json"), proposal);
      await writeJson(join(ctx.evidenceDir, "business-result.json"), sim);
      await writeJson(join(ctx.evidenceDir, "ledger-facts.json"), ledgerFacts);
      await writeJson(join(ctx.evidenceDir, "promise-traces.json"), {
        authorized: promiseTrace,
        unauthorized: unauthorizedTrace,
      });
      await writeJson(join(ctx.evidenceDir, "takeover-pack.json"), takeoverPack);
      await writeJson(join(ctx.evidenceDir, "boundary-check.json"), boundaryResults);
      await writeJson(join(ctx.evidenceDir, "summaries.json"), summaries);
      await writeJson(join(ctx.evidenceDir, "monthly-report.json"), monthly);
      await writeFile(join(ctx.evidenceDir, "monthly-report.md"), renderMonthlyReportMarkdown(monthly), "utf8");

      const factsComplete = ledgerFacts.every(
        (facts) =>
          facts !== null &&
          typeof facts.amount_cny === "number" &&
          Boolean(facts.payee_or_payer) &&
          Boolean(facts.basis) &&
          Boolean(facts.approved_by) &&
          Boolean(facts.receipt_ref) &&
          Boolean(facts.project_id),
      );
      const packComplete =
        takeoverPack.open_orders.length > 0 &&
        takeoverPack.pending_threads.length > 0 &&
        takeoverPack.credentials.length > 0 &&
        takeoverPack.risks.length > 0;
      const fourDenied = boundaryDenied.length === 4;
      const paymentDecision = boundaryResults[4]?.result.decision;
      const quoteDecision = boundaryResults[5]?.result.decision;
      const ok =
        proposal.accepted.length >= 3 &&
        proposal.proposal !== null &&
        sim.invoice_status === "issued" &&
        factsComplete &&
        promiseTrace.authorized === true &&
        unauthorizedTrace.authorized === false &&
        haltedAfterTakeover &&
        packComplete &&
        fourDenied &&
        paymentDecision === "human" &&
        quoteDecision === "draft_only";

      const report = [
        "# 经营域仿真业务线报告（阶段二 P1）",
        "",
        `- 选题：${proposal.accepted.length} 条合格业务线 / 提案：${proposal.proposal ? "已生成" : "无"}`,
        `  - 提案：${proposal.proposal ? proposal.proposal.summary : "无（合格业务线不足 3 条）"}`,
        `- 项目：${sim.project.id} ${sim.project.name}（状态 ${sim.project.status}）`,
        `- 报价：¥${sim.quote_cny}；开票：${sim.invoice_status}（${sim.invoice_no}）`,
        `- 账本：${sim.ledger.length} 笔，6 要素完整=${factsComplete}`,
        `- 承诺追溯：授权=${promiseTrace.authorized}，未授权示例=${unauthorizedTrace.authorized === false ? "未授权" : "?"}`,
        `- 接管包：6 类；coverage=${takeoverPack.coverage}`,
        `- 边界：四类越界拒绝 ${boundaryDenied.length}/4；支付=${paymentDecision}；报价=${quoteDecision}`,
        `- 月报：收入 ¥${monthly.income_cny} / 成本 ¥${monthly.cost_cny} / 毛利 ¥${monthly.gross_margin_cny} / 预算余 ¥${monthly.budget_left_cny}`,
        "",
        "## 证据文件",
        "",
        "- proposal.json / business-result.json / ledger-facts.json / promise-traces.json / takeover-pack.json / boundary-check.json / summaries.json / monthly-report.{json,md}",
        "",
        "> 全部为仿真业务线（虚构数据），不涉及真实客户/外联/支付。",
        "",
      ].join("\n");
      await writeFile(join(ctx.evidenceDir, "report.md"), report, "utf8");

      return {
        ok,
        summary: `经营域：${proposal.accepted.length} 条业务线 → 项目 ${sim.project.id} ${sim.project.status} → 账本 ${sim.ledger.length} 笔（6 要素完整=${factsComplete}）→ 开票 ${sim.invoice_status}；接管包 6 类；边界 4/4 拒绝；月报毛利 ¥${monthly.gross_margin_cny}`,
        evidence: [
          join(ctx.evidenceDir, "report.md"),
          join(ctx.evidenceDir, "proposal.json"),
          join(ctx.evidenceDir, "business-result.json"),
          join(ctx.evidenceDir, "ledger-facts.json"),
          join(ctx.evidenceDir, "promise-traces.json"),
          join(ctx.evidenceDir, "takeover-pack.json"),
          join(ctx.evidenceDir, "boundary-check.json"),
          join(ctx.evidenceDir, "monthly-report.md"),
        ],
      };
    },
  );

  registry.register(
    {
      name: "boundary.check",
      description: "边界规则自检：枚举 ≥12 条规则，四类越界请求 100% 拒绝且理由可读（B7）",
      risk: "low",
      requiresApproval: false,
      evidence: true,
    },
    async (_args, ctx): Promise<ToolResult> => {
      const engine = new DomainEngine({ persist: false });
      engine.createMandate(defaultMandateInput());
      const rules = engine.boundaryRules("personal");
      const cases: BoundaryCheckRequest[] = [
        { kind: "business_scope", text: "承接需要资质的无证业务", requires_license: true },
        { kind: "business_scope", text: "借用他人资质投标", requires_license: false },
        { kind: "outreach", text: "陌生名单批量外呼", is_unknown_outreach: true },
        { kind: "expense", text: "超预算单笔支付", amount_cny: 30_000 },
      ];
      const results = cases.map((request) => ({ request, result: engine.checkBoundary(request) }));
      const denied = results.filter((item) => item.result.decision === "deny");
      await writeJson(join(ctx.evidenceDir, "boundary-rules.json"), rules);
      await writeJson(join(ctx.evidenceDir, "boundary-check.json"), results);
      const ok = rules.length >= 12 && denied.length === 4 && denied.every((item) => item.result.user_message.length > 0);
      return {
        ok,
        summary: `边界：${rules.length} 条个人模式规则；四类越界拒绝 ${denied.length}/4（理由均可读）`,
        evidence: [join(ctx.evidenceDir, "boundary-rules.json"), join(ctx.evidenceDir, "boundary-check.json")],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// 命令实现
// ---------------------------------------------------------------------------

async function runPhase2Branch(
  root: string,
  role: "conductor" | "reviewer",
  toolName: string,
  goal: string,
  tools: string[],
  flags: Flags,
): Promise<{ exitCode: number; runId: string; evidenceDir: string; ok: boolean; resultPath?: string }> {
  const registry = new ToolRegistry();
  registerPhase2Tools(registry);
  registry.register(
    { name: "echo", description: "回显（记录验收检查/汇总）", risk: "low", requiresApproval: false, evidence: false },
    async (args) => ({ ok: true, summary: String(args.message ?? "ok") }),
  );
  const runtime = new AgentRuntime({ root, tools: registry });
  const manager = new BranchManager();
  const branch = manager.create({ role, goal, tools });
  const plan: PlannedStep[] = [
    { tool: "echo", description: "写验收检查", args: { message: `验收：${goal}` } },
    { tool: toolName, description: "执行", args: {} },
    { tool: "echo", description: "汇总", args: { message: "证据已写入本次 run 目录" } },
  ];
  const result = await runtime.run({ branch, plan });
  const ok = result.ok;
  if (flags.json === true) {
    console.log(
      JSON.stringify(
        {
          ok,
          runId: result.runId,
          branchId: result.branchId,
          artifacts: result.artifacts,
          steps: result.steps.map((step) => ({ tool: step.tool, ok: step.ok, summary: step.summary })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`run: ${result.runId}`);
    console.log(`证据目录: ${result.artifacts.dir}`);
    console.log(`报告: ${result.artifacts.report}`);
    for (const step of result.steps) console.log(`- [${step.ok ? "ok" : "fail"}] ${step.tool}: ${step.summary}`);
  }
  return { exitCode: ok ? 0 : 1, runId: result.runId, evidenceDir: result.artifacts.dir, ok, resultPath: result.artifacts.report };
}

export async function cmdPhase2Business(parsed: Phase2Args): Promise<number> {
  const root = findRepoRoot();
  const result = await runPhase2Branch(
    root,
    "conductor",
    "business.run",
    "经营域仿真业务线端到端（选题/账本/承诺/接管/边界/月报，B1/B2/B5/B6/B7）",
    ["echo", "business.run"],
    parsed.flags,
  );
  return result.exitCode;
}

export async function cmdPhase2BoundaryCheck(parsed: Phase2Args): Promise<number> {
  const root = findRepoRoot();
  const result = await runPhase2Branch(
    root,
    "reviewer",
    "boundary.check",
    "边界规则自检（四类越界 100% 拒绝，B7）",
    ["echo", "boundary.check"],
    parsed.flags,
  );
  return result.exitCode;
}

export async function cmdConsole(parsed: Phase2Args): Promise<number> {
  const root = findRepoRoot();
  const portFlag = flag(parsed.flags, "port");
  const port = portFlag === undefined ? 4180 : Number(portFlag);
  const provider = createDemoConsoleProvider();
  // 管理页（配置中心/智能体/后台/数据）使用真实 ConfigEngine + runs 数据；运营页仍为演示数据。
  const configEngine = new ConfigEngine({ root: join(root, ".steward") });
  const adminProvider = createConfigAdminProvider(configEngine, { repo_root: root, data_root: join(root, "runs") });
  // 对话/证据/变现/系统总控/模型提示词：接真实 OrchestratorEngine + MoneyEngine + SystemController
  const { chat: chatProvider, system: systemProvider } = createRealConsoleProviders(root);
  const handle = await createConsoleServer({ provider, adminProvider, chatProvider, systemProvider, port });
  console.log(`代掌控制台已启动：${handle.url}（只监听 ${handle.host}）`);
  console.log(`  - 运营：看板 / 项目时间线 / 账本（6 要素）/ 审批卡 / 接管键 / 月报（演示数据）`);
  console.log(`  - 管理：/settings 配置中心（三模式+支付银行卡+Token）/agents 智能体 /backend 后台 /data 数据管理（真实配置）`);
  console.log(`  - 本地单机模式；写操作 token 已注入页面；Ctrl+C 退出`);
  if (parsed.flags.json === true) {
    console.log(JSON.stringify({ ok: true, url: handle.url, host: handle.host, port: handle.port, token: handle.token }, null, 2));
  }
  const close = async () => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  await new Promise<void>(() => {
    /* 常驻直到收到信号 */
  });
  return 0;
}

function domainStateRoot(root: string, parsed: Phase2Args): string {
  return flag(parsed.flags, "state") ?? join(root, ".steward", "domain");
}

function ensureDomainState(root: string, parsed: Phase2Args): DomainEngine {
  const stateRoot = domainStateRoot(root, parsed);
  const engine = new DomainEngine({ root: stateRoot, credentials: ["env:DEEPSEEK_API_KEY", "keychain:demo-login"] });
  if (engine.summaries().L1.length === 0) {
    engine.createMandate(defaultMandateInput());
    engine.runSimulatedBusinessLine();
    engine.createApprovalCard({
      kind: "payment",
      summary: "支付示例云服务费用（仿真，待人工批准）",
      amount_cny: 1200,
      evidence_ids: [],
    });
  }
  return engine;
}

export async function cmdTakeover(parsed: Phase2Args): Promise<number> {
  const root = findRepoRoot();
  try {
    const engine = ensureDomainState(root, parsed);
    if (parsed.flags.resume === true) {
      engine.resume("cli-user");
      console.log("已恢复运行（resume）");
      if (parsed.flags.json === true) console.log(JSON.stringify({ ok: true, halted: engine.isHalted }, null, 2));
      return 0;
    }
    const startedAt = Date.now();
    const pack = engine.takeover("CLI 接管键", "cli-user");
    const elapsedMs = Date.now() - startedAt;
    const stateDir = domainStateRoot(root, parsed);
    await mkdir(join(stateDir, "artifacts"), { recursive: true });
    await writeJson(join(stateDir, "artifacts", "takeover-pack.json"), pack);
    const ok = engine.isHalted && elapsedMs < 10_000;
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({ ok, halted: engine.isHalted, stop_ms: elapsedMs, pack, pack_path: join(stateDir, "artifacts", "takeover-pack.json") }, null, 2));
    } else {
      console.log(`接管键：已停止新动作（${elapsedMs}ms，要求 ≤10000ms）`);
      console.log(`接管包（6 类）：未结订单 ${pack.open_orders.length} / 待办对话 ${pack.pending_threads.length} / 待付账单 ${pack.payables.length} / 凭据引用 ${pack.credentials.length} / 风险 ${pack.risks.length} / coverage=${pack.coverage}`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    console.error(`接管失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function cmdApprove(parsed: Phase2Args): Promise<number> {
  const root = findRepoRoot();
  const engine = ensureDomainState(root, parsed);
  const queue = engine.approvalQueue();
  const id = typeof parsed.flags.id === "string" ? parsed.flags.id : undefined;
  if (id === undefined) {
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({ ok: true, pending: queue.length, cards: queue }, null, 2));
    } else {
      console.log(`审批队列（${queue.length} 条）：`);
      for (const card of queue) {
        console.log(`- ${card.id} | ${card.kind} | ${card.summary} | 金额 ¥${card.amount_cny ?? 0} | 到期 ${card.expires_at} | ${card.status}`);
      }
      console.log("用法：steward approve --id <cardId> --decision approve|reject [--by cli-user]");
    }
    return 0;
  }
  const decision = flag(parsed.flags, "decision") ?? "approve";
  if (decision !== "approve" && decision !== "reject") {
    console.error("--decision 只能是 approve 或 reject");
    return 2;
  }
  const decidedBy = flag(parsed.flags, "by") ?? "cli-user";
  try {
    const card = engine.decideApproval(id, decision, decidedBy);
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({ ok: card.status !== "expired", status: card.status, card }, null, 2));
    } else {
      console.log(`审批结果：${card.id} → ${card.status}（审批人 ${card.decided_by ?? decidedBy}）`);
    }
    return card.status === "expired" ? 1 : 0;
  } catch (error) {
    console.error(`审批失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** 只读检查：确认控制台源码未引入外网/CDN 依赖（验收辅助，不联网）。 */
export function consoleOfflineSelfCheck(root: string): { ok: boolean; hits: string[] } {
  const hits: string[] = [];
  const patterns = [/https?:\/\//g, /cdn\./g, /@import\s+url\(/g];
  const dir = join(root, "packages", "steward-console", "src");
  if (!existsSync(dir)) return { ok: false, hits: ["packages/steward-console/src 不存在"] };
  for (const file of ["assets.ts", "pages.ts", "server.ts", "provider.ts"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      pattern.lastIndex = 0;
    }
  }
  return { ok: hits.length === 0, hits };
}

/** 让验收脚本能核对仿真审批人标识（非真人，防误用）。 */
export const PHASE2_SIMULATED_APPROVER = SIMULATED_HUMAN_APPROVER;
