/**
 * v1.5.1-A：steward-chat（对话式 AI 总控内核）单元测试。
 *
 * 零网络 / 零真实模型：fake ChatTools + 临时目录，覆盖
 * 意图分类（18 类）、查询回复卡片、任务流式 onPart、审批卡、危险动作不执行、
 * 记忆抽取/去重/召回/删除/上限/持久化、多会话、标题、空消息/不存在会话、未知问题建议。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ChatEngine,
  ChatError,
  ChatStore,
  analyzeIntent,
  classifyIntent,
  recallMemories,
  tokenizeForRecall,
} from "../../dist/packages/steward-chat/src/index.js";

// ---------------------------------------------------------------------------
// fake ChatTools（记录调用；query 类返回 summary+卡片；任务类流式 onPart）
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ISO = "2026-10-31T08:00:00.000Z";
const dataCard = (title, items) => ({ type: "data", data: { title, items } });

function makeFakeTools() {
  const calls = {
    systemSummary: [],
    listRuns: [],
    runDetail: [],
    listArtifacts: [],
    artifactPreview: [],
    listReports: [],
    reportContent: [],
    runMetrics: [],
    readLogs: [],
    configSummary: [],
    ledgerSummary: [],
    agentsSummary: [],
    executeGoal: [],
    harnessTask: [],
    approve: [],
    systemActionPreview: [],
  };
  const tools = {
    async systemSummary() {
      calls.systemSummary.push({});
      return {
        tool: "systemSummary",
        ok: true,
        summary: "系统正常：2 个程序运行中，1 个插件启用",
        parts: [dataCard("系统状态", [{ label: "程序", value: "2 运行" }, { label: "插件", value: "1 启用" }])],
      };
    },
    async listRuns(limit) {
      calls.listRuns.push(limit);
      return {
        tool: "listRuns",
        ok: true,
        summary: "最近 2 个 run：run-demo-1（等待审批）、run-demo-2（已完成）",
        parts: [
          dataCard("Run 列表", [
            { label: "run-demo-1", value: "awaiting_approval" },
            { label: "run-demo-2", value: "done" },
          ]),
        ],
      };
    },
    async runDetail(runId) {
      calls.runDetail.push(runId);
      return {
        tool: "runDetail",
        ok: true,
        summary: `run ${runId ?? "（最新）"}：3/5 步，当前等待审批`,
        parts: [dataCard("Run 详情", [{ label: "run_id", value: runId ?? "（最新）" }, { label: "进度", value: "3/5" }])],
      };
    },
    async listArtifacts(query) {
      calls.listArtifacts.push(query);
      return {
        tool: "listArtifacts",
        ok: true,
        summary: "2 个产物：page.html（html）、plan.md（markdown）",
        parts: [
          { type: "artifact", artifact: { id: "art-1", title: "page.html", kind: "html", size: 2048, preview_text: "<html>…</html>" } },
          { type: "artifact", artifact: { id: "art-2", title: "plan.md", kind: "markdown", size: 1238 } },
        ],
      };
    },
    async artifactPreview(id) {
      calls.artifactPreview.push(id);
      return {
        tool: "artifactPreview",
        ok: true,
        summary: `产物 ${id} 预览：page.html（2 KB）`,
        parts: [
          {
            type: "artifact",
            artifact: { id, title: "page.html", kind: "html", size: 2048, preview_text: "<html>…</html>", preview_url: "/api/artifacts/art-1" },
          },
        ],
      };
    },
    async listReports(query) {
      calls.listReports.push(query);
      return {
        tool: "listReports",
        ok: true,
        summary: "最近 1 份报告：operator · Harness 报告",
        parts: [
          {
            type: "report",
            report: { id: "rep-1", title: "operator · Harness 报告", markdown: "# 报告", created_at: ISO, agent_role: "operator" },
          },
        ],
      };
    },
    async reportContent(id) {
      calls.reportContent.push(id);
      return {
        tool: "reportContent",
        ok: true,
        summary: `报告 ${id} 内容已加载`,
        parts: [{ type: "report", report: { id, title: "operator · Harness 报告", markdown: "# 报告\n\n最终结论：已完成。", created_at: ISO } }],
      };
    },
    async runMetrics(runId) {
      calls.runMetrics.push(runId);
      return {
        tool: "runMetrics",
        ok: true,
        summary: `Token 用量：输入 21000 / 输出 5200 / 合计 28950（${runId ?? "全部 run"}）`,
        parts: [dataCard("Metrics", [{ label: "total_tokens", value: "28950" }, { label: "耗时", value: "8.2s" }])],
      };
    },
    async readLogs(limit) {
      calls.readLogs.push(limit);
      return {
        tool: "readLogs",
        ok: true,
        summary: "最近 3 条日志：无错误",
        parts: [dataCard("日志", [{ label: "audit", value: "app.list 只读" }])],
      };
    },
    async configSummary() {
      calls.configSummary.push({});
      return {
        tool: "configSummary",
        ok: true,
        summary: "配置摘要：默认模型 deepseek-chat，审批策略 auto_low_risk",
        parts: [dataCard("配置", [{ label: "approval_mode", value: "auto_low_risk" }])],
      };
    },
    async ledgerSummary() {
      calls.ledgerSummary.push({});
      return {
        tool: "ledgerSummary",
        ok: true,
        summary: "账本：本月收款 880 元，支出 0 元",
        parts: [dataCard("账本", [{ label: "收款", value: "¥880" }])],
      };
    },
    async agentsSummary() {
      calls.agentsSummary.push({});
      return {
        tool: "agentsSummary",
        ok: true,
        summary: "智能体：conductor / operator / harness / reviewer（4 个）",
        parts: [dataCard("智能体", [{ label: "harness", value: "编码代理" }])],
      };
    },
    async executeGoal(goal, onPart) {
      calls.executeGoal.push(goal);
      onPart({ type: "thinking", text: "项目总调度正在拆解目标…" });
      await delay(5);
      onPart({ type: "tool_call", tool: "orchestrator.startProject", input: { goal } });
      await delay(5);
      onPart({
        type: "artifact",
        artifact: { id: "art-run-1", title: "deliverable.md", kind: "markdown", size: 512, run_id: "run-demo-9" },
      });
      onPart({
        type: "report",
        report: { id: "rep-run-1", title: "项目交付报告", markdown: "# 项目交付报告", created_at: ISO, run_id: "run-demo-9" },
      });
      return { ok: true, run_id: "run-demo-9", session_id: "session-demo-9", summary: "项目已完成：3/3 步，产物已交付" };
    },
    async harnessTask(task, onPart) {
      calls.harnessTask.push(task);
      onPart({ type: "thinking", text: "harness 思考：先写 plan.md" });
      await delay(5);
      onPart({ type: "tool_call", tool: "write", input: { path: "plan.md" } });
      onPart({ type: "artifact", artifact: { id: "art-h-1", title: "plan.md", kind: "markdown", size: 1238, preview_text: "# Plan" } });
      onPart({ type: "report", report: { id: "rep-h-1", title: "harness · Harness 报告", markdown: "# harness 报告", created_at: ISO } });
      return { ok: true, summary: "harness 已完成：plan.md（1238B）" };
    },
    async approve(runId, step, decision) {
      calls.approve.push({ runId, step, decision });
      return {
        tool: "approve",
        ok: true,
        summary: `已${decision === "approve" ? "批准" : "驳回"} run ${runId} 第 ${step} 步`,
        parts: [dataCard("审批结果", [{ label: "run", value: runId }, { label: "step", value: String(step) }])],
      };
    },
    async systemActionPreview(action, target) {
      calls.systemActionPreview.push({ action, target });
      return {
        tool: "systemActionPreview",
        ok: true,
        summary: `${action} ${target ?? ""} 需要人工确认（高危不可逆）`.trim(),
        parts: [
          {
            type: "approval",
            approval: {
              run_id: "run-demo-7",
              step: 1,
              risk: "high",
              summary: `删除程序 ${target ?? "demo-app"}`,
              reason: "高危不可逆操作，必须人工确认",
            },
          },
        ],
      };
    },
  };
  return { tools, calls };
}

function makeEngine(options = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "steward-chat-"));
  const fake = options.fake ?? makeFakeTools();
  const engine = new ChatEngine({
    tools: fake.tools,
    root,
    now: () => new Date(ISO),
    ...(options.maxMemoryEntries === undefined ? {} : { maxMemoryEntries: options.maxMemoryEntries }),
    ...(options.dshEnabled === undefined ? {} : { dshEnabled: options.dshEnabled }),
  });
  return { engine, fake, root };
}

function partTypes(message) {
  return message.parts.map((part) => part.type);
}

function findPart(message, type) {
  return message.parts.find((part) => part.type === type);
}

// ---------------------------------------------------------------------------
// 1) 意图分类（≥15 类）
// ---------------------------------------------------------------------------

test("意图分类：18 类规则路由全部可命中（含危险动作/审批/项目/harness/记忆/闲聊）", () => {
  const cases = [
    ["查看系统状态", "system"],
    ["列出最近的运行", "runs"],
    ["看看 run-demo-1 的详情", "run_detail"],
    ["列出所有产物", "artifacts"],
    ["预览产物 art-1", "artifact_preview"],
    ["有哪些报告", "reports"],
    ["打开报告 rep-1 的内容", "report_content"],
    ["token 用量多少", "metrics"],
    ["看看最近日志", "logs"],
    ["当前配置是什么", "config"],
    ["账本余额", "ledger"],
    ["智能体列表", "agents"],
    ["帮我做一个报价页面项目", "execute_goal"],
    ["写个 plan.md 文件", "harness_task"],
    ["批准 run-demo-1 第 2 步", "approve"],
    ["驳回 run-demo-1 第 3 步", "approve"],
    ["删除程序 demo-app", "danger_action"],
    ["付款给客户 880 元", "danger_action"],
    ["你还记得我的偏好吗", "memory"],
    ["记住我的偏好是回复简洁中文", "memory"],
    ["今天天气怎么样", "chat"],
  ];
  const seen = new Set();
  for (const [text, expected] of cases) {
    const result = classifyIntent(text);
    assert.equal(result.intent, expected, `「${text}」应分类为 ${expected}，实际 ${result.intent}`);
    assert.ok(result.confidence > 0 && result.confidence <= 1);
    seen.add(result.intent);
  }
  assert.ok(seen.size >= 15, `应覆盖 ≥15 类意图，实际 ${seen.size}`);
  assert.equal(classifyIntent("").intent, "chat");
  assert.equal(analyzeIntent("删除程序 demo-app").entities.action, "删除");
  assert.ok(String(analyzeIntent("删除程序 demo-app").entities.target).includes("demo-app"));
  assert.equal(analyzeIntent("批准 run-demo-1 第 2 步").entities.step, 2);
  assert.equal(analyzeIntent("驳回 run-demo-1 第 3 步").entities.decision, "reject");
});

// ---------------------------------------------------------------------------
// 2) 查询类：AI 自己查系统（0 token，返回摘要 + 内嵌卡片）
// ---------------------------------------------------------------------------

test("查询回复：系统状态 → 规则回答（model_mode=rule）+ text 摘要 + data 卡片，无模型调用", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const { userMessage, assistantMessage } = await engine.send(conversation.id, "查看系统状态");
  assert.equal(userMessage.role, "user");
  assert.equal(assistantMessage.role, "assistant");
  assert.equal(assistantMessage.model_mode, "rule");
  assert.equal(assistantMessage.status, "done");
  assert.equal(fake.calls.systemSummary.length, 1);
  const types = partTypes(assistantMessage);
  assert.ok(types.includes("tool_call"), "应展示工具调用卡片");
  // v1.5.2：tool_result 合并进 tool_call（单卡显示状态/结果）。
  assert.ok(assistantMessage.parts.some((part) => part.type === "tool_call" && (part.status === "ok" || part.status === "done" || part.result_preview !== undefined)), "工具卡应带有执行结果");
  assert.ok(types.includes("text"));
  assert.ok(types.includes("data"));
  const text = assistantMessage.parts.find((part) => part.type === "text").text;
  assert.ok(text.includes("系统正常"));
  const data = findPart(assistantMessage, "data").data;
  assert.equal(data.title, "系统状态");
  assert.ok(data.items.length >= 2);
});

test("查询路由：12 个只读工具按问题自动选择（run/产物/报告/metrics/日志/配置/账本/智能体）", async () => {
  const cases = [
    ["列出最近的运行", "listRuns"],
    ["看看 run-demo-1 的详情", "runDetail"],
    ["列出所有产物", "listArtifacts"],
    ["预览产物 art-1", "artifactPreview"],
    ["有哪些报告", "listReports"],
    ["打开报告 rep-1 的内容", "reportContent"],
    ["token 用量多少", "runMetrics"],
    ["看看最近日志", "readLogs"],
    ["当前配置是什么", "configSummary"],
    ["账本余额", "ledgerSummary"],
    ["智能体列表", "agentsSummary"],
    ["查看系统状态", "systemSummary"],
  ];
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  for (const [text, method] of cases) {
    const { assistantMessage } = await engine.send(conversation.id, text);
    assert.equal(fake.calls[method].length, 1, `「${text}」应调用 ${method}`);
    assert.ok(partTypes(assistantMessage).includes("text"), `「${text}」应有文字回答`);
    assert.ok(
      assistantMessage.parts.some((part) => ["data", "artifact", "report"].includes(part.type)),
      `「${text}」应有内嵌卡片`,
    );
  }
  assert.equal(fake.calls.runDetail[0], "run-demo-1");
  assert.equal(fake.calls.artifactPreview[0], "art-1");
  assert.equal(fake.calls.reportContent[0], "rep-1");
});

// ---------------------------------------------------------------------------
// 3) 任务类：项目执行器 / DSH harness（流式 onPart）
// ---------------------------------------------------------------------------

test("execute_goal：流式 onPart 实时写入同一条消息，含 thinking/工具/产物/报告卡片与总结", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const streamed = [];
  const goal = "帮我做一个报价页面项目";
  const { assistantMessage } = await engine.send(conversation.id, goal, (part) => streamed.push(part));
  assert.deepEqual(fake.calls.executeGoal, [goal]);
  assert.equal(assistantMessage.model_mode, "local_fallback");
  assert.equal(assistantMessage.status, "done");
  const types = partTypes(assistantMessage);
  for (const expected of ["text", "thinking", "tool_call", "artifact", "report", "data"]) {
    assert.ok(types.includes(expected), `任务消息应包含 ${expected} 卡片`);
  }
  assert.ok(streamed.length >= 5, "onPart 应实时回调多段");
  // v1.5.2：tool_result 会合并进 tool_call（单卡），因此流式序列只校验类型覆盖与最终分相。
  const mergedTypes = new Set(types);
  for (const streamedPart of streamed) {
    assert.ok(mergedTypes.has(streamedPart.type) || streamedPart.type === "tool_result", `未知流式片段类型：${String(streamedPart.type)}`);
  }
  assert.ok(assistantMessage.parts.some((part) => part.phase === "thinking"), "应有思考过程分相");
  assert.ok(assistantMessage.result_text !== undefined && assistantMessage.result_text.length > 0, "应有最终结果文本");
  const summaryText = assistantMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.ok(summaryText.includes("项目已完成"));
  // 任务结果自动写入长期记忆（run 引用）
  const memories = engine.listMemory({ kind: "run" });
  assert.ok(memories.some((entry) => entry.content.includes("run-demo-9")), "应记住 run 摘要");
});

test("harness_task：真实 DSH harness 流式执行（model_mode=harness），产物/报告卡片可见", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const streamed = [];
  const { assistantMessage } = await engine.send(conversation.id, "写个 plan.md 文件", (part) => streamed.push(part));
  assert.equal(fake.calls.harnessTask.length, 1);
  assert.equal(assistantMessage.model_mode, "harness");
  const types = partTypes(assistantMessage);
  for (const expected of ["text", "thinking", "tool_call", "artifact", "report"]) {
    assert.ok(types.includes(expected), `harness 消息应包含 ${expected}`);
  }
  const artifact = findPart(assistantMessage, "artifact").artifact;
  assert.equal(artifact.title, "plan.md");
  assert.equal(artifact.kind, "markdown");
  assert.ok(streamed.length >= 4);
});

test("dshEnabled=false：harness 任务提示不可用，不调用模型/harness", async () => {
  const { engine, fake } = makeEngine({ dshEnabled: false });
  const conversation = engine.createConversation();
  const { assistantMessage } = await engine.send(conversation.id, "写个 plan.md 文件");
  assert.equal(fake.calls.harnessTask.length, 0);
  assert.equal(assistantMessage.model_mode, "rule");
  const text = assistantMessage.parts.find((part) => part.type === "text").text;
  assert.ok(text.includes("未启用"));
});

// ---------------------------------------------------------------------------
// 4) 危险动作 / 审批
// ---------------------------------------------------------------------------

test("危险动作：只返回审批卡（approval 卡片），绝不调用 executeGoal/harnessTask/approve", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const { assistantMessage } = await engine.send(conversation.id, "删除程序 demo-app");
  assert.equal(fake.calls.systemActionPreview.length, 1);
  assert.equal(fake.calls.systemActionPreview[0].action, "删除");
  assert.ok(String(fake.calls.systemActionPreview[0].target).includes("demo-app"));
  assert.equal(fake.calls.executeGoal.length, 0);
  assert.equal(fake.calls.harnessTask.length, 0);
  assert.equal(fake.calls.approve.length, 0);
  const approval = findPart(assistantMessage, "approval");
  assert.ok(approval !== undefined, "必须返回审批卡");
  assert.equal(approval.approval.risk, "high");
  assert.equal(approval.approval.run_id, "run-demo-7");
  const text = assistantMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.ok(text.includes("需要你确认") || text.includes("审批卡"));
});

test("审批：批准/驳回 run 步骤 → 调用 tools.approve，回复审批结果", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const approved = await engine.send(conversation.id, "批准 run-demo-1 第 2 步");
  assert.deepEqual(fake.calls.approve[0], { runId: "run-demo-1", step: 2, decision: "approve" });
  const approvedText = approved.assistantMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.ok(approvedText.includes("批准"));
  const rejected = await engine.send(conversation.id, "驳回 run-demo-1 第 3 步");
  assert.deepEqual(fake.calls.approve[1], { runId: "run-demo-1", step: 3, decision: "reject" });
  assert.equal(rejected.assistantMessage.model_mode, "rule");
});

test("审批信息缺失：不调用 tools.approve，给出可操作提示", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const { assistantMessage } = await engine.send(conversation.id, "批准一下");
  // "批准一下" 命中 approve 规则但缺少 run/step
  assert.equal(fake.calls.approve.length, 0);
  const text = assistantMessage.parts.find((part) => part.type === "text").text;
  assert.ok(text.includes("run"));
  assert.ok(text.includes("步骤"));
});

// ---------------------------------------------------------------------------
// 5) 长期记忆
// ---------------------------------------------------------------------------

test("记忆：显式「记住」抽取偏好并去重（同一内容不重复），可搜索", async () => {
  const { engine } = makeEngine();
  const conversation = engine.createConversation();
  await engine.send(conversation.id, "记住：我的偏好是回复简洁中文");
  const first = engine.listMemory();
  assert.ok(first.length >= 1);
  assert.ok(first.some((entry) => entry.kind === "preference" && entry.content.includes("简洁")));
  await engine.send(conversation.id, "记住：我的偏好是回复简洁中文");
  const second = engine.listMemory();
  assert.equal(second.length, first.length, "同内容记忆不得重复");
  assert.ok(engine.listMemory({ query: "偏好" }).length >= 1);
});

test("记忆召回：回复前用 memoryRecall 注入相关记忆（最多 5 条）到卡片", async () => {
  const { engine } = makeEngine();
  engine.addMemory({ kind: "preference", content: "我的偏好是回复简洁中文", tags: ["偏好"], importance: 3 });
  engine.addMemory({ kind: "project", content: "项目：报价页面（客户 A）", tags: ["项目"], importance: 2 });
  const conversation = engine.createConversation();
  const { assistantMessage } = await engine.send(conversation.id, "你还记得我的偏好吗");
  const text = assistantMessage.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.ok(text.includes("记忆"), "应提到记忆");
  const dataParts = assistantMessage.parts.filter((part) => part.type === "data");
  assert.ok(dataParts.length >= 1);
  assert.ok(dataParts.some((part) => part.data.items.some((item) => item.value.includes("简洁"))));
  const recalled = engine.memoryRecall("你还记得我的偏好吗", 5);
  assert.ok(recalled.length >= 1 && recalled.length <= 5);
  assert.ok(recalled[0].content.includes("简洁"), "相关度最高应是偏好记忆");
});

test("记忆删除与上限：deleteMemory 生效；maxMemoryEntries 超出时丢弃低重要度最旧条目", async () => {
  const { engine } = makeEngine({ maxMemoryEntries: 3 });
  const entry = engine.addMemory({ kind: "note", content: "临时记忆：测试删除", tags: [], importance: 1 });
  assert.equal(engine.deleteMemory(entry.id), true);
  assert.equal(engine.deleteMemory(entry.id), false);
  assert.equal(engine.listMemory({ query: "临时记忆" }).length, 0);

  for (let index = 1; index <= 5; index += 1) {
    engine.addMemory({ kind: "note", content: `记忆 ${index}`, tags: [], importance: 1 });
  }
  const remaining = engine.listMemory();
  assert.equal(remaining.length, 3, "不得超过 maxMemoryEntries");
  assert.ok(remaining.some((item) => item.content === "记忆 5"));
  assert.ok(!remaining.some((item) => item.content === "记忆 1"));
});

// ---------------------------------------------------------------------------
// 6) 多会话 / 标题 / 持久化
// ---------------------------------------------------------------------------

test("多会话：创建/列出/切换/重命名/删除，消息互相隔离", async () => {
  const { engine } = makeEngine();
  const first = engine.createConversation("项目 A");
  const second = engine.createConversation();
  assert.equal(engine.listConversations().length, 2);
  await engine.send(first.id, "查看系统状态");
  await engine.send(second.id, "账本余额");
  const firstView = engine.getConversation(first.id);
  const secondView = engine.getConversation(second.id);
  assert.equal(firstView.messages.length, 2);
  assert.equal(secondView.messages.length, 2);
  assert.ok(firstView.messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("系统正常"))));
  assert.ok(secondView.messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("账本"))));

  const renamed = engine.renameConversation(second.id, "财务会话");
  assert.equal(renamed.title, "财务会话");
  assert.equal(engine.getConversation(second.id).conversation.title, "财务会话");
  assert.equal(engine.deleteConversation(first.id), true);
  assert.equal(engine.getConversation(first.id), null);
  assert.equal(engine.deleteConversation(first.id), false);
  assert.equal(engine.listConversations().length, 1);
});

test("标题：首条消息自动取前 20 字；重命名可覆盖", async () => {
  const { engine } = makeEngine();
  const conversation = engine.createConversation();
  const text = "帮我做一个报价页面并自动交付给客户，包含预算与验收标准";
  await engine.send(conversation.id, text);
  const view = engine.getConversation(conversation.id);
  assert.equal(view.conversation.title, Array.from(text).slice(0, 20).join(""));
  assert.equal(Array.from(view.conversation.title).length, 20);
  engine.renameConversation(conversation.id, "报价页面项目");
  assert.equal(engine.getConversation(conversation.id).conversation.title, "报价页面项目");
});

test("空消息 / 不存在会话：返回明确错误（Error），不会写入脏数据", async () => {
  const { engine } = makeEngine();
  const conversation = engine.createConversation();
  await assert.rejects(() => engine.send(conversation.id, "   "), (error) => error instanceof ChatError && error.code === "INVALID_INPUT");
  await assert.rejects(() => engine.send("conv-does-not-exist", "你好"), (error) => error instanceof ChatError && error.code === "NOT_FOUND");
  assert.equal(engine.getConversation("conv-does-not-exist"), null);
  const view = engine.getConversation(conversation.id);
  assert.equal(view.messages.length, 0);
});

test("持久化：会话/消息/记忆落盘，新引擎重载后仍可列出与继续对话", async () => {
  const root = mkdtempSync(join(tmpdir(), "steward-chat-persist-"));
  const first = makeEngine({ root });
  const conversation = first.engine.createConversation("持久化会话");
  await first.engine.send(conversation.id, "查看系统状态");
  first.engine.addMemory({ kind: "preference", content: "我的偏好是回复简洁中文", tags: ["偏好"], importance: 3 });
  assert.ok(existsSync(join(root, "index.json")));
  assert.ok(existsSync(join(root, "conversations", `${conversation.id}.json`)));
  assert.ok(existsSync(join(root, "memory.json")));

  const second = makeEngine({ root });
  const list = second.engine.listConversations();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "持久化会话");
  const view = second.engine.getConversation(conversation.id);
  assert.equal(view.messages.length, 2);
  const assistant = view.messages[1];
  assert.ok(assistant.parts.some((part) => part.type === "data"));
  assert.ok(second.engine.listMemory().some((entry) => entry.content.includes("简洁")));
  const continued = await second.engine.send(conversation.id, "查看系统状态");
  assert.equal(second.engine.getConversation(conversation.id).messages.length, 4);
  assert.equal(continued.assistantMessage.status, "done");
});

// ---------------------------------------------------------------------------
// 7) 闲聊兜底 / 纯函数
// ---------------------------------------------------------------------------

test("未知问题：走 chat 兜底（0 token，给建议），不调用任何数据工具", async () => {
  const { engine, fake } = makeEngine();
  const conversation = engine.createConversation();
  const { assistantMessage } = await engine.send(conversation.id, "今天天气怎么样");
  assert.equal(assistantMessage.model_mode, "rule");
  const text = assistantMessage.parts.find((part) => part.type === "text").text;
  assert.ok(text.includes("没有完全理解") || text.includes("没有理解") || text.includes("可以"));
  assert.ok(partTypes(assistantMessage).includes("markdown"), "应给出可操作建议");
  const calledAnyTool = Object.values(fake.calls).some((list) => Array.isArray(list) && list.length > 0);
  assert.equal(calledAnyTool, false, "闲聊兜底不应调用数据工具");
});

test("记忆召回纯函数：tokenize/recall 相关度排序（中文 bigram）", () => {
  const tokens = tokenizeForRecall("你还记得我的偏好吗");
  assert.ok(tokens.includes("偏好"));
  assert.ok(tokens.includes("我的"));
  const memories = [
    { id: "m1", kind: "preference", content: "我的偏好是回复简洁中文", tags: ["偏好"], importance: 3, created_at: ISO },
    { id: "m2", kind: "project", content: "项目：报价页面", tags: ["项目"], importance: 2, created_at: ISO },
  ];
  const recalled = recallMemories(memories, "我的偏好是什么", 5);
  assert.equal(recalled[0].id, "m1");
  assert.equal(recallMemories(memories, "完全无关的句子呀", 5).length, 0);
});

test("ChatStore 直接 API：会话索引/消息/记忆持久化与容错", () => {
  const root = mkdtempSync(join(tmpdir(), "steward-chat-store-"));
  const store = new ChatStore(root);
  const conversation = store.createConversation("直接使用");
  store.appendMessage(conversation.id, {
    id: "m-1",
    conversation_id: conversation.id,
    role: "user",
    at: ISO,
    parts: [{ type: "text", text: "你好世界" }],
    status: "done",
  });
  const listed = store.listConversations();
  assert.equal(listed[0].message_count, 1);
  assert.ok(String(listed[0].last_message).includes("你好世界"));
  const memory = store.addMemory({ kind: "note", content: "  项目事实：报价 880 元  ", tags: ["quote"], importance: 2 });
  assert.equal(memory.content, "项目事实：报价 880 元");
  const duplicate = store.addMemory({ kind: "note", content: "项目事实：报价 880 元", tags: ["extra"], importance: 3 });
  assert.equal(duplicate.id, memory.id);
  assert.equal(store.listMemory().length, 1);
  assert.ok(store.listMemory({ query: "报价" }).length === 1);
  const reloaded = new ChatStore(root);
  assert.equal(reloaded.listConversations().length, 1);
  assert.equal(reloaded.listMemory().length, 1);
  assert.equal(reloaded.listMessages(conversation.id).length, 1);
});
