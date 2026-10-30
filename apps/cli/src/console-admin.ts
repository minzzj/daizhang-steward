/**
 * v1.1：把真实 `ConfigEngine` + 仓库 `runs/` 数据接入控制台管理端（ConsoleAdminProvider）。
 * 运营页（看板/账本等）仍使用演示 data provider；管理页（配置中心/智能体/后台/数据）使用真实数据。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConfigEngine,
  isFeatureName,
  isRunMode,
  maskBankCard,
  type FeatureName,
  type RunMode as ConfigRunMode,
} from "../../../packages/steward-config/src/index.js";
import {
  RUN_MODE_LABELS,
  type AgentConfig as ConsoleAgentConfig,
  type AdminStatus,
  type ConfigSaveResult,
  type ConsoleAdminProvider,
  type ConsoleAgentInfo,
  type DataStats,
  type FlowRun,
  type ModeApplyResult,
  type PaymentsConfig,
  type QueueItem,
  type RunMode,
  type StewardConfig as ConsoleStewardConfig,
  type TokenBudgetConfig,
} from "../../../packages/steward-console/src/index.js";

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** 目录大小（MB，保留 1 位）。 */
function dirSizeMb(dir: string): number {
  let total = 0;
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(current, name);
      try {
        const st = statSync(path);
        if (st.isDirectory()) walk(path);
        else total += st.size;
      } catch {
        /* ignore */
      }
    }
  };
  if (!existsSync(dir)) return 0;
  walk(dir);
  return Math.round((total / (1024 * 1024)) * 10) / 10;
}

export interface ConfigAdminProviderOptions {
  /** 仓库根目录（默认取 engine 配置所在目录的父级由调用方传入）。 */
  repo_root: string;
  /** 运行时数据目录（runs/）。 */
  data_root?: string;
}

export function createConfigAdminProvider(engine: ConfigEngine, options: ConfigAdminProviderOptions): ConsoleAdminProvider {
  const repoRoot = options.repo_root;
  const runsDir = options.data_root ?? join(repoRoot, "runs");
  const toConsoleConfig = (): ConsoleStewardConfig => engine.load() as unknown as ConsoleStewardConfig;

  const applyPartial = (partial: Record<string, unknown>): string[] => {
    const errors: string[] = [];
    try {
      if (typeof partial.mode === "string" && isRunMode(partial.mode)) engine.setMode(partial.mode as ConfigRunMode);
      if (partial.profile && typeof partial.profile === "object") engine.setProfile(partial.profile as never);
      if (partial.budgets && typeof partial.budgets === "object") engine.setBudgets(partial.budgets as never);
      if (partial.token_budget && typeof partial.token_budget === "object") engine.setTokenBudget(partial.token_budget as never);
      if (partial.approval && typeof partial.approval === "object") engine.setApprovalPolicy(partial.approval as never);
      if (partial.data && typeof partial.data === "object") engine.setData(partial.data as never);
      if (partial.runtime && typeof partial.runtime === "object") engine.setRuntimeSettings(partial.runtime as never);
      if (partial.features && typeof partial.features === "object") {
        for (const [name, value] of Object.entries(partial.features as Record<string, unknown>)) {
          if (!isFeatureName(name)) continue;
          const toggle = (value ?? {}) as { enabled?: boolean; requires_approval?: boolean; requiresApproval?: boolean; note?: string };
          const update: { enabled: boolean; requiresApproval?: boolean; note?: string } = { enabled: toggle.enabled !== false };
          const requiresApproval = toggle.requiresApproval ?? toggle.requires_approval;
          if (typeof requiresApproval === "boolean") update.requiresApproval = requiresApproval;
          if (typeof toggle.note === "string") update.note = toggle.note;
          engine.setFeature(name as FeatureName, update);
        }
      }
      if (partial.payments && typeof partial.payments === "object") {
        const payments = partial.payments as Record<string, unknown>;
        if (payments.payout_account && typeof payments.payout_account === "object") {
          const account = payments.payout_account as Record<string, unknown>;
          const update: Record<string, string> = {};
          if (typeof account.holder === "string") update.holder = account.holder;
          if (typeof account.bank_name === "string") update.bank_name = account.bank_name;
          for (const key of ["card_no", "wechat_id", "alipay_id"]) {
            if (typeof account[key] === "string") update[key] = account[key] as string;
          }
          const cardMasked = account.card_no_masked;
          if (typeof cardMasked === "string" && /[0-9]{4}/.test(cardMasked) && !update.card_no) {
            update.card_no = `6222${String(cardMasked).replace(/\D/g, "").slice(-4)}`;
          }
          if (typeof account.type === "string") update.type = account.type;
          engine.setPayoutAccount(update as never);
        }
        if (payments.invoice && typeof payments.invoice === "object") engine.setInvoiceConfig(payments.invoice as never);
        const policy: { require_dual_review?: boolean; sign_contract?: boolean } = {};
        if (typeof payments.require_dual_review === "boolean") policy.require_dual_review = payments.require_dual_review;
        if (typeof payments.sign_contract === "boolean") policy.sign_contract = payments.sign_contract;
        engine.setPaymentsPolicy(policy);
        if (Array.isArray(payments.providers)) {
          for (const item of payments.providers as Array<Record<string, unknown>>) {
            if (typeof item.id !== "string") continue;
            const update: { enabled?: boolean; mode?: never; note?: string } = {};
            if (typeof item.enabled === "boolean") update.enabled = item.enabled;
            if (typeof item.mode === "string") update.mode = item.mode as never;
            engine.setPaymentProvider(item.id, update);
          }
        }
      }
      if (Array.isArray(partial.agents)) {
        for (const item of partial.agents as Array<Record<string, unknown>>) {
          if (typeof item.role !== "string") continue;
          const update: { enabled?: boolean; autonomy?: never; token_limit?: number; tools?: string[] } = {};
          if (typeof item.enabled === "boolean") update.enabled = item.enabled;
          if (typeof item.autonomy === "string") update.autonomy = item.autonomy as never;
          if (typeof item.token_limit === "number") update.token_limit = item.token_limit;
          if (Array.isArray(item.tools)) update.tools = item.tools as string[];
          engine.setAgentConfig(item.role, update);
        }
      }
      const validation = engine.validate();
      if (!validation.ok) errors.push(...validation.errors.map((e) => e.message ?? String(e)));
      engine.save();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return errors;
  };

  const toAgentInfo = (agent: ReturnType<ConfigEngine["listAgents"]>[number]): ConsoleAgentInfo => {
    const usage = engine.agentUsage(agent.role);
    const history = engine.tokenUsageHistory().filter((entry) => entry.agent_role === agent.role).slice(-3);
    const today = new Date().toISOString().slice(0, 10);
    const todayActions = engine.tokenUsageHistory().filter((entry) => entry.agent_role === agent.role && entry.at.startsWith(today)).length;
    return {
      ...agent,
      title: agent.name,
      status: agent.enabled ? "idle" : "disabled",
      current_task: "",
      today_actions: todayActions,
      tokens_used: usage?.tokens ?? 0,
      logs: history.map((entry) => `${entry.at} ${entry.action} +${entry.amount} tokens${entry.ok ? "" : `（${entry.reason ?? "拒绝"}）`}`),
      enterprise_only: false,
    };
  };

  const listRuns = (limit = 6): string[] => {
    if (!existsSync(runsDir)) return [];
    return readdirSync(runsDir)
      .filter((name) => name.startsWith("run-"))
      .map((name) => ({ name, mtime: statSync(join(runsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((item) => item.name);
  };

  const flowForRun = (runId: string): FlowRun => {
    const dir = join(runsDir, runId);
    const result = readJson(join(dir, "run-result.json")) as Record<string, unknown> | null;
    const meta = readJson(join(dir, "meta.json")) as Record<string, unknown> | null;
    const timeline = readJson(join(dir, "agents-timeline.json")) as Array<Record<string, unknown>> | null;
    const startedAt = String(meta?.startedAt ?? result?.started_at ?? new Date(statSync(dir).mtimeMs).toISOString());
    const goal = String(result?.project_name ?? meta?.goal ?? "运行记录");
    const events = (timeline ?? []).map((step, index) => ({
      seq: Number(step.seq ?? index + 1),
      phase: String(step.stage ?? "action"),
      ts: String(step.at ?? startedAt),
      actor: String(step.agent ?? "operator"),
      summary: `${String(step.action ?? "")}：${String(step.detail ?? "")}`,
    }));
    if (events.length === 0) {
      const eventsFile = join(dir, "events.jsonl");
      if (existsSync(eventsFile)) {
        const lines = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).slice(-20);
        for (const line of lines) {
          const event = JSON.parse(line) as Record<string, unknown>;
          events.push({
            seq: Number(event.seq ?? events.length + 1),
            phase: String(event.action ?? "event"),
            ts: String(event.ts ?? startedAt),
            actor: String(event.object_type ?? "system"),
            summary: `${String(event.action ?? "")} ${String(event.result ?? "")}`,
          });
        }
      }
    }
    const ok = result?.ok === true;
    return {
      run_id: runId,
      goal,
      started_at: startedAt,
      status: ok ? "done" : events.length > 0 ? "done" : "failed",
      events,
    };
  };

  const dataStats = (cleared = false): DataStats => {
    const runIds = listRuns(1000);
    let evidenceFiles = 0;
    for (const runId of runIds) {
      try {
        evidenceFiles += readdirSync(join(runsDir, runId)).length;
      } catch {
        /* ignore */
      }
    }
    let ledgerProjects = 0;
    const domainDir = join(repoRoot, ".steward", "domain");
    if (existsSync(domainDir)) {
      try {
        ledgerProjects = existsSync(join(domainDir, "state.json")) ? 1 : 0;
      } catch {
        ledgerProjects = 0;
      }
    }
    return {
      runs: runIds.length,
      evidence_files: evidenceFiles,
      ledger_projects: ledgerProjects,
      config_updated_at: engine.load().updated_at,
      data_root: runsDir,
      disk_usage_mb: dirSizeMb(runsDir),
      cleared,
    };
  };

  return {
    getConfig: () => toConsoleConfig(),
    saveConfig: (partial) => {
      const errors = applyPartial(partial as unknown as Record<string, unknown>);
      const result: ConfigSaveResult = { ok: errors.length === 0, config: toConsoleConfig(), errors };
      return result;
    },
    applyMode: (mode: RunMode): ModeApplyResult => {
      try {
        const diff = engine.setMode(mode as ConfigRunMode);
        engine.save();
        return { ok: true, config: toConsoleConfig(), mode, diff: diff.changed, errors: [] };
      } catch (error) {
        return { ok: false, config: toConsoleConfig(), mode, diff: [], errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    resetConfig: (mode) => {
      engine.reset((mode ?? "personal") as ConfigRunMode);
      engine.save();
      return toConsoleConfig();
    },
    exportConfig: () => engine.export(),
    getAgents: () => engine.listAgents().map(toAgentInfo),
    getAgentDetail: (role) => {
      const agent = engine.listAgents().find((item) => item.role === role);
      return agent ? toAgentInfo(agent) : null;
    },
    updateAgent: (role, patch: Partial<ConsoleAgentConfig>) => {
      const update: { enabled?: boolean; autonomy?: never; token_limit?: number; tools?: string[] } = {};
      if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
      if (typeof patch.autonomy === "string") update.autonomy = patch.autonomy as never;
      if (typeof patch.token_limit === "number") update.token_limit = patch.token_limit;
      if (Array.isArray(patch.tools)) update.tools = patch.tools;
      try {
        engine.setAgentConfig(role, update);
        engine.save();
        return { ok: true, config: toConsoleConfig(), errors: [] } satisfies ConfigSaveResult;
      } catch (error) {
        return { ok: false, config: toConsoleConfig(), errors: [error instanceof Error ? error.message : String(error)] } satisfies ConfigSaveResult;
      }
    },
    getFlow: (filter) => {
      let runs = listRuns(filter?.limit ?? 6).map(flowForRun);
      if (filter?.run_id) runs = runs.filter((run) => run.run_id === filter.run_id);
      if (filter?.phase) runs = runs.filter((run) => run.events.some((event) => event.phase === filter.phase));
      return runs;
    },
    getQueue: (): QueueItem[] => [],
    getDataStats: () => dataStats(),
    resetData: () => {
      const result = engine.resetData(runsDir);
      const stats = dataStats(true);
      return {
        ok: true,
        cleared: stats,
        removed: [...result.deleted, ...result.missing.map((path) => path)],
      };
    },
    resetDemoData: () => {
      engine.reset("demo");
      engine.save();
      return { ok: true, stats: dataStats() };
    },
    getTokenBudget: (): TokenBudgetConfig => engine.load().token_budget as unknown as TokenBudgetConfig,
    getPaymentConfig: (): PaymentsConfig => engine.load().payments as unknown as PaymentsConfig,
    getAdminStatus: (): AdminStatus => {
      const config = engine.load();
      const lastRuns = listRuns(1);
      return {
        mode: config.profile.mode as unknown as RunMode,
        mode_label: RUN_MODE_LABELS[config.profile.mode as keyof typeof RUN_MODE_LABELS] ?? config.profile.mode,
        budget_left_cny: config.budgets.month_cny,
        token_remaining: config.token_budget.limit_tokens - config.token_budget.used_tokens,
        token_limit_tokens: config.token_budget.limit_tokens,
        token_used_tokens: config.token_budget.used_tokens,
        halted: false,
        last_event_at: lastRuns[0] ? new Date(statSync(join(runsDir, lastRuns[0])).mtimeMs).toISOString() : null,
        config_updated_at: config.updated_at,
      };
    },
    auditTrail: () =>
      engine.auditTrail(50).map((entry) => ({
        at: entry.at,
        actor: "config-engine",
        action: entry.action,
        target: entry.object,
        result: entry.result,
        reason: entry.reason ?? "",
      })),
  };
}

/** 掩码工具透出（供 CLI 自检/演示使用）。 */
export { maskBankCard };
