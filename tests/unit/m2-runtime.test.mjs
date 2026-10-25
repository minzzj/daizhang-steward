import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRuntime,
  BranchManager,
  StopController,
  ToolRegistry,
} from "../../dist/packages/steward-core/src/index.js";

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), "steward-m2-runtime-"));
}

function makeTools(state) {
  const tools = new ToolRegistry();
  tools.register(
    { name: "echo", description: "echo", risk: "low", requiresApproval: false, evidence: false },
    async (args) => ({ ok: true, summary: String(args.message ?? "echo") }),
  );
  tools.register(
    { name: "slow", description: "slow op (8s)", risk: "low", requiresApproval: false, evidence: false },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      return { ok: true, summary: "slow finished (should have been preempted)" };
    },
  );
  tools.register(
    { name: "step1", description: "first step", risk: "low", requiresApproval: false, evidence: false },
    async () => {
      state.step1 += 1;
      return { ok: true, summary: `step1 #${state.step1}` };
    },
  );
  tools.register(
    { name: "step2", description: "second step (fails first time)", risk: "low", requiresApproval: false, evidence: false },
    async () => {
      state.step2 += 1;
      if (state.step2 === 1) return { ok: false, summary: "step2 failed on purpose (round 1)" };
      return { ok: true, summary: `step2 #${state.step2}` };
    },
  );
  tools.register(
    { name: "locker", description: "acquires shared profile lock", risk: "low", requiresApproval: false, evidence: false },
    async (_args, ctx) => {
      const info = ctx.locks?.acquire("shared-profile");
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        return { ok: true, summary: "locker done" };
      } finally {
        if (info) ctx.locks?.release("shared-profile", info.token);
      }
    },
  );
  tools.register(
    { name: "vault", description: "writes a credential reference", risk: "low", requiresApproval: false, evidence: false },
    async (_args, ctx) => {
      ctx.vault?.set(ctx.branchId, "api", "env:TEST_API_KEY");
      const keys = ctx.vault?.listKeys(ctx.branchId) ?? [];
      return { ok: keys.includes("api"), summary: `vault keys: ${keys.join(",")}` };
    },
  );
  return tools;
}

async function makeBranch(manager, tools, goal) {
  return manager.create({ role: "operator", goal, tools });
}

test("A8：停止键在运行中触发时，runtime 在 5 秒内结束（真实抢占）", async () => {
  const root = await tmpRoot();
  const state = { step1: 0, step2: 0 };
  const runtime = new AgentRuntime({ root, tools: makeTools(state) });
  const branch = await makeBranch(new BranchManager(), ["slow"], "停止键抢占测试");

  const pending = runtime.run({ branch, plan: [{ tool: "slow" }, { tool: "slow" }] });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const externalStop = new StopController(join(root, ".steward", "STOP"));
  const t0 = Date.now();
  await externalStop.request("unit-test-stop");
  const result = await pending;
  const elapsed = Date.now() - t0;
  externalStop.dispose();

  assert.equal(result.ok, false);
  assert.ok(elapsed < 5_000, `停止耗时 ${elapsed}ms 应小于 5000ms`);
  assert.ok(result.steps.length >= 1);
  assert.match(result.steps[0].summary, /停止键/);
});

test("A8：失败后保留检查点，resume 跳过已完成步骤且不重复执行", async () => {
  const root = await tmpRoot();
  const state = { step1: 0, step2: 0 };
  const runtime = new AgentRuntime({ root, tools: makeTools(state) });
  const branch = await makeBranch(new BranchManager(), ["step1", "step2"], "检查点恢复测试");
  const plan = [{ tool: "step1" }, { tool: "step2" }];
  const runId = "run-test-resume-001";

  const first = await runtime.run({ branch, plan, runId });
  assert.equal(first.ok, false);
  assert.equal(state.step1, 1);
  assert.equal(state.step2, 1);

  const checkpoint = await runtime.checkpoints.load(runId);
  assert.ok(checkpoint);
  assert.equal(checkpoint.completed, false);
  assert.ok(checkpoint.doneSteps.includes("step-0"));
  const resumable = await runtime.listResumable();
  assert.ok(resumable.some((r) => r.runId === runId));

  const second = await runtime.run({ branch, plan, runId, resume: true });
  assert.equal(second.ok, true);
  assert.equal(state.step1, 1, "resume 不应重复执行已完成步骤");
  assert.equal(state.step2, 2);
  const done = await runtime.checkpoints.load(runId);
  assert.equal(done.completed, true);
  assert.ok(!(await runtime.listResumable()).some((r) => r.runId === runId));
});

test("A9：两个分支不能同时占用同一 profile（ProfileBusyError 生效）", async () => {
  const root = await tmpRoot();
  const runtimeA = new AgentRuntime({ root, tools: makeTools({ step1: 0, step2: 0 }) });
  const runtimeB = new AgentRuntime({ root, tools: makeTools({ step1: 0, step2: 0 }) });
  const branchA = await makeBranch(new BranchManager(), ["locker"], "占用 profile A");
  const branchB = await makeBranch(new BranchManager(), ["locker"], "占用 profile B");

  const pendingA = runtimeA.run({ branch: branchA, plan: [{ tool: "locker" }] });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const resultB = await runtimeB.run({ branch: branchB, plan: [{ tool: "locker" }] });
  const resultA = await pendingA;

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, false);
  assert.match(resultB.steps[0].summary, /profile|占用|busy/i);
});

test("A9：ToolContext 提供按分支隔离的凭据引用（vault）", async () => {
  const root = await tmpRoot();
  const runtime = new AgentRuntime({ root, tools: makeTools({ step1: 0, step2: 0 }) });
  const branch = await makeBranch(new BranchManager(), ["vault"], "凭据引用测试");
  const result = await runtime.run({ branch, plan: [{ tool: "vault" }] });
  assert.equal(result.ok, true);
  assert.match(result.steps[0].summary, /vault keys: api/);
});
