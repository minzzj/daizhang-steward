/**
 * v1.2-C / v1.3 编排内核单元测试（≥20 条；全部零网络：fake resolver / fake adapter / 本地回退）。
 *
 * 覆盖：
 * - project 会话（conductor）：创建/计划/对话记录/派发真实本地动作/每轮摘要+全文+tokens+证据/
 *   打断恢复/审批/Token 超限/持久化/模型适配与回退/账本注入；
 * - system 会话（supervisor）：系统动作计划（ActionPlan risk/requires_confirmation）、
 *   确认/拒绝/执行、危险动作未确认不执行、委派 conductor 子会话、模型与提示词切换、日志读取、
 *   不能绕过确认、project 会话行为不变且不能越权委派。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BUDGET_CNY,
  DEFAULT_TOKEN_LIMIT,
  LocalPlannerAdapter,
  OpenAICompatibleAdapter,
  OrchestratorEngine,
  OrchestratorNotFoundError,
  OrchestratorValidationError,
  PLAN_MARKER,
  SUPERVISOR_PLAN_MARKER,
  SYSTEM_ACTIONS,
  buildLocalPlan,
  buildLocalSystemPlan,
  createModelResolverFromConfig,
  estimateTokens,
  parseConductorPlan,
  parseSystemPlan,
  riskForSystemAction,
} from "../../dist/packages/steward-orchestrator/src/index.js";

const FIXED_NOW = new Date("2026-10-26T08:00:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

function deepProvider(overrides = {}) {
  return {
    id: "deepseek",
    name: "DeepSeek",
    kind: "deepseek",
    base_url: "https://api.deepseek.com",
    default_model: "deepseek-chat",
    models: ["deepseek-chat"],
    ...overrides,
  };
}

function makeResolver(options = {}) {
  const state = {
    tokens: 0,
    limit: options.limit ?? 1_000_000,
    consumed: [],
    hasKey: options.hasKey === true,
    consumeOk: options.consumeOk !== false,
  };
  const resolver = {
    resolveAgentModel() {
      return {
        provider: deepProvider(),
        model: "deepseek-chat",
        has_key: state.hasKey,
        key_source: state.hasKey ? "env" : "missing",
      };
    },
    getApiKey() {
      return state.hasKey ? "sk-test-secret" : null;
    },
    getConductorPrompt() {
      return "总调度提示词：拆解目标、输出 JSON 计划、留证、人工确认。";
    },
    getSystemPrompt(role) {
      return `${role} 系统提示词：真实执行、留证、不越界、失败升级人工。`;
    },
    consumeTokens(amount, meta) {
      state.consumed.push({ amount, meta });
      if (!state.consumeOk) {
        return {
          ok: false,
          used_tokens: state.tokens,
          limit_tokens: state.limit,
          remaining_tokens: Math.max(0, state.limit - state.tokens),
          reason: "测试：Token 预算拒绝",
        };
      }
      if (state.tokens + amount > state.limit) {
        return {
          ok: false,
          used_tokens: state.tokens,
          limit_tokens: state.limit,
          remaining_tokens: Math.max(0, state.limit - state.tokens),
          reason: `Token 超限：${state.tokens}+${amount}>${state.limit}`,
        };
      }
      state.tokens += amount;
      return {
        ok: true,
        used_tokens: state.tokens,
        limit_tokens: state.limit,
        remaining_tokens: Math.max(0, state.limit - state.tokens),
      };
    },
    remainingTokens() {
      return Math.max(0, state.limit - state.tokens);
    },
  };
  return { resolver, state };
}

function tryCleanup(root) {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeEngine(overrides = {}) {
  const root = overrides.root ?? mkdtempSync(join(tmpdir(), "steward-orch-"));
  const box = overrides.resolverBox ?? makeResolver(overrides.resolverOptions ?? {});
  const engine = new OrchestratorEngine({
    resolver: box.resolver,
    root,
    now: () => new Date(FIXED_NOW.getTime()),
    ...(overrides.engineOptions ?? {}),
  });
  return { engine, root, resolver: box.resolver, resolverState: box.state, cleanup: () => tryCleanup(root) };
}

function delay(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** 计划/摘要脚本化 remote adapter（记录调用；延迟可调，支持中断）。 */
function makeScriptedAdapter(options = {}) {
  const calls = [];
  const state = {
    delayMs: options.delayMs ?? 0,
    planContent:
      options.planContent ??
      JSON.stringify({
        title: "远程模型计划",
        steps: [
          { agent_role: "operator", action: "operator.build_deliverable", summary: "生成交付物" },
          { agent_role: "harness", action: "harness.quality_check", summary: "本地质检" },
          { agent_role: "reviewer", action: "reviewer.review_evidence", summary: "核查证据" },
          { agent_role: "backend", action: "backend.write_events", summary: "写事件与证据索引" },
          { agent_role: "finance", action: "finance.collect_payment", summary: "生成收款请求" },
        ],
      }),
    summary: options.summary ?? "【远程模型】本轮已完成并留证。",
  };
  const adapter = {
    async chat(input) {
      calls.push(input);
      await delay(state.delayMs, input.signal);
      const joined = input.messages.map((message) => message.content).join("\n");
      if (joined.includes(PLAN_MARKER) || joined.includes(SUPERVISOR_PLAN_MARKER)) {
        return { ok: true, content: state.planContent, tokens_used: 120, mode: "remote" };
      }
      return { ok: true, content: state.summary, tokens_used: 30, mode: "remote" };
    },
  };
  return { adapter, calls, state };
}

/** fake SystemActions：记录调用；全部成功；用于 supervisor 测试。 */
function makeSystemActionsFake(options = {}) {
  const calls = [];
  const record = (name, args) => {
    calls.push({ name, args });
    return { ok: true, summary: `[fake] ${name} 执行成功` };
  };
  const actions = {
    listApps: () => record("listApps", {}),
    startApp: (id) => record("startApp", id),
    stopApp: (id) => record("stopApp", id),
    restartApp: (id) => record("restartApp", id),
    removeApp: (id) => record("removeApp", id),
    listPlugins: () => record("listPlugins", {}),
    enablePlugin: (id) => record("enablePlugin", id),
    disablePlugin: (id) => record("disablePlugin", id),
    removePlugin: (id) => record("removePlugin", id),
    changeAgentModel: (role, binding) => record("changeAgentModel", { role, binding }),
    setPrompt: (role, prompt) => record("setPrompt", { role, prompt }),
    delegateProject: (goal, sessionId) => record("delegateProject", { goal, sessionId }),
  };
  if (options.failRemove === true) {
    actions.removeApp = (id) => {
      calls.push({ name: "removeApp", args: id });
      return { ok: false, summary: "[fake] 删除失败（测试注入）" };
    };
  }
  return { actions, calls };
}

/** fake ConfigBridge：记录模型/提示词变更。 */
function makeConfigBridgeFake() {
  const calls = [];
  const bridge = {
    setAgentModel: (role, binding) => {
      calls.push({ method: "setAgentModel", role, binding });
      return { ok: true, summary: `[fake] 已切换 ${role} → ${binding.provider_id}/${binding.model}` };
    },
    setSystemPrompt: (role, prompt) => {
      calls.push({ method: "setSystemPrompt", role, prompt });
      return { ok: true, summary: `[fake] 已更新 ${role} 系统提示词` };
    },
    setConductorPrompt: (prompt) => {
      calls.push({ method: "setConductorPrompt", prompt });
      return { ok: true, summary: "[fake] 已更新总调度提示词" };
    },
    listAgents: () => [{ role: "operator", name: "执行", model: "deepseek-chat" }],
    getTokenUsage: () => ({ used_tokens: 0, limit_tokens: 1_000_000, remaining_tokens: 1_000_000 }),
  };
  return { bridge, calls };
}

// ---------------------------------------------------------------------------
// A. project 会话（conductor）基础
// ---------------------------------------------------------------------------

test("createSession：默认值/kind/list/get，空目标与未知会话抛错", () => {
  const box = makeEngine();
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价单页面" });
    assert.equal(session.kind, "project");
    assert.equal(session.status, "active");
    assert.equal(session.budget_cny, DEFAULT_BUDGET_CNY);
    assert.equal(session.token_limit, DEFAULT_TOKEN_LIMIT);
    assert.ok(session.title.length > 0);
    assert.ok(Array.isArray(session.messages) && session.messages.length >= 1);

    const system = box.engine.createSession({ goal: "管理受管程序与插件", kind: "system" });
    assert.equal(system.kind, "system");
    assert.deepEqual(system.child_sessions, []);

    assert.equal(box.engine.listSessions().length, 2);
    assert.equal(box.engine.getSession(session.id).id, session.id);
    assert.throws(() => box.engine.createSession({ goal: "   " }), OrchestratorValidationError);
    assert.throws(() => box.engine.getSession("sess-missing"), OrchestratorNotFoundError);
  } finally {
    box.cleanup();
  }
});

test("sendMessage/startProject/runStep：空消息、无计划、非法审批等前置校验", async () => {
  const box = makeEngine();
  try {
    const session = box.engine.createSession({ goal: "帮我做一个页面" });
    await assert.rejects(box.engine.sendMessage(session.id, "   "), OrchestratorValidationError);
    await assert.rejects(box.engine.sendMessage("sess-missing", "你好"), OrchestratorNotFoundError);
    await assert.rejects(box.engine.startProject(session.id), (error) => {
      assert.ok(error instanceof OrchestratorValidationError);
      assert.equal(error.code, "MISSING_PLAN");
      return true;
    });
    await assert.rejects(box.engine.runStep(session.id), OrchestratorValidationError);
    assert.throws(() => box.engine.decideApproval(session.id, 99, "approve"), OrchestratorValidationError);
    assert.throws(() => box.engine.decideApproval(session.id, 1, "maybe"), OrchestratorValidationError);
  } finally {
    box.cleanup();
  }
});

test("无 key → 本地规则计划 + conductor 对话记录 + 明确回退标注 + Token 预扣", async () => {
  const box = makeEngine();
  try {
    const session = box.engine.createSession({ goal: "帮我调研竞品并回复客户，报价 880 元" });
    const planned = await box.engine.sendMessage(session.id, "帮我调研竞品并回复客户，报价 880 元");

    assert.equal(planned.status, "active");
    assert.ok(planned.plan.length >= 4, `本地计划应有多步，实际 ${planned.plan.length}`);
    const roles = new Set(planned.plan.map((step) => step.agent_role));
    assert.ok(roles.has("operator") && roles.has("harness") && roles.has("reviewer") && roles.has("backend"));
    for (const step of planned.plan) {
      assert.equal(step.status, "pending");
      assert.ok(step.summary.length > 0);
    }

    const conductorMessages = planned.messages.filter((message) => message.role === "conductor");
    assert.ok(conductorMessages.length >= 1, "应有总调度计划消息");
    assert.equal(conductorMessages[0].kind, "plan");
    assert.equal(conductorMessages[0].model_mode, "local_fallback");
    assert.match(conductorMessages[0].text, /本地规则模式/u);

    const conversation = box.engine.getConductorConversation(session.id);
    assert.ok(conversation.some((message) => message.role === "user"));
    assert.ok(conversation.some((message) => message.role === "conductor" && message.kind === "plan"));

    const conductorTurns = box.engine.getAgentTranscripts(session.id, "conductor");
    assert.equal(conductorTurns.length, 1);
    assert.equal(conductorTurns[0].model_mode, "local_fallback");
    assert.ok(conductorTurns[0].input_summary.includes("用户消息"));
    assert.ok(conductorTurns[0].output_summary.includes("本地规则回退"));
    assert.ok(conductorTurns[0].tokens > 0);
    assert.ok(box.resolverState.consumed.length >= 1, "调用模型/回退前必须预扣 Token");
    assert.ok((planned.tokens_used ?? 0) > 0);
  } finally {
    box.cleanup();
  }
});

test("LocalPlannerAdapter / buildLocalPlan / parseConductorPlan 单元行为", async () => {
  const adapter = new LocalPlannerAdapter();
  const planResult = await adapter.chat({
    resolution: { provider: deepProvider({ kind: "local" }), model: "local-rules", has_key: false, key_source: "missing" },
    messages: [
      { role: "system", content: "你是总调度" },
      { role: "user", content: `帮我做一个页面\n\n${PLAN_MARKER}\n请输出计划` },
    ],
  });
  assert.equal(planResult.ok, true);
  assert.equal(planResult.mode, "local_fallback");
  const parsed = parseConductorPlan(planResult.content);
  assert.ok(parsed !== null && parsed.steps.length > 0);
  assert.equal(parsed.steps[0].agent_role, "operator");

  const summaryResult = await adapter.chat({
    resolution: { provider: deepProvider({ kind: "local" }), model: "local-rules", has_key: false },
    messages: [{ role: "user", content: "角色：operator\n动作：operator.build_deliverable\n步骤：生成交付物" }],
  });
  assert.equal(summaryResult.mode, "local_fallback");
  assert.match(summaryResult.content, /本地规则模式/u);

  const local = buildLocalPlan("帮我调研竞品并回复客户 880 元");
  assert.ok(local.steps.length >= 6);
  assert.equal(local.steps[0].agent_role, "operator");
  assert.equal(local.steps[local.steps.length - 1].agent_role, "finance");
  const capped = buildLocalPlan("帮我调研竞品并回复客户 880 元", 3);
  assert.equal(capped.steps.length, 3);
  assert.equal(capped.steps[capped.steps.length - 1].agent_role, "finance");

  const tolerant = parseConductorPlan(
    '```json\n{"title":"T","steps":[{"agent_role":"OPERATOR","action":"operator.build_deliverable","summary":"生成"},{"agent_role":"hacker","action":"evil"},{"role":"reviewer","summary":"核查"}]}\n```',
  );
  assert.ok(tolerant !== null);
  assert.equal(tolerant.title, "T");
  assert.equal(tolerant.steps.length, 2);
  assert.equal(tolerant.steps[1].agent_role, "reviewer");
  assert.equal(tolerant.steps[1].action, "reviewer.review_evidence");
  assert.equal(parseConductorPlan("抱歉，我不能输出 JSON"), null);
  assert.equal(parseConductorPlan('{"steps":[]}'), null);
});

test("OpenAICompatibleAdapter：真实 fetch 协议（URL/Bearer/usage）解析成功", async () => {
  const requests = [];
  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test-123",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "远程模型回复内容" } }],
          usage: { total_tokens: 234 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const result = await adapter.chat({
    resolution: { provider: deepProvider(), model: "deepseek-chat", has_key: true, key_source: "env" },
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "你好" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "remote");
  assert.equal(result.content, "远程模型回复内容");
  assert.equal(result.tokens_used, 234);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer sk-test-123");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);
});

test("OpenAICompatibleAdapter：无密钥/401/网络异常/超时都分类为 local_fallback 可读错误", async () => {
  const noKey = new OpenAICompatibleAdapter({ getApiKey: () => null });
  const noKeyResult = await noKey.chat({
    resolution: { provider: deepProvider({ id: "nokey-provider" }), model: "m", has_key: true },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(noKeyResult.ok, false);
  assert.equal(noKeyResult.mode, "local_fallback");
  assert.match(noKeyResult.error, /未配置 API 密钥/u);

  const unauthorized = new OpenAICompatibleAdapter({
    apiKey: "bad",
    fetchImpl: async () => new Response("bad key", { status: 401, statusText: "Unauthorized" }),
  });
  const unauthorizedResult = await unauthorized.chat({
    resolution: { provider: deepProvider(), model: "m", has_key: true },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(unauthorizedResult.ok, false);
  assert.match(unauthorizedResult.error, /HTTP 401/u);

  const network = new OpenAICompatibleAdapter({
    apiKey: "sk",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  const networkResult = await network.chat({
    resolution: { provider: deepProvider(), model: "m", has_key: true },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(networkResult.ok, false);
  assert.match(networkResult.error, /网络错误/u);

  const timeout = new OpenAICompatibleAdapter({
    apiKey: "sk",
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  const timeoutResult = await timeout.chat({
    resolution: { provider: deepProvider(), model: "m", has_key: true },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(timeoutResult.ok, false);
  assert.match(timeoutResult.error, /超时/u);
});

test("remote 计划：fake adapter 返回 JSON 计划 → 解析并标注 remote", async () => {
  const scripted = makeScriptedAdapter();
  const box = makeEngine({
    resolverOptions: { hasKey: true },
    engineOptions: { adapter: scripted.adapter },
  });
  try {
    const session = box.engine.createSession({ goal: "帮我交付一个页面" });
    const planned = await box.engine.sendMessage(session.id, "帮我交付一个页面");
    assert.equal(planned.plan.length, 5);
    assert.equal(planned.plan[0].agent_role, "operator");
    assert.equal(planned.plan[4].agent_role, "finance");
    assert.equal(planned.title, "远程模型计划");
    const conductorMessage = planned.messages.find((message) => message.role === "conductor" && message.kind === "plan");
    assert.equal(conductorMessage.model_mode, "remote");
    const conductorTurn = box.engine.getAgentTranscripts(session.id, "conductor")[0];
    assert.equal(conductorTurn.model_mode, "remote");
    assert.ok(scripted.calls.length >= 1);
    assert.ok(scripted.calls[0].resolution.provider.base_url.includes("deepseek"));
  } finally {
    box.cleanup();
  }
});

test("模型返回非法计划 JSON → 回退本地规则计划并标注回退", async () => {
  const scripted = makeScriptedAdapter({ planContent: "抱歉，这里只是一段自然语言，没有 JSON。" });
  const box = makeEngine({ resolverOptions: { hasKey: true }, engineOptions: { adapter: scripted.adapter } });
  try {
    const goal = "帮我调研竞品并回复客户";
    const session = box.engine.createSession({ goal });
    const planned = await box.engine.sendMessage(session.id, goal);
    const expected = buildLocalPlan(goal);
    assert.equal(planned.plan.length, expected.steps.length);
    const conductorMessage = planned.messages.find((message) => message.role === "conductor" && message.kind === "plan");
    assert.equal(conductorMessage.model_mode, "local_fallback");
    assert.match(conductorMessage.text, /本地规则模式|回退/u);
    const conductorTurn = box.engine.getAgentTranscripts(session.id, "conductor")[0];
    assert.equal(conductorTurn.model_mode, "local_fallback");
    assert.match(conductorTurn.detail, /回退说明/u);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------------------
// B. project 会话：执行 / 每轮摘要 / 证据 / 打断恢复 / 审批 / Token / 持久化
// ---------------------------------------------------------------------------

test("startProject（autoApprove）跑完计划：真实本地交付物/质检/核查/事件/收款请求 + turns", async () => {
  const box = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户，报价 880 元" });
    await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户，报价 880 元");
    const done = await box.engine.startProject(session.id);

    assert.equal(done.status, "done");
    assert.ok(done.project_id !== undefined);
    assert.ok(done.plan.every((step) => step.status === "done"));
    assert.ok(done.evidence_dir !== undefined && existsSync(done.evidence_dir));

    const files = readdirSync(done.evidence_dir);
    for (const expected of [
      "deliverable.html",
      "deliverable.md",
      "quality-check.json",
      "review.json",
      "events.jsonl",
      "evidence-index.json",
      "payment-request.json",
      "ledger.json",
    ]) {
      assert.ok(files.includes(expected), `证据目录应包含 ${expected}，实际 ${files.join(", ")}`);
    }
    const payment = JSON.parse(readFileSync(join(done.evidence_dir, "payment-request.json"), "utf8"));
    assert.equal(payment.status, "pending");
    assert.equal(payment.amount_cny, 880);

    const roles = Object.keys(done.children).sort();
    for (const expected of ["operator", "harness", "reviewer", "backend", "finance"]) {
      assert.ok(roles.includes(expected), `缺少 ${expected} 轮次，实际 ${roles.join(", ")}`);
    }
    const turns = box.engine.getRunDetail(session.id).turns;
    assert.ok(turns.length >= 6);
  } finally {
    box.cleanup();
  }
});

test("每轮 AgentTurn：input/output 摘要 + detail 全文 + tokens + evidence_refs 齐全（本地回退标注）", async () => {
  const box = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户");
    await box.engine.startProject(session.id);
    const turns = box.engine.getAgentTranscripts(session.id);
    assert.ok(turns.length >= 6);
    for (const turn of turns) {
      assert.equal(typeof turn.seq, "number");
      assert.equal(typeof turn.at, "string");
      assert.ok(!Number.isNaN(Date.parse(turn.at)));
      assert.ok(turn.agent_role.length > 0);
      assert.ok(turn.input_summary.length > 0);
      assert.ok(turn.output_summary.length > 0);
      assert.ok(turn.detail.length >= turn.output_summary.length);
      assert.equal(typeof turn.tokens, "number");
      assert.ok(turn.tokens >= 0);
      assert.ok(["done", "blocked", "failed"].includes(turn.status));
      assert.ok(Array.isArray(turn.evidence_refs));
      assert.ok(turn.detail.length > 0);
    }
    const agentTurns = turns.filter((turn) => turn.agent_role !== "conductor" && turn.agent_role !== "supervisor");
    assert.ok(agentTurns.every((turn) => turn.model_mode === "local_fallback"), "无 key 时 agent 轮次必须标注本地回退");
    assert.ok(agentTurns.some((turn) => turn.evidence_refs.length > 0));
  } finally {
    box.cleanup();
  }
});

test("getAgentTranscripts 过滤 / getConductorConversation / getRunDetail 证据列表", async () => {
  const box = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户");
    await box.engine.startProject(session.id);

    const all = box.engine.getAgentTranscripts(session.id);
    const totalChildren = Object.values(session.children ?? {}).reduce((sum, list) => sum + list.length, 0);
    // 会话在 sendMessage 后是快照；这里用最新的 getSession 校验
    const latest = box.engine.getSession(session.id);
    const latestTotal = Object.values(latest.children).reduce((sum, list) => sum + list.length, 0);
    assert.equal(all.length, latestTotal);

    const operatorTurns = box.engine.getAgentTranscripts(session.id, "operator");
    assert.ok(operatorTurns.length >= 1);
    assert.ok(operatorTurns.every((turn) => turn.agent_role === "operator" && turn.input_summary.length > 0));
    const unknown = box.engine.getAgentTranscripts(session.id, "not-an-agent");
    assert.deepEqual(unknown, []);

    const detail = box.engine.getRunDetail(session.id);
    assert.equal(detail.session.id, session.id);
    assert.deepEqual(
      detail.turns.map((turn) => turn.seq),
      [...detail.turns.map((turn) => turn.seq)].sort((a, b) => a - b),
    );
    assert.ok(detail.evidence.length >= 6);
    for (const item of detail.evidence) {
      assert.ok(item.path.length > 0);
      assert.ok(["html", "report", "json", "log", "screenshot", "other"].includes(item.kind));
      assert.ok(item.title.length > 0);
      assert.ok(existsSync(join(box.root, item.path)), `证据文件应存在：${item.path}`);
    }
    assert.ok(detail.evidence.some((item) => item.kind === "html"));
    assert.ok(detail.evidence.some((item) => item.kind === "report"));
    assert.ok(totalChildren >= 0);
  } finally {
    box.cleanup();
  }
});

test("打断（≤1s）后不再执行，resume 后继续并完成；打断轮次标记 interrupted", async () => {
  const scripted = makeScriptedAdapter({ delayMs: 40 });
  const box = makeEngine({ resolverOptions: { hasKey: true }, engineOptions: { adapter: scripted.adapter, autoApprove: true } });
  try {
    const session = box.engine.createSession({ goal: "帮我交付一个页面" });
    await box.engine.sendMessage(session.id, "帮我交付一个页面");

    const pending = box.engine.startProject(session.id);
    await delay(5);
    const startedAt = Date.now();
    const interrupted = box.engine.interrupt(session.id, "测试打断");
    const interruptMs = Date.now() - startedAt;
    await pending;

    assert.ok(interruptMs < 1000, `interrupt 应立即生效（≤1s），实际 ${interruptMs}ms`);
    assert.equal(interrupted.status, "interrupted");
    const afterInterrupt = box.engine.getSession(session.id);
    assert.equal(afterInterrupt.status, "interrupted");
    const turnsAtInterrupt = box.engine.getAgentTranscripts(session.id).length;
    assert.ok(turnsAtInterrupt >= 1);
    assert.ok(
      box.engine.getAgentTranscripts(session.id).some((turn) => turn.interrupted === true),
      "被打断的轮次必须标记 interrupted",
    );
    assert.ok(afterInterrupt.messages.some((message) => message.kind === "interrupt"));
    assert.ok(afterInterrupt.plan.some((step) => step.status === "pending"));

    // 打断状态下 runStep 不再执行
    await box.engine.runStep(session.id);
    assert.equal(box.engine.getAgentTranscripts(session.id).length, turnsAtInterrupt);

    scripted.state.delayMs = 0;
    const resumed = box.engine.resume(session.id);
    assert.ok(["running", "active"].includes(resumed.status));
    const finished = await box.engine.startProject(session.id);
    assert.equal(finished.status, "done");
    assert.ok(finished.plan.every((step) => step.status === "done"));
  } finally {
    box.cleanup();
  }
});

test("审批（project finance 步骤）：未批准挂起，approve 后执行完成；reject 阻塞且不产生收款请求", async () => {
  // 通过：未确认挂起 → 批准 → 执行 finance
  const box = makeEngine();
  const rejectedBox = makeEngine();
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户");
    const paused = await box.engine.startProject(session.id);
    assert.equal(paused.status, "paused");
    const financeStep = paused.plan.find((step) => step.agent_role === "finance");
    assert.ok(financeStep !== undefined && financeStep.status === "pending");
    assert.ok(paused.messages.some((message) => message.kind === "approval"));
    assert.equal(
      paused.children.finance,
      undefined,
      "未批准前 finance 步骤不得执行",
    );

    const approved = box.engine.decideApproval(session.id, financeStep.step, "approve", "human:test");
    assert.equal(approved.status, "running");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");
    assert.ok(done.children.finance !== undefined && done.children.finance.length === 1);
    const evidenceDir = done.evidence_dir;
    assert.ok(evidenceDir !== undefined && existsSync(join(evidenceDir, "payment-request.json")));

    // 驳回：finance 不执行，会话 blocked
    const rejectedSession = rejectedBox.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    await rejectedBox.engine.sendMessage(rejectedSession.id, "帮我做一个报价页面并回复客户");
    const rejectedPaused = await rejectedBox.engine.startProject(rejectedSession.id);
    const rejectedFinance = rejectedPaused.plan.find((step) => step.agent_role === "finance");
    const blocked = rejectedBox.engine.decideApproval(rejectedSession.id, rejectedFinance.step, "reject", "human:test");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.plan.find((step) => step.agent_role === "finance").status, "blocked");
    assert.equal(blocked.children.finance, undefined, "驳回后 finance 步骤不得执行");
    const blockedDetail = rejectedBox.engine.getRunDetail(rejectedSession.id);
    assert.ok(!blockedDetail.evidence.some((item) => item.title === "payment-request.json"));
  } finally {
    box.cleanup();
    rejectedBox.cleanup();
  }
});

test("Token 双限额：会话 token_limit 超限 → blocked + error 消息；resolver 拒绝同样 blocked", async () => {
  const smallBox = makeEngine();
  const denyBox = makeEngine({ resolverOptions: { consumeOk: false } });
  try {
    const session = smallBox.engine.createSession({ goal: "帮我做一个页面", token_limit: 5 });
    const blocked = await smallBox.engine.sendMessage(session.id, "帮我做一个页面并交付给客户");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.plan.length, 0);
    assert.ok(blocked.messages.some((message) => message.kind === "error" && /Token/u.test(message.text)));
    assert.ok(
      smallBox.engine.getAgentTranscripts(session.id).some((turn) => turn.status === "blocked"),
      "Token 超限轮次必须记录 blocked",
    );

    const denySession = denyBox.engine.createSession({ goal: "帮我做一个页面" });
    const denied = await denyBox.engine.sendMessage(denySession.id, "帮我做一个页面");
    assert.equal(denied.status, "blocked");
    assert.ok(denied.messages.some((message) => message.kind === "error" && /测试：Token 预算拒绝/u.test(message.text)));
  } finally {
    smallBox.cleanup();
    denyBox.cleanup();
  }
});

test("持久化：会话/计划/轮次/证据重载后可恢复（新引擎同 root）", async () => {
  const box = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");

    const { resolver } = makeResolver();
    const reloaded = new OrchestratorEngine({
      resolver,
      root: box.root,
      now: () => new Date(FIXED_NOW.getTime()),
    });
    const list = reloaded.listSessions();
    assert.ok(list.some((item) => item.id === session.id));
    const restored = reloaded.getSession(session.id);
    assert.equal(restored.status, "done");
    assert.equal(restored.goal, done.goal);
    assert.equal(restored.plan.length, done.plan.length);
    assert.ok(restored.messages.length >= done.messages.length);
    assert.ok(reloaded.getAgentTranscripts(session.id).length >= 6);
    assert.ok(reloaded.getRunDetail(session.id).evidence.length >= 6);
    assert.ok(reloaded.auditLog().length >= 1);
  } finally {
    box.cleanup();
  }
});

test("createModelResolverFromConfig：结构适配配置中心（不泄露密钥明文）", async () => {
  const consumed = [];
  const source = {
    resolveAgentModel(role) {
      return {
        provider: {
          id: "deepseek",
          name: "DeepSeek",
          kind: "deepseek",
          base_url: "https://api.deepseek.com",
          default_model: "deepseek-chat",
          models: ["deepseek-chat"],
          api_key_ref: "env:DEEPSEEK_API_KEY",
        },
        model: "deepseek-chat",
        has_key: true,
        key_source: "env",
      };
    },
    getApiKeyForProvider(providerId) {
      return providerId === "deepseek" ? "sk-super-secret-value" : null;
    },
    getConductorPrompt() {
      return "总调度专业提示词";
    },
    getSystemPrompt(role) {
      return `${role} 专业提示词`;
    },
    consumeTokens(amount, meta) {
      consumed.push({ amount, meta });
      return { ok: true, used_tokens: amount, limit_tokens: 1_000, remaining_tokens: 1_000 - amount };
    },
    tokenBudget: { remaining: () => 777 },
  };
  const resolver = createModelResolverFromConfig(source);
  const resolution = resolver.resolveAgentModel("conductor");
  assert.equal(resolution.has_key, true);
  assert.equal(resolution.key_source, "env");
  assert.equal(resolution.provider.base_url, "https://api.deepseek.com");
  assert.equal(resolution.model, "deepseek-chat");
  assert.ok(!JSON.stringify(resolution).includes("sk-super-secret-value"), "解析结果不得包含密钥明文");
  assert.equal(resolver.getApiKey("deepseek"), "sk-super-secret-value");
  assert.equal(resolver.getConductorPrompt(), "总调度专业提示词");
  assert.equal(resolver.getSystemPrompt("operator"), "operator 专业提示词");
  assert.equal(resolver.remainingTokens(), 777);
  const consume = resolver.consumeTokens(100, { agentRole: "operator", action: "test" });
  assert.equal(consume.ok, true);
  assert.equal(consume.remaining_tokens, 900);
  assert.equal(consumed.length, 1);
});

test("账本注入：finance 动作调用 ledger.recordIncome（金额从目标解析）", async () => {
  const incomes = [];
  const ledger = {
    recordIncome(entry) {
      incomes.push(entry);
      return { ok: true, id: "led-test" };
    },
    recordExpense() {
      return { ok: true };
    },
  };
  const box = makeEngine({ engineOptions: { autoApprove: true, ledger } });
  try {
    const session = box.engine.createSession({ goal: "帮我做报价单，报价 880 元并回复客户" });
    await box.engine.sendMessage(session.id, "帮我做报价单，报价 880 元并回复客户");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");
    assert.equal(incomes.length, 1);
    assert.equal(incomes[0].amount_cny, 880);
    assert.equal(incomes[0].session_id, session.id);
    assert.ok(incomes[0].basis.includes(session.id));
  } finally {
    box.cleanup();
  }
});

test("零网络：hasKey=true 但注入 LocalPlannerAdapter 时全流程不调用 fetch，且明确标注 local_fallback", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("测试期间禁止网络"));
  };
  const box = makeEngine({
    resolverOptions: { hasKey: true },
    engineOptions: { adapter: new LocalPlannerAdapter(), autoApprove: true },
  });
  try {
    const session = box.engine.createSession({ goal: "帮我做一个报价页面并回复客户" });
    const planned = await box.engine.sendMessage(session.id, "帮我做一个报价页面并回复客户");
    assert.equal(planned.plan.length > 0, true);
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");
    assert.equal(fetchCalls, 0, "编排内核不得自行发起网络请求（远程调用只经注入 adapter）");
    const turns = box.engine.getAgentTranscripts(session.id);
    assert.ok(turns.length >= 1);
    assert.ok(turns.every((turn) => turn.model_mode === "local_fallback"));
  } finally {
    globalThis.fetch = originalFetch;
    box.cleanup();
  }
});

// ---------------------------------------------------------------------------
// C. system 会话（supervisor）：系统动作 / 确认 / 委派 / 模型提示词 / 日志
// ---------------------------------------------------------------------------

test("system 会话：supervisor 计划生成（ActionPlan 含 risk/requires_confirmation）", async () => {
  const box = makeEngine();
  try {
    const session = box.engine.createSession({ goal: "删除 demo-app 程序并读取全部日志", kind: "system" });
    assert.equal(session.kind, "system");
    const planned = await box.engine.sendMessage(session.id, "删除 demo-app 程序并读取全部日志");
    assert.ok(planned.plan.length >= 2);
    for (const step of planned.plan) {
      assert.equal(step.agent_role, "supervisor");
      assert.ok(step.action_plan !== undefined, "system 每一步都必须生成 ActionPlan");
      assert.ok(["low", "medium", "high", "critical"].includes(step.action_plan.risk));
      assert.equal(typeof step.action_plan.requires_confirmation, "boolean");
      assert.ok(step.action_plan.summary.length > 0);
    }
    const removeStep = planned.plan.find((step) => step.action === "removeApp");
    assert.ok(removeStep !== undefined, "本地计划应识别删除受管程序");
    assert.equal(removeStep.action_plan.risk, "high");
    assert.equal(removeStep.action_plan.requires_confirmation, true, "删除类动作必须需要二次确认");
    assert.equal(removeStep.action_plan.target, "demo-app");
    const planMessage = planned.messages.find((message) => message.role === "supervisor" && message.kind === "plan");
    assert.ok(planMessage !== undefined);
    assert.match(planMessage.text, /需人工确认/u);
    assert.equal(planned.status, "active");
  } finally {
    box.cleanup();
  }
});

test("系统动作执行（autoApprove、非危险）：fake SystemActions 被真实调用并留证/审计", async () => {
  const fake = makeSystemActionsFake();
  const box = makeEngine({ engineOptions: { autoApprove: true, systemActions: fake.actions } });
  try {
    const session = box.engine.createSession({ goal: "列出受管程序", kind: "system" });
    await box.engine.sendMessage(session.id, "列出受管程序");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].name, "listApps");

    const supervisorTurns = box.engine.getAgentTranscripts(session.id, "supervisor");
    assert.ok(supervisorTurns.length >= 2, "应有计划轮次 + 系统动作轮次");
    const actionTurn = supervisorTurns.find((turn) => turn.input_summary.includes("listApps"));
    assert.ok(actionTurn !== undefined);
    assert.equal(actionTurn.status, "done");
    assert.ok(actionTurn.evidence_refs.length >= 1);
    assert.ok(actionTurn.detail.includes("系统动作"));
    const evidence = box.engine.getRunDetail(session.id).evidence;
    assert.ok(evidence.some((item) => item.path.includes("system-actions/")), "系统动作必须写证据文件");
    assert.ok(box.engine.auditLog().some((entry) => entry.action === "system.listApps" && entry.result === "ok"));
  } finally {
    box.cleanup();
  }
});

test("危险动作未确认不执行：autoApprove 也不能绕过删除确认，approve 后才执行", async () => {
  const fake = makeSystemActionsFake();
  const box = makeEngine({ engineOptions: { autoApprove: true, systemActions: fake.actions } });
  try {
    const session = box.engine.createSession({ goal: "删除 demo-app 程序", kind: "system" });
    await box.engine.sendMessage(session.id, "删除 demo-app 程序");
    const paused = await box.engine.startProject(session.id);
    assert.equal(paused.status, "paused");
    assert.equal(fake.calls.length, 0, "高危动作未确认前绝不能调用 SystemActions");
    assert.ok(paused.messages.some((message) => message.kind === "approval" && /需要确认/u.test(message.text)));
    const removeStep = paused.plan.find((step) => step.action === "removeApp");
    assert.equal(removeStep.action_plan.requires_confirmation, true);

    // 未确认时 runStep 也不能执行
    await box.engine.runStep(session.id);
    assert.equal(fake.calls.length, 0);

    const approved = box.engine.decideApproval(session.id, removeStep.step, "approve", "human:owner");
    assert.equal(approved.status, "running");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].name, "removeApp");
    assert.equal(fake.calls[0].args, "demo-app");
    const actionTurn = box.engine.getAgentTranscripts(session.id, "supervisor").find((turn) => turn.input_summary.includes("removeApp"));
    assert.ok(actionTurn.detail.includes("确认人：human:owner"));
  } finally {
    box.cleanup();
  }
});

test("危险动作被驳回：不执行并阻塞会话", async () => {
  const fake = makeSystemActionsFake();
  const box = makeEngine({ engineOptions: { autoApprove: true, systemActions: fake.actions } });
  try {
    const session = box.engine.createSession({ goal: "删除 demo-app 程序", kind: "system" });
    await box.engine.sendMessage(session.id, "删除 demo-app 程序");
    const paused = await box.engine.startProject(session.id);
    const removeStep = paused.plan.find((step) => step.action === "removeApp");
    const blocked = box.engine.decideApproval(session.id, removeStep.step, "reject", "human:owner");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.plan.find((step) => step.action === "removeApp").status, "blocked");
    assert.equal(fake.calls.length, 0);
    assert.ok(box.engine.auditLog().some((entry) => entry.action === "approval.decide" && entry.result === "blocked"));
  } finally {
    box.cleanup();
  }
});

test("supervisor 委派项目：生成 conductor 子会话（parent_id/child_sessions + fake hook）", async () => {
  const fake = makeSystemActionsFake();
  const box = makeEngine({ engineOptions: { autoApprove: true, systemActions: fake.actions } });
  try {
    const supervisor = box.engine.createSession({ goal: "委派项目：做报价单页面", kind: "system" });
    await box.engine.sendMessage(supervisor.id, "委派项目：做报价单页面");
    const done = await box.engine.startProject(supervisor.id);
    assert.equal(done.status, "done");

    assert.ok(Array.isArray(done.child_sessions) && done.child_sessions.length === 1);
    const childId = done.child_sessions[0];
    const child = box.engine.getSession(childId);
    assert.equal(child.kind, "project", "委派出的子会话必须是 conductor/project 会话");
    assert.equal(child.parent_id, supervisor.id);
    assert.match(child.goal, /报价单|项目/u);
    assert.equal(child.status, "active");
    assert.ok(fake.calls.some((call) => call.name === "delegateProject" && call.args.sessionId === childId));

    // 子会话可继续由 conductor 拆解执行（project 会话行为不变）
    await box.engine.sendMessage(childId, child.goal);
    const childDone = await box.engine.startProject(childId);
    assert.equal(childDone.status, "done");
    assert.ok(childDone.project_id !== undefined);
    assert.ok(box.engine.getRunDetail(childId).evidence.some((item) => item.title === "deliverable.html"));

    // project 会话不能反向委派 supervisor
    assert.throws(() => box.engine.delegateProject(childId, "再拆一个项目"), OrchestratorValidationError);
  } finally {
    box.cleanup();
  }
});

test("模型/提示词切换作为 supervisor 动作：调用 ConfigBridge 并记录 turns/证据", async () => {
  const bridgeFake = makeConfigBridgeFake();
  const box = makeEngine({ engineOptions: { autoApprove: true, configBridge: bridgeFake.bridge } });
  try {
    const session = box.engine.createSession({
      goal: "切换 operator 模型为 deepseek-chat，并把 conductor 提示词更新为更专业",
      kind: "system",
    });
    await box.engine.sendMessage(session.id, "切换 operator 模型为 deepseek-chat，并把 conductor 提示词更新为更专业");
    const done = await box.engine.startProject(session.id);
    assert.equal(done.status, "done");

    assert.ok(bridgeFake.calls.some((call) => call.method === "setAgentModel" && call.role === "operator"));
    assert.ok(bridgeFake.calls.some((call) => call.method === "setConductorPrompt"));

    const supervisorTurns = box.engine.getAgentTranscripts(session.id, "supervisor");
    assert.ok(supervisorTurns.some((turn) => turn.input_summary.includes("changeAgentModel")));
    assert.ok(supervisorTurns.some((turn) => turn.input_summary.includes("setPrompt")));
    const evidence = box.engine.getRunDetail(session.id).evidence;
    assert.ok(evidence.some((item) => item.title === "step-1-changeAgentModel.json" || item.title.includes("changeAgentModel")));
    assert.ok(box.engine.auditLog().some((entry) => entry.action === "system.changeAgentModel"));
  } finally {
    box.cleanup();
  }
});

test("supervisor 读取全部日志/记录：readLogs 动作 + engine.readLogs 快照", async () => {
  const box = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const project = box.engine.createSession({ goal: "帮我做一个页面" });
    await box.engine.sendMessage(project.id, "帮我做一个页面");

    const supervisor = box.engine.createSession({ goal: "读取全部日志", kind: "system" });
    await box.engine.sendMessage(supervisor.id, "读取全部日志");
    const done = await box.engine.startProject(supervisor.id);
    assert.equal(done.status, "done");
    const actionTurn = box.engine.getAgentTranscripts(supervisor.id, "supervisor").find((turn) => turn.input_summary.includes("readLogs"));
    assert.ok(actionTurn !== undefined);
    assert.match(actionTurn.output_summary, /会话 \d+ 个，审计 \d+ 条/u);

    const records = box.engine.readLogs(supervisor.id);
    assert.ok(records.sessions.length >= 2);
    assert.ok(records.audit.length >= 1);
    assert.ok(records.sessions.some((item) => item.kind === "system"));
    assert.ok(records.sessions.some((item) => item.kind === "project"));
    assert.ok(records.generated_at.length > 0);
    assert.ok(existsSync(box.engine.getSession(supervisor.id).evidence_dir));
  } finally {
    box.cleanup();
  }
});

test("system 与 project 行为隔离：system 不执行项目交付动作，project 不产生系统动作文件", async () => {
  const fake = makeSystemActionsFake();
  const systemBox = makeEngine({ engineOptions: { autoApprove: true, systemActions: fake.actions } });
  const projectBox = makeEngine({ engineOptions: { autoApprove: true } });
  try {
    const systemSession = systemBox.engine.createSession({ goal: "列出受管程序", kind: "system" });
    await systemBox.engine.sendMessage(systemSession.id, "列出受管程序");
    const systemDone = await systemBox.engine.startProject(systemSession.id);
    assert.equal(systemDone.status, "done");
    const systemEvidence = systemBox.engine.getRunDetail(systemSession.id).evidence;
    assert.ok(!systemEvidence.some((item) => item.title === "deliverable.html"), "system 会话不得执行 conductor 的项目动作");
    assert.ok(systemEvidence.some((item) => item.path.includes("system-actions/")));

    const projectSession = projectBox.engine.createSession({ goal: "帮我做一个页面" });
    await projectBox.engine.sendMessage(projectSession.id, "帮我做一个页面");
    const projectDone = await projectBox.engine.startProject(projectSession.id);
    assert.equal(projectDone.status, "done");
    const projectEvidence = projectBox.engine.getRunDetail(projectSession.id).evidence;
    assert.ok(projectEvidence.some((item) => item.title === "deliverable.html"));
    assert.ok(!projectEvidence.some((item) => item.path.includes("system-actions/")), "project 会话不得产生系统动作证据");
  } finally {
    systemBox.cleanup();
    projectBox.cleanup();
  }
});

test("system 计划解析（模型 JSON）与 SYSTEM_ACTIONS 风险分级", async () => {
  const parsed = parseSystemPlan(
    '```json\n{"title":"系统计划","steps":[{"action":"removeApp","target":"demo-app","summary":"删除程序"},{"action":"listApps","summary":"列程序"},{"action":"hackSystem","target":"x"}]}\n```',
  );
  assert.ok(parsed !== null);
  assert.equal(parsed.steps.length, 2, "非法动作必须被过滤");
  assert.equal(parsed.steps[0].action, "removeApp");
  assert.equal(parsed.steps[0].target, "demo-app");
  assert.equal(parsed.steps[0].risk, "high");
  assert.equal(parsed.steps[1].risk, "low");
  assert.equal(parseSystemPlan("自然语言没有 JSON"), null);

  const local = buildLocalSystemPlan("删除 demo-app 程序并列出受管程序");
  assert.ok(local.steps.some((step) => step.action === "removeApp"));
  assert.ok(local.steps.some((step) => step.action === "listApps"));
  assert.equal(riskForSystemAction("removeApp"), "high");
  assert.equal(riskForSystemAction("removePlugin"), "high");
  assert.equal(riskForSystemAction("listApps"), "low");
  assert.equal(riskForSystemAction("delegateProject"), "medium");
  assert.ok(SYSTEM_ACTIONS.includes("delegateProject"));
  assert.ok(SYSTEM_ACTIONS.includes("changeAgentModel"));
  assert.ok(estimateTokens([{ role: "user", content: "你好世界" }]) >= 1);
  assert.ok(FIXED_ISO.length > 0);
});
