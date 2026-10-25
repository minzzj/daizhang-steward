#!/usr/bin/env node
/**
 * steward CLI — phase-1 entrypoint.
 * Commands: demo | run | branch | report | stop | takeover | approve | version | help
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentRuntime,
  ArtifactBus,
  BranchManager,
  PromptManager,
  StopSignal,
  ToolRegistry,
  findRepoRoot,
  stewardPaths,
  type BranchSpec,
  type CodeTask,
  type PlannedStep,
  type RunResult,
  type ToolResult,
} from "../../../packages/steward-core/src/index.js";
import { MockHarness, demoCodeTask } from "../../../packages/steward-harness/src/index.js";

const VERSION = "0.1.0";
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
  steward run --goal "<目标>" [--role operator] [--json]
                                              在 Mock 计划下执行一个分支
  steward branch --role operator --goal "<目标>" [--json]
                                              只生成 BranchSpec（不执行）
  steward report [--run <id|latest>] [--json] 查看运行报告
  steward stop [--reason "<原因>"]            触发停止键（5 秒内生效于下一步前检查）
  steward stop --clear                        清除停止键
  steward takeover                            阶段二交付（当前为占位）
  steward approve                             审批队列（M1 交付；当前为占位）
  steward version | help

约定：
  - 所有运行产物写入 runs/<run-id>/（prompt.md / patch.diff / test.log / events.jsonl / report.md）
  - 事件账本只追加、哈希链；密钥脱敏
  - 高风险动作默认拒绝；验证码/2FA/人脸一律停止交人（M1 起在真实浏览器适配器执行）
`);
}

function createTools(): ToolRegistry {
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
  const runtime = new AgentRuntime({ root, tools: createTools(), ...(prompts ? { prompts } : {}) });
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
  const runtime = new AgentRuntime({ root, tools: createTools(), ...(prompts ? { prompts } : {}) });
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
    { tool: "echo", description: "汇总", args: { message: "计划执行完成（M0 空回路；真实工具在 M1/M2 接入）" } },
  ];
  const result = await runtime.run({ branch, plan });
  printRunResult(result, root, parsed.flags.json === true);
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
  const runs = await bus.listRuns();
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
    case "takeover":
      console.error("takeover 属阶段二交付（M0 为占位）。见 ROADMAP.md。");
      return 2;
    case "approve":
      console.error("审批队列属 M1 交付（M0 为占位）。见 ROADMAP.md。");
      return 2;
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
