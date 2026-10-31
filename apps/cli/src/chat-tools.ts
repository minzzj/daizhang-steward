/**
 * v1.5.1：对话式总控的真实 ChatTools 实现（控制台/CLI 共用）。
 *
 * - 只读查询（0 token）：系统/run/产物/报告/metrics/日志/配置/账本/智能体
 * - 任务类（流式）：executeGoal → RunManager（项目执行器）；harnessTask → 真实 DSH harness
 * - 危险动作：只返回审批卡，绝不执行
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigEngine, composeHarnessPrompt, type HarnessSettings } from "../../../packages/steward-config/src/index.js";
import type { ChatGoalResult, ChatHarnessResult, ChatPart, ChatQueryResult, ChatReportCard, ChatTools } from "../../../packages/steward-chat/src/index.js";
import { RunManager, type RunRecord } from "../../../packages/steward-runtime/src/index.js";
import {
  type HarnessReportView,
  harnessArtifactFilePath,
  harnessMetrics,
  listHarnessArtifacts,
  listHarnessReports,
  readHarnessArtifact,
} from "./harness-data.js";
import { createRuntime, type Runtime } from "./agent-cli.js";

export interface RealChatToolsOptions {
  root: string;
  /** 允许的 harness 任务 token 上限（默认 2,000,000，防止对话任务失控烧 token）。 */
  harnessTokenLimit?: number;
  /** harness 单次超时（默认 180000ms）。 */
  harnessTimeoutMs?: number;
}

export interface RealChatToolsHandle {
  tools: ChatTools;
  runtime: Runtime;
  manager: RunManager;
  /** v1.5.2：系统动作审批（plan → 人工确认 → execute）。approvalId 形如 system:<requestId>。 */
  confirmSystemAction: (approvalId: string, decision: "approve" | "reject") => Promise<ChatQueryResult>;
}

const oneLine = (text: string, max = 120): string => {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const fmt = (value: number): string => value.toLocaleString("zh-CN");

const reportCard = (report: HarnessReportView): ChatReportCard => ({
  id: report.id,
  title: report.title,
  ...(report.agent_role ? { agent_role: report.agent_role } : {}),
  ...(report.step !== undefined ? { step: report.step } : {}),
  run_id: report.run_id,
  session_id: report.session_id,
  markdown: report.markdown.slice(0, 20000),
  created_at: report.created_at,
});

function dataCard(title: string, items: Array<{ label: string; value: string }>): ChatPart {
  return { type: "data", data: { title, items } };
}

export function createRealChatTools(options: RealChatToolsOptions): RealChatToolsHandle {
  const root = options.root;
  const runsRoot = join(root, "runs");
  const runtime = createRuntime(root, { autoApprove: false });
  const { config, orchestrator, money, system: systemctl } = runtime;
  const manager = new RunManager({
    orchestrator: {
      createSession: (input) => orchestrator.createSession(input as never),
      sendMessage: (sessionId, text) => orchestrator.sendMessage(sessionId, text),
      startProject: (sessionId) => orchestrator.startProject(sessionId),
      runStep: (sessionId) => orchestrator.runStep(sessionId),
      getSession: (sessionId) => {
        const session = orchestrator.getSession(sessionId);
        return {
          id: session.id,
          status: session.status,
          plan: session.plan.map((step) => ({
            step: step.step,
            agent_role: step.agent_role,
            action: step.action,
            summary: step.summary,
            status: step.status,
            ...(step.requires_approval ? { requires_approval: true } : {}),
            ...(step.action_plan ? { action_plan: { ...(step.action_plan.risk ? { risk: step.action_plan.risk } : {}), ...(step.action_plan.requires_confirmation ? { requires_confirmation: true } : {}) } } : {}),
          })),
          approvals: Object.fromEntries(Object.entries(session.approvals ?? {}).map(([key, value]) => [key, { status: value.status }])),
          messages: session.messages.map((message) => ({ ...(message.role ? { role: message.role } : {}), ...(message.kind ? { kind: message.kind } : {}), text: message.text, ...(message.summary ? { summary: message.summary } : {}) })),
          children: Object.fromEntries(
            Object.entries(session.children).map(([role, turns]) => [
              role,
              turns.map((turn) => ({ seq: turn.seq, agent_role: turn.agent_role, input_summary: turn.input_summary, output_summary: turn.output_summary, tokens: turn.tokens, status: turn.status, ...(turn.model_mode ? { model_mode: turn.model_mode } : {}) })),
            ]),
          ),
        };
      },
      decideApproval: (sessionId, step, decision) => orchestrator.decideApproval(sessionId, step, decision, "human:chat"),
      interrupt: (sessionId, reason) => (reason ? orchestrator.interrupt(sessionId, reason) : orchestrator.interrupt(sessionId)),
      resume: (sessionId) => orchestrator.resume(sessionId),
    },
    settings: (() => {
      const settings = config.getRuntimeSettings();
      return {
        auto_run: settings.auto_run,
        approval_mode: settings.approval_mode,
        full_auto: settings.full_auto,
        max_auto_steps: settings.max_auto_steps,
        rework_limit: settings.rework_limit,
        event_retention: settings.event_retention,
      };
    })(),
    root: join(root, ".steward", "runtime"),
    maxConcurrentRuns: 3,
  });

  interface PendingSystemAction {
    request: { id: string; action: string; target?: string; reason?: string; confirmation_token?: string };
    label: string;
    executable: boolean;
  }
  const pendingSystemActions = new Map<string, PendingSystemAction>();
  const runIdForSession = (sessionId: string): string | undefined => manager.listRuns().find((record) => record.session_id === sessionId)?.run_id;
  const sessionForRunId = (runId: string): string | undefined => (manager.getRun(runId) ?? manager.listRuns().find((item) => item.session_id === runId))?.session_id;
  const latestRun = (): RunRecord | null => manager.listRuns()[0] ?? null;

  const result = (tool: string, ok: boolean, summary: string, parts: ChatPart[] = []): ChatQueryResult => ({ tool, ok, summary, parts });

  const tools: ChatTools = {
    systemSummary: async () => {
      const cfg = config.load();
      const apps = systemctl.listApps();
      const plugins = systemctl.listPlugins();
      const runtimeSettings = config.getRuntimeSettings();
      const runs = manager.listRuns();
      const running = runs.filter((run) => run.status === "running" || run.status === "queued").length;
      const awaiting = runs.filter((run) => run.status === "awaiting_approval" || run.status === "paused").length;
      const summary = `系统正常：${cfg.profile.mode === "personal" ? "个人模式" : cfg.profile.mode}；受管程序 ${apps.length} 个、插件 ${plugins.length} 个；运行中 ${running} 个、等待审批 ${awaiting} 个；Token 已用 ${fmt(cfg.token_budget.used_tokens)} / ${fmt(cfg.token_budget.limit_tokens)}。`;
      return result("systemSummary", true, summary, [
        dataCard("系统概览", [
          { label: "运行模式", value: cfg.profile.mode },
          { label: "受管程序", value: String(apps.length) },
          { label: "插件", value: String(plugins.length) },
          { label: "运行中 Run", value: String(running) },
          { label: "等待审批", value: String(awaiting) },
          { label: "Token 已用/上限", value: `${fmt(cfg.token_budget.used_tokens)} / ${fmt(cfg.token_budget.limit_tokens)}` },
          { label: "Harness", value: `${config.getHarnessSettings().enabled ? "启用" : "关闭"}（${config.getHarnessSettings().profile}）` },
          { label: "自动执行", value: runtimeSettings.auto_run ? `开启（${runtimeSettings.approval_mode}）` : "关闭" },
        ]),
      ]);
    },
    listRuns: async (limit = 10) => {
      const runs = manager.listRuns().slice(0, limit);
      if (runs.length === 0) return result("listRuns", true, "还没有运行记录。", []);
      const summary = `最近 ${runs.length} 个运行：` + runs.map((run) => `${run.run_id}（${run.status}，${run.steps_done}/${run.steps_total} 步）`).join("；");
      return result("listRuns", true, summary, [
        dataCard("运行列表", runs.map((run) => ({ label: run.run_id, value: `${run.status} · ${run.steps_done}/${run.steps_total} 步 · ${fmt(run.token_used)} tokens · ${oneLine(run.goal, 40)}` }))),
      ]);
    },
    runDetail: async (runId) => {
      const record = runId ? manager.getRun(runId) : latestRun();
      if (!record) return result("runDetail", false, "没有找到运行记录。");
      const session = orchestrator.getSession(record.session_id);
      const turns = Object.values(session.children).flat();
      const parts: ChatPart[] = [
        dataCard(`运行 ${record.run_id}`, [
          { label: "目标", value: record.goal },
          { label: "状态", value: record.status },
          { label: "步骤", value: `${record.steps_done}/${record.steps_total}` },
          { label: "Token", value: fmt(record.token_used) },
          ...session.plan.map((step) => ({ label: `步骤 ${step.step}（${step.agent_role}）`, value: `${step.status} · ${oneLine(step.summary, 60)}` })),
        ]),
      ];
      const reports = listHarnessReports(runsRoot, { session_id: record.session_id, limit: 2 }, runIdForSession);
      for (const report of reports) parts.push({ type: "report", report: reportCard(report) });
      return result("runDetail", true, `运行 ${record.run_id}：${record.status}，${record.steps_done}/${record.steps_total} 步，Token ${fmt(record.token_used)}，共 ${turns.length} 轮 agent 执行。`, parts);
    },
    listArtifacts: async (query) => {
      const artifacts = listHarnessArtifacts(runsRoot, { ...(query ?? {}), limit: query?.limit ?? 12 }, runIdForSession);
      if (artifacts.length === 0) return result("listArtifacts", true, "还没有 Harness 产物。");
      const parts: ChatPart[] = artifacts.map((artifact) => ({
        type: "artifact",
        artifact: {
          id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          size: artifact.size,
          ...(artifact.agent_role ? { agent_role: artifact.agent_role } : {}),
          ...(artifact.step !== undefined ? { step: artifact.step } : {}),
          run_id: artifact.run_id,
          session_id: artifact.session_id,
          ...(artifact.preview_url ? { preview_url: artifact.preview_url } : {}),
          ...(artifact.download_url ? { download_url: artifact.download_url } : {}),
        },
      }));
      return result("listArtifacts", true, `共 ${artifacts.length} 个产物：` + artifacts.map((artifact) => artifact.rel_path).join("、"), parts);
    },
    artifactPreview: async (id) => {
      const content = readHarnessArtifact(runsRoot, id);
      if (!content.ok || !content.content) return result("artifactPreview", false, content.error ?? "无法读取产物内容。");
      return result("artifactPreview", true, `已读取产物 ${id}（${content.kind}）。`, [{ type: "markdown", title: id, markdown: "```\n" + content.content.slice(0, 8000) + "\n```" }]);
    },
    listReports: async (query) => {
      const reports = listHarnessReports(runsRoot, { ...(query ?? {}), limit: query?.limit ?? 6 }, runIdForSession);
      if (reports.length === 0) return result("listReports", true, "还没有 Harness 报告。");
      const parts: ChatPart[] = reports.map((report) => ({ type: "report", report: reportCard(report) }));
      return result("listReports", true, `共 ${reports.length} 份报告：` + reports.map((report) => report.title).join("、"), parts);
    },
    reportContent: async (id) => {
      const reports = listHarnessReports(runsRoot, {}, runIdForSession);
      const report = reports.find((item) => item.id === id) ?? reports[0];
      if (!report) return result("reportContent", false, "没有找到报告。");
      return result("reportContent", true, `报告：${report.title}`, [{ type: "report", report }]);
    },
    runMetrics: async (runId) => {
      const record = runId ? manager.getRun(runId) : latestRun();
      if (!record) return result("runMetrics", false, "没有找到运行记录。");
      const metrics = harnessMetrics(runsRoot, record.session_id);
      if (!metrics) return result("runMetrics", true, `运行 ${record.run_id} 暂无 Harness metrics。`);
      return result("runMetrics", true, `运行 ${record.run_id} Token 总量 ${fmt(metrics.token_total)}，工具调用 ${metrics.tool_calls} 次，耗时 ${(metrics.duration_ms / 1000).toFixed(1)}s。`, [
        dataCard(`运行 ${record.run_id} · 数据`, [
          { label: "Token 输入", value: fmt(metrics.token_input) },
          { label: "Token 输出", value: fmt(metrics.token_output) },
          { label: "Token 缓存", value: fmt(metrics.token_cache_read) },
          { label: "Token 总计", value: fmt(metrics.token_total) },
          { label: "步骤", value: String(metrics.steps) },
          { label: "工具调用", value: String(metrics.tool_calls) },
          { label: "事件", value: String(metrics.events) },
          { label: "耗时", value: `${(metrics.duration_ms / 1000).toFixed(1)}s` },
          { label: "模型来源", value: metrics.model_modes.join("/") },
        ]),
      ]);
    },
    readLogs: async (limit = 20) => {
      const audit = orchestrator.auditLog().slice(-limit).map((entry) => `${entry.at} ${entry.action} ${entry.object} ${entry.result}`);
      const runs = manager.listRuns().slice(0, 3).map((run) => `${run.run_id} ${run.status}`);
      return result("readLogs", true, `最近日志：${audit.slice(-5).join("；") || "（空）"}`, [
        dataCard("日志/审计（最近）", [...runs.map((line) => ({ label: "run", value: line })), ...audit.map((line) => ({ label: "audit", value: line }))].slice(-limit)),
      ]);
    },
    configSummary: async () => {
      const cfg = config.load();
      const providers = config.listModelProviders().map((provider) => `${provider.id}（${provider.enabled ? "启用" : "关闭"}，密钥 ${provider.api_key_ref ? config.maskApiKeyRef(provider.api_key_ref) : "未配置"}）`);
      const harness = config.getHarnessSettings();
      return result("configSummary", true, `当前配置：${cfg.profile.mode} 模式；预算 月 ¥${cfg.budgets.month_cny}/项目 ¥${cfg.budgets.project_cny}/单笔 ¥${cfg.budgets.per_txn_cny}；Token 上限 ${fmt(cfg.token_budget.limit_tokens)}；模型 ${providers.join("、")}。`, [
        dataCard("配置概览", [
          { label: "运行模式", value: cfg.profile.mode },
          { label: "预算", value: `¥${cfg.budgets.month_cny} / ¥${cfg.budgets.project_cny} / ¥${cfg.budgets.per_txn_cny}` },
          { label: "Token 上限", value: fmt(cfg.token_budget.limit_tokens) },
          { label: "模型服务商", value: providers.join("；") },
          { label: "Harness", value: `${harness.enabled ? "启用" : "关闭"} · ${harness.profile} · 并发 ${harness.max_concurrency}` },
          { label: "支付", value: cfg.payments.providers.map((provider) => provider.name).join(" / ") },
        ]),
      ]);
    },
    ledgerSummary: async () => {
      const summary = money.summary();
      const requests = money.list().slice(-5).map((request) => `${request.id} ¥${request.amount_cny} ${request.status} ${request.client}`);
      return result("ledgerSummary", true, `账本：已收 ${summary.paid_count} 笔共 ¥${summary.paid_cny}，待收 ${summary.pending_count} 笔共 ¥${summary.pending_cny}。`, [
        dataCard("收款/账本", [
          { label: "已收", value: `${summary.paid_count} 笔 / ¥${summary.paid_cny}` },
          { label: "待收", value: `${summary.pending_count} 笔 / ¥${summary.pending_cny}` },
          { label: "取消", value: `${summary.cancelled_count} 笔` },
          { label: "收款账户", value: summary.payout ? `${summary.payout.bank_name} ${summary.payout.card_no_masked}` : "未配置" },
          ...requests.map((line) => ({ label: "请求", value: line })),
        ]),
      ]);
    },
    agentsSummary: async () => {
      const agents = config.listAgents().map((agent) => {
        const resolved = config.resolveAgentModel(agent.role);
        const harness = agent.harness;
        return `${agent.name}（${agent.role}，${resolved.model}，${resolved.has_key ? "密钥已配置" : "无密钥"}）${harness ? ` · Harness ${harness.tools.join("/")}` : ""}`;
      });
      return result("agentsSummary", true, `共 ${agents.length} 个智能体：` + agents.join("；"), [
        dataCard("智能体（DeepSeek Harness）", config.listAgents().map((agent) => {
          const resolved = config.resolveAgentModel(agent.role);
          return { label: `${agent.name}（${agent.role}）`, value: `${resolved.provider_id}/${resolved.model} · ${resolved.has_key ? "已配置密钥" : "未配置密钥"}${agent.harness ? ` · 工具 ${agent.harness.tools.join("/")}` : ""}` };
        })),
      ]);
    },
    executeGoal: async (goal, onPart): Promise<ChatGoalResult> => {
      onPart({ type: "text", text: `好的，我来做：${goal}。我会自动拆解计划并派发智能体执行，过程会实时显示。` });
      const run = await manager.createRun({ goal });
      let lastStep = 0;
      const unsubscribe = manager.subscribeRun(run.run_id, (event) => {
        const data = event.data as Record<string, unknown>;
        if (event.type === "plan.generating") onPart({ type: "thinking", text: "总调度正在生成计划…", collapsed: true });
        else if (event.type === "plan.ready") {
          const steps = Array.isArray(data.steps) ? (data.steps as Array<Record<string, unknown>>) : [];
          onPart({ type: "markdown", title: "执行计划", markdown: steps.map((step, index) => `${Number(step.step ?? index + 1)}. **${String(step.agent_role ?? "")}** · ${String(step.action ?? "")} — ${String(step.summary ?? "")}`).join("\n") });
        } else if (event.type === "step.started") {
          lastStep = Number(data.step ?? lastStep + 1);
          onPart({ type: "tool_call", tool: String(data.action ?? data.agent_role ?? "step"), input: { step: lastStep, agent_role: String(data.agent_role ?? "") }, status: "running" });
        } else if (event.type === "agent.turn") {
          const summary = String(data.output_summary ?? data.summary ?? "");
          if (summary) onPart({ type: "thinking", text: `[${String(data.agent_role ?? "")}] ${oneLine(summary, 400)}`, collapsed: true });
        } else if (event.type === "approval.required") {
          onPart({ type: "approval", approval: { run_id: run.run_id, step: Number(data.step ?? lastStep), risk: String(data.risk ?? "medium"), summary: String(data.summary ?? "需要人工确认"), ...(data.reason ? { reason: String(data.reason) } : {}) } });
        } else if (event.type === "run.completed") {
          onPart({ type: "text", text: `执行完成：共 ${Number(data.steps_total ?? 0)} 步，Token ${fmt(Number(data.token_used ?? 0))}。` });
        } else if (event.type === "run.blocked" || event.type === "run.failed") {
          onPart({ type: "error", message: String(data.error ?? data.reason ?? "执行未成功") });
        }
      });
      const finished = await manager.waitFor(run.run_id, ["done", "blocked", "failed", "paused", "awaiting_approval", "interrupted"], 900_000);
      const record = manager.getRun(run.run_id);
      if (record !== null && (record.status === "awaiting_approval" || record.status === "paused") && record.pending_approval !== undefined) {
        return {
          ok: false,
          run_id: run.run_id,
          session_id: run.session_id,
          summary: `Run ${run.run_id} 等待你审批第 ${record.pending_approval.step} 步：${record.pending_approval.summary}`,
          pending_approval: {
            run_id: run.run_id,
            step: record.pending_approval.step,
            risk: record.pending_approval.risk ?? "medium",
            summary: record.pending_approval.summary,
            reason: "高风险步骤需要你确认后才会继续执行。",
          },
        };
      }
      unsubscribe();
      const artifacts = listHarnessArtifacts(runsRoot, { session_id: run.session_id, limit: 8 }, runIdForSession);
      for (const artifact of artifacts) {
        onPart({ type: "artifact", artifact: { id: artifact.id, title: artifact.title, kind: artifact.kind, size: artifact.size, ...(artifact.agent_role ? { agent_role: artifact.agent_role } : {}), ...(artifact.step !== undefined ? { step: artifact.step } : {}), run_id: artifact.run_id, session_id: artifact.session_id, ...(artifact.preview_url ? { preview_url: artifact.preview_url } : {}), ...(artifact.download_url ? { download_url: artifact.download_url } : {}) } });
      }
      const reports = listHarnessReports(runsRoot, { session_id: run.session_id, limit: 2 }, runIdForSession);
      for (const report of reports) onPart({ type: "report", report: reportCard(report) });
      const metrics = harnessMetrics(runsRoot, run.session_id);
      if (metrics) onPart(dataCard("执行数据", [
        { label: "Token 总计", value: fmt(metrics.token_total) },
        { label: "工具调用", value: String(metrics.tool_calls) },
        { label: "步骤", value: String(metrics.steps) },
      ]));
      return { ok: finished.status === "done", run_id: run.run_id, session_id: run.session_id, summary: `Run ${run.run_id}：${finished.status}，${finished.steps_done}/${finished.steps_total} 步，Token ${fmt(finished.token_used)}。` };
    },
    harnessTask: async (task, onPart): Promise<ChatHarnessResult> => {
      const harnessSettings = config.getHarnessSettings();
      if (!harnessSettings.enabled) {
        onPart({ type: "error", message: "Harness 已关闭（配置中心 harness.enabled=false），无法执行任务。" });
        return { ok: false, summary: "Harness 未启用" };
      }
      const runner = runtime.harness.runner;
      if (!runner.isAvailable()) {
        onPart({ type: "error", message: "本机未检测到 DeepSeek Harness（dsh），无法执行任务。" });
        return { ok: false, summary: "dsh 不可用" };
      }
      const workspace = join(root, ".steward", "chat", "harness", `task-${Date.now()}`);
      mkdirSync(workspace, { recursive: true });
      const tokenLimit = options.harnessTokenLimit ?? 2_000_000;
      const controller = new AbortController();
      let totalTokens = 0;
      const timeout = setTimeout(() => controller.abort(), options.harnessTimeoutMs ?? 180_000);
      onPart({ type: "text", text: `收到任务，我会用真实 Harness 代理执行：${task}` });
      try {
        const run = await runner.run({
          role: "harness",
          task,
          system_prompt: composeHarnessPrompt("harness"),
          workspace_dir: workspace,
          timeout_ms: options.harnessTimeoutMs ?? 180_000,
          signal: controller.signal,
          on_event: (event) => {
            const data = event.data as Record<string, unknown>;
            if (event.type === "thinking") onPart({ type: "thinking", text: String(data.text ?? "").slice(0, 800), collapsed: true });
            else if (event.type === "tool_call") onPart({ type: "tool_call", tool: String(data.tool ?? ""), input: (data.input ?? {}) as Record<string, unknown>, status: "running" });
            else if (event.type === "tool_result") onPart({ type: "tool_result", tool: String(data.tool ?? ""), ok: true, summary: String(data.result ?? "").slice(0, 300) });
            else if (event.type === "final") onPart({ type: "text", text: String(data.text ?? "").slice(0, 800) });
          },
          on_usage: (usage) => {
            totalTokens = usage.total_tokens;
            if (usage.total_tokens > tokenLimit) controller.abort();
          },
        });
        clearTimeout(timeout);
        const parts: ChatPart[] = [];
        for (const artifact of run.artifacts.slice(0, 10)) {
          const id = `${run.session_id ?? "harness"}::${artifact.rel_path}`;
          parts.push({ type: "artifact", artifact: { id, title: artifact.rel_path.split(/[\\/]/).pop() ?? artifact.rel_path, kind: artifact.kind === "code" || artifact.kind === "data" ? artifact.kind : artifact.kind === "markdown" ? "markdown" : "text", size: artifact.size, ...(run.session_id ? { session_id: run.session_id } : {}), ...(artifact.kind === "html" ? { preview_url: `/api/artifacts/${encodeURIComponent(id)}/preview` } : {}) } });
        }
        for (const part of parts) onPart(part);
        if (run.report_path && existsSync(run.report_path)) {
          const markdown = readFileSync(run.report_path, "utf8").slice(0, 20000);
          onPart({ type: "report", report: { id: `${run.session_id ?? "harness"}::report`, title: "Harness 报告", markdown, created_at: new Date().toISOString() } });
        }
        onPart(dataCard("Harness 执行数据", [
          { label: "Token 总计", value: fmt(run.usage.total_tokens) },
          { label: "工具调用", value: String(run.tool_calls.length) },
          { label: "产物", value: String(run.artifacts.length) },
          { label: "耗时", value: `${(run.duration_ms / 1000).toFixed(1)}s` },
        ]));
        return { ok: run.ok, summary: run.ok ? run.final_text.slice(0, 300) : (run.error ?? "harness 执行失败") };
      } catch (error) {
        clearTimeout(timeout);
        onPart({ type: "error", message: `Harness 执行失败：${error instanceof Error ? error.message : String(error)}` });
        return { ok: false, summary: error instanceof Error ? error.message : String(error) };
      }
    },
    approve: async (runId, step, decision) => {
      try {
        await manager.approve(runId, step, decision === "approve" ? "approve" : "reject", "human:chat");
        return result("approve", true, `已${decision === "approve" ? "批准" : "驳回"} ${runId} 第 ${step} 步。`);
      } catch (error) {
        return result("approve", false, `审批失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    systemActionPreview: async (action, target) => {
      const cleanTarget = (() => {
        if (target === undefined) return undefined;
        const stripped = target.replace(/^(受管)?(程序|应用|插件|文件|目录|进程)\s*/u, "").replace(/^id[:：]?\s*/iu, "").trim();
        const idMatch = /([A-Za-z][A-Za-z0-9_-]{2,})/u.exec(stripped);
        return (idMatch?.[1] ?? stripped) || undefined;
      })();
      const actionText = `${action} ${target ?? ""}`;
      const genericApproval = (label: string, executable: boolean): ChatQueryResult => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingSystemActions.set(requestId, { request: { id: requestId, action: "app.list", ...(cleanTarget !== undefined ? { target: cleanTarget } : {}), reason: label }, label, executable });
        return result("systemActionPreview", true, `已生成审批卡（未执行）：${label}`, [
          { type: "approval", approval: { run_id: `system:${requestId}`, step: 0, risk: "high", summary: `${label}${target ? ` → ${target}` : ""}`, reason: executable ? "危险动作：需你确认后由 AI 在系统策略内执行。" : "该动作需要人工在对应系统/线下完成；AI 不代执行、不代签。" } },
        ]);
      };
      if (/付款|支付|转账|退款|签约|合同|用印|对外发布|批量发送|生产部署/.test(actionText)) {
        return genericApproval(`危险动作：${actionText}`, false);
      }
      const inferred = /删除|移除|卸载/.test(actionText)
        ? /插件/.test(actionText)
          ? { action: "plugin.remove" as const, label: "删除受管插件" }
          : /程序|应用|app/i.test(actionText)
            ? { action: "app.remove" as const, label: "删除受管程序" }
            : { action: "file.remove" as const, label: "删除文件" }
        : /安装/.test(actionText)
          ? { action: "program.install" as const, label: "安装受管程序" }
          : /打开/.test(actionText)
            ? { action: "app.open" as const, label: "打开应用/URL" }
            : undefined;
      const mapped = inferred ?? (() => {
        const table: Record<string, { action: "app.remove" | "plugin.remove" | "program.install" | "app.open" | "file.remove" | "file.write"; label: string }> = {
          delete_program: { action: "app.remove", label: "删除受管程序" },
          delete_plugin: { action: "plugin.remove", label: "删除受管插件" },
          install_program: { action: "program.install", label: "安装受管程序" },
          open_app: { action: "app.open", label: "打开应用/URL" },
          file_write: { action: "file.write", label: "写入文件" },
          file_remove: { action: "file.remove", label: "删除文件" },
        };
        return table[action];
      })();
      if (mapped === undefined) return genericApproval(`待确认动作：${actionText}`, false);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const request = { id: requestId, action: mapped.action, ...(cleanTarget !== undefined ? { target: cleanTarget } : {}), reason: "对话式总控请求（需人工确认）", requested_by: "human:chat" };
      try {
        const plan = systemctl.plan(request as never);
        if (!plan.allowed) {
          return result("systemActionPreview", false, `危险动作「${mapped.label}」被策略拒绝：${plan.summary}`);
        }
        const confirmation = (plan as unknown as { confirmation_token?: string }).confirmation_token;
        pendingSystemActions.set(requestId, { request: { ...request, ...(confirmation ? { confirmation_token: confirmation } : {}) }, label: mapped.label, executable: true });
        return result("systemActionPreview", true, `危险动作「${mapped.label}」待人工确认：${plan.summary}`, [
          { type: "approval", approval: { run_id: `system:${requestId}`, step: 0, risk: plan.risk, summary: `${mapped.label}${target ? ` → ${target}` : ""}（${plan.summary}）`, reason: "系统级危险动作：确认后由 AI 在系统策略内执行并留审计。" } },
        ]);
      } catch (error) {
        return result("systemActionPreview", false, `生成审批卡失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
  const confirmSystemAction = async (approvalId: string, decision: "approve" | "reject"): Promise<ChatQueryResult> => {
    const requestId = approvalId.startsWith("system:") ? approvalId.slice("system:".length) : approvalId;
    const pending = pendingSystemActions.get(requestId);
    if (pending === undefined) return result("confirmSystemAction", false, "审批已过期或不存在，请重新发起。");
    if (decision === "reject") {
      pendingSystemActions.delete(requestId);
      return result("confirmSystemAction", true, `已驳回：${pending.label}`);
    }
    if (!pending.executable) {
      pendingSystemActions.delete(requestId);
      return result("confirmSystemAction", true, `已记录你的确认：${pending.label}。该动作需要人工在对应系统/线下完成，AI 不代执行、不代签。`, [
        dataCard("审批记录", [{ label: "动作", value: pending.label }, { label: "状态", value: "已确认（人工执行）" }]),
      ]);
    }
    try {
      const receipt = await systemctl.execute(pending.request as never);
      pendingSystemActions.delete(requestId);
      const summary = String((receipt as unknown as { summary?: string }).summary ?? (receipt as unknown as { ok?: boolean }).ok ? "已执行" : "已执行");
      return result("confirmSystemAction", true, `已执行并留审计：${summary}`, [
        dataCard("系统动作回执", [
          { label: "动作", value: pending.label },
          { label: "结果", value: summary },
          { label: "风险", value: String((receipt as unknown as { risk?: string }).risk ?? "") },
          { label: "备份", value: String((receipt as unknown as { backup_path?: string }).backup_path ?? "无") },
        ]),
      ]);
    } catch (error) {
      pendingSystemActions.delete(requestId);
      return result("confirmSystemAction", false, `执行失败（未执行/已过期）：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  tools.confirmSystemAction = confirmSystemAction;
  return { tools, runtime, manager, confirmSystemAction };
}
