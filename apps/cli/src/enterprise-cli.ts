/**
 * 阶段二 P3：企业版 CLI 与证据（`steward enterprise-demo`）。
 * 覆盖：企业主体/认证/授权书/用印（AI 不代签）/对公账户/发票校验/申报草稿/双人复核/组织审批链/30 条边界双模式/B8 双模式一致性阻断。
 * 由 apps/cli/src/index.ts 接线；纯本地、无网络。
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
import { EnterpriseEngine, type OrderContext } from "../../../packages/steward-enterprise/src/index.js";

type Flags = Record<string, string | boolean>;
export interface EnterpriseArgs {
  flags: Flags;
}

const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");

function loadFixtureOrders(root: string): OrderContext[] | null {
  const path = join(root, "examples", "demo-enterprise", "orders.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as OrderContext[]) : null;
  } catch {
    return null;
  }
}

export function registerEnterpriseTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: "enterprise.run",
      description: "企业版：主体/授权书/用印/对公/专票/双人复核/组织审批链/30 条边界双模式/B8 双模式一致性（AI 不代签、不自动提交）",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (_args, ctx): Promise<ToolResult> => {
      const root = findRepoRoot();
      const engine = new EnterpriseEngine();

      // 1) 企业主体校验 + 用印流程（AI 不代签）
      const entityValidation = engine.validateEntity();
      const seal = engine.sealFlow({ doc_id: "doc-demo-contract-001", title: "示例企业服务合同（虚构）" });
      const sealSigned = engine.markSealSignedByHuman(seal.doc_id, "示例法人（虚构，人签）");

      // 2) 组织审批链
      const approvalChains = [3000, 20000, 80000].map((amount) => engine.approvalChainFor(amount));

      // 3) 双人复核（收款账户变更：1 人不生效，2 位不同角色生效）
      const change = engine.requestAccountChange({
        from_account: "示例银行 **** 8888（虚构）",
        to_account: "示例银行 **** 9999（虚构）",
        requested_by: "示例财务（虚构）",
      });
      const review1 = engine.reviewAccountChange(change.id, "示例财务负责人（虚构，finance）", "approve");
      const review2 = engine.reviewAccountChange(change.id, "示例法务（虚构，legal）", "approve");

      // 4) 发票校验与申报草稿（仅草稿，人确认提交）
      const invoiceContext: OrderContext = {
        mode: "enterprise",
        client_type: "company",
        quote_cny: 20000,
        invoice_type_requested: "vat_special",
        payment_method: "corporate_account",
        client_invoice_title: engine.profile.invoice_defaults.title,
        client_tax_no: engine.profile.invoice_defaults.tax_no,
        signatory: engine.profile.entity.agent_name,
        seal_required: true,
      };
      const invoice = engine.createInvoiceDraft(invoiceContext);

      // 5) B8：双模式各跑一单 + 6 类不一致阻断
      const dualMode = engine.runDualModeOrders();

      // 6) fixtures 一致性交叉验证（若 fixtures 已提供）
      const fixtureOrders = loadFixtureOrders(root);
      let fixtureCheck: unknown = null;
      if (fixtureOrders) {
        const rows = fixtureOrders.map((order) => {
          const conflicts = engine.checkModeConsistency(order);
          const run = engine.runOrder(order);
          const expectedBlocked = (order as unknown as { expected_blocked?: boolean }).expected_blocked === true;
          const expectedCode = (order as unknown as { expected_conflict_code?: string }).expected_conflict_code;
          return {
            case_id: (order as unknown as { case_id?: string }).case_id ?? null,
            expected_blocked: expectedBlocked,
            blocked: run.blocked,
            ok: run.blocked === expectedBlocked && (expectedCode ? conflicts.some((c) => c.code === expectedCode) : true),
            conflicts: conflicts.map((c) => ({ code: c.code, field: c.field, message: c.message })),
          };
        });
        fixtureCheck = { total: rows.length, all_ok: rows.every((row) => row.ok), rows };
      }

      // 7) 30 条边界双模式表
      const boundaryTable = engine.boundaryRules30();
      const boundaryMarkdown = engine.boundaryTableMarkdown();
      const boundaryChecks = engine.checkBoundary({
        kind: "business_scope",
        text: "承接需要资质的用工派遣业务",
        requires_license: true,
        mode: "enterprise",
      });

      // 8) 写证据
      await writeJson(join(ctx.evidenceDir, "profile.json"), engine.profile);
      await writeJson(join(ctx.evidenceDir, "entity-validation.json"), entityValidation);
      await writeJson(join(ctx.evidenceDir, "seal-flow.json"), { initial: seal, signed: sealSigned });
      await writeJson(join(ctx.evidenceDir, "org-approval.json"), approvalChains);
      await writeJson(join(ctx.evidenceDir, "dual-review.json"), {
        request: change,
        after_first_review: review1,
        after_second_review: review2,
        applied_only_after_two: review1.applied === false && review2.applied === true,
      });
      await writeJson(join(ctx.evidenceDir, "invoice-validation.json"), invoice);
      await writeJson(join(ctx.evidenceDir, "dual-mode-orders.json"), dualMode);
      await writeJson(join(ctx.evidenceDir, "boundary-table.json"), boundaryTable);
      await writeFile(join(ctx.evidenceDir, "boundary-table.md"), boundaryMarkdown + "\n", "utf8");
      await writeJson(join(ctx.evidenceDir, "boundary-checks.json"), boundaryChecks);
      if (fixtureCheck) await writeJson(join(ctx.evidenceDir, "fixture-checks.json"), fixtureCheck);

      const fourKeyRules = boundaryTable.filter((row) =>
        ["无证业务", "借用资质", "陌生外呼", "超预算"].some((keyword) => row.trigger.includes(keyword) || row.user_message.includes(keyword)),
      );
      const ok =
        entityValidation.ok === true &&
        sealSigned.ai_may_sign === false &&
        sealSigned.status === "signed" &&
        review1.applied === false &&
        review2.applied === true &&
        invoice.draft_status === "draft_pending_human" &&
        dualMode.ok === true &&
        dualMode.checks.all_mismatches_blocked === true &&
        boundaryTable.length === 30 &&
        fourKeyRules.length >= 4 &&
        boundaryChecks.decision !== "allow" &&
        (fixtureCheck === null || (fixtureCheck as { all_ok: boolean }).all_ok === true);

      const report = [
        "# 企业版演示报告（阶段二 P3）",
        "",
        `- 企业主体：${engine.profile.entity.name}（虚构）；许可/授权书/对公/税号校验=${entityValidation.ok}`,
        `- 用印：${seal.status} → ${sealSigned.status}（ai_may_sign=${sealSigned.ai_may_sign}，仅人签）`,
        `- 组织审批链：${approvalChains.map((chain) => `${chain.amount_cny}→${chain.chain.length}级`).join("；")}`,
        `- 双人复核：1 人后 applied=${review1.applied}；2 人后 applied=${review2.applied}（要求 2 位不同角色）`,
        `- 发票：${invoice.invoice_type} 抬头/税号/合同一致=${invoice.checks.title_matches && invoice.checks.tax_no_matches && invoice.checks.contract_matches}；草稿状态=${invoice.draft_status}（不自动提交）`,
        `- B8 双模式：personal=${dualMode.personal.order?.blocked === false ? "通过" : "阻断"}；enterprise=${dualMode.enterprise.order?.blocked === false ? "通过" : "阻断"}；6 类不一致阻断=${dualMode.checks.all_mismatches_blocked}`,
        `- 30 条边界：${boundaryTable.length} 条（个人/企业双模式标注）；四类重点规则 ${fourKeyRules.length} 条`,
        `- fixtures 交叉验证：${fixtureCheck ? (fixtureCheck as { total: number; all_ok: boolean }).total + " 条，全部符合预期=" + (fixtureCheck as { all_ok: boolean }).all_ok : "无 fixtures"}`,
        "",
        "> 全部为虚构企业数据；AI 不代签、发票仅草稿、申报需人确认，未连接真实银行/税务系统。",
        "",
      ].join("\n");
      await writeFile(join(ctx.evidenceDir, "report.md"), report, "utf8");

      return {
        ok,
        summary: `企业版：主体校验=${entityValidation.ok}；双人复核 1 人 applied=${review1.applied}/2 人 applied=${review2.applied}；发票草稿=${invoice.draft_status}；B8 双模式=${dualMode.ok}（6 类不一致阻断=${dualMode.checks.all_mismatches_blocked}）；边界 ${boundaryTable.length} 条（四类重点 ${fourKeyRules.length}）`,
        evidence: [
          join(ctx.evidenceDir, "report.md"),
          join(ctx.evidenceDir, "boundary-table.md"),
          join(ctx.evidenceDir, "boundary-table.json"),
          join(ctx.evidenceDir, "dual-mode-orders.json"),
          join(ctx.evidenceDir, "dual-review.json"),
          join(ctx.evidenceDir, "seal-flow.json"),
          join(ctx.evidenceDir, "invoice-validation.json"),
          join(ctx.evidenceDir, "org-approval.json"),
          ...(fixtureCheck ? [join(ctx.evidenceDir, "fixture-checks.json")] : []),
        ],
      };
    },
  );
}

export async function cmdEnterpriseDemo(parsed: EnterpriseArgs): Promise<number> {
  const root = findRepoRoot();
  const registry = new ToolRegistry();
  registerEnterpriseTools(registry);
  registry.register(
    { name: "echo", description: "回显（记录验收检查/汇总）", risk: "low", requiresApproval: false, evidence: false },
    async (args) => ({ ok: true, summary: String(args.message ?? "ok") }),
  );
  const runtime = new AgentRuntime({ root, tools: registry });
  const manager = new BranchManager();
  const branch = manager.create({
    role: "conductor",
    goal: "企业版：主体/授权/用印/对公/专票/双人复核/组织审批/30 条边界/B8 双模式一致性（AI 不代签、仅草稿）",
    tools: ["echo", "enterprise.run"],
  });
  const plan: PlannedStep[] = [
    {
      tool: "echo",
      description: "写验收检查",
      args: { message: "验收：B8 双模式各跑一单且 6 类不一致阻断；30 条边界双模式标注；双人复核 2 人才生效；AI 不代签；发票仅草稿" },
    },
    { tool: "enterprise.run", description: "运行企业版演示", args: {} },
    { tool: "echo", description: "汇总", args: { message: "企业版证据已写入本次 run 目录（boundary-table/dual-mode-orders/dual-review/seal-flow/invoice/org-approval）" } },
  ];
  const result = await runtime.run({ branch, plan });
  const ok = result.ok;
  if (parsed.flags.json === true) {
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
    for (const step of result.steps) console.log(`- [${step.ok ? "ok" : "fail"}] ${step.tool}: ${step.summary}`);
  }
  return ok ? 0 : 1;
}
