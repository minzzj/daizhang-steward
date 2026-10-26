/**
 * v1.3：控制台真实引擎适配器。
 * - ConsoleChatProvider ← OrchestratorEngine + MoneyEngine + ConfigEngine
 * - ConsoleSystemProvider ← SystemController + ConfigEngine + EpayClient
 * 控制台本身保持零依赖；适配器在 apps/cli。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentTranscript as ConsoleAgentTranscript,
  ChatMessage as ConsoleChatMessage,
  ChatSession as ConsoleChatSession,
  ConsoleChatProvider,
  EvidenceItem as ConsoleEvidenceItem,
  ModelSettings,
  MoneyRequest,
  RunDetail as ConsoleRunDetail,
} from "../../../packages/steward-console/src/index.js";
import type {
  ConsoleSystemProvider,
  EpayConfig as ConsoleEpayConfig,
  EpayPayLink,
  SystemActionResult as ConsoleSystemActionResult,
  SystemDangerConfirm,
  SystemDangerExecuteInput,
  SystemDangerRequest,
  SystemLogEntry,
  SystemStatus,
  SupervisorMessage,
} from "../../../packages/steward-console/src/index.js";
import { buildLocalSystemPlan } from "../../../packages/steward-orchestrator/src/index.js";
import { SYSTEM_AUDIT_FILE, newActionRequestId, type ActionReceipt, type ActionRequest as SystemActionRequest, type RiskLevel } from "../../../packages/steward-system/src/index.js";
import { EpayClient, maskKeyRef, type EpayConfig } from "../../../packages/steward-money/src/index.js";
import { createRuntime } from "./agent-cli.js";

const METHOD_LABELS: Record<string, string> = {
  wechat_pay: "微信支付",
  alipay: "支付宝",
  personal_bank_card: "个人银行卡",
  corporate_account: "对公账户",
  manual: "人工记账",
  epay: "易支付",
};

function qrPlaceholder(text: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" fill="#ffffff"/>` +
    `<rect x="10" y="10" width="180" height="180" fill="#0b1220"/>` +
    `<rect x="24" y="24" width="40" height="40" fill="#e8f1ff"/><rect x="136" y="24" width="40" height="40" fill="#e8f1ff"/><rect x="24" y="136" width="40" height="40" fill="#e8f1ff"/>` +
    `<text x="100" y="104" fill="#66e3d2" font-size="12" text-anchor="middle" font-family="monospace">DEMO QR</text>` +
    `<text x="100" y="124" fill="#8fa3bd" font-size="9" text-anchor="middle" font-family="monospace">${text.slice(0, 26)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function roleTitle(role: string): string {
  const titles: Record<string, string> = {
    supervisor: "系统总控",
    conductor: "项目总调度",
    operator: "办公执行",
    harness: "编码代理",
    customer: "客户沟通",
    finance: "财务",
    reviewer: "核查",
    backend: "后台运维",
    scout: "线索",
    content: "内容",
    research: "调研",
  };
  return titles[role] ?? role;
}

export function createRealConsoleProviders(root: string): { chat: ConsoleChatProvider; system: ConsoleSystemProvider } {
  const runtime = createRuntime(root, { autoApprove: true });
  const { orchestrator, money, system: controller, config } = runtime;

  const toConsoleSession = (session: ReturnType<typeof orchestrator.getSession>): ConsoleChatSession => ({
    id: session.id,
    title: session.title,
    goal: session.goal,
    mode: session.mode,
    status: (session.status === "interrupted" ? "paused" : session.status) as ConsoleChatSession["status"],
    created_at: session.created_at,
    updated_at: session.updated_at,
    ...(session.project_id ? { project_id: session.project_id } : {}),
    run_id: session.id,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: (message.role === "user" ? "user" : message.role === "conductor" || message.role === "supervisor" ? "conductor" : "agent") as ConsoleChatMessage["role"],
      ...(message.agent_role ? { agent_role: message.agent_role } : {}),
      text: message.text,
      ...(message.summary ? { summary: message.summary } : {}),
      at: message.at,
      kind: (message.kind === "plan" || message.kind === "approval" || message.kind === "result" || message.kind === "error" ? message.kind : "result") as NonNullable<ConsoleChatMessage["kind"]>,
    })),
    plan: session.plan.map((step) => ({
      step: step.step,
      agent_role: step.agent_role,
      action: step.action,
      summary: step.summary,
      status: step.status,
      ...(step.requires_approval ? { requires_approval: true } : {}),
    })),
    budget_cny: session.budget_cny,
    token_limit: session.token_limit,
    interruptible: session.status === "running" || session.status === "planning",
  });

  const advance = async (sessionId: string): Promise<ReturnType<typeof orchestrator.getSession>> => {
    let session = orchestrator.getSession(sessionId);
    let steps = 0;
    while ((session.status === "planning" || session.status === "running") && steps < 30) {
      session = await orchestrator.runStep(sessionId);
      steps += 1;
    }
    return session;
  };

  const evidenceItem = (item: { path: string; kind: string; title: string }): ConsoleEvidenceItem => {
    const abs = join(root, "runs", item.path);
    const kind: ConsoleEvidenceItem["kind"] =
      item.kind === "html" ? "html" : item.kind === "report" ? "report" : item.kind === "json" ? "json" : item.kind === "screenshot" ? "screenshot" : "log";
    const mapped: ConsoleEvidenceItem = { path: item.path, kind, title: item.title };
    if (existsSync(abs)) {
      try {
        if (kind === "screenshot" && /\.png$/i.test(abs)) {
          const data = readFileSync(abs).toString("base64");
          mapped.thumb_url = `data:image/png;base64,${data}`;
          mapped.full_url = mapped.thumb_url;
        } else if (kind !== "html" && kind !== "screenshot") {
          mapped.preview_text = readFileSync(abs, "utf8").slice(0, 4000);
        }
      } catch {
        /* ignore */
      }
    }
    return mapped;
  };

  const consoleTranscripts = (sessionId: string): ConsoleAgentTranscript[] => {
    const detail = orchestrator.getRunDetail(sessionId);
    const byRole = new Map<string, ConsoleAgentTranscript["turns"]>();
    for (const turn of detail.turns) {
      const list = byRole.get(turn.agent_role) ?? [];
      list.push({
        seq: turn.seq,
        at: turn.at,
        input_summary: turn.input_summary,
        output_summary: turn.output_summary,
        tokens: turn.tokens,
        status: turn.status,
        ...(turn.evidence_refs[0] ? { evidence_ref: turn.evidence_refs[0] } : {}),
      });
      byRole.set(turn.agent_role, list);
    }
    return [...byRole.entries()].map(([role, turns]) => ({ agent_role: role, title: roleTitle(role), turns }));
  };

  const runDetail = (sessionId: string): ConsoleRunDetail | null => {
    try {
      const session = orchestrator.getSession(sessionId);
      const detail = orchestrator.getRunDetail(sessionId);
      const turns = detail.turns;
      const events = [
        ...session.plan.map((step) => ({
          seq: step.step,
          phase: step.status === "done" ? "verify" : step.status === "blocked" ? "error" : "action",
          ts: session.updated_at,
          actor: step.agent_role,
          summary: `${step.action}：${step.summary}（${step.status}）`,
        })),
        ...turns.map((turn) => ({
          seq: 100 + turn.seq,
          phase: "evidence",
          ts: turn.at,
          actor: turn.agent_role,
          summary: turn.output_summary,
        })),
      ];
      const reportFile = join(root, "runs", sessionId, "deliverable.md");
      return {
        run_id: sessionId,
        goal: session.goal,
        status: (session.status === "interrupted" ? "paused" : session.status) as ConsoleChatSession["status"],
        started_at: session.created_at,
        ...(session.status === "done" || session.status === "blocked" ? { finished_at: session.updated_at } : {}),
        events,
        evidence: detail.evidence.map(evidenceItem),
        ...(existsSync(reportFile) ? { report_md: readFileSync(reportFile, "utf8") } : {}),
        agents: consoleTranscripts(sessionId),
        token_used: turns.reduce((sum, turn) => sum + turn.tokens, 0),
        budget_used_cny: 0,
        session_id: sessionId,
      };
    } catch {
      return null;
    }
  };

  const toMoneyRequest = (request: ReturnType<typeof money.createRequest>): MoneyRequest => {
    const epay = config.getEpayConfig();
    const mapped: MoneyRequest = {
      id: request.id,
      amount_cny: request.amount_cny,
      client: request.client,
      purpose: request.purpose,
      status: request.status,
      created_at: request.created_at,
      payment_method: (request.method === "manual" ? "manual" : request.method) as MoneyRequest["payment_method"],
      payment_ref: request.payment_ref,
      pay_url: request.qr_payload,
      qr_url: qrPlaceholder(request.payment_ref),
      ...(request.ledger_entry_id ? { ledger_entry_id: request.ledger_entry_id } : {}),
      ...(request.invoice_draft ? { invoice_draft: request.invoice_draft } : {}),
      ...(request.note ? { note: request.note } : {}),
      ...(request.paid_at ? { paid_at: request.paid_at } : {}),
    };
    if (epay.enabled && request.method === "manual") {
      mapped.payment_method = "epay";
    }
    return mapped;
  };

  const modelSettings = (): ModelSettings => {
    const cfg = config.load();
    const providers = config.listModelProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind === "deepseek" ? "deepseek" : provider.kind === "local" ? "local" : "openai_compatible",
      base_url: provider.base_url,
      model: provider.default_model,
      api_key_ref: provider.api_key_ref,
      api_key_masked: maskKeyRef(provider.api_key_ref),
      enabled: provider.enabled,
      ...(provider.note ? { note: provider.note } : {}),
    })) as ModelSettings["providers"];
    const agent_bindings = config.listAgents().map((agent) => {
      const binding = cfg.models.agent_models[agent.role];
      return {
        agent_role: agent.role,
        provider_id: binding?.provider_id ?? cfg.models.default_provider_id,
        model: binding?.model ?? "deepseek-chat",
      };
    });
    const prompts = config.listSystemPrompts().map((prompt, index) => ({
      id: prompt.role,
      role: prompt.role,
      title: prompt.title,
      content: prompt.system_prompt,
      updated_at: prompt.updated_at,
      version: index + 1,
    }));
    return {
      providers,
      agent_bindings,
      prompts,
      sync_status: cfg.models.sync_mode === "single_key_all" ? "synced" : "not_synced",
      default_provider_id: cfg.models.default_provider_id,
    };
  };

  const chat: ConsoleChatProvider = {
    listSessions: () => orchestrator.listSessions().map(toConsoleSession),
    createSession: (input) => {
      const session = orchestrator.createSession({ goal: input.goal, ...(input.mode ? { mode: input.mode } : {}), ...(input.budget_cny ? { budget_cny: input.budget_cny } : {}), ...(input.token_limit ? { token_limit: input.token_limit } : {}) } as never);
      return toConsoleSession(session);
    },
    getSession: (id) => {
      try {
        return toConsoleSession(orchestrator.getSession(id));
      } catch {
        return null;
      }
    },
    sendMessage: async (sessionId, text) => toConsoleSession(await orchestrator.sendMessage(sessionId, text)),
    startProject: async (sessionId) => {
      await orchestrator.startProject(sessionId);
      return toConsoleSession(await advance(sessionId));
    },
    interrupt: (sessionId) => toConsoleSession(orchestrator.interrupt(sessionId, "控制台打断")),
    resume: async (sessionId) => {
      orchestrator.resume(sessionId);
      return toConsoleSession(await advance(sessionId));
    },
    decideApproval: async (sessionId, step, decision) => {
      orchestrator.decideApproval(sessionId, step, decision, "human:console");
      return toConsoleSession(decision === "approve" ? await advance(sessionId) : orchestrator.getSession(sessionId));
    },
    listRuns: () =>
      orchestrator.listSessions().map((session) => {
        const detail = orchestrator.getRunDetail(session.id);
        return {
          run_id: session.id,
          goal: session.goal,
          status: (session.status === "interrupted" ? "paused" : session.status) as ConsoleChatSession["status"],
          started_at: session.created_at,
          agent_count: new Set(detail.turns.map((turn) => turn.agent_role)).size,
          evidence_count: detail.evidence.length,
          session_id: session.id,
        };
      }),
    getRunDetail: (runId) => runDetail(runId),
    getAgentTranscripts: (runIdOrRole) => {
      if (!runIdOrRole) {
        const all: ConsoleAgentTranscript[] = [];
        for (const session of orchestrator.listSessions()) all.push(...consoleTranscripts(session.id));
        return all;
      }
      if (orchestrator.listSessions().some((session) => session.id === runIdOrRole)) return consoleTranscripts(runIdOrRole);
      const all: ConsoleAgentTranscript[] = [];
      for (const session of orchestrator.listSessions()) {
        for (const transcript of consoleTranscripts(session.id)) {
          if (transcript.agent_role === runIdOrRole) all.push(transcript);
        }
      }
      return all;
    },
    listEvidence: (runId) => {
      try {
        return orchestrator.getRunDetail(runId).evidence.map(evidenceItem);
      } catch {
        return [];
      }
    },
    listMoneyRequests: () => money.list().map(toMoneyRequest),
    createMoneyRequest: (input) => {
      try {
        const request = money.createRequest({
          amount_cny: input.amount_cny,
          client: input.client,
          purpose: input.purpose,
          method: (input.payment_method === "epay" ? "manual" : input.payment_method === "corporate_account" ? "manual" : input.payment_method) as never,
        });
        void money.persist();
        return { ok: true, request: toMoneyRequest(request), errors: [] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    confirmMoneyReceived: (id, by) => {
      try {
        const request = money.confirmReceived(id, { confirmed_by: by ?? "本人（控制台人工确认到账）" });
        void money.persist();
        return { ok: true, request: toMoneyRequest(request), ...(request.ledger_entry_id ? { ledger_entry_id: request.ledger_entry_id } : {}), errors: [] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    getModelSettings: () => modelSettings(),
    saveModelSettings: (partial) => {
      const errors: string[] = [];
      try {
        for (const provider of partial.providers ?? []) {
          try {
            config.upsertModelProvider({
              id: provider.id,
              name: provider.name,
              kind: provider.kind as never,
              base_url: provider.base_url,
              api_key_ref: provider.api_key_ref,
              enabled: provider.enabled,
              default_model: provider.model,
              models: [provider.model],
            } as never);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        for (const binding of partial.agent_bindings ?? []) config.setAgentModel(binding.agent_role, { provider_id: binding.provider_id, model: binding.model });
        if (partial.default_provider_id) config.setDefaultProvider(partial.default_provider_id);
        config.save();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      return { ok: errors.length === 0, settings: modelSettings(), errors };
    },
    syncKeysToAll: () => {
      const target = config.listModelProviders().find((provider) => provider.api_key_ref.length > 0);
      if (!target) return { ok: false, settings: modelSettings(), synced_at: new Date().toISOString(), targets: 0, errors: ["没有可同步的密钥引用，请先在某个 provider 配置密钥"] };
      try {
        config.syncApiKey(target.api_key_ref);
        config.save();
        return { ok: true, settings: modelSettings(), synced_at: new Date().toISOString(), targets: config.listModelProviders().length, errors: [] };
      } catch (error) {
        return { ok: false, settings: modelSettings(), synced_at: new Date().toISOString(), targets: 0, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    savePrompts: (patches) => {
      const errors: string[] = [];
      for (const patch of patches) {
        try {
          if (patch.id === "conductor") config.setConductorPrompt(patch.content);
          else config.setSystemPrompt(patch.id, patch.content);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      config.save();
      return { ok: errors.length === 0, settings: modelSettings(), errors };
    },
  };

  // ---------------- 系统总控 ----------------
  const messages: SupervisorMessage[] = [
    { id: "sup-0000", role: "supervisor", text: "我是系统总控（supervisor）：可以查看/管理受管程序与插件、切换各智能体模型与提示词、读取全部日志、把项目委派给项目总调度；删除类动作必须二次确认并备份。", summary: "系统总控已就绪", at: new Date().toISOString(), kind: "status" },
  ];
  let messageSeq = 0;
  const pushMessage = (role: SupervisorMessage["role"], text: string, kind: SupervisorMessage["kind"], summary?: string) => {
    messageSeq += 1;
    messages.push({ id: `sup-${String(messageSeq).padStart(4, "0")}`, role, text, ...(summary ? { summary } : {}), at: new Date().toISOString(), ...(kind ? { kind } : {}) });
  };

  const mapAppsPrograms = (): SystemStatus["programs"] =>
    controller.listApps().map((app) => ({
      id: app.id,
      name: app.name,
      kind: app.kind === "plugin" ? "worker" : app.kind === "console" ? "gateway" : "service",
      status: "stopped",
      since: new Date().toISOString(),
      health: "unknown",
      description: app.note ?? app.command,
    }));

  const mapPlugins = (): SystemStatus["plugins"] =>
    controller.listPlugins().map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version ?? "1.0.0",
      enabled: plugin.enabled,
      description: plugin.note ?? plugin.path,
      requires_approval: true,
    }));

  const mapAgents = (): SystemStatus["agents"] =>
    config.listAgents().map((agent) => {
      const resolved = config.resolveAgentModel(agent.role);
      return {
        agent_role: agent.role,
        title: agent.name,
        layer: agent.role === "supervisor" ? "supervisor" : agent.role === "conductor" ? "project_conductor" : "specialist",
        provider: resolved.provider_id,
        model: resolved.model,
        tokens_today: 0,
        token_limit: agent.token_limit,
        status: agent.enabled ? "idle" : "disabled",
      };
    });

  const status = (): SystemStatus => {
    const cfg = config.load();
    return {
      supervisor: { title: "系统总控（supervisor）", model: config.resolveAgentModel("supervisor").model, status: "idle", layer_label: "L1 系统级" },
      project_conductor: { title: "项目总调度（conductor）", model: config.resolveAgentModel("conductor").model, status: "idle", layer_label: "L2 项目级" },
      agents: mapAgents(),
      programs: mapAppsPrograms(),
      plugins: mapPlugins(),
      logs: systemLogs(12),
      mode: cfg.profile.mode,
      updated_at: new Date().toISOString(),
    };
  };

  const systemLogs = (limit = 20): SystemLogEntry[] =>
    controller.auditTrail(limit).map((raw) => {
      const entry = raw as unknown as Record<string, unknown>;
      return {
        at: String(entry.at ?? new Date().toISOString()),
        level: (entry.ok === false ? "error" : "info") as SystemLogEntry["level"],
        source: String(entry.action ?? "system"),
        message: `${String(entry.target ?? "-")} | ${String(entry.summary ?? "")}`,
      };
    });

  const execAction = async (action: SystemActionRequest["action"], target?: string): Promise<ConsoleSystemActionResult> => {
    const request: SystemActionRequest = { id: newActionRequestId(), action, ...(target ? { target } : {}), reason: "控制台系统动作" };
    const plan = controller.plan(request);
    if (!plan.allowed) return { ok: false, message: plan.summary, errors: [plan.summary] };
    try {
      const receipt: ActionReceipt = await controller.execute({ ...request, ...(plan.confirmation_token ? { confirmation_token: plan.confirmation_token } : {}) } as never);
      return { ok: receipt.ok, message: `${plan.summary}${receipt.backup_path ? `；备份 ${receipt.backup_path}` : ""}`, status: status(), errors: receipt.ok ? [] : [receipt.error ?? "执行失败"] };
    } catch (error) {
      return { ok: false, message: `执行失败：${error instanceof Error ? error.message : String(error)}`, errors: [error instanceof Error ? error.message : String(error)] };
    }
  };

  const quickActionFor = (action: string, target: string): Promise<ConsoleSystemActionResult> | null => {
    const map: Record<string, SystemActionRequest["action"]> = {
      listApps: "app.list",
      listPlugins: "plugin.list",
      startApp: "app.start",
      stopApp: "app.stop",
      restartApp: "app.restart",
      disablePlugin: "plugin.disable",
      enablePlugin: "plugin.enable",
    };
    const mapped = map[action];
    if (!mapped) return null;
    return execAction(mapped, target === "*" ? undefined : target);
  };

  const epayConsoleConfig = (): ConsoleEpayConfig => {
    const epay = config.getEpayConfig() as EpayConfig;
    return {
      enabled: epay.enabled,
      mode: epay.mode,
      gateway_url: epay.gateway_url,
      merchant_id: epay.pid,
      api_key_ref: epay.key_ref,
      api_key_masked: maskKeyRef(epay.key_ref),
      methods: (epay.pay_types ?? ["alipay", "wxpay"]) as ConsoleEpayConfig["methods"],
      notify_url: epay.notify_url,
      return_url: epay.return_url,
      updated_at: new Date().toISOString(),
    };
  };

  const resolveEpayKey = (ref: string): string | null => {
    if (!ref) return null;
    if (ref.startsWith("env:")) {
      const name = ref.slice(4);
      const value = process.env[name];
      return value && value.length > 0 ? value : null;
    }
    if (ref.startsWith("file:")) {
      const match = /^file:([^#]+)#(.+)$/.exec(ref);
      if (!match) return null;
      const file = join(root, ".steward", match[1] ?? "");
      if (!existsSync(file)) return null;
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, { api_key?: string }>;
        return parsed[match[2] ?? ""]?.api_key ?? null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const pendingDanger = new Map<string, { action: SystemActionRequest["action"]; target: string }>();

  const system: ConsoleSystemProvider = {
    supervisorMessages: () => [...messages],
    sendSupervisorMessage: async (text) => {
      pushMessage("user", text, "command", text.slice(0, 60));
      const plan = buildLocalSystemPlan(text, 8);
      const executed: string[] = [];
      const blocked: string[] = [];
      for (const step of plan.steps) {
        if (step.action === "delegateProject") {
          // 创建 conductor 子会话：真实委派
          try {
            const child = orchestrator.createSession({ goal: String(step.target ?? text), kind: "project" } as never);
            await orchestrator.sendMessage(child.id, String(step.target ?? text));
            executed.push(`已委派项目给项目总调度（会话 ${child.id}）`);
          } catch (error) {
            blocked.push(`委派失败：${error instanceof Error ? error.message : String(error)}`);
          }
          continue;
        }
        if (step.action === "readLogs") {
          executed.push(`已读取系统审计 ${controller.auditTrail(20).length} 条`);
          continue;
        }
        if (step.action === "changeAgentModel") {
          const args = (step.args ?? {}) as { role?: string; provider_id?: string; model?: string };
          if (args.role && args.provider_id && args.model) {
            try {
              config.setAgentModel(args.role, { provider_id: args.provider_id, model: args.model });
              config.save();
              executed.push(`已切换 ${args.role} 模型为 ${args.provider_id}/${args.model}`);
            } catch (error) {
              blocked.push(String(error));
            }
          } else blocked.push("切换模型缺少 role/provider/model 参数");
          continue;
        }
        if (step.action === "setPrompt") {
          const args = (step.args ?? {}) as { role?: string; prompt?: string };
          if (args.role && args.prompt) {
            try {
              config.setSystemPrompt(args.role, args.prompt);
              config.save();
              executed.push(`已更新 ${args.role} 提示词`);
            } catch (error) {
              blocked.push(String(error));
            }
          } else blocked.push("更新提示词缺少参数");
          continue;
        }
        const risk = String(step.risk ?? "low");
        if (risk === "high" || step.action === "removeApp" || step.action === "removePlugin") {
          blocked.push(`「${step.summary}」属于危险动作，需要二次确认（请在系统页危险确认处操作）`);
          continue;
        }
        const result = await quickActionFor(step.action, String(step.target ?? "*"));
        if (result) {
          if (result.ok) executed.push(result.message);
          else blocked.push(result.message);
        }
      }
      pushMessage(
        "supervisor",
        `${executed.length > 0 ? "已执行：\n- " + executed.join("\n- ") : "没有可直接执行的动作。"}${blocked.length > 0 ? "\n\n需要人工处理：\n- " + blocked.join("\n- ") : ""}`,
        "result",
        executed.length > 0 ? `已执行 ${executed.length} 个动作` : "无动作",
      );
      return [...messages];
    },
    getSystemStatus: () => status(),
    programAction: async (programId, action) => {
      const mapped = action === "start" ? "app.start" : action === "stop" ? "app.stop" : "app.restart";
      return execAction(mapped, programId);
    },
    pluginAction: async (pluginId, enabled) => execAction(enabled ? "plugin.enable" : "plugin.disable", pluginId),
    getSystemLogs: (limit) => systemLogs(limit ?? 20),
    runQuickCommand: async (command) => {
      const plan = buildLocalSystemPlan(command, 8);
      const results: string[] = [];
      for (const step of plan.steps) {
        if (step.action === "listApps" || step.action === "listPlugins" || step.action === "listApps" || step.action === "readLogs") {
          results.push("已读取系统状态");
          continue;
        }
        if (step.action === "removeApp" || step.action === "removePlugin") {
          return { ok: false, message: "危险动作需要二次确认", status: status(), errors: ["请使用危险动作确认流程"] };
        }
        const result = await quickActionFor(step.action, String(step.target ?? "*"));
        if (result) results.push(result.message);
      }
      return { ok: true, message: results.join("；") || "已完成", status: status(), errors: [] };
    },
    prepareDangerousAction: (request: SystemDangerRequest) => {
      const action = request.action === "delete_plugin" ? "plugin.remove" : "app.remove";
      const actionRequest: SystemActionRequest = { id: newActionRequestId(), action, target: request.target_id, reason: `控制台危险动作：${request.target_name ?? request.target_id}` };
      const plan = controller.plan(actionRequest);
      if (!plan.allowed) return { ok: false, request, errors: [plan.summary] };
      if (!plan.confirmation_token) return { ok: false, request, errors: ["该动作未生成确认令牌"] };
      pendingDanger.set(plan.confirmation_token, { action, target: request.target_id });
      const recycle = join(root, ".steward", "system", "recycle");
      return {
        ok: true,
        request,
        risk: `破坏性动作：将先备份到回收站（${recycle}）再删除；仅限受管范围，删除后可通过备份恢复。`,
        backup_path: recycle,
        confirm_token: plan.confirmation_token,
        expires_at: new Date(Date.now() + 120_000).toISOString(),
        errors: [],
      };
    },
    executeDangerousAction: async (input: SystemDangerExecuteInput) => {
      if (!/确认删除/.test(input.confirm_text)) return { ok: false, message: "确认文本不正确（需包含「确认删除」）", status: status(), errors: ["confirm_text"] };
      const pending = pendingDanger.get(input.confirm_token);
      if (!pending) return { ok: false, message: "确认令牌无效或已过期", status: status(), errors: ["confirm_token"] };
      pendingDanger.delete(input.confirm_token);
      const request: SystemActionRequest = { id: newActionRequestId(), action: pending.action, target: pending.target, reason: "控制台危险动作（已二次确认）", confirmation_token: input.confirm_token };
      try {
        const receipt = await controller.execute(request);
        pushMessage("supervisor", `危险动作已执行：${receipt.backup_path ? `已备份到 ${receipt.backup_path}` : "已完成"}`, "danger", "危险动作已确认执行");
        return { ok: receipt.ok, message: `已执行并备份：${receipt.backup_path ?? "（无备份路径）"}`, status: status(), errors: receipt.ok ? [] : [receipt.error ?? "失败"] };
      } catch (error) {
        return { ok: false, message: `执行失败：${error instanceof Error ? error.message : String(error)}`, status: status(), errors: [String(error)] };
      }
    },
    getEpayConfig: () => epayConsoleConfig(),
    saveEpayConfig: (partial) => {
      try {
        const patch: Record<string, unknown> = {};
        if (partial.enabled !== undefined) patch.enabled = partial.enabled;
        if (partial.mode !== undefined) patch.mode = partial.mode;
        if (partial.gateway_url !== undefined) patch.gateway_url = partial.gateway_url;
        if (partial.merchant_id !== undefined) patch.pid = partial.merchant_id;
        if (partial.api_key_ref !== undefined) patch.key_ref = partial.api_key_ref;
        if (partial.methods !== undefined) patch.pay_types = partial.methods;
        if (partial.notify_url !== undefined) patch.notify_url = partial.notify_url;
        if (partial.return_url !== undefined) patch.return_url = partial.return_url;
        config.setEpayConfig(patch as never);
        config.save();
        return { ok: true, config: epayConsoleConfig(), errors: [] };
      } catch (error) {
        return { ok: false, config: epayConsoleConfig(), errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    buildEpayPayLink: (input): EpayPayLink => {
      try {
        const epay = config.getEpayConfig() as EpayConfig;
        if (!epay.enabled) return { ok: false, errors: ["易支付未启用（请先在变现页启用并填写商家信息）"] };
        const client = new EpayClient({ config: epay, resolveKey: resolveEpayKey });
        const created = client.createPayment({ out_trade_no: input.out_trade_no, name: input.purpose, amount_cny: input.amount_cny, type: "alipay" });
        return { ok: true, pay_url: created.pay_url, qr_url: qrPlaceholder(input.out_trade_no), errors: [] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
  };

  return { chat, system };
}
