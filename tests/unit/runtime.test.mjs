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


// ===========================================================================
// v1.4-A：steward-runtime RunManager（实时自动执行内核）单元测试
//
// 本段追加在既有 AgentRuntime 测试之后（同一文件），验证：
// 创建即自动执行（无需手动点执行）、事件流/seq 连续、审批策略、并发队列、打断/恢复、
// 暂停、订阅回放、持久化重载、自动返工、Token 事件、错误 failed、事件保留上限、
// 真实 OrchestratorEngine 适配与 system(supervisor) Run 自动执行。
// 全部零网络（fake orchestrator 端口 / LocalPlannerAdapter 本地回退）。
// ===========================================================================
import { rmSync } from "node:fs";
import {
  RunManager,
  RuntimeTimeoutError,
  REWORK_PROMPT,
} from "../../dist/packages/steward-runtime/src/index.js";
import {
  LocalPlannerAdapter,
  OrchestratorEngine,
} from "../../dist/packages/steward-orchestrator/src/index.js";

const RT_FIXED_NOW = new Date("2026-10-30T08:00:00.000Z");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RT_TERMINAL = ["done", "blocked", "failed"];

// ---------------------------------------------------------------------------
// fake orchestrator 端口（可控计划/审批门禁/失败注入/延迟/并发观测）
// ---------------------------------------------------------------------------

function makeFakeOrchestrator(options = {}) {
  const sessions = new Map();
  const calls = {
    createSession: [],
    sendMessage: [],
    startProject: [],
    runStep: [],
    decideApproval: [],
    interrupt: [],
    resume: [],
  };
  const state = {
    stepDelayMs: options.stepDelayMs ?? 0,
    failSendMessage: options.failSendMessage === true,
    failStepOnce: options.failStepOnce === true,
    stepsPerStart: options.stepsPerStart ?? 1,
    maxActive: 0,
    active: 0,
    failedOnce: false,
    planFactory:
      options.planFactory ??
      (() => [
        { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "生成交付物", status: "pending" },
        { step: 2, agent_role: "harness", action: "harness.quality_check", summary: "本地质检", status: "pending" },
      ]),
  };
  let sessionSeq = 0;

  const delay = async () => {
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      if (state.stepDelayMs > 0) await sleepMs(state.stepDelayMs);
    } finally {
      state.active -= 1;
    }
  };

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session === undefined) throw new Error(`fake: 未找到会话 ${sessionId}`);
    return session;
  }

  function addTurn(session, step) {
    const role = step.agent_role;
    const turns = session.children[role] ?? (session.children[role] = []);
    const seq = Object.values(session.children).reduce((sum, list) => sum + list.length, 0) + 1;
    turns.push({
      seq,
      agent_role: role,
      input_summary: `步骤 ${step.step}：${step.summary}`,
      output_summary: `完成 ${step.action}`,
      tokens: 10,
      status: "done",
      model_mode: "local_fallback",
      detail: `fake detail for step ${step.step}`,
    });
    session.tokens_used = (session.tokens_used ?? 0) + 10;
  }

  function executeOneStep(session) {
    if (session.status !== "running" && session.status !== "active") return;
    const step = session.plan.find((item) => item.status === "pending");
    if (step === undefined) {
      session.status = "done";
      return;
    }
    const requiresApproval =
      step.requires_approval === true || step.action_plan?.requires_confirmation === true;
    const approval = session.approvals?.[String(step.step)]?.status;
    if (requiresApproval && approval !== "approved") {
      if (approval === "rejected") {
        step.status = "blocked";
        session.status = "blocked";
        return;
      }
      session.status = "paused";
      session.messages.push({
        role: "conductor",
        kind: "approval",
        text: `步骤 ${step.step}「${step.summary}」需要人工审批`,
        summary: "等待人工审批",
      });
      return;
    }
    step.status = "running";
    if (state.failStepOnce && !state.failedOnce) {
      state.failedOnce = true;
      step.status = "blocked";
      session.status = "blocked";
      session.messages.push({ role: "system", kind: "error", text: "测试注入：步骤执行失败" });
      return;
    }
    step.status = "done";
    addTurn(session, step);
    session.status = session.plan.every((item) => item.status === "done") ? "done" : "running";
  }

  const port = {
    createSession(input) {
      calls.createSession.push(cloneJson(input));
      const session = {
        id: `fake-sess-${++sessionSeq}`,
        goal: input.goal,
        kind: input.kind ?? "project",
        status: "active",
        plan: [],
        approvals: {},
        messages: [],
        children: {},
        tokens_used: 0,
      };
      sessions.set(session.id, session);
      return { id: session.id };
    },
    async sendMessage(sessionId, text) {
      calls.sendMessage.push({ sessionId, text });
      await delay();
      if (state.failSendMessage) throw new Error("测试注入：sendMessage 失败");
      const session = getSession(sessionId);
      session.plan = state.planFactory(text ?? session.goal).map((item) => ({
        ...cloneJson(item),
        status: "pending",
      }));
      session.status = "active";
    },
    async startProject(sessionId) {
      calls.startProject.push(sessionId);
      await delay();
      const session = getSession(sessionId);
      session.project_id = `proj-${session.id}`;
      for (let index = 0; index < state.stepsPerStart; index += 1) executeOneStep(session);
    },
    async runStep(sessionId) {
      calls.runStep.push(sessionId);
      await delay();
      executeOneStep(getSession(sessionId));
    },
    getSession(sessionId) {
      return cloneJson(getSession(sessionId));
    },
    decideApproval(sessionId, step, decision) {
      calls.decideApproval.push({ sessionId, step, decision });
      const session = getSession(sessionId);
      session.approvals[String(step)] = { status: decision === "approve" ? "approved" : "rejected" };
      if (decision === "reject") {
        const target = session.plan.find((item) => item.step === step);
        if (target !== undefined) target.status = "blocked";
        session.status = "blocked";
        return;
      }
      session.status = session.project_id === undefined ? "active" : "running";
    },
    interrupt(sessionId) {
      calls.interrupt.push(sessionId);
      getSession(sessionId).status = "interrupted";
    },
    resume(sessionId) {
      calls.resume.push(sessionId);
      getSession(sessionId).status = "running";
    },
  };
  return { port, sessions, calls, state };
}

async function makeRtRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function makeFakeManager(options = {}) {
  const root = options.root ?? (await makeRtRoot("steward-runtime-rm-"));
  const fake = options.fake ?? makeFakeOrchestrator(options.fakeOptions ?? {});
  const manager = new RunManager({
    orchestrator: fake.port,
    root,
    now: () => new Date(RT_FIXED_NOW.getTime()),
    pollIntervalMs: 2,
    ...(options.maxConcurrentRuns === undefined ? {} : { maxConcurrentRuns: options.maxConcurrentRuns }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  return {
    manager,
    fake,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 真实 OrchestratorEngine 适配（零网络：LocalPlannerAdapter 本地回退）
// ---------------------------------------------------------------------------

function makeLocalModelResolver() {
  let used = 0;
  const limit = 1_000_000;
  return {
    resolveAgentModel: () => ({
      provider: {
        id: "local",
        name: "本地规则模式",
        kind: "local",
        base_url: "",
        default_model: "local-rules",
        models: ["local-rules"],
      },
      model: "local-rules",
      has_key: false,
      key_source: "missing",
    }),
    getApiKey: () => null,
    getConductorPrompt: () => "总调度提示词：拆解目标、输出 JSON 计划、留证、需人工确认的动作要标注。",
    getSystemPrompt: (role) => `${role} 系统提示词：真实执行、留证、不越界。`,
    consumeTokens: (amount) => {
      used += typeof amount === "number" ? amount : 0;
      return { ok: true, used_tokens: used, limit_tokens: limit, remaining_tokens: Math.max(0, limit - used) };
    },
    remainingTokens: () => Math.max(0, limit - used),
  };
}

/** 真实 OrchestratorEngine → OrchestratorRuntimePort 适配器（README 同款）。 */
function toRuntimePort(engine) {
  return {
    createSession(input) {
      const session = engine.createSession({
        goal: input.goal,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.budget_cny === undefined ? {} : { budget_cny: input.budget_cny }),
        ...(input.token_limit === undefined ? {} : { token_limit: input.token_limit }),
      });
      return { id: session.id };
    },
    sendMessage: (sessionId, text) => engine.sendMessage(sessionId, text),
    startProject: (sessionId) => engine.startProject(sessionId),
    runStep: (sessionId) => engine.runStep(sessionId),
    getSession: (sessionId) => {
      const session = engine.getSession(sessionId);
      return {
        id: session.id,
        status: session.status,
        plan: session.plan,
        approvals: session.approvals,
        messages: session.messages,
        children: session.children,
        tokens_used: session.tokens_used,
      };
    },
    decideApproval: (sessionId, step, decision) => engine.decideApproval(sessionId, step, decision, "human:runtime-test"),
    interrupt: (sessionId, reason) => engine.interrupt(sessionId, reason),
    resume: (sessionId) => engine.resume(sessionId),
  };
}

function makeRealEngine(root, options = {}) {
  return new OrchestratorEngine({
    resolver: makeLocalModelResolver(),
    root: join(root, "orchestrator"),
    now: () => new Date(RT_FIXED_NOW.getTime()),
    adapter: new LocalPlannerAdapter(),
    ...(options.systemActions === undefined ? {} : { systemActions: options.systemActions }),
  });
}

function makeSystemActionsFake(calls) {
  const record = (name) => (arg) => {
    calls.push({ name, arg });
    return { ok: true, summary: `[fake] ${name} 成功` };
  };
  return {
    listApps: () => {
      calls.push({ name: "listApps" });
      return { ok: true, summary: "[fake] 受管程序 2 个" };
    },
    startApp: record("startApp"),
    stopApp: record("stopApp"),
    restartApp: record("restartApp"),
    removeApp: record("removeApp"),
    listPlugins: () => ({ ok: true, summary: "[fake] 插件 1 个" }),
    enablePlugin: record("enablePlugin"),
    disablePlugin: record("disablePlugin"),
    removePlugin: record("removePlugin"),
    changeAgentModel: () => ({ ok: true, summary: "模型已切换" }),
    setPrompt: () => ({ ok: true, summary: "提示词已更新" }),
    delegateProject: () => ({ ok: true, summary: "已委派" }),
  };
}

// ---------------------------------------------------------------------------
// 1) 核心痛点：createRun 即自动执行完成（无需手动点执行）
// ---------------------------------------------------------------------------

test("RunManager：createRun 立即返回并自动执行到完成（无需手动点执行）", async () => {
  const box = await makeFakeManager();
  try {
    const startedAt = Date.now();
    const run = await box.manager.createRun({ goal: "帮我做一个报价页面" });
    const createMs = Date.now() - startedAt;
    assert.ok(createMs < 1000, `createRun 必须立即返回，实际 ${createMs}ms`);
    assert.ok(["queued", "running"].includes(run.status), `创建后应排队或运行中，实际 ${run.status}`);
    assert.equal(run.goal, "帮我做一个报价页面");
    assert.ok(run.kind === "project");

    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    assert.equal(done.status, "done");
    assert.equal(done.steps_total, 2);
    assert.equal(done.steps_done, 2);
    assert.ok(done.token_used > 0);
    assert.ok(box.fake.calls.sendMessage.length >= 1, "应自动调用 sendMessage 生成计划");
    assert.ok(box.fake.calls.startProject.length >= 1, "应自动 startProject 执行");
  } finally {
    box.cleanup();
  }
});

test("RunManager 事件流：类型齐全、seq 连续递增、plan 在 step 之前、每步 started 先于 completed", async () => {
  const box = await makeFakeManager();
  try {
    const run = await box.manager.createRun({ goal: "自动执行事件测试" });
    await box.manager.waitFor(run.run_id, ["done"], 5000);
    const events = box.manager.eventLog(run.run_id);
    assert.ok(events.length >= 8);
    for (let index = 0; index < events.length; index += 1) {
      assert.equal(events[index].seq, index + 1, "seq 必须从 1 连续递增");
      assert.equal(events[index].run_id, run.run_id);
      assert.ok(events[index].session_id.length > 0);
      assert.ok(!Number.isNaN(Date.parse(events[index].at)));
    }
    const types = events.map((event) => event.type);
    for (const expected of [
      "run.queued",
      "run.started",
      "plan.generating",
      "plan.ready",
      "step.started",
      "step.completed",
      "agent.turn",
      "tool.called",
      "tool.result",
      "token.updated",
      "run.completed",
    ]) {
      assert.ok(types.includes(expected), `事件流应包含 ${expected}`);
    }
    const planReadySeq = events.find((event) => event.type === "plan.ready").seq;
    const firstStepSeq = events.find((event) => event.type === "step.started").seq;
    assert.ok(planReadySeq < firstStepSeq, "plan.ready 必须在第一步 step.started 之前");
    for (const stepNumber of [1, 2]) {
      const started = events.find((event) => event.type === "step.started" && event.data.step === stepNumber);
      const completed = events.find((event) => event.type === "step.completed" && event.data.step === stepNumber);
      assert.ok(started !== undefined && completed !== undefined);
      assert.ok(started.seq < completed.seq, `步骤 ${stepNumber} started 必须先于 completed`);
    }
    const agentTurn = events.find((event) => event.type === "agent.turn");
    assert.ok(agentTurn.data.input_summary.length > 0);
    assert.ok(agentTurn.data.output_summary.length > 0);
    assert.equal(typeof agentTurn.data.tokens, "number");
    assert.equal(agentTurn.data.model_mode, "local_fallback");
    const completed = events[events.length - 1];
    assert.equal(completed.type, "run.completed");
    assert.equal(completed.data.steps_done, 2);
  } finally {
    box.cleanup();
  }
});

test("RunManager：真实 OrchestratorEngine（本地回退）发送消息即自动完成，含事件/Token/证据证据链", async () => {
  const root = await makeRtRoot("steward-runtime-real-");
  try {
    const engine = makeRealEngine(root);
    const manager = new RunManager({
      orchestrator: toRuntimePort(engine),
      root: join(root, "runtime"),
      now: () => new Date(RT_FIXED_NOW.getTime()),
      pollIntervalMs: 2,
      settings: { approval_mode: "auto_low_risk", rework_limit: 1 },
    });
    const run = await manager.createRun({ goal: "帮我做一个报价页面并回复客户，报价 880 元" });
    const done = await manager.waitFor(run.run_id, ["done"], 20_000);
    assert.equal(done.status, "done");
    assert.ok(done.steps_total >= 5, `真实计划应有多步，实际 ${done.steps_total}`);
    assert.equal(done.steps_done, done.steps_total);
    assert.ok(done.token_used > 0, "应产生 token.updated");

    const events = manager.eventLog(run.run_id);
    assert.ok(events.some((event) => event.type === "plan.ready"));
    assert.ok(events.some((event) => event.type === "agent.turn"));
    assert.ok(events.some((event) => event.type === "run.completed"));
    // finance 步骤需要审批：auto_low_risk 下判定为低风险 → 自动批准（无需人工）
    const autoApproved = events.find((event) => event.type === "run.resumed" && event.data.reason === "auto_approved");
    assert.ok(autoApproved !== undefined, "低风险审批应自动批准并继续");

    const session = engine.getSession(run.session_id);
    assert.equal(session.status, "done");
    const detail = engine.getRunDetail(run.session_id);
    assert.ok(detail.evidence.length >= 5, "真实执行应产生证据文件");
    assert.ok(detail.turns.length >= 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2) 审批策略
// ---------------------------------------------------------------------------

test("审批策略 auto_low_risk：高风险动作暂停 + approval.required，且未调用 decideApproval", async () => {
  const plan = [
    { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "生成交付物" },
    {
      step: 2,
      agent_role: "supervisor",
      action: "removeApp",
      summary: "删除受管程序 demo-app",
      requires_approval: true,
      action_plan: { risk: "high", requires_confirmation: true },
    },
  ];
  const box = await makeFakeManager({
    fakeOptions: { planFactory: () => plan, stepsPerStart: 1 },
    settings: { approval_mode: "auto_low_risk" },
  });
  try {
    const run = await box.manager.createRun({ goal: "删除受管程序" });
    const awaiting = await box.manager.waitFor(run.run_id, ["awaiting_approval"], 5000);
    assert.equal(awaiting.status, "awaiting_approval");
    assert.ok(awaiting.pending_approval !== undefined);
    assert.equal(awaiting.pending_approval.step, 2);
    assert.equal(awaiting.pending_approval.risk, "high");
    assert.equal(box.fake.calls.decideApproval.length, 0, "高风险未确认前不得自动批准");
    const approvalEvent = box.manager.eventLog(run.run_id).find((event) => event.type === "approval.required");
    assert.ok(approvalEvent !== undefined);
    assert.equal(approvalEvent.data.step, 2);
    assert.equal(approvalEvent.data.risk, "high");
    assert.ok(String(approvalEvent.data.message).includes("需要人工确认"));
    assert.ok(box.manager.eventLog(run.run_id).some((event) => event.type === "run.paused"));

    // 人工批准后继续到完成
    await box.manager.approve(run.run_id, 2, "approve", "human:test");
    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    assert.equal(done.status, "done");
    assert.equal(box.fake.calls.decideApproval.length, 1);
    assert.equal(box.fake.calls.decideApproval[0].decision, "approve");
  } finally {
    box.cleanup();
  }
});

test("审批策略 auto_low_risk：低风险审批步骤自动批准继续（无人工）", async () => {
  const plan = [
    { step: 1, agent_role: "harness", action: "harness.quality_check", summary: "质检" },
    { step: 2, agent_role: "finance", action: "finance.collect_payment", summary: "生成收款请求", requires_approval: true },
  ];
  const box = await makeFakeManager({ fakeOptions: { planFactory: () => plan, stepsPerStart: 1 }, settings: { approval_mode: "auto_low_risk" } });
  try {
    const run = await box.manager.createRun({ goal: "生成收款请求" });
    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    assert.equal(done.status, "done");
    assert.equal(box.fake.calls.decideApproval.length, 1);
    assert.equal(box.fake.calls.decideApproval[0].decision, "approve");
    const resumed = box.manager.eventLog(run.run_id).find((event) => event.type === "run.resumed" && event.data.reason === "auto_approved");
    assert.ok(resumed !== undefined);
  } finally {
    box.cleanup();
  }
});

test("审批策略 auto_all：全部自动批准；manual：必须人工暂停", async () => {
  const plan = [
    { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "生成" },
    { step: 2, agent_role: "supervisor", action: "removeApp", summary: "删除", requires_approval: true, action_plan: { risk: "critical", requires_confirmation: true } },
  ];
  const allBox = await makeFakeManager({ fakeOptions: { planFactory: () => plan, stepsPerStart: 1 }, settings: { approval_mode: "auto_all" } });
  const manualBox = await makeFakeManager({ fakeOptions: { planFactory: () => plan, stepsPerStart: 1 }, settings: { approval_mode: "manual" } });
  try {
    const autoRun = await allBox.manager.createRun({ goal: "自动全部批准" });
    const autoDone = await allBox.manager.waitFor(autoRun.run_id, ["done"], 5000);
    assert.equal(autoDone.status, "done");
    assert.equal(allBox.fake.calls.decideApproval.length, 1);
    assert.equal(allBox.fake.calls.decideApproval[0].decision, "approve");

    const manualRun = await manualBox.manager.createRun({ goal: "人工审批" });
    const manualAwaiting = await manualBox.manager.waitFor(manualRun.run_id, ["awaiting_approval"], 5000);
    assert.equal(manualAwaiting.status, "awaiting_approval");
    assert.equal(manualBox.fake.calls.decideApproval.length, 0);
    await manualBox.manager.approve(manualRun.run_id, 2, "approve", "human:manual");
    const manualDone = await manualBox.manager.waitFor(manualRun.run_id, ["done"], 5000);
    assert.equal(manualDone.status, "done");
  } finally {
    allBox.cleanup();
    manualBox.cleanup();
  }
});

test("审批 reject：步骤 blocked、Run blocked，且不自动返工", async () => {
  const plan = [
    { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "生成" },
    { step: 2, agent_role: "supervisor", action: "removeApp", summary: "删除", requires_approval: true, action_plan: { risk: "high", requires_confirmation: true } },
  ];
  const box = await makeFakeManager({ fakeOptions: { planFactory: () => plan, stepsPerStart: 1 }, settings: { approval_mode: "manual", rework_limit: 2 } });
  try {
    const run = await box.manager.createRun({ goal: "驳回测试" });
    await box.manager.waitFor(run.run_id, ["awaiting_approval"], 5000);
    await box.manager.approve(run.run_id, 2, "reject", "human:test");
    const blocked = box.manager.getRun(run.run_id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.pending_approval, undefined);
    const events = box.manager.eventLog(run.run_id);
    const blockedEvent = events.find((event) => event.type === "run.blocked");
    assert.ok(blockedEvent !== undefined);
    assert.equal(blockedEvent.data.reason, "rejected_by_human");
    assert.equal(box.fake.calls.sendMessage.length, 1, "人工驳回后不得自动返工重新规划");
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3) 并发 / 排队
// ---------------------------------------------------------------------------

test("并发：maxConcurrentRuns=3 时 3 个 Run 并行执行并全部完成", async () => {
  const box = await makeFakeManager({
    fakeOptions: { stepDelayMs: 15, stepsPerStart: 1 },
    maxConcurrentRuns: 3,
  });
  try {
    const runs = await Promise.all([
      box.manager.createRun({ goal: "并发项目 A" }),
      box.manager.createRun({ goal: "并发项目 B" }),
      box.manager.createRun({ goal: "并发项目 C" }),
    ]);
    const done = await Promise.all(runs.map((run) => box.manager.waitFor(run.run_id, ["done"], 10_000)));
    assert.equal(done.filter((run) => run.status === "done").length, 3);
    assert.ok(box.fake.state.maxActive >= 2, `应观察到并行执行，实际 maxActive=${box.fake.state.maxActive}`);
  } finally {
    box.cleanup();
  }
});

test("排队：maxConcurrentRuns=1 时超出并发上限的 Run 先 queued，随后自动调度完成", async () => {
  const box = await makeFakeManager({
    fakeOptions: { stepDelayMs: 20, stepsPerStart: 1 },
    maxConcurrentRuns: 1,
  });
  try {
    const first = await box.manager.createRun({ goal: "排队项目 1" });
    const second = await box.manager.createRun({ goal: "排队项目 2" });
    assert.ok(
      box.manager.listRuns().some((run) => run.status === "queued"),
      "超出并发上限的 Run 应处于 queued",
    );
    const done = await Promise.all([
      box.manager.waitFor(first.run_id, ["done"], 10_000),
      box.manager.waitFor(second.run_id, ["done"], 10_000),
    ]);
    assert.equal(done.length, 2);
    assert.equal(box.fake.state.maxActive, 1, "并发上限=1 时不应并行执行");
    const queuedSeen = box.manager.eventLog(second.run_id).some((event) => event.type === "run.queued");
    assert.ok(queuedSeen);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4) 打断 / 恢复 / 暂停
// ---------------------------------------------------------------------------

test("interrupt → interrupted（步骤边界停止）→ resume → 继续完成", async () => {
  const plan = [
    { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "步骤1" },
    { step: 2, agent_role: "reviewer", action: "reviewer.review_evidence", summary: "步骤2" },
    { step: 3, agent_role: "backend", action: "backend.write_events", summary: "步骤3" },
  ];
  const box = await makeFakeManager({ fakeOptions: { planFactory: () => plan, stepDelayMs: 30, stepsPerStart: 1 } });
  try {
    const run = await box.manager.createRun({ goal: "打断恢复测试" });
    await sleepMs(20);
    await box.manager.interruptRun(run.run_id);
    const interrupted = box.manager.getRun(run.run_id);
    assert.equal(interrupted.status, "interrupted");
    assert.ok(box.manager.eventLog(run.run_id).some((event) => event.type === "run.interrupted"));
    assert.ok(box.fake.calls.interrupt.length >= 1);
    await sleepMs(80);
    assert.equal(box.manager.getRun(run.run_id).status, "interrupted", "打断后不得自行继续");

    await box.manager.resumeRun(run.run_id);
    assert.ok(box.fake.calls.resume.length >= 1);
    const done = await box.manager.waitFor(run.run_id, ["done"], 10_000);
    assert.equal(done.status, "done");
    assert.ok(box.manager.eventLog(run.run_id).some((event) => event.type === "run.resumed"));
  } finally {
    box.cleanup();
  }
});

test("pause：未开始/暂停期间不推进，resume 后完成", async () => {
  const box = await makeFakeManager();
  try {
    const run = await box.manager.createRun({ goal: "暂停测试", autoStart: false });
    assert.equal(run.status, "queued");
    await box.manager.pauseRun(run.run_id);
    const paused = box.manager.getRun(run.run_id);
    assert.equal(paused.status, "paused");
    assert.equal(paused.steps_done, 0);
    await sleepMs(60);
    assert.equal(box.manager.getRun(run.run_id).steps_done, 0, "暂停期间不得推进步骤");
    assert.ok(box.manager.eventLog(run.run_id).some((event) => event.type === "run.paused"));

    await box.manager.resumeRun(run.run_id);
    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    assert.equal(done.status, "done");
    assert.equal(done.steps_done, 2);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5) 订阅回放 / 持久化 / 返工 / Token / 错误 / 保留上限
// ---------------------------------------------------------------------------

test("subscribeRun：sinceSeq 回放 + 实时订阅 + 取消订阅", async () => {
  const box = await makeFakeManager();
  try {
    const run = await box.manager.createRun({ goal: "订阅测试" });
    await box.manager.waitFor(run.run_id, ["done"], 5000);
    const all = box.manager.eventLog(run.run_id);
    assert.ok(all.length >= 8);

    const replayed = [];
    const unsubscribe = box.manager.subscribeRun(run.run_id, (event) => replayed.push(event), 0);
    assert.equal(replayed.length, all.length, "sinceSeq=0 应回放全部保留事件");
    assert.deepEqual(replayed.map((event) => event.seq), all.map((event) => event.seq));
    unsubscribe();

    const partial = [];
    box.manager.subscribeRun(run.run_id, (event) => partial.push(event), all[3].seq);
    assert.equal(partial.length, all.length - 4, "sinceSeq 之后的事件才回放");
    assert.ok(partial.every((event) => event.seq > all[3].seq));

    // 实时订阅：新 Run 执行期间收到事件
    const live = [];
    const second = await box.manager.createRun({ goal: "实时订阅测试", autoStart: false });
    const off = box.manager.subscribeRun(second.run_id, (event) => live.push(event), 0);
    await box.manager.startRun(second.run_id);
    await box.manager.waitFor(second.run_id, ["done"], 5000);
    off();
    assert.ok(live.some((event) => event.type === "step.completed"));
    const sizeAfterOff = live.length;
    await sleepMs(20);
    assert.equal(live.length, sizeAfterOff, "取消订阅后不再接收事件");
  } finally {
    box.cleanup();
  }
});

test("持久化：runs.json + events-<id>.jsonl 原子落盘，重启后 listRuns/getRun/eventLog 恢复", async () => {
  const root = await makeRtRoot("steward-runtime-persist-");
  try {
    const fake1 = makeFakeOrchestrator({ stepsPerStart: 1 });
    const manager1 = new RunManager({
      orchestrator: fake1.port,
      root,
      now: () => new Date(RT_FIXED_NOW.getTime()),
      pollIntervalMs: 2,
    });
    const run = await manager1.createRun({ goal: "持久化测试" });
    await manager1.waitFor(run.run_id, ["done"], 5000);
    assert.ok(existsSync(join(root, "runs.json")));
    assert.ok(existsSync(join(root, `events-${run.run_id}.jsonl`)));

    const fake2 = makeFakeOrchestrator();
    const manager2 = new RunManager({
      orchestrator: fake2.port,
      root,
      now: () => new Date(RT_FIXED_NOW.getTime()),
      pollIntervalMs: 2,
    });
    const restored = manager2.getRun(run.run_id);
    assert.ok(restored !== null);
    assert.equal(restored.status, "done");
    assert.equal(restored.goal, "持久化测试");
    assert.equal(restored.steps_done, restored.steps_total);
    const events = manager2.eventLog(run.run_id);
    assert.ok(events.length >= 8, "事件应可从 JSONL 回放");
    assert.equal(events[events.length - 1].type, "run.completed");
    assert.ok(manager2.listRuns().some((item) => item.run_id === run.run_id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("返工：blocked 且 rework_limit>0 时自动重新规划重试；rework_limit=0 时不返工", async () => {
  const reworkBox = await makeFakeManager({ fakeOptions: { failStepOnce: true, stepsPerStart: 1 }, settings: { rework_limit: 2 } });
  const noReworkBox = await makeFakeManager({ fakeOptions: { failStepOnce: true, stepsPerStart: 1 }, settings: { rework_limit: 0 } });
  try {
    const run = await reworkBox.manager.createRun({ goal: "返工测试" });
    const done = await reworkBox.manager.waitFor(run.run_id, ["done"], 10_000);
    assert.equal(done.status, "done");
    assert.equal(reworkBox.fake.calls.sendMessage.length, 2, "首次规划 + 1 次返工重新规划");
    assert.equal(reworkBox.fake.calls.sendMessage[1].text, REWORK_PROMPT);
    const resumed = reworkBox.manager.eventLog(run.run_id).find(
      (event) => event.type === "run.resumed" && event.data.reason === "rework",
    );
    assert.ok(resumed !== undefined);
    assert.equal(resumed.data.attempt, 1);

    const failedRun = await noReworkBox.manager.createRun({ goal: "不返工测试" });
    const blocked = await noReworkBox.manager.waitFor(failedRun.run_id, ["blocked"], 10_000);
    assert.equal(blocked.status, "blocked");
    assert.equal(noReworkBox.fake.calls.sendMessage.length, 1);
    assert.ok(blocked.error.includes("测试注入"));
    assert.ok(noReworkBox.manager.eventLog(failedRun.run_id).some((event) => event.type === "run.blocked"));
  } finally {
    reworkBox.cleanup();
    noReworkBox.cleanup();
  }
});

test("token.updated：每轮 Token 递增并事件化；Run 记录 token_used 一致", async () => {
  const box = await makeFakeManager({ fakeOptions: { stepsPerStart: 1 } });
  try {
    const run = await box.manager.createRun({ goal: "Token 测试" });
    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    const tokenEvents = box.manager.eventLog(run.run_id).filter((event) => event.type === "token.updated");
    assert.ok(tokenEvents.length >= 2, `应有 ≥2 次 token.updated，实际 ${tokenEvents.length}`);
    const values = tokenEvents.map((event) => event.data.token_used);
    for (let index = 1; index < values.length; index += 1) {
      assert.ok(values[index] > values[index - 1], "token_used 应单调递增");
    }
    assert.equal(done.token_used, 20);
    assert.equal(tokenEvents[tokenEvents.length - 1].data.token_used, done.token_used);
  } finally {
    box.cleanup();
  }
});

test("错误处理：orchestrator 抛错 → run failed + run.failed 事件（无 unhandled rejection）", async () => {
  const box = await makeFakeManager({ fakeOptions: { failSendMessage: true } });
  try {
    const run = await box.manager.createRun({ goal: "错误注入测试" });
    const failed = await box.manager.waitFor(run.run_id, ["failed"], 5000);
    assert.equal(failed.status, "failed");
    assert.ok(failed.error.includes("测试注入"));
    const events = box.manager.eventLog(run.run_id);
    assert.ok(events.some((event) => event.type === "plan.generating"));
    const failedEvent = events.find((event) => event.type === "run.failed");
    assert.ok(failedEvent !== undefined);
    assert.ok(String(failedEvent.data.error).includes("测试注入"));
  } finally {
    box.cleanup();
  }
});

test("事件保留上限：event_retention 生效（内存/磁盘都只保留最近 N 条，seq 仍连续）", async () => {
  const root = await makeRtRoot("steward-runtime-retention-");
  try {
    const fake = makeFakeOrchestrator({
      planFactory: () => [
        { step: 1, agent_role: "operator", action: "operator.build_deliverable", summary: "1" },
        { step: 2, agent_role: "harness", action: "harness.quality_check", summary: "2" },
        { step: 3, agent_role: "reviewer", action: "reviewer.review_evidence", summary: "3" },
        { step: 4, agent_role: "backend", action: "backend.write_events", summary: "4" },
        { step: 5, agent_role: "customer", action: "customer.reply_draft", summary: "5" },
      ],
      stepsPerStart: 1,
    });
    const manager = new RunManager({
      orchestrator: fake.port,
      root,
      now: () => new Date(RT_FIXED_NOW.getTime()),
      pollIntervalMs: 2,
      settings: { event_retention: 10 },
    });
    const run = await manager.createRun({ goal: "保留上限测试" });
    await manager.waitFor(run.run_id, ["done"], 10_000);
    const events = manager.eventLog(run.run_id);
    assert.equal(events.length, 10, "内存事件应只保留 event_retention 条");
    const finalRun = manager.getRun(run.run_id);
    const lastSeq = finalRun.event_seq;
    assert.equal(events[events.length - 1].seq, lastSeq, "最后一条保留事件 seq 应等于 event_seq");
    for (let index = 1; index < events.length; index += 1) {
      assert.equal(events[index].seq, events[index - 1].seq + 1, "保留窗口内 seq 仍连续");
    }
    const lines = readFileSync(join(root, `events-${run.run_id}.jsonl`), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    assert.equal(lines.length, 10, "磁盘事件文件也不超过 retention");
    assert.ok(events[0].seq > 1, "旧事件被丢弃（seq 从中间开始）");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("waitFor：超时抛 RuntimeTimeoutError；createRun/查询入参校验", async () => {
  const box = await makeFakeManager({ fakeOptions: { stepDelayMs: 60, stepsPerStart: 1 } });
  try {
    const run = await box.manager.createRun({ goal: "超时测试" });
    await assert.rejects(
      box.manager.waitFor(run.run_id, ["done"], 40),
      (error) => error instanceof RuntimeTimeoutError && error.run_id === run.run_id,
    );
    await box.manager.interruptRun(run.run_id);
    assert.equal(box.manager.getRun("run-missing"), null);
    await assert.rejects(box.manager.waitFor("run-missing", ["done"], 100));
    assert.throws(() => box.manager.subscribeRun("run-missing", () => undefined), (error) => error.name === "RuntimeNotFoundError");
    await assert.rejects(box.manager.createRun({ goal: "   " }), /goal/);
    assert.throws(() => box.manager.updateSettings({ approval_mode: "nope" }), /approval_mode/);
    assert.throws(() => new RunManager({}), /orchestrator/);
  } finally {
    box.cleanup();
  }
});

test("auto_run=false：createRun 不自动执行，startRun 后才开始并完成", async () => {
  const box = await makeFakeManager({ settings: { auto_run: false } });
  try {
    const run = await box.manager.createRun({ goal: "手动开始测试" });
    assert.equal(run.status, "queued");
    await sleepMs(40);
    assert.equal(box.manager.getRun(run.run_id).status, "queued", "auto_run=false 时不应自动执行");
    assert.equal(box.fake.calls.sendMessage.length, 0);
    await box.manager.startRun(run.run_id);
    const done = await box.manager.waitFor(run.run_id, ["done"], 5000);
    assert.equal(done.status, "done");
  } finally {
    box.cleanup();
  }
});

test("approve 策略纯函数：auto_low_risk/auto_all/manual/full_auto 判定可解释", async () => {
  const { evaluateApprovalPolicy } = await import("../../dist/packages/steward-runtime/src/index.js");
  const { DEFAULT_RUNTIME_SETTINGS } = await import("../../dist/packages/steward-runtime/src/index.js");
  const highStep = { step: 1, agent_role: "supervisor", action: "removeApp", summary: "删除", requires_approval: true, action_plan: { risk: "high", requires_confirmation: true } };
  const lowStep = { step: 2, agent_role: "finance", action: "finance.collect_payment", summary: "收款", requires_approval: true };
  const lowRisk = evaluateApprovalPolicy(lowStep, { ...DEFAULT_RUNTIME_SETTINGS });
  assert.equal(lowRisk.decision, "approve_now");
  assert.equal(lowRisk.dangerous, false);
  const highRisk = evaluateApprovalPolicy(highStep, { ...DEFAULT_RUNTIME_SETTINGS });
  assert.equal(highRisk.decision, "wait_human");
  assert.equal(highRisk.dangerous, true);
  assert.ok(highRisk.reason.includes("auto_low_risk"));
  assert.equal(evaluateApprovalPolicy(highStep, { ...DEFAULT_RUNTIME_SETTINGS, approval_mode: "auto_all" }).decision, "approve_now");
  assert.equal(evaluateApprovalPolicy(lowStep, { ...DEFAULT_RUNTIME_SETTINGS, approval_mode: "manual" }).decision, "wait_human");
  assert.equal(evaluateApprovalPolicy(highStep, { ...DEFAULT_RUNTIME_SETTINGS, full_auto: true }).decision, "approve_now");
});

// ---------------------------------------------------------------------------
// 6) system(supervisor) Run 自动执行（真实 OrchestratorEngine + fake SystemActions）
// ---------------------------------------------------------------------------

test("system Run：supervisor 系统动作在 auto_all 下自动确认并执行完成（真实引擎 + fake SystemActions）", async () => {
  const root = await makeRtRoot("steward-runtime-system-");
  try {
    const systemCalls = [];
    const engine = makeRealEngine(root, { systemActions: makeSystemActionsFake(systemCalls) });
    const manager = new RunManager({
      orchestrator: toRuntimePort(engine),
      root: join(root, "runtime"),
      now: () => new Date(RT_FIXED_NOW.getTime()),
      pollIntervalMs: 2,
      settings: { approval_mode: "auto_all" },
    });
    const run = await manager.createRun({ goal: "列出受管程序", kind: "system" });
    assert.equal(run.kind, "system");
    const done = await manager.waitFor(run.run_id, ["done"], 20_000);
    assert.equal(done.status, "done");
    assert.ok(systemCalls.some((call) => call.name === "listApps"), "系统动作应真实调用注入的 SystemActions");
    const events = manager.eventLog(run.run_id);
    assert.ok(events.some((event) => event.type === "plan.ready"));
    assert.ok(events.some((event) => event.type === "agent.turn" && event.data.agent_role === "supervisor"));
    const session = engine.getSession(run.session_id);
    assert.equal(session.kind, "system");
    assert.equal(session.status, "done");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
