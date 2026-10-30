#!/usr/bin/env node
/**
 * steward CLI — phase-1 entrypoint.
 * Commands: demo | run | branch | report | stop | takeover | approve | version | help
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRuntime,
  ArtifactBus,
  BranchManager,
  CheckpointStore,
  CredentialVault,
  CrossBranchAccessError,
  ProfileBusyError,
  ProfileLock,
  PromptManager,
  StopController,
  StoppedError,
  StopSignal,
  ToolRegistry,
  assertBranchToolsAllowed,
  findRepoRoot,
  stewardPaths,
  type BranchSpec,
  type CodeTask,
  type PlannedStep,
  type RunResult,
  type ToolResult,
} from "../../../packages/steward-core/src/index.js";
import { MockHarness, demoCodeTask, runCodeLoop } from "../../../packages/steward-harness/src/index.js";
import {
  ScoutEngine,
  type ScoutFixtureLead,
  type ScoutReport,
} from "../../../packages/steward-scout/src/index.js";
import {
  cmdApprove,
  cmdConsole,
  cmdPhase2BoundaryCheck,
  cmdPhase2Business,
  cmdTakeover,
  registerPhase2Tools,
} from "./phase2.js";
import { cmdEnterpriseDemo } from "./enterprise-cli.js";
import { cmdFaultDrill } from "./fault-cli.js";
import { cmdConfig, cmdAgents, cmdData } from "./config-cli.js";
import { cmdLimitRun } from "./limit-run.js";
import { cmdMoney } from "./money-cli.js";
import { cmdAgent, cmdSystem } from "./agent-cli.js";
import { cmdRuntime } from "./run-cli.js";
import { cmdAi } from "./ai-cli.js";

const VERSION = "1.5.1";
const REPO_SLUG = "github.com/minzzj/daizhang-steward";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function printHelp(): void {
  console.log(`steward ${VERSION} — 代掌 Steward CLI（阶段一内核）

用法 / Usage:
  steward demo [--json]                       跑通 M0 空回路（MockHarness，无需付费 API）
  steward browser-flow [--case normal|login-timeout] [--headless] [--json]
                                              真实浏览器（本机 Chrome/Edge）执行 demo-web 流程并截图留证（A2）
  steward desktop-flow [--json]              真实 Windows 桌面键鼠执行 demo-desktop 流程并截图留证（A3）
  steward scout [--fixture <path>] [--json]  Scout 客户分支：fixture → ICP/评分/3 条草稿/审批队列（不发送，A7）
  steward dummy-branch [--json]              只读 dummy 分支：仅配置+已有 reviewer 提示词，不改核心（A10）
  steward business [--json]                  阶段二：选题/仿真业务线/账本6要素/承诺追溯/接管包/月报/边界（B1/B2/B5/B6/B7）
  steward boundary-check [--json]            阶段二：边界规则自检（四类越界 100% 拒绝，B7）
  steward fault-drill --case net-outage|platform-ban [--outage-minutes 120] [--ban-minutes 15] [--json]
                                              阶段二：真实故障演练（断网 B3 / 平台封禁 B4，真实 localhost HTTP）
  steward console [--port 4180]              阶段二：本地 Web 控制台（只监听 127.0.0.1）
  steward enterprise-demo [--json]           阶段三：企业版（主体/授权/用印/对公/专票/双人复核/30 条边界/B8 双模式）
  steward config [--action get|mode|set|reset|export|import|validate] [--json]
                                              配置中心：体验/个人/企业三模式、预算/Token/银行卡/支付/功能开关
  steward agents [--json]                     智能体列表（含写代码 Harness、核查、后台）与 Token 用量
  steward data [--action stats|reset] [--yes] 数据统计 / 清空运行时数据（清空需 --yes）
  steward limit-run [--budget 0] [--token-limit 10000000] [--revenue 10] [--json]
                                              0 元预算极限测试：真实交付 + 真实浏览器验收 + 变现记账（个人模式）
  steward runtime --goal "<目标>" [--json] [--manual]                      发送即执行（自动跑完/需人工确认才暂停）+ 实时事件
  steward runtime --action list|status|stream|approve|reject|interrupt|resume --run <id> [--step N] [--json]
                                              实时执行：查看/审批/打断/恢复 Run（无需手动点开始）
  steward chat --goal "<目标>" [--kind system|project] [--auto] [--json]     总调度对话：拆计划/派发/每轮摘要/打断恢复/审批
  steward supervisor --goal "<目标>" [--json]  系统总控（最高层）：程序/插件/模型/提示词/委派项目/危险动作二次确认
  steward project --goal "<目标>" [--json]     项目总调度（conductor）：拆解→派发→交付→证据
  steward chat --action run|approve|reject|interrupt|resume|list|detail|logs --session <id> [--step N] [--json]
  steward system [--action info|list|plan|exec|audit] [--op app.start] [--target <id>] [--yes] [--json]
                                              系统动作：受管程序/插件；删除类需二次确认+备份回收站
  steward money [--action create|list|confirm|cancel|summary|explain|ledger|reset]
                [--amount 10] [--client "..."] [--purpose "..."] [--method wechat_pay|alipay|personal_bank_card|corporate_account|manual] [--json]
                                              变现实收：创建收款请求 → 人工确认到账 → 账本 6 要素 + 发票草稿（演示渠道，未接真实支付）
  steward approve [--id <cardId> --decision approve|reject] [--json]  审批队列（超时挂起，不自动放行）
  steward takeover [--resume] [--json]       接管键：停止新动作并生成 6 类接管包
  steward code-loop [--fail] [--json]         CodeTask→Harness→隔离 worktree 应用补丁→真实浏览器验收（A4/A5）
  steward run --goal "<目标>" [--role operator] [--resume <runId>] [--json]
                                              在 Mock 计划下执行一个分支；--resume 从检查点跳过已完成步骤
  steward safety-check [--json]               停止键≤5s / 检查点恢复 / 分支隔离自检（A8/A9）
  steward branch --role operator --goal "<目标>" [--json]
                                              只生成 BranchSpec（不执行）
  steward report [--run <id|latest>] [--json] 查看运行报告
  steward stop [--reason "<原因>"]            触发停止键（5 秒内生效于下一步前检查）
  steward stop --clear                        清除停止键
  steward version | help

约定：
  - 所有运行产物写入 runs/<run-id>/（prompt.md / patch.diff / test.log / events.jsonl / report.md）
  - 事件账本只追加、哈希链；密钥脱敏
  - 高风险动作默认拒绝；验证码/2FA/人脸一律停止交人（M1 起在真实浏览器适配器执行）
`);
}

function createTools(root: string): ToolRegistry {
  const registry = new ToolRegistry();
  const harness = new MockHarness();

  registry.register(
    { name: "echo", description: "记录一条计划内说明（无副作用）", risk: "low", requiresApproval: false, evidence: false },
    async (args): Promise<ToolResult> => ({
      ok: true,
      summary: String(args.message ?? args.text ?? ""),
    }),
  );

  registry.register(
    { name: "write.artifact", description: "把计划产物写入本次运行的证据目录", risk: "low", requiresApproval: false, evidence: true },
    async (args, ctx): Promise<ToolResult> => {
      const name = String(args.name ?? "artifact.md").replaceAll("/", "_").replaceAll("\\", "_");
      const path = join(ctx.evidenceDir, name);
      await writeFile(path, String(args.content ?? ""), "utf8");
      return { ok: true, summary: `已写入产物 ${name}`, evidence: [path] };
    },
  );

  registry.register(
    { name: "harness.request", description: "把 CodeTask 交给 HarnessAdapter 并保存补丁与测试日志", risk: "medium", requiresApproval: false, evidence: true },
    async (args, ctx): Promise<ToolResult> => {
      const task = args.task as CodeTask | undefined;
      if (!task) return { ok: false, summary: "缺少 CodeTask 参数" };
      const result = await harness.runTask(task);
      const taskPath = join(ctx.evidenceDir, "code-task.json");
      const resultPath = join(ctx.evidenceDir, "code-result.json");
      const patchPath = join(ctx.evidenceDir, "patch.diff");
      const testLogPath = join(ctx.evidenceDir, "test.log");
      await writeFile(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
      await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
      await writeFile(patchPath, result.patch, "utf8");
      const testLog = [
        `# MockHarness test log`,
        `task_id: ${task.task_id}`,
        `tests_run:`,
        ...result.tests_run.map((t) => `  - ${t}`),
        `risks: ${result.risks.join("; ")}`,
        `uncovered: ${result.uncovered.join("; ")}`,
        `RESULT: PASS (mock harness; real browser acceptance runs at M1)`,
        "",
      ].join("\n");
      await writeFile(testLogPath, testLog, "utf8");
      return {
        ok: true,
        summary: result.summary,
        evidence: [taskPath, resultPath, patchPath, testLogPath],
      };
    },
  );

  registry.register(
    {
      name: "browser.flow",
      description: "真实浏览器（本机 Chrome/Edge，有头默认）执行 demo-web 登录/提交/校验流程并逐步截图留证",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (args, ctx): Promise<ToolResult> => {
      const caseName = String(args.case ?? "normal");
      const headless = args.headless === true ? "1" : "0";
      const e2eDir = join(ctx.evidenceDir, "e2e");
      const script = join(root, "tests", "e2e-browser", "login-flow.mjs");
      if (!existsSync(script)) {
        return { ok: false, summary: `真实浏览器 E2E 脚本缺失：${script}` };
      }
      const run = spawnSync(
        process.execPath,
        [script, "--case", caseName, "--headless", headless, "--workdir", join(root, "examples", "demo-web"), "--evidence-dir", e2eDir],
        { cwd: root, encoding: "utf8", timeout: 240_000, env: { ...process.env, NO_COLOR: "1" } },
      );
      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      const logPath = join(ctx.evidenceDir, "test.log");
      await writeFile(logPath, output, "utf8");
      const resultPath = join(e2eDir, "result.json");
      const evidence = [logPath, ...(existsSync(resultPath) ? [resultPath] : []), e2eDir];
      return {
        ok: run.status === 0,
        summary:
          run.status === 0
            ? `真实浏览器流程通过（case=${caseName}），截图见 ${e2eDir}`
            : `真实浏览器流程失败（case=${caseName}, exit=${run.status}），详见 ${logPath}`,
        evidence,
      };
    },
  );

  registry.register(
    {
      name: "desktop.flow",
      description: "真实 Windows 桌面：打开 demo-desktop、真实键鼠填表/保存/校验并逐步截图",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (_args, ctx): Promise<ToolResult> => {
      const e2eDir = join(ctx.evidenceDir, "e2e-desktop");
      const script = join(root, "tests", "e2e-desktop", "run.mjs");
      if (!existsSync(script)) {
        return { ok: false, summary: `真实桌面 E2E 脚本缺失：${script}` };
      }
      const run = spawnSync(process.execPath, [script, "--evidence-dir", e2eDir], {
        cwd: root,
        encoding: "utf8",
        timeout: 300_000,
        env: { ...process.env, NO_COLOR: "1" },
      });
      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      const logPath = join(ctx.evidenceDir, "test.log");
      await writeFile(logPath, output, "utf8");
      const resultPath = join(e2eDir, "result.json");
      const evidence = [logPath, ...(existsSync(resultPath) ? [resultPath] : []), e2eDir];
      return {
        ok: run.status === 0,
        summary:
          run.status === 0
            ? `真实桌面流程通过（真实键鼠），截图见 ${e2eDir}`
            : `真实桌面流程失败（exit=${run.status}），详见 ${logPath}`,
        evidence,
      };
    },
  );

  registry.register(
    {
      name: "code.loop",
      description: "CodeTask→Harness→隔离 worktree 应用补丁→真实浏览器验收；最多两轮，超限升级人类",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (args, ctx): Promise<ToolResult> => {
      const useBroken = args.fail === true;
      const patchFile = join(root, "examples", "mock-harness", useBroken ? "broken-login-timeout.patch" : "fix-login-timeout.patch");
      if (!existsSync(patchFile)) return { ok: false, summary: `Mock 补丁缺失：${patchFile}` };
      const e2eScript = join(root, "tests", "e2e-browser", "login-flow.mjs");
      if (!existsSync(e2eScript)) return { ok: false, summary: `真实浏览器 E2E 脚本缺失：${e2eScript}` };
      const harnessWithPatch = new MockHarness({ patch: readFileSync(patchFile, "utf8") });
      const task = demoCodeTask(REPO_SLUG);
      const e2eDir = join(ctx.evidenceDir, "e2e");
      const testLogPath = join(ctx.evidenceDir, "test.log");
      await writeFile(testLogPath, "", "utf8");
      const result = await runCodeLoop({
        task,
        harness: harnessWithPatch,
        repoRoot: root,
        acceptanceCommand: `node "${e2eScript}" --case login-timeout --headless 0 --workdir "{worktree}/examples/demo-web" --evidence-dir "${e2eDir}"`,
        evidenceDir: e2eDir,
        testLogPath,
        maxRounds: 2,
      });
      const patchPath = join(ctx.evidenceDir, "patch.diff");
      const resultPath = join(ctx.evidenceDir, "code-loop-result.json");
      await writeFile(patchPath, result.patch, "utf8");
      await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
      return {
        ok: result.ok,
        summary: result.summary,
        evidence: [patchPath, testLogPath, resultPath],
      };
    },
  );

  registry.register(
    {
      name: "scout.report",
      description: "Scout 客户分支：读取本地合规 fixtures → ICP/三场景/四因子评分/去重/3 条外联草稿/审批队列（只起草，不发送）",
      risk: "medium",
      requiresApproval: false,
      evidence: true,
    },
    async (args, ctx): Promise<ToolResult> => {
      const fixturePath = String(args.fixture ?? join(root, "examples", "scout-fixtures", "leads.json"));
      if (!existsSync(fixturePath)) return { ok: false, summary: `Scout fixtures 缺失：${fixturePath}` };
      let leads: ScoutFixtureLead[];
      try {
        leads = JSON.parse(readFileSync(fixturePath, "utf8")) as ScoutFixtureLead[];
      } catch (error) {
        return { ok: false, summary: `Scout fixtures 不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
      }
      if (!Array.isArray(leads) || leads.length === 0) return { ok: false, summary: "Scout fixtures 必须是非空数组" };

      const engine = new ScoutEngine({ leads }); // 全量传入（不要按 status 预过滤）
      const report: ScoutReport = engine.buildReport(); // 内部会物化草稿
      const scored = engine.scoredLeads();
      const drafts = engine.drafts();
      const queue = engine.approvalQueue();

      const reportMdPath = join(ctx.evidenceDir, "scout-report.md");
      const reportJsonPath = join(ctx.evidenceDir, "scout-report.json");
      const scoredPath = join(ctx.evidenceDir, "leads-scored.json");
      const draftsPath = join(ctx.evidenceDir, "drafts.json");
      const queuePath = join(ctx.evidenceDir, "approval-queue.json");
      await writeFile(reportJsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      await writeFile(scoredPath, JSON.stringify(scored, null, 2) + "\n", "utf8");
      await writeFile(draftsPath, JSON.stringify(drafts, null, 2) + "\n", "utf8");
      await writeFile(queuePath, JSON.stringify(queue, null, 2) + "\n", "utf8");

      const markdown = [
        "# ScoutReport — 客户分支（fixture 驱动；只起草，未发送）",
        "",
        `- 生成时间：${report.generated_at}`,
        `- 线索总数：${report.leads_total}（丢弃 ${report.leads_discarded}）`,
        `- 合格线索：${report.qualified_count}`,
        `- 外联草稿：${report.drafts_count}（全部待人工审批）`,
        `- 已发送：${report.sent_count}（自动发送被禁止）`,
        `- 每日每渠道上限：${report.daily_limit_per_channel}`,
        "",
        "## ICP",
        "",
        `- 细分：${report.icp.segment}`,
        `- 痛点：${report.icp.pain_points.join("；")}`,
        `- 预算：${report.icp.budget}`,
        `- 渠道：${report.icp.channels.join(", ")}`,
        `- 不合格线：${report.icp.disqualifiers.join("；")}`,
        "",
        "## 三个高价值场景",
        "",
        ...report.scenarios.map(
          (scenario) => `- **${scenario.name}**：${scenario.who_hurts}；痛点：${scenario.pain}；现状：${scenario.current_workaround}`,
        ),
        "",
        "## 渠道统计",
        "",
        ...Object.entries(report.channels).map(([channel, stats]) => `- ${channel}: drafts=${stats.drafts}, sent=${stats.sent}`),
        "",
        "## 丢弃记录",
        "",
        ...(report.rejected_reasons.length > 0
          ? report.rejected_reasons.map((item) => `- ${item.lead_id ?? "(无 id)"}：${item.reason}`)
          : ["- 无"]),
        "",
        "## 审批队列（全部 pending；人工批准后才会发送）",
        "",
        "| lead_id | 渠道 | 字数 | 引用信号 | 状态 |",
        "|---|---|---|---|---|",
        ...queue.map((item) => `| ${item.lead_id} | ${item.draft.channel} | ${item.draft.chars} | ${item.draft.cites_signal} | ${item.status} |`),
        "",
        "> 合规：未批准不发送；每日每渠道 ≤10；支持退订；不冒充人类；不采集无合法依据的个人信息。",
        "",
      ].join("\n");
      await writeFile(reportMdPath, markdown, "utf8");

      const draftsDir = join(ctx.evidenceDir, "outreach-drafts");
      await mkdir(draftsDir, { recursive: true });
      for (const draft of drafts) {
        await writeFile(
          join(draftsDir, `${draft.lead_id}.md`),
          `# ${draft.subject}\n\n${draft.body}\n\n- chars: ${draft.chars}\n- cites_signal: ${draft.cites_signal}\n- status: ${draft.status}\n`,
          "utf8",
        );
      }

      const ok = report.sent_count === 0 && queue.every((item) => item.status === "pending");
      return {
        ok,
        summary: `Scout：${report.leads_total} 条线索 → 丢弃 ${report.leads_discarded} → 合格 ${report.qualified_count} → ${report.drafts_count} 条草稿（全部待审批，0 发送）`,
        evidence: [reportMdPath, reportJsonPath, scoredPath, draftsPath, queuePath, draftsDir],
      };
    },
  );

  registerPhase2Tools(registry);

  return registry;
}

async function loadPrompts(): Promise<PromptManager | undefined> {
  const paths = stewardPaths(findRepoRoot());
  try {
    return await PromptManager.load(paths.prompts);
  } catch (error) {
    console.error(`[warn] 提示词未加载：${(error as Error).message}`);
    console.error("[warn] 先运行 `npm run prompts:manifest` 生成/更新 prompts/manifest.json");
    return undefined;
  }
}

function printRunResult(result: RunResult, root: string, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          runId: result.runId,
          branchId: result.branchId,
          reportPath: result.reportPath,
          artifacts: result.artifacts,
          steps: result.steps.map((s) => ({ tool: s.tool, decision: s.decision, ok: s.ok, summary: s.summary })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const rel = (p: string): string => p.replaceAll("\\", "/").replace(root.replaceAll("\\", "/") + "/", "");
  console.log("");
  console.log(`运行 ${result.ok ? "通过 ✅" : "未通过 ❌"}  run-id: ${result.runId}`);
  console.log(`分支: ${result.branchId}`);
  console.log(`证据目录: ${rel(result.artifacts.dir)}/`);
  for (const step of result.steps) {
    console.log(`  - [${step.decision}] ${step.tool}: ${step.ok ? "ok" : "failed"} — ${step.summary}`);
  }
  console.log(`报告: ${rel(result.reportPath)}`);
}

async function cmdDemo(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const branch: BranchSpec = manager.create({
    role: "operator",
    goal: "M0 空回路演示：确定本期方向 → 产出计划 → 请 Harness 生成补丁 → 汇总（MockHarness，无付费 API）",
    tools: ["echo", "write.artifact", "harness.request"],
    promptRef: "operator@1.0.0",
  });
  const task = demoCodeTask(REPO_SLUG);
  const plan: PlannedStep[] = [
    { tool: "echo", description: "确定方向", args: { message: "本期方向：接管 demo-web 登录超时缺陷，走 CodeTask→MockHarness→补丁→证据 回路" } },
    {
      tool: "write.artifact",
      description: "写验收计划",
      args: {
        name: "goal.md",
        content: [
          "# M0 空回路目标（自动生成）",
          "",
          `- 仓库：${REPO_SLUG}`,
          "- 目标：跑通 AgentRuntime + BranchSpec + PolicyEngine + ArtifactBus + MockHarness 的最小闭环",
          "- 验收：A1（干净安装可跑、无需付费 API）、A6（每次运行有 prompt/patch/test.log/截图/report 且无密钥）、A12（提示词版本化且有测试）",
          "- 下一步（M1）：真实浏览器执行同一回路并修复 demo-web 预置缺陷",
          "",
        ].join("\n"),
      },
    },
    { tool: "harness.request", description: "请求 MockHarness 生成补丁", args: { task } },
    { tool: "echo", description: "汇总", args: { message: "M0 空回路完成：产物与事件已落盘，等待 M1 接入真实浏览器验收" } },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdRun(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const goal = flagString(parsed.flags, "goal");
  if (!goal) {
    console.error('缺少 --goal "<目标>"');
    return 2;
  }
  const roleFlag = flagString(parsed.flags, "role") ?? "operator";
  if (!["operator", "dummy", "conductor"].includes(roleFlag)) {
    console.error(`不支持的 --role：${roleFlag}`);
    return 2;
  }
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const branch = manager.create({
    role: roleFlag as "operator" | "dummy" | "conductor",
    goal,
    tools: roleFlag === "dummy" ? ["echo"] : ["echo", "write.artifact"],
    promptRef: `${roleFlag}@1.0.0`,
  });
  const plan: PlannedStep[] = [
    { tool: "echo", description: "接收目标", args: { message: `目标：${goal}` } },
    { tool: "write.artifact", description: "记录计划", args: { name: "plan.md", content: `# 计划\n\n目标：${goal}\n分支：${branch.id}\n` } },
    { tool: "echo", description: "汇总", args: { message: "计划执行完成（空回路；真实工具已接入 browser-flow/desktop-flow/code-loop）" } },
  ];
  const resumeRunId = flagString(parsed.flags, "resume");
  const result = await runtime.run({
    branch,
    plan,
    ...(resumeRunId ? { runId: resumeRunId, resume: true } : {}),
  });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdBrowserFlow(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const branch = manager.create({
    role: "operator",
    goal: "真实浏览器执行 demo-web 登录→提交项目流程并留证（A2）",
    tools: ["echo", "browser.flow"],
  });
  const caseName = flagString(parsed.flags, "case") ?? "normal";
  const plan: PlannedStep[] = [
    { tool: "echo", description: "写验收检查", args: { message: "验收：真实 Chrome/Edge 有头模式完成登录、填表、提交、校验，每步截图" } },
    { tool: "browser.flow", description: "运行真实浏览器流程", args: { case: caseName, headless: parsed.flags.headless === true } },
    { tool: "echo", description: "汇总", args: { message: "真实浏览器证据已写入本次 run 目录的 e2e/" } },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdDesktopFlow(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const branch = manager.create({
    role: "operator",
    goal: "真实 Windows 桌面执行 demo-desktop 打开→填表→保存→校验→截图（A3）",
    tools: ["echo", "desktop.flow"],
  });
  const plan: PlannedStep[] = [
    { tool: "echo", description: "写验收检查", args: { message: "验收：真实窗口+真实键鼠完成打开/填表/保存/校验，JSON 内容正确，每步截图" } },
    { tool: "desktop.flow", description: "运行真实桌面流程", args: {} },
    { tool: "echo", description: "汇总", args: { message: "真实桌面证据已写入本次 run 目录的 e2e-desktop/" } },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdCodeLoop(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const branch = manager.create({
    role: "operator",
    goal: "CodeTask→补丁→隔离 worktree→真实浏览器验收回路（A4；--fail 时验证 A5 两轮升级）",
    tools: ["echo", "code.loop"],
  });
  const plan: PlannedStep[] = [
    {
      tool: "echo",
      description: "写验收检查",
      args: { message: "验收：真实浏览器 login-timeout 用例从红转绿；最多两轮，超限升级人类" },
    },
    { tool: "code.loop", description: "运行编码回路", args: { fail: parsed.flags.fail === true } },
    { tool: "echo", description: "汇总", args: { message: "回路证据已写入本次 run 目录（patch.diff / test.log / code-loop-result.json / e2e/）" } },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdSafetyCheck(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const workDir = await mkdtemp(join(tmpdir(), "steward-safety-check-"));
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // --- A8-1: 停止键 ≤5s（对 10s 慢操作发起停止） ---
  {
    const controller = new StopController(join(workDir, "STOP"));
    controller.start();
    const started = Date.now();
    const slow = controller.withAbort(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return "late";
      },
      15_000,
    );
    setTimeout(() => {
      void controller.request("safety-check");
    }, 300);
    let latencyMs = -1;
    let stopped = false;
    try {
      await slow;
    } catch (error) {
      latencyMs = Date.now() - started;
      stopped = error instanceof StoppedError;
    }
    controller.dispose();
    checks.stop = {
      ok: stopped && latencyMs >= 0 && latencyMs < 5_000,
      detail: stopped ? `停止耗时 ${latencyMs}ms（<5000ms）` : "停止未生效",
    };
  }

  // --- A8-2: 检查点 save/load/resume/completed ---
  {
    const store = new CheckpointStore(workDir);
    const runId = "run-safety-check";
    await store.save({ runId, branchId: "br-safety", stepIndex: 1, doneSteps: ["step-0", "step-1"], completed: false });
    const loaded = await store.load(runId);
    const resumableBefore = (await store.listResumable()).some((r) => r.runId === runId);
    await store.markCompleted(runId);
    const resumableAfter = (await store.listResumable()).some((r) => r.runId === runId);
    checks.checkpoint = {
      ok: Boolean(loaded && loaded.stepIndex === 1 && resumableBefore && !resumableAfter),
      detail: loaded
        ? `读取 stepIndex=${loaded.stepIndex}，可恢复=${resumableBefore}，完成后可恢复=${resumableAfter}`
        : "检查点读取失败",
    };
  }

  // --- A9-1: 跨分支凭据隔离 + 脱敏 ---
  {
    const vault = new CredentialVault();
    vault.set("br-operator", "api", "env:OPERATOR_API_KEY");
    let crossDenied = false;
    try {
      vault.get("br-scout", "api");
    } catch (error) {
      crossDenied = error instanceof CrossBranchAccessError;
    }
    const redacted = JSON.stringify(vault.redactFor("br-operator"));
    checks.credentials = {
      ok: crossDenied && !redacted.includes("OPERATOR_API_KEY"),
      detail: `跨分支读取被拒=${crossDenied}，脱敏输出不含引用明文=${!redacted.includes("OPERATOR_API_KEY")}`,
    };
  }

  // --- A9-2: 同一 profile 不能并发占用 + 工具白名单 ---
  {
    const locks = new ProfileLock(workDir);
    const info = locks.acquire("browser-demo");
    let busy = false;
    try {
      locks.acquire("browser-demo");
    } catch (error) {
      busy = error instanceof ProfileBusyError;
    }
    locks.release("browser-demo", info.token);
    let allowlistOk = false;
    try {
      assertBranchToolsAllowed(["echo"], "payment");
    } catch {
      allowlistOk = true;
    }
    checks.isolation = {
      ok: busy && allowlistOk,
      detail: `重复占用被拒=${busy}，白名单外工具被拒=${allowlistOk}`,
    };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const runDir = join(root, "runs", `run-safety-check-${stamp}`);
  await mkdir(runDir, { recursive: true });
  const resultPath = join(runDir, "safety-check-result.json");
  await writeFile(resultPath, JSON.stringify({ ok, checks, workDir: "(临时目录，已脱敏)", generatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");

  if (parsed.flags.json === true) {
    console.log(JSON.stringify({ ok, checks, resultPath }, null, 2));
  } else {
    console.log("");
    console.log(`安全自检 ${ok ? "通过 ✅" : "未通过 ❌"}`);
    for (const [key, value] of Object.entries(checks)) {
      console.log(`  - ${key}: ${value.ok ? "ok" : "failed"} — ${value.detail}`);
    }
    console.log(`结果: ${resultPath.replaceAll("\\", "/")}`);
  }
  return ok ? 0 : 1;
}

async function cmdScout(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  const fixture = flagString(parsed.flags, "fixture");
  const branch = manager.create({
    role: "scout",
    goal: "Scout：从本地合规 fixtures 产出 ICP/三场景/四因子评分/3 条外联草稿/审批队列（只起草，不发送）",
    tools: ["echo", "scout.report"],
  });
  const plan: PlannedStep[] = [
    {
      tool: "echo",
      description: "写验收检查",
      args: { message: "验收：≥10 条线索（含来源+评分）、3 条草稿 ≤150 字且引用具体信号、全部待审批、0 发送、丢弃有记录" },
    },
    { tool: "scout.report", description: "运行 Scout 客户分支", args: fixture ? { fixture } : {} },
    {
      tool: "echo",
      description: "汇总",
      args: { message: "Scout 证据已写入本次 run 目录（scout-report.md/json、drafts.json、approval-queue.json、outreach-drafts/）" },
    },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
  return result.ok ? 0 : 1;
}

async function cmdDummyBranch(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const prompts = await loadPrompts();
  const runtime = new AgentRuntime({ root, tools: createTools(root), ...(prompts ? { prompts } : {}) });
  const manager = new BranchManager();
  // A10：新增只读分支仅需 BranchSpec（role/tools/prompt_ref）+ 已有提示词，不改核心代码。
  const branch = manager.create({
    role: "dummy",
    goal: "只读 dummy 分支：验证新增分支只需配置与提示词、不改核心（A10）",
    tools: ["echo"],
    promptRef: "reviewer@1.0.0", // 复用只读复核提示词；新分支无需新增核心代码
  });
  const plan: PlannedStep[] = [
    {
      tool: "echo",
      description: "只读检查",
      args: { message: `dummy 分支 ${branch.id} 已创建：role=dummy，tools=[echo]，prompt_ref=${branch.prompt_ref}` },
    },
    {
      tool: "echo",
      description: "汇总",
      args: { message: "A10 通过：分支由 BranchSpec+提示词+工具白名单组成，核心 runtime/CLI 分支机制未改动" },
    },
  ];
  const result = await runtime.run({ branch, plan });
  if (parsed.flags.json === true) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          runId: result.runId,
          branchId: result.branchId,
          role: branch.role,
          tools: branch.tools,
          promptRef: branch.prompt_ref,
          reportPath: result.reportPath,
          artifacts: result.artifacts,
          steps: result.steps,
        },
        null,
        2,
      ),
    );
  } else {
    printRunResult(result, root, false);
    console.log(`分支配置: role=${branch.role} tools=[${branch.tools.join(", ")}] prompt_ref=${branch.prompt_ref}`);
  }
  return result.ok ? 0 : 1;
}

async function cmdBranch(parsed: ParsedArgs): Promise<number> {
  const goal = flagString(parsed.flags, "goal") ?? "示例目标";
  const role = (flagString(parsed.flags, "role") ?? "operator") as "operator" | "dummy" | "conductor" | "scout" | "reviewer";
  const manager = new BranchManager();
  const spec = manager.create({ role, goal });
  console.log(JSON.stringify(spec, null, 2));
  return 0;
}

async function cmdReport(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const paths = stewardPaths(root);
  const bus = new ArtifactBus(paths.runs);
  const want = flagString(parsed.flags, "run") ?? "latest";
  // 只考虑有 report.md 的运行（safety-check 等辅助目录不参与 report 选择）
  const runs = (await bus.listRuns()).filter((r) => existsSync(join(r.dir, "report.md")));
  const picked = want === "latest" ? runs[0] : runs.find((r) => r.runId === want);
  if (!picked) {
    console.error(`找不到运行：${want}`);
    return 1;
  }
  const reportPath = join(picked.dir, "report.md");
  if (parsed.flags.json === true) {
    console.log(JSON.stringify({ runId: picked.runId, reportPath }, null, 2));
    return 0;
  }
  const text = await import("node:fs/promises").then((m) => m.readFile(reportPath, "utf8"));
  console.log(text);
  return 0;
}

async function cmdStop(parsed: ParsedArgs): Promise<number> {
  const root = findRepoRoot();
  const paths = stewardPaths(root);
  const signal = new StopSignal(paths.stopFile);
  if (parsed.flags.clear === true) {
    await signal.clear();
    console.log("停止键已清除：", paths.stopFile);
    return 0;
  }
  const reason = flagString(parsed.flags, "reason") ?? "manual stop via CLI";
  await signal.request(reason);
  console.log("停止键已触发：", paths.stopFile);
  console.log("下一个动作开始前生效（架构目标：5 秒内停止所有分支新动作）");
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "help";
  const parsed = parseArgs(argv.slice(1));
  switch (command) {
    case "demo":
      return cmdDemo(parsed);
    case "run":
      return cmdRun(parsed);
    case "branch":
      return cmdBranch(parsed);
    case "report":
      return cmdReport(parsed);
    case "stop":
      return cmdStop(parsed);
    case "safety-check":
      return cmdSafetyCheck(parsed);
    case "browser-flow":
    case "demo-browser":
      return cmdBrowserFlow(parsed);
    case "desktop-flow":
    case "demo-desktop":
      return cmdDesktopFlow(parsed);
    case "scout":
      return cmdScout(parsed);
    case "dummy-branch":
    case "demo-dummy":
      return cmdDummyBranch(parsed);
    case "code-loop":
    case "demo-code-loop":
      return cmdCodeLoop(parsed);
    case "takeover":
      return cmdTakeover(parsed);
    case "approve":
      return cmdApprove(parsed);
    case "business":
    case "demo-business":
      return cmdPhase2Business(parsed);
    case "boundary-check":
      return cmdPhase2BoundaryCheck(parsed);
    case "console":
      return cmdConsole(parsed);
    case "fault-drill":
      return cmdFaultDrill(parsed);
    case "enterprise-demo":
    case "demo-enterprise":
      return cmdEnterpriseDemo(parsed);
    case "config":
      return cmdConfig(parsed);
    case "agents":
      return cmdAgents(parsed);
    case "data":
      return cmdData(parsed);
    case "limit-run":
    case "limit-test":
      return cmdLimitRun(parsed);
    case "money":
    case "pay":
      return cmdMoney(parsed);
    case "runtime":
    case "auto":
    case "runs":
      return cmdRuntime(parsed);
    case "ai":
      return cmdAi(parsed);
    case "chat":
    case "ask":
      return cmdAgent(parsed);
    case "supervisor":
    case "system-supervisor":
      parsed.flags.supervisor = true;
      return cmdAgent(parsed);
    case "project":
    case "conductor":
      parsed.flags.project = true;
      return cmdAgent(parsed);
    case "system":
      return cmdSystem(parsed);
    case "version":
      console.log(`steward ${VERSION} (node ${process.version})`);
      return 0;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`未知命令：${command}\n`);
      printHelp();
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
