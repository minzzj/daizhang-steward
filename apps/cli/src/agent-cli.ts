/**
 * v1.3：CLI 总调度入口（两层：supervisor 系统总控 / conductor 项目总调度）。
 *
 * 命令：
 *   steward chat --goal "<目标>" [--kind system|project] [--json] [--auto]
 *   steward chat --action run|approve|reject|interrupt|resume|list|detail|logs --session <id>
 *   steward supervisor ...   （= --kind system）
 *   steward project ...      （= --kind project）
 *
 * 依赖真实引擎：ConfigEngine + OrchestratorEngine + SystemController + MoneyEngine。
 * 模型：默认 OpenAI 兼容真实调用（DeepSeek）；无 key/失败自动本地回退并标注。
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { ConfigEngine } from "../../../packages/steward-config/src/index.js";
import {
  OrchestratorEngine,
  createModelResolverFromConfig,
  SUPERVISOR_ROLE,
  type AgentTurn,
  type ConfigBridge,
  type ConfigBridgeResult,
  type LedgerSink,
  type OrchestratorSession,
  type RunDetail,
  type SessionKind,
  type SystemActions,
  type SystemActionResult,
} from "../../../packages/steward-orchestrator/src/index.js";
import { SystemController, newActionRequestId, type ManagedApp } from "../../../packages/steward-system/src/index.js";
import { MoneyEngine } from "../../../packages/steward-money/src/index.js";
import { createHarnessAgentExecutor, type HarnessExecutorHandle } from "./harness-executor.js";

type Flags = Record<string, string | boolean>;
export interface AgentArgs {
  flags: Flags;
}

const flag = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const flagNum = (flags: Flags, name: string, fallback: number): number => {
  const value = flag(flags, name);
  if (value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
const printJson = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** 把配置中心的 system_policy.managed_apps 转成 SystemController 的受管应用。 */
function buildManagedApps(root: string, config: ConfigEngine): ManagedApp[] {
  const policy = config.getSystemPolicy();
  return policy.managed_apps.map((item) => {
    const command = String(item.command ?? "").trim();
    const parts = command.split(/\s+/).filter(Boolean);
    const executable = parts[0] ?? command;
    const args = parts.slice(1);
    const app: ManagedApp = {
      id: item.id,
      name: item.name,
      command: executable,
      kind: "program",
      allow_start: item.allow_start !== false,
      allow_stop: item.allow_stop !== false,
      allow_remove: item.allow_remove === true,
      ...(args.length > 0 ? { args } : {}),
      ...(executable.startsWith(root) ? { cwd: root } : {}),
    };
    // allow_remove 的应用需要 path（备份/删除目标）：取可执行文件所在目录，且必须位于受管 root 内。
    if (app.allow_remove && executable.startsWith(root)) {
      const dir = executable.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
      if (dir.startsWith(root.replaceAll("\\", "/"))) app.path = dir;
    }
    return app;
  });
}

export interface Runtime {
  root: string;
  config: ConfigEngine;
  orchestrator: OrchestratorEngine;
  system: SystemController;
  money: MoneyEngine;
  harness: HarnessExecutorHandle;
}

export function createRuntime(root: string, options: { autoApprove?: boolean; kind?: SessionKind } = {}): Runtime {
  const config = new ConfigEngine({ root: join(root, ".steward") });
  config.load();
  const policy = config.getSystemPolicy();
  const system = new SystemController({
    root,
    state_dir: join(root, ".steward", "system"),
    apps: buildManagedApps(root, config),
    plugins_dir: join(root, policy.plugins_dir),
  });
  const money = new MoneyEngine({
    root: join(root, ".steward", "money"),
    mode: config.load().profile.mode,
    payout: config.load().payments.payout_account,
    invoice: config.load().payments.invoice,
  });
  const cfg = config.load();

  let orchestratorRef: OrchestratorEngine | null = null;

  const runSystemAction = async (
    action: "app.list" | "app.start" | "app.stop" | "app.restart" | "app.remove" | "plugin.list" | "plugin.enable" | "plugin.disable" | "plugin.remove",
    target?: string,
    params: Record<string, unknown> = {},
  ): Promise<SystemActionResult> => {
    const request = { id: newActionRequestId(), action, ...(target ? { target } : {}), params, reason: "supervisor 系统动作" };
    const plan = system.plan(request);
    if (!plan.allowed) return { ok: false, summary: plan.summary, detail: "受管范围拒绝（OutOfScope）" };
    try {
      const receipt = await system.execute({ ...request, ...(plan.confirmation_token ? { confirmation_token: plan.confirmation_token } : {}) });
      const summary = `${plan.summary}${receipt.backup_path ? `；备份：${receipt.backup_path}` : ""}`;
      return {
        ok: receipt.ok,
        summary,
        detail: JSON.stringify(receipt.output ?? ""),
        data: { audit_id: receipt.audit_id, backup_path: receipt.backup_path, risk: plan.risk },
        ...(receipt.backup_path ? { evidence_refs: [receipt.backup_path] } : {}),
      };
    } catch (error) {
      return { ok: false, summary: `${plan.summary}（执行失败）`, detail: error instanceof Error ? error.message : String(error) };
    }
  };

  const systemActions: SystemActions = {
    listApps: () => runSystemAction("app.list"),
    startApp: (appId) => runSystemAction("app.start", appId),
    stopApp: (appId) => runSystemAction("app.stop", appId),
    restartApp: (appId) => runSystemAction("app.restart", appId),
    removeApp: (appId) => runSystemAction("app.remove", appId),
    listPlugins: () => runSystemAction("plugin.list"),
    enablePlugin: (pluginId) => runSystemAction("plugin.enable", pluginId),
    disablePlugin: (pluginId) => runSystemAction("plugin.disable", pluginId),
    removePlugin: (pluginId) => runSystemAction("plugin.remove", pluginId),
    changeAgentModel: (role, binding) => {
      try {
        config.setAgentModel(role, { provider_id: binding.provider_id, model: binding.model });
        config.save();
        const resolved = config.resolveAgentModel(role);
        return {
          ok: true,
          summary: `已切换 ${role} 的模型：${binding.provider_id}/${binding.model}（密钥已配置=${resolved.has_key}）`,
          data: { role, provider_id: binding.provider_id, model: binding.model, has_key: resolved.has_key },
        };
      } catch (error) {
        return { ok: false, summary: `切换模型失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
    setPrompt: (role, prompt) => {
      try {
        if (role === "conductor") config.setConductorPrompt(prompt);
        else config.setSystemPrompt(role, prompt);
        config.save();
        return { ok: true, summary: `已更新 ${role} 的系统提示词（${prompt.length} 字）`, data: { role, length: prompt.length } };
      } catch (error) {
        return { ok: false, summary: `更新提示词失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
    delegateProject: (goal, conductorSessionId) => ({
      ok: true,
      summary: `已把项目委派给项目总调度（conductor 会话 ${conductorSessionId}）：${goal}`,
      data: { session_id: conductorSessionId, goal },
    }),
  };

  const configBridge: ConfigBridge = {
    setAgentModel: (role, binding): ConfigBridgeResult => {
      try {
        config.setAgentModel(role, { provider_id: binding.provider_id, model: binding.model });
        config.save();
        return { ok: true, summary: `已切换 ${role} 模型为 ${binding.provider_id}/${binding.model}` };
      } catch (error) {
        return { ok: false, summary: `切换失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
    setSystemPrompt: (role, prompt): ConfigBridgeResult => {
      try {
        config.setSystemPrompt(role, prompt);
        config.save();
        return { ok: true, summary: `已更新 ${role} 系统提示词（${prompt.length} 字）` };
      } catch (error) {
        return { ok: false, summary: `更新失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
    setConductorPrompt: (prompt): ConfigBridgeResult => {
      try {
        config.setConductorPrompt(prompt);
        config.save();
        return { ok: true, summary: `已更新总调度提示词（${prompt.length} 字）` };
      } catch (error) {
        return { ok: false, summary: `更新失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
    listAgents: () =>
      config.listAgents().map((agent) => {
        const resolved = config.resolveAgentModel(agent.role);
        return { role: agent.role, name: agent.name, provider_id: resolved.provider_id, model: resolved.model, enabled: agent.enabled };
      }),
    getTokenUsage: () => {
      const budget = config.load().token_budget;
      return {
        used_tokens: budget.used_tokens,
        limit_tokens: budget.limit_tokens,
        remaining_tokens: Math.max(0, budget.limit_tokens - budget.used_tokens),
      };
    },
  };

  const ledger: LedgerSink = {
    recordIncome: async (entry) => {
      const request = money.createRequest({
        amount_cny: entry.amount_cny,
        client: entry.client || "示例客户（虚构）",
        purpose: entry.basis,
        method: "manual",
      });
      await money.persist();
      return { ok: true, request_id: request.id, status: request.status, note: "演示资金渠道：需人工确认到账（steward money --action confirm）" };
    },
    recordExpense: async (entry) => {
      const dir = join(root, ".steward", "money");
      await mkdir(dir, { recursive: true });
      await appendFile(
        join(dir, "expenses.jsonl"),
        JSON.stringify({ at: new Date().toISOString(), amount_cny: entry.amount_cny, payee: entry.payee, basis: entry.basis, session_id: entry.session_id }) + "\n",
        "utf8",
      );
      return { ok: true };
    },
  };

  const resolver = createModelResolverFromConfig(config as never);

  const harness = createHarnessAgentExecutor(config);

  const orchestrator = new OrchestratorEngine({
    resolver,
    root: join(root, "runs"),
    ...(options.autoApprove === true ? { autoApprove: true } : {}),
    systemActions,
    configBridge,
    ledger,
    ...(harness.executor ? { agentExecutor: harness.executor } : {}),
  });
  orchestratorRef = orchestrator;

  return { root, config, orchestrator, system, money, harness };
}

function sessionSummary(runtime: Runtime, session: OrchestratorSession) {
  const detail: RunDetail = runtime.orchestrator.getRunDetail(session.id);
  const turns = detail.turns;
  const turnsByRole: Record<string, number> = {};
  for (const turn of turns) turnsByRole[turn.agent_role] = (turnsByRole[turn.agent_role] ?? 0) + 1;
  const tokensUsed = turns.reduce((sum, turn) => sum + turn.tokens, 0);
  const modelModes = [...new Set(turns.map((turn) => turn.model_mode ?? "unknown"))];
  const pending = session.plan.filter((step) => step.status !== "done" && step.status !== "blocked");
  return {
    session_id: session.id,
    kind: session.kind,
    status: session.status,
    goal: session.goal,
    title: session.title,
    parent_id: session.parent_id ?? null,
    child_sessions: session.child_sessions ?? [],
    budget_cny: session.budget_cny,
    token_limit: session.token_limit,
    tokens_used: tokensUsed,
    model_modes: modelModes,
    plan: session.plan,
    pending_steps: pending.map((step) => ({
      step: step.step,
      agent_role: step.agent_role,
      action: step.action,
      status: step.status,
      risk: step.action_plan?.risk,
      requires_confirmation: step.action_plan?.requires_confirmation ?? false,
      summary: step.summary,
    })),
    approvals: session.approvals ?? {},
    turns_by_role: turnsByRole,
    turns: turns.map((turn: AgentTurn) => ({
      seq: turn.seq,
      at: turn.at,
      agent_role: turn.agent_role,
      input_summary: turn.input_summary,
      output_summary: turn.output_summary,
      tokens: turn.tokens,
      status: turn.status,
      model_mode: turn.model_mode ?? "unknown",
      evidence_refs: turn.evidence_refs,
    })),
    messages: session.messages.slice(-8),
    evidence: detail.evidence,
    evidence_dir: runtime.orchestrator.evidenceDir(session.id),
    audit_count: runtime.orchestrator.auditCount,
  };
}

async function advance(runtime: Runtime, sessionId: string, maxSteps = 40): Promise<OrchestratorSession> {
  let session = runtime.orchestrator.getSession(sessionId);
  let stepCount = 0;
  while ((session.status === "planning" || session.status === "running") && stepCount < maxSteps) {
    session = await runtime.orchestrator.runStep(sessionId);
    stepCount += 1;
  }
  return session;
}

function printSession(runtime: Runtime, session: OrchestratorSession): void {
  const summary = sessionSummary(runtime, session);
  console.log(`会话 ${summary.session_id}（${summary.kind === "system" ? "系统总控 supervisor" : "项目总调度 conductor"}）`);
  console.log(`  目标：${summary.goal}`);
  console.log(`  状态：${summary.status}；Token：${summary.tokens_used}/${summary.token_limit}；模型来源：${summary.model_modes.join("/")}`);
  if (summary.plan.length > 0) {
    console.log("  计划：");
    for (const step of summary.plan) {
      const risk = step.action_plan?.risk ? ` risk=${step.action_plan.risk}` : "";
      const confirm = step.action_plan?.requires_confirmation ? " 需确认" : "";
      console.log(`    [${step.step}] ${step.agent_role} ${step.action} - ${step.summary}（${step.status}${risk}${confirm}）`);
    }
  }
  console.log(`  每轮摘要（${summary.turns.length} 轮）：`);
  for (const turn of summary.turns) console.log(`    #${turn.seq} [${turn.agent_role}] ${turn.input_summary} → ${turn.output_summary}（${turn.status}, ${turn.model_mode}, ${turn.tokens} tokens）`);
  if (summary.pending_steps.length > 0) {
    console.log("  ⏳ 待处理步骤（需人工确认/继续）：");
    for (const step of summary.pending_steps) console.log(`    [${step.step}] ${step.action} → ${step.summary}`);
    console.log(`  确认：steward chat --action approve --session ${session.id} --step <步骤号>`);
    console.log(`  拒绝：steward chat --action reject --session ${session.id} --step <步骤号>`);
  }
  console.log(`  证据目录：${summary.evidence_dir}`);
  console.log(`  证据文件：${summary.evidence.map((item) => `${item.kind}:${item.title}`).join("、") || "（无）"}`);
}

export async function cmdAgent(parsed: AgentArgs): Promise<number> {
  const root = findRepoRoot();
  const json = parsed.flags.json === true;
  const action = (flag(parsed.flags, "action") ?? "start").toLowerCase();
  const requestedKind: SessionKind | undefined =
    parsed.flags.supervisor === true ? "system" : parsed.flags.project === true ? "project" : (flag(parsed.flags, "kind") as SessionKind | undefined);
  // 默认自动执行低/中风险动作；高危/删除类动作仍由引擎强制人工确认（atmost 需二次确认）。
  const autoApprove = parsed.flags.manual === true ? false : true;
  let runtime: Runtime;
  try {
    runtime = createRuntime(root, { autoApprove });
  } catch (error) {
    console.error(`初始化失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  try {
    switch (action) {
      case "start":
      case "send": {
        const goal = flag(parsed.flags, "goal");
        if (!goal || goal.trim().length === 0) {
          console.error('用法：steward chat --goal "帮我做一个报价单页面" [--kind system|project] [--auto] [--json]');
          return 2;
        }
        const kind: SessionKind = requestedKind ?? "project";
        const session = runtime.orchestrator.createSession({
          goal: goal.trim(),
          kind,
          budget_cny: flagNum(parsed.flags, "budget", 0) > 0 ? flagNum(parsed.flags, "budget", 0) : undefined,
          ...(flag(parsed.flags, "token-limit") ? { token_limit: flagNum(parsed.flags, "token-limit", 0) } : {}),
        } as never);
        await runtime.orchestrator.sendMessage(session.id, goal.trim());
        if (action === "start") {
          await runtime.orchestrator.startProject(session.id);
        }
        const advanced = await advance(runtime, session.id);
        if (json) printJson(sessionSummary(runtime, advanced));
        else printSession(runtime, advanced);
        return advanced.status === "blocked" ? 1 : 0;
      }
      case "run": {
        const sessionId = flag(parsed.flags, "session");
        if (!sessionId) {
          console.error("用法：steward chat --action run --session <id>");
          return 2;
        }
        const advanced = await advance(runtime, sessionId);
        if (json) printJson(sessionSummary(runtime, advanced));
        else printSession(runtime, advanced);
        return 0;
      }
      case "approve":
      case "reject": {
        const sessionId = flag(parsed.flags, "session");
        const step = flagNum(parsed.flags, "step", 0);
        if (!sessionId || step <= 0) {
          console.error(`用法：steward chat --action ${action} --session <id> --step <步骤号>`);
          return 2;
        }
        runtime.orchestrator.decideApproval(sessionId, step, action === "approve" ? "approve" : "reject", "human:cli");
        const advanced = action === "approve" ? await advance(runtime, sessionId) : runtime.orchestrator.getSession(sessionId);
        if (json) printJson(sessionSummary(runtime, advanced));
        else printSession(runtime, advanced);
        return 0;
      }
      case "interrupt": {
        const sessionId = flag(parsed.flags, "session");
        if (!sessionId) {
          console.error("用法：steward chat --action interrupt --session <id>");
          return 2;
        }
        const session = runtime.orchestrator.interrupt(sessionId, flag(parsed.flags, "reason") ?? "用户打断");
        if (json) printJson(sessionSummary(runtime, session));
        else printSession(runtime, session);
        return 0;
      }
      case "resume": {
        const sessionId = flag(parsed.flags, "session");
        if (!sessionId) {
          console.error("用法：steward chat --action resume --session <id>");
          return 2;
        }
        runtime.orchestrator.resume(sessionId);
        const advanced = await advance(runtime, sessionId);
        if (json) printJson(sessionSummary(runtime, advanced));
        else printSession(runtime, advanced);
        return 0;
      }
      case "list": {
        const sessions = runtime.orchestrator.listSessions().map((session) => ({
          id: session.id,
          kind: session.kind,
          status: session.status,
          goal: session.goal,
          updated_at: session.updated_at,
          turns: Object.values(session.children).reduce((sum, list) => sum + list.length, 0),
        }));
        if (json) printJson({ ok: true, sessions, supervisor_role: SUPERVISOR_ROLE, token_budget: runtime.config.load().token_budget });
        else {
          console.log(`会话（${sessions.length}）`);
          for (const session of sessions) console.log(`- ${session.id} | ${session.kind} | ${session.status} | ${session.goal} | ${session.turns} 轮`);
        }
        return 0;
      }
      case "detail": {
        const sessionId = flag(parsed.flags, "session");
        if (!sessionId) {
          console.error("用法：steward chat --action detail --session <id>");
          return 2;
        }
        const session = runtime.orchestrator.getSession(sessionId);
        if (json) printJson(sessionSummary(runtime, session));
        else printSession(runtime, session);
        return 0;
      }
      case "logs": {
        const snapshot = runtime.orchestrator.readLogs(flag(parsed.flags, "session"));
        if (json) printJson({ ok: true, snapshot });
        else console.log(JSON.stringify(snapshot, null, 2));
        return 0;
      }
      default:
        console.error(`未知 action：${action}（start|run|approve|reject|interrupt|resume|list|detail|logs）`);
        return 2;
    }
  } catch (error) {
    console.error(`总调度命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function cmdSystem(parsed: AgentArgs): Promise<number> {
  const root = findRepoRoot();
  const json = parsed.flags.json === true;
  const action = (flag(parsed.flags, "action") ?? "info").toLowerCase();
  try {
    const config = new ConfigEngine({ root: join(root, ".steward") });
    config.load();
    const policy = config.getSystemPolicy();
    const system = new SystemController({
      root,
      state_dir: join(root, ".steward", "system"),
      apps: buildManagedApps(root, config),
      plugins_dir: join(root, policy.plugins_dir),
    });
    switch (action) {
      case "info": {
        const info = system.systemInfo();
        const apps = system.listApps();
        const plugins = system.listPlugins();
        if (json) printJson({ ok: true, info, apps, plugins, policy });
        else {
          console.log(`系统信息：${info.platform} ${info.arch}；Node ${info.node_version}；内存 ${(info.free_memory_bytes / 1024 / 1024).toFixed(0)}MB 可用 / ${(info.total_memory_bytes / 1024 / 1024).toFixed(0)}MB 总`);
          console.log(`受管应用（${apps.length}）：${apps.map((app) => app.id).join(" ")}`);
          console.log(`插件（${plugins.length}）：${plugins.map((plugin) => `${plugin.id}${plugin.enabled ? "✓" : "✗"}`).join(" ") || "（无）"}`);
        }
        return 0;
      }
      case "list": {
        const apps = system.listApps();
        const plugins = system.listPlugins();
        if (json) printJson({ ok: true, apps, plugins });
        else {
          console.log("受管应用：");
          for (const app of apps) console.log(`- ${app.id} | ${app.name}`);
          console.log("插件：");
          for (const plugin of plugins) console.log(`- ${plugin.id} | ${plugin.name} | ${plugin.enabled ? "启用" : "禁用"}`);
        }
        return 0;
      }
      case "plan": {
        const request = {
          id: newActionRequestId(),
          action: (flag(parsed.flags, "op") ?? "app.list") as never,
          ...(flag(parsed.flags, "target") ? { target: flag(parsed.flags, "target") } : {}),
          reason: flag(parsed.flags, "reason") ?? "用户请求",
        };
        const plan = system.plan(request as never);
        if (json) printJson({ ok: plan.allowed, plan });
        else console.log(`${plan.summary}\n风险：${plan.risk}；需要确认：${plan.requires_confirmation}；允许：${plan.allowed}`);
        return plan.allowed ? 0 : 1;
      }
      case "exec": {
        const request = {
          id: newActionRequestId(),
          action: (flag(parsed.flags, "op") ?? "app.list") as never,
          ...(flag(parsed.flags, "target") ? { target: flag(parsed.flags, "target") } : {}),
          reason: flag(parsed.flags, "reason") ?? "用户请求",
        };
        const plan = system.plan(request as never);
        if (!plan.allowed) {
          console.error(`拒绝执行：${plan.summary}`);
          return 2;
        }
        if (plan.requires_confirmation && parsed.flags.yes !== true) {
          console.error(`该动作风险为 ${plan.risk}，需要二次确认：请追加 --yes 再执行（备份到回收站）`);
          if (json) printJson({ ok: false, requires_confirmation: true, plan });
          return 2;
        }
        const receipt = await system.execute({ ...request, ...(plan.confirmation_token ? { confirmation_token: plan.confirmation_token } : {}) } as never);
        if (json) printJson({ ok: receipt.ok, receipt });
        else console.log(`${receipt.ok ? "执行成功" : "执行失败"}：${JSON.stringify(receipt.output)}${receipt.backup_path ? `；备份：${receipt.backup_path}` : ""}`);
        return receipt.ok ? 0 : 1;
      }
      case "audit": {
        const entries = system.auditTrail(flagNum(parsed.flags, "limit", 20));
        if (json) printJson({ ok: true, audit: entries });
        else for (const entry of entries) console.log(`${entry.at} | ${entry.action} | ${entry.target ?? "-"} | ${entry.risk ?? "-"} | ok=${entry.ok} | ${entry.reason ?? ""}`);
        return 0;
      }
      default:
        console.error(`未知 action：${action}（info|list|plan|exec|audit）`);
        return 2;
    }
  } catch (error) {
    console.error(`系统命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** 读取 JSON 文件（epay 回调参数等）。 */
export async function readJsonFile(path: string): Promise<Record<string, string> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}
