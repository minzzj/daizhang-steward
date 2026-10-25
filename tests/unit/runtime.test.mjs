import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentRuntime,
  BranchManager,
  EventLog,
  ToolRegistry,
  PromptManager,
} from "../../dist/packages/steward-core/src/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeTools() {
  const tools = new ToolRegistry();
  tools.register(
    { name: "echo", description: "test echo", risk: "low", requiresApproval: false, evidence: false },
    async (args) => ({ ok: true, summary: String(args.message ?? "echo") }),
  );
  tools.register(
    { name: "artifact.write", description: "test artifact", risk: "low", requiresApproval: false, evidence: true },
    async (args, ctx) => ({ ok: true, summary: "artifact", evidence: [ctx.evidenceDir] }),
  );
  // high-risk tool must be blocked by policy before execution
  tools.register(
    { name: "payment", description: "should be denied", risk: "low", requiresApproval: false, evidence: false },
    async () => ({ ok: true, summary: "should never run" }),
  );
  return tools;
}

test("AgentRuntime 跑通空回路并留下证据（prompt/report/events/console）", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-runtime-"));
  const prompts = await PromptManager.load(join(REPO_ROOT, "prompts"));
  const runtime = new AgentRuntime({ root, tools: makeTools(), prompts });
  const branch = new BranchManager().create({
    role: "operator",
    goal: "空回路测试：echo → artifact → echo",
    tools: ["echo", "artifact.write"],
  });
  const result = await runtime.run({
    branch,
    plan: [
      { tool: "echo", args: { message: "计划开始" } },
      { tool: "echo", description: "写产物", args: { name: "goal.md", content: "test" } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 2);
  assert.ok(existsSync(result.artifacts.prompt));
  assert.ok(existsSync(result.artifacts.report));
  assert.ok(existsSync(result.artifacts.events));
  assert.ok(existsSync(result.artifacts.consoleLog));
  const promptText = readFileSync(result.artifacts.prompt, "utf8");
  assert.ok(promptText.includes("operator"), "prompt.md 应来自版本化运行时提示词");

  const events = await EventLog.open(result.artifacts.events);
  assert.deepEqual(await events.verify(), { ok: true });
  const list = await events.read();
  assert.ok(list.some((e) => e.tool === "branch.start"));
  assert.ok(list.some((e) => e.tool === "branch.end"));

  const report = readFileSync(result.artifacts.report, "utf8");
  assert.ok(report.includes("运行报告"));
  assert.ok(report.includes("证据清单"));
});

test("高风险工具在策略层被拒绝，不会执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-runtime-deny-"));
  const runtime = new AgentRuntime({ root, tools: makeTools() });
  const branch = new BranchManager().create({ role: "operator", goal: "尝试支付", tools: ["payment"] });
  const result = await runtime.run({ branch, plan: [{ tool: "payment" }] });
  assert.equal(result.ok, false);
  assert.equal(result.steps[0].decision, "deny");
  assert.ok(result.steps[0].summary.includes("默认拒绝"));
});

test("工具白名单外/未注册工具会被拒绝执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-runtime-tools-"));
  const runtime = new AgentRuntime({ root, tools: makeTools() });

  // 已注册但不在分支 tools 白名单里的工具 → 拒绝，不执行
  const branch = new BranchManager().create({ role: "operator", goal: "白名单测试", tools: ["echo"] });
  const notAllowlisted = await runtime.run({ branch, plan: [{ tool: "payment" }] });
  assert.equal(notAllowlisted.ok, false);
  assert.ok(notAllowlisted.steps[0].summary.includes("白名单"));

  // 完全未注册的工具 → 拒绝
  const branch2 = new BranchManager().create({ role: "operator", goal: "未注册工具", tools: ["echo", "nope.tool"] });
  await assert.rejects(() => runtime.run({ branch: branch2, plan: [{ tool: "echo" }] }), /未注册工具/);
});

test("停止键生效后运行失败并留下 stop 事件", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-runtime-stop-"));
  const { StopSignal } = await import("../../dist/packages/steward-core/src/index.js");
  await new StopSignal(join(root, ".steward", "STOP")).request("测试停止");
  const runtime = new AgentRuntime({ root, tools: makeTools() });
  const branch = new BranchManager().create({ role: "operator", goal: "停止测试", tools: ["echo"] });
  const result = await runtime.run({ branch, plan: [{ tool: "echo", args: { message: "不应执行" } }] });
  assert.equal(result.ok, false);
  assert.ok(result.steps[0].summary.includes("停止键"));
  const runDirs = readdirSync(join(root, "runs"));
  assert.equal(runDirs.length, 1);
  const events = await EventLog.open(join(root, "runs", runDirs[0], "events.jsonl"));
  assert.ok((await events.read()).some((e) => e.tool === "stop"));
});
