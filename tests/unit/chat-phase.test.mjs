/**
 * v1.5.2：消息分相（思考过程折叠/最终结果可见）、工具卡合并、等待审批、系统动作审批、追加消息。
 * 全部使用 fake ChatTools + 临时目录，零网络。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChatEngine,
  applyMessagePhases,
  splitPartsByPhase,
  mergeToolParts,
} from "../../dist/packages/steward-chat/src/index.js";

function makeTools(overrides = {}) {
  const ok = (tool, summary, parts = []) => Promise.resolve({ tool, ok: true, summary, parts });
  const base = {
    systemSummary: () => ok("systemSummary", "系统正常：程序 3 个", [{ type: "data", data: { title: "系统状态", items: [{ label: "程序", value: "3" }] } }]),
    listRuns: () => ok("listRuns", "运行 1 个", [{ type: "data", data: { title: "运行", items: [{ label: "run", value: "run-1" }] } }]),
    runDetail: () => ok("runDetail", "run 详情"),
    listArtifacts: () => ok("listArtifacts", "产物 2 个", [
      { type: "artifact", artifact: { id: "a1", title: "a.md", kind: "markdown", size: 10 } },
      { type: "artifact", artifact: { id: "a2", title: "b.md", kind: "markdown", size: 20 } },
    ]),
    artifactPreview: () => ok("artifactPreview", "产物内容"),
    listReports: () => ok("listReports", "报告 1 份", [{ type: "report", report: { id: "r1", title: "报告1", markdown: "# 报告", created_at: "2026-10-31T00:00:00.000Z" } }]),
    reportContent: () => ok("reportContent", "报告内容"),
    runMetrics: () => ok("runMetrics", "Token 100"),
    readLogs: () => ok("readLogs", "日志"),
    configSummary: () => ok("configSummary", "配置"),
    ledgerSummary: () => ok("ledgerSummary", "账本"),
    agentsSummary: () => ok("agentsSummary", "智能体"),
    executeGoal: async (_goal, onPart) => {
      onPart({ type: "thinking", text: "正在执行项目…" });
      onPart({ type: "tool_call", tool: "operator.build_deliverable", input: { step: 1 }, callId: "c1", status: "running" });
      onPart({ type: "artifact", artifact: { id: "art-1", title: "out.md", kind: "markdown", size: 5 } });
      onPart({ type: "report", report: { id: "rep-1", title: "报告", markdown: "# 报告", created_at: "2026-10-31T00:00:00.000Z" } });
      return { ok: true, run_id: "run-demo-1", session_id: "sess-demo-1", summary: "项目已完成" };
    },
    harnessTask: async (_task, onPart) => {
      onPart({ type: "thinking", text: "harness 思考" });
      return { ok: true, summary: "harness 完成" };
    },
    runAgentTask: async (role, task, onPart) => {
      onPart({ type: "thinking", text: `${role} 独立会话思考…` });
      onPart({ type: "tool_call", tool: "runAgentTask", input: { agent_role: role, task }, callId: "agent-1", status: "running" });
      onPart({ type: "tool_result", tool: "runAgentTask", ok: true, summary: "完成", callId: "agent-1" });
      return { ok: true, summary: `${role} 独立完成：${task}`, agent_role: role, session_id: `agent-${role}-` };
    },
    approve: (runId, step, decision) => Promise.resolve({ tool: "approve", ok: true, summary: `已${decision} ${runId} 第 ${step} 步`, parts: [] }),
    systemActionPreview: (action) => Promise.resolve({ tool: "systemActionPreview", ok: true, summary: "系统动作待确认", parts: [
      { type: "approval", approval: { run_id: "system:req-1", step: 0, risk: "high", summary: action } },
    ] }),
    confirmSystemAction: (approvalId, decision) => Promise.resolve({ tool: "confirmSystemAction", ok: true, summary: `已${decision} ${approvalId}`, parts: [] }),
    ...overrides,
  };
  return base;
}

function makeEngine(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "chat-phase-"));
  const engine = new ChatEngine({ tools: makeTools(overrides), root });
  return { engine, root };
}

test("applyMessagePhases：工具合并 + 分相 + 最终结果 + 思考摘要（旧消息兼容）", () => {
  const message = {
    id: "m1",
    conversation_id: "c1",
    role: "assistant",
    at: "2026-10-31T00:00:00.000Z",
    parts: [
      { type: "thinking", text: "想想" },
      { type: "tool_call", tool: "systemSummary", input: {}, callId: "call-1", status: "running" },
      { type: "tool_result", tool: "systemSummary", ok: true, summary: "结果 OK", callId: "call-1" },
      { type: "data", data: { title: "数据", items: [] } },
      { type: "text", text: "中间话" },
      { type: "text", text: "最终结论" },
      { type: "artifact", artifact: { id: "a1", title: "a.md", kind: "markdown", size: 3 } },
      { type: "approval", approval: { run_id: "run-1", step: 2, risk: "high", summary: "需审批" } },
    ],
  };
  const phased = applyMessagePhases(message);
  assert.equal(phased.parts.filter((part) => part.type === "tool_result").length, 0, "tool_result 应合并进 tool_call");
  const tool = phased.parts.find((part) => part.type === "tool_call");
  assert.equal(tool.status, "ok");
  assert.equal(tool.result_preview, "结果 OK");
  assert.equal(phased.parts.find((part) => part.type === "thinking").phase, "thinking");
  assert.equal(phased.parts.find((part) => part.type === "data").phase, "thinking");
  assert.equal(phased.parts.filter((part) => part.type === "text" && part.phase === "result").length, 1);
  assert.equal(phased.parts.find((part) => part.type === "artifact").phase, "result");
  assert.equal(phased.parts.find((part) => part.type === "approval").phase, "result");
  assert.equal(phased.result_text, "最终结论");
  assert.equal(phased.thinking_summary.tool_calls, 1);
  assert.equal(phased.thinking_summary.artifacts, 1);
});

test("splitPartsByPhase：思考/交付物/结果/审批分开，无 phase 也能分类", () => {
  const parts = [
    { type: "tool_call", tool: "listRuns", input: {} },
    { type: "tool_result", tool: "listRuns", ok: true, summary: "ok" },
    { type: "text", text: "最终结果" },
    { type: "report", report: { id: "r1", title: "报告", markdown: "", created_at: "" } },
    { type: "error", message: "失败" },
  ];
  const split = splitPartsByPhase(parts);
  assert.equal(split.thinking.filter((part) => part.type === "tool_call").length, 1);
  assert.equal(split.thinking.some((part) => part.type === "tool_result"), false);
  assert.equal(split.deliverables.length, 1);
  assert.equal(split.results.length, 1);
  assert.equal(split.errors.length, 1);
});

test("查询消息：思考过程 + 单卡工具 + 数据卡折叠 + 最终结果可见；查询不产生产物记忆噪音", async () => {
  const { engine, root } = makeEngine();
  try {
    const conversation = engine.createConversation();
    const { assistantMessage } = await engine.send(conversation.id, "查看系统状态");
    assert.equal(assistantMessage.status, "done");
    assert.ok(assistantMessage.parts.some((part) => part.type === "thinking" && part.phase === "thinking"));
    assert.ok(assistantMessage.parts.some((part) => part.type === "tool_call" && part.status === "ok"));
    assert.ok(assistantMessage.parts.some((part) => part.type === "data" && part.phase === "thinking"));
    assert.ok(assistantMessage.result_text?.includes("系统正常"));
    const memories = engine.listMemory();
    assert.equal(memories.some((entry) => entry.kind === "artifact" || entry.kind === "report"), false, "查询不应产生产物/报告记忆");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("查询产物：产物卡片属于交付物（结果区），思考区不含卡片", async () => {
  const { engine, root } = makeEngine();
  try {
    const conversation = engine.createConversation();
    const { assistantMessage } = await engine.send(conversation.id, "列出所有产物");
    const split = splitPartsByPhase(assistantMessage.parts);
    assert.ok(split.deliverables.filter((part) => part.type === "artifact").length >= 2);
    assert.equal(split.thinking.some((part) => part.type === "artifact"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("等待审批：executeGoal 返回 pending_approval → 审批卡可见、不是失败、result_text 提示等待", async () => {
  const { engine, root } = makeEngine({
    executeGoal: async () => ({
      ok: false,
      run_id: "run-pending-1",
      session_id: "sess-pending-1",
      summary: "等待审批第 2 步",
      pending_approval: { run_id: "run-pending-1", step: 2, risk: "high", summary: "对外发送邮件" },
    }),
  });
  try {
    const conversation = engine.createConversation();
    const { assistantMessage } = await engine.send(conversation.id, "帮我执行这个项目");
    assert.equal(assistantMessage.status, "done");
    assert.equal(assistantMessage.parts.some((part) => part.type === "error"), false, "等待审批不应显示失败");
    assert.ok(assistantMessage.parts.some((part) => part.type === "approval" && part.approval.step === 2));
    assert.ok(assistantMessage.result_text?.includes("等待"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendAssistantMessage：审批后续消息可持久化并带分相", () => {
  const { engine, root } = makeEngine();
  try {
    const conversation = engine.createConversation();
    const message = engine.appendAssistantMessage(conversation.id, [
      { type: "text", text: "✅ 已批准，Run 继续执行" },
      { type: "data", data: { title: "执行数据", items: [{ label: "Token", value: "10" }] } },
    ]);
    assert.equal(message.status, "done");
    assert.ok(message.result_text?.includes("已批准"));
    const view = engine.getConversation(conversation.id);
    assert.ok(view !== null);
    assert.equal(view.messages.some((item) => item.id === message.id && item.result_text !== undefined), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("系统动作审批：批准 system:req-1 走 confirmSystemAction（不调用 run approve）", async () => {
  let confirmCalls = 0;
  let approveCalls = 0;
  const { engine, root } = makeEngine({
    confirmSystemAction: async (approvalId, decision) => {
      confirmCalls += 1;
      return { tool: "confirmSystemAction", ok: true, summary: `系统动作 ${decision} ${approvalId}`, parts: [] };
    },
    approve: async () => {
      approveCalls += 1;
      return { tool: "approve", ok: true, summary: "run approve", parts: [] };
    },
  });
  try {
    const conversation = engine.createConversation();
    const { assistantMessage } = await engine.send(conversation.id, "批准 system:req-1 第 0 步");
    assert.equal(approveCalls, 0, "系统审批不应调用 run approve");
    assert.equal(confirmCalls, 1, "应调用 confirmSystemAction");
    assert.ok(assistantMessage.result_text?.includes("系统动作"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("点名发送：@operator 路由到该智能体独立执行（runAgentTask），任务文本去掉点名前缀", async () => {
  const calls = [];
  const { engine, root } = makeEngine({
    runAgentTask: async (role, task) => {
      calls.push({ role, task });
      return { ok: true, summary: `${role} 完成：${task}`, agent_role: role };
    },
  });
  try {
    const conversation = engine.createConversation();
    const { assistantMessage } = await engine.send(conversation.id, "@operator 写一份周报");
    assert.equal(calls.length, 1, "应调用 runAgentTask 一次");
    assert.equal(calls[0].role, "operator");
    assert.equal(calls[0].task, "写一份周报", "任务文本应去掉 @operator 前缀");
    assert.ok(assistantMessage.parts.some((part) => part.type === "tool_call" && part.tool === "runAgentTask"));
    assert.ok(assistantMessage.result_text?.includes("operator 完成"));
    assert.ok(assistantMessage.parts.some((part) => part.type === "data" && part.data.title.includes("独立执行结果")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("点名别名：请财务看一下账本 → agent_direct/finance", () => {
  const { engine, root } = makeEngine();
  try {
    const analysis = engine.classify("请财务看一下账本");
    assert.equal(analysis.intent, "agent_direct");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mergeToolParts：无 callId 时按同名工具合并", () => {
  const merged = mergeToolParts([
    { type: "tool_call", tool: "readLogs", input: {} },
    { type: "tool_call", tool: "listRuns", input: {} },
    { type: "tool_result", tool: "listRuns", ok: true, summary: "运行 OK" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].type, "tool_call");
  assert.equal(merged[1].status, "ok");
  assert.equal(merged[1].result_preview, "运行 OK");
});
