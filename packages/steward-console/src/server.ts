/**
 * packages/steward-console/src/server.ts
 *
 * 本地 Web 控制台 HTTP 服务（零第三方依赖，只用 node:http）：
 * - 只允许监听回环地址（默认 127.0.0.1:4180），非回环 host 直接拒绝启动；
 * - 页面：看板 / 项目时间线 / 账本 / 审批 / 月报 / 接管；静态资源同源内联提供（无 CDN/外链）；
 * - 读接口无需 token；**写接口必须带 `X-Steward-Token`**（默认随机，构造时返回给调用方，
 *   并通过 `<meta name="steward-token">` 注入页面，供同源 JS 使用）；
 * - token 不写日志、不进 URL；响应带 CSP / nosniff / frame-ancestors 等安全头；
 * - `close()` 关闭监听并断开 keep-alive 连接（E2E 用 `port: 0` 时确保不残留端口）。
 *
 * 安全边界（详见 README）：本地单机、单用户、无 HTTPS；不做多用户鉴权/权限模型。
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, normalize, sep } from "node:path";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { BASE_CSS, CLIENT_JS } from "./assets.js";
import { ADMIN_JS, PRO_CSS } from "./assets-admin.js";
import { CHAT_CSS, CHAT_JS } from "./assets-chat.js";
import { SYSTEM_CSS, SYSTEM_JS } from "./assets-system.js";
import {
  renderAgentsPage,
  renderBackendPage,
  renderDataPage,
  renderProjectsPage,
  renderSettingsPage,
  type SettingsPageInput,
} from "./pages-admin.js";
import {
  renderAgentRolePage,
  renderChatPage,
  renderChatSessionPage,
  renderMoneyPage,
  renderMoneyRequestPage,
  renderRunDetailPage,
} from "./pages-chat.js";
import {
  renderApprovalsPage,
  renderDashboardPage,
  renderErrorPage,
  renderLedgerPage,
  renderProjectPage,
  renderReportPage,
  renderTakeoverPage,
  type ConsolePageName,
  type PageRenderOptions,
  type ShellStatus,
} from "./pages.js";
import type {
  ConsoleDataProvider,
  ConsoleLedgerFilter,
  ConsoleSummaryLevel,
  ConsoleTakeoverStatus,
} from "./provider.js";
import type { AgentConfig, ConsoleAdminProvider, RunMode, StewardConfig } from "./admin.js";
import {
  MONEY_METHOD_LABELS,
  MONEY_METHODS,
  chatAgentTitle,
  createDemoChatProvider,
  type AgentModelBinding,
  type ChatSessionStatus,
  type ConsoleChatProvider,
  type ModelProviderConfig,
  type MoneyMethod,
} from "./chat.js";
import { createDemoSystemProvider, type ConsoleSystemProvider, type EpayConfig, type EpayMethod } from "./system.js";
import { createDemoChatEngineProvider, type ConsoleChatEngineProvider, type ConsoleChatPart } from "./conversations.js";
import { renderChatHomePage } from "./pages-chatgpt.js";
import { GPT_CSS, GPT_JS } from "./assets-chatgpt.js";
import { createDemoRuntimeProvider, type ConsoleRuntimeEvent, type ConsoleRuntimeProvider } from "./runtime.js";
import { renderSystemPage } from "./pages-system.js";
import { renderArtifactsCenterPage, renderReportsCenterPage } from "./pages-chat.js";
import type { HarnessArtifactView, HarnessReportView, RunMetricsView, RuntimeArtifactFilter, RuntimeReportFilter } from "./runtime.js";
import type { HarnessAgentSummary } from "./pages-admin.js";
import type { MoneyPageInput } from "./pages-chat.js";

export const CONSOLE_DEFAULT_HOST = "127.0.0.1";
export const CONSOLE_DEFAULT_PORT = 4180;

/** 只允许回环地址：控制台是本机单机界面，不允许对外网/局域网暴露。 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface ConsoleServerOptions {
  provider: ConsoleDataProvider;
  /** 管理侧 provider（配置中心/智能体中心/后台/数据管理）；不传时管理页与 API 返回 503（向后兼容）。 */
  adminProvider?: ConsoleAdminProvider;
  /**
   * 对话/智能体记录/证据/变现/模型配置 provider（v1.2）。
   * 缺省：自动启用 `createDemoChatProvider()`（本地演示可用，确认到账会写演示账本）；
   * 传 `null`：显式关闭（相关页面/API 返回 503）。真实 Orchestrator/MoneyEngine 接线时传入适配器。
   */
  chatProvider?: ConsoleChatProvider | null;
  /**
   * 系统总控 provider（v1.3：/system 超级总调度、程序/插件、危险动作、易支付配置）。
   * 缺省：自动启用内置演示实现；传 `null` 关闭 /system 与易支付 API。
   */
  systemProvider?: ConsoleSystemProvider | null;
  /** v1.5.1：ChatGPT 式对话总控 provider（默认 createDemoChatEngineProvider；null 关闭 /chat 新界面）。 */
  chatEngineProvider?: ConsoleChatEngineProvider | null;
  /**
   * v1.5.1：任务类消息是否自动创建演示 runtime run（真实 ChatEngine 自执行时设为 false，避免双跑）。
   * 缺省 true（演示/兼容行为）。
   */
  autoCreateChatRuns?: boolean;
  /**
   * 运行时 provider（v1.4：发送即执行 + SSE 实时流）。
   * 缺省：自动启用内置 `createDemoRuntimeProvider()`；传 `null` 关闭 /api/chat/runs 与 SSE（页面 503）。
   */
  runtimeProvider?: ConsoleRuntimeProvider | null;
  /** 默认 127.0.0.1；只允许回环地址（localhost/::1 等价放行）。 */
  host?: string;
  /** 默认 4180；传 0 表示随机端口（E2E/CI 推荐）。 */
  port?: number;
  /** 自定义写操作 token；缺省用 crypto.randomBytes(16) 随机生成。 */
  token?: string;
  /** 请求日志回调（只记录方法/路径/状态/耗时，不记录 token 与请求体）。 */
  log?: (line: string) => void;
}

export interface ConsoleServerHandle {
  server: Server;
  /** 实际监听地址（port 传 0 时为随机端口的真实 URL）。 */
  url: string;
  host: string;
  port: number;
  token: string;
  provider: ConsoleDataProvider;
  adminProvider?: ConsoleAdminProvider;
  chatProvider?: ConsoleChatProvider;
  /** v1.3：系统总控（/system、易支付配置）。 */
  systemProvider?: ConsoleSystemProvider;
  /** v1.4：运行时（发送即执行 + SSE 实时流）。 */
  runtimeProvider?: ConsoleRuntimeProvider;
  close(): Promise<void>;
}

export class ConsoleSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleSecurityError";
  }
}

/** 是否回环地址（控制台只允许这些 host）。 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new ConsoleSecurityError(
      `控制台只允许监听回环地址（127.0.0.1 / ::1 / localhost），拒绝 host=${host}。` +
        "本地单机界面不允许对外暴露。",
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    ...extra,
  };
}

/**
 * 创建并启动控制台服务。返回 `{server, url, token, close()}`（url 为实际监听地址）。
 */
export async function createConsoleServer(options: ConsoleServerOptions): Promise<ConsoleServerHandle> {
  const provider = options.provider;
  if (provider === null || typeof provider !== "object") {
    throw new Error("createConsoleServer 需要 provider（ConsoleDataProvider）");
  }
  const adminProvider = options.adminProvider;
  // v1.3：系统总控 provider（默认启用内置演示实现；显式传 null 关闭）
  const systemProvider: ConsoleSystemProvider | undefined =
    options.systemProvider === null ? undefined : options.systemProvider ?? createDemoSystemProvider();
  const chatProvider: ConsoleChatProvider | undefined =
    options.chatProvider === null
      ? undefined
      : options.chatProvider ??
        createDemoChatProvider({
          onIncome: async (input) => {
            if (provider.recordIncome === undefined) return null;
            try {
              const result = await provider.recordIncome({
                amount_cny: input.amount_cny,
                client: input.client,
                purpose: input.purpose,
                occurred_at: input.occurred_at,
                source_ref: input.source_ref,
              });
              return { entry_id: result.entry.id };
            } catch {
              return null;
            }
          },
          ...(systemProvider === undefined
            ? {}
            : {
                epayLinkBuilder: async (input: { amount_cny: number; client: string; purpose: string; out_trade_no: string }) =>
                  systemProvider.buildEpayPayLink(input),
              }),
        });
  // v1.4：运行时 provider（发送即执行 + SSE；默认启用内置演示实现；显式传 null 关闭）
  const runtimeProvider: ConsoleRuntimeProvider | undefined =
    options.runtimeProvider === null ? undefined : options.runtimeProvider ?? createDemoRuntimeProvider();
  const chatEngineProvider: ConsoleChatEngineProvider | undefined =
    options.chatEngineProvider === null ? undefined : options.chatEngineProvider ?? createDemoChatEngineProvider();
  let activeSseStreams = 0;

  // v1.5：产物/报告/指标只读访问（runtime 可选方法；缺省返回空，页面显示「暂不可用」）
  const listRuntimeArtifacts = async (filter?: RuntimeArtifactFilter): Promise<HarnessArtifactView[]> => {
    if (runtimeProvider?.listArtifacts === undefined) return [];
    try {
      return await runtimeProvider.listArtifacts(filter);
    } catch {
      return [];
    }
  };
  const listRuntimeReports = async (filter?: RuntimeReportFilter): Promise<HarnessReportView[]> => {
    if (runtimeProvider?.listReports === undefined) return [];
    try {
      return await runtimeProvider.listReports(filter);
    } catch {
      return [];
    }
  };
  const getRuntimeMetrics = async (runId: string): Promise<RunMetricsView | null> => {
    if (runtimeProvider?.getRunMetrics === undefined) return null;
    try {
      return await runtimeProvider.getRunMetrics(runId);
    } catch {
      return null;
    }
  };
  /** 每个智能体的 Harness 真实执行摘要（最近会话/tokens/工具/产物/报告）。 */
  const buildHarnessSummaries = async (roles: string[]): Promise<Record<string, HarnessAgentSummary>> => {
    const summaries: Record<string, HarnessAgentSummary> = {};
    if (runtimeProvider === undefined || runtimeProvider.listRuns === undefined) return summaries;
    const runs = await runtimeProvider.listRuns();
    const artifacts = await listRuntimeArtifacts();
    const reports = await listRuntimeReports();
    for (const role of roles) {
      const summary: HarnessAgentSummary = { label: "DeepSeek Harness 真实执行" };
      for (const run of runs) {
        const detail = runtimeProvider.getRunDetail === undefined ? null : runtimeProvider.getRunDetail(run.run_id);
        if (detail === null) continue;
        const agent = detail.agents.find((item) => item.agent_role === role);
        if (agent === undefined) continue;
        const events = runtimeProvider.eventLog === undefined ? [] : runtimeProvider.eventLog(run.run_id);
        const toolEvents = events.filter((event) => event.type === "harness.tool_call" && String(event.data.agent_role ?? "") === role);
        const startedMs = Date.parse(run.created_at);
        const updatedMs = Date.parse(run.updated_at);
        summary.session_id = run.session_id;
        summary.run_id = run.run_id;
        summary.recent_at = run.updated_at;
        summary.duration_ms = Number.isFinite(startedMs) && Number.isFinite(updatedMs) ? Math.max(0, updatedMs - startedMs) : 0;
        summary.tokens = agent.turns.reduce((sum, turn) => sum + turn.tokens, 0);
        summary.tools = toolEvents.length;
        summary.artifacts = artifacts.filter((item) => item.run_id === run.run_id && item.agent_role === role).length;
        summary.reports = reports.filter((item) => item.run_id === run.run_id && item.agent_role === role).length;
        summary.profile = "deepseek-harness@v1";
        summary.workspace = `runs/${run.session_id}/harness/`;
        const toolNames = [...new Set(toolEvents.map((event) => String(event.data.tool ?? "")).filter((name) => name !== ""))];
        summary.tool_names = toolNames;
        break;
      }
      summaries[role] = summary;
    }
    return summaries;
  };

  const host = options.host ?? CONSOLE_DEFAULT_HOST;
  assertLoopbackHost(host);
  const port = options.port ?? CONSOLE_DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`port 不合法：${String(port)}（0 表示随机端口）`);
  }
  const token = options.token ?? randomBytes(16).toString("hex");
  if (typeof token !== "string" || token.length < 8) {
    throw new Error("token 至少 8 个字符（写接口凭据）");
  }
  const log = options.log ?? (() => {});
  const startedAt = new Date().toISOString();

  const sendJson = (res: ServerResponse, statusCode: number, payload: unknown): number => {
    const body = `${JSON.stringify(payload)}\n`;
    res.writeHead(
      statusCode,
      baseHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body)),
      }),
    );
    res.end(body);
    return statusCode;
  };

  const sendHtml = (res: ServerResponse, statusCode: number, html: string): number => {
    res.writeHead(
      statusCode,
      baseHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Content-Length": String(Buffer.byteLength(html)),
      }),
    );
    res.end(html);
    return statusCode;
  };

  const sendText = (res: ServerResponse, contentType: string, text: string): number => {
    res.writeHead(
      200,
      baseHeaders({
        "Content-Type": contentType,
        "Content-Length": String(Buffer.byteLength(text)),
      }),
    );
    res.end(text);
    return 200;
  };

  const methodNotAllowed = (res: ServerResponse, allow: string[]): number => {
    res.setHeader("Allow", allow.join(", "));
    return sendJson(res, 405, { ok: false, error: "method_not_allowed", message: `不支持的请求方法（允许：${allow.join(", ")}）` });
  };

  const isWriteAuthorized = (req: IncomingMessage): boolean => {
    const header = req.headers["x-steward-token"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (typeof provided !== "string" || provided.length !== token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(token, "utf8"));
    } catch {
      return false;
    }
  };

  const requireWriteAuth = (req: IncomingMessage, res: ServerResponse): number | null => {
    if (isWriteAuthorized(req)) return null;
    return sendJson(res, 401, {
      ok: false,
      error: "unauthorized",
      message: "写操作需要 X-Steward-Token（由页面同源注入，不对外暴露）",
    });
  };

  const readJsonBody = async (
    req: IncomingMessage,
  ): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number; message: string }> => {
    const contentTypeHeader = req.headers["content-type"];
    const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader.toLowerCase() : "";
    if (contentType !== "" && !contentType.includes("application/json")) {
      return { ok: false, status: 415, message: "Content-Type 必须是 application/json" };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) return { ok: false, status: 413, message: "请求体过大（>64KB）" };
      chunks.push(buffer);
    }
    if (chunks.length === 0) return { ok: true, value: {} };
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, status: 400, message: "请求体必须是 JSON 对象" };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, status: 400, message: "请求体不是合法 JSON" };
    }
  };

  const readString = (value: unknown, fallback: string): string => {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    return fallback;
  };

  const safeTakeoverStatus = async (): Promise<ConsoleTakeoverStatus | null> => {
    try {
      return await provider.takeoverStatus();
    } catch {
      return null;
    }
  };

  const shellStatus = async (): Promise<ShellStatus | undefined> => {
    if (adminProvider === undefined) return undefined;
    try {
      const [adminStatus, takeover] = await Promise.all([adminProvider.getAdminStatus(), safeTakeoverStatus()]);
      return {
        mode: adminStatus.mode,
        modeLabel: adminStatus.mode_label,
        budgetLeftCny: adminStatus.budget_left_cny,
        tokenRemaining: adminStatus.token_remaining,
        tokenLimit: adminStatus.token_limit_tokens,
        halted: takeover !== null && takeover.halted === true,
        lastEventAt: adminStatus.last_event_at,
      };
    } catch {
      return undefined;
    }
  };

  const pageOptions = async (active: ConsolePageName): Promise<PageRenderOptions> => {
    const status = await safeTakeoverStatus();
    const shell = await shellStatus();
    const options: PageRenderOptions = { token, active, halted: status !== null && status.halted === true };
    if (shell !== undefined) options.status = shell;
    return options;
  };

  const adminUnavailablePage = async (res: ServerResponse, what: string): Promise<number> => {
    const options = await pageOptions("dashboard");
    return sendHtml(
      res,
      503,
      renderErrorPage(
        options,
        503,
        `${what}不可用`,
        "该页面需要管理侧 provider。请在 createConsoleServer({ provider, adminProvider }) 中传入 createDemoAdminProvider() 或真实 ConfigEngine 适配器。",
      ),
    );
  };

  const notFoundPage = async (res: ServerResponse, message: string): Promise<number> => {
    const options = await pageOptions("dashboard");
    return sendHtml(res, 404, renderErrorPage(options, 404, "页面不存在", message));
  };

  const chatUnavailablePage = async (res: ServerResponse, what: string): Promise<number> => {
    const options = await pageOptions("chat");
    return sendHtml(
      res,
      503,
      renderErrorPage(
        options,
        503,
        `${what}不可用`,
        "该页面需要对话侧 provider（v1.2 默认自动启用内置演示实现）。若显式传了 createConsoleServer({ chatProvider: null })，请改为传入 createDemoChatProvider() 或真实 Orchestrator 适配器。",
      ),
    );
  };

  const systemUnavailablePage = async (res: ServerResponse, what: string): Promise<number> => {
    const options = await pageOptions("system");
    return sendHtml(
      res,
      503,
      renderErrorPage(
        options,
        503,
        `${what}不可用`,
        "该页面需要系统总控 provider（v1.3 默认自动启用内置演示实现）。若显式传了 createConsoleServer({ systemProvider: null })，请改为传入 createDemoSystemProvider() 或真实 supervisor/程序管理适配器。",
      ),
    );
  };

  /** 变现页：收款渠道来自真实配置（adminProvider）或演示默认值。 */
  const resolveMoneyChannels = async (): Promise<{
    mode: string;
    channels: Array<{ kind: string; label: string; enabled: boolean; account_masked?: string }>;
  }> => {
    let mode = "demo";
    let channels: Array<{ kind: string; label: string; enabled: boolean; account_masked?: string }> | null = null;
    if (adminProvider !== undefined) {
      try {
        const config = await adminProvider.getConfig();
        mode = config.profile.mode;
        const payout = config.payments.payout_account;
        channels = config.payments.providers.map((payment) => ({
          kind: payment.kind,
          label: MONEY_METHOD_LABELS[payment.kind as MoneyMethod] ?? payment.name,
          enabled: payment.enabled,
          account_masked:
            payment.kind === "personal_bank_card"
              ? `${payout.bank_name} ${payout.card_no_masked}`
              : payment.kind === "wechat_pay"
                ? payout.wechat_id_masked ?? payment.account_masked
                : payment.kind === "alipay"
                  ? payout.alipay_id_masked ?? payment.account_masked
                  : payment.account_masked,
        }));
      } catch {
        channels = null;
      }
    }
    if (channels === null) {
      channels = [
        { kind: "wechat_pay", label: "微信支付", enabled: true, account_masked: "wxid_****demo88" },
        { kind: "alipay", label: "支付宝", enabled: true, account_masked: "dem***@example.com" },
        { kind: "personal_bank_card", label: "个人银行卡", enabled: true, account_masked: "招商银行 **** **** 8888" },
        { kind: "manual", label: "人工记账", enabled: true, account_masked: "—" },
      ];
    }
    return { mode, channels };
  };

  // -------------------------------------------------------------------------
  // 页面路由
  // -------------------------------------------------------------------------
  const handlePage = async (res: ServerResponse, pathname: string, requestUrl: URL): Promise<number> => {
    if (pathname === "/") {
      const [overview, summaryL0, ledger] = await Promise.all([
        provider.overview(),
        provider.summary("L0"),
        provider.ledger(),
      ]);
      const options = await pageOptions("dashboard");
      return sendHtml(res, 200, renderDashboardPage({ overview, summaryL0, ledger, options }));
    }
    if (pathname === "/ledger") {
      const [entries, overview] = await Promise.all([provider.ledger(), provider.overview()]);
      const options = await pageOptions("ledger");
      return sendHtml(res, 200, renderLedgerPage({ entries, projects: overview.projects, options }));
    }
    if (pathname === "/approvals") {
      const approvals = await provider.approvals();
      const options = await pageOptions("approvals");
      return sendHtml(res, 200, renderApprovalsPage({ approvals, options }));
    }
    if (pathname === "/report") {
      const report = await provider.monthlyReport();
      const options = await pageOptions("report");
      return sendHtml(res, 200, renderReportPage({ report, options }));
    }
    if (pathname === "/takeover") {
      const status = await safeTakeoverStatus();
      const options = await pageOptions("takeover");
      if (status === null) {
        return sendHtml(res, 500, renderErrorPage(options, 500, "接管状态不可用", "provider.takeoverStatus() 调用失败"));
      }
      return sendHtml(res, 200, renderTakeoverPage({ status, options }));
    }
    // ---- v1.1 专业版页面：项目 / 配置中心 / 智能体中心 / 后台 / 数据管理 ----
    if (pathname === "/projects") {
      const overview = await provider.overview();
      const options = await pageOptions("projects");
      return sendHtml(res, 200, renderProjectsPage({ projects: overview.projects, options }));
    }
    if (pathname === "/settings") {
      if (adminProvider === undefined) return adminUnavailablePage(res, "配置中心");
      const [config, adminStatus, chatSettings] = await Promise.all([
        adminProvider.getConfig(),
        adminProvider.getAdminStatus(),
        chatProvider === undefined ? Promise.resolve(undefined) : chatProvider.getModelSettings(),
      ]);
      const options = await pageOptions("settings");
      const input: SettingsPageInput = { config, status: adminStatus, options };
      if (chatSettings !== undefined) input.chatSettings = chatSettings;
      if (systemProvider !== undefined) {
        try {
          input.epayConfig = await systemProvider.getEpayConfig();
        } catch {
          /* 易支付配置不可用时不渲染该分组 */
        }
      }
      return sendHtml(res, 200, renderSettingsPage(input));
    }
    if (pathname === "/agents") {
      if (adminProvider === undefined) return adminUnavailablePage(res, "智能体中心");
      const [agents, config] = await Promise.all([adminProvider.getAgents(), adminProvider.getConfig()]);
      const harness = await buildHarnessSummaries(agents.map((agent) => agent.role));
      const options = await pageOptions("agents");
      return sendHtml(res, 200, renderAgentsPage({ agents, mode: config.profile.mode, harness, options }));
    }
    if (pathname === "/backend") {
      if (adminProvider === undefined) return adminUnavailablePage(res, "后台");
      const [runs, queue, token, stats, config] = await Promise.all([
        adminProvider.getFlow(),
        adminProvider.getQueue(),
        adminProvider.getTokenBudget(),
        adminProvider.getDataStats(),
        adminProvider.getConfig(),
      ]);
      const options = await pageOptions("backend");
      return sendHtml(
        res,
        200,
        renderBackendPage({ runs, queue, token, stats, halted: options.halted, monthBudgetCny: config.budgets.month_cny, options }),
      );
    }
    if (pathname === "/data") {
      if (adminProvider === undefined) return adminUnavailablePage(res, "数据管理");
      const [stats, config, agents] = await Promise.all([
        adminProvider.getDataStats(),
        adminProvider.getConfig(),
        adminProvider.getAgents(),
      ]);
      const options = await pageOptions("data");
      return sendHtml(res, 200, renderDataPage({ stats, config, agents, options }));
    }
    // ---- v1.2：对话 / 智能体对话记录 / run 证据 / 变现 ----
    if (pathname === "/chat") {
      if (chatEngineProvider === undefined) return chatUnavailablePage(res, "对话");
      const conversations = await chatEngineProvider.listConversations();
      const queryConversation = requestUrl.searchParams.get("conversation");
      const targetId = queryConversation ?? conversations[0]?.id;
      const active = targetId === undefined ? null : await chatEngineProvider.getConversation(targetId);
      const [memory, status] = await Promise.all([chatEngineProvider.listMemory(), chatEngineProvider.status()]);
      const options = await pageOptions("chat");
      return sendHtml(res, 200, renderChatHomePage({ conversations, active, memory, status, options }));
    }
    if (pathname === "/money") {
      if (chatProvider === undefined) return chatUnavailablePage(res, "变现");
      const requests = await chatProvider.listMoneyRequests();
      const ledger = await provider.ledger();
      const money = await resolveMoneyChannels();
      const epay: EpayConfig | null = systemProvider === undefined ? null : await Promise.resolve(systemProvider.getEpayConfig()).catch(() => null);
      const options = await pageOptions("money");
      const income = ledger.filter((entry) => entry.type === "income");
      const channels = [...money.channels];
      if (epay !== null) {
        channels.push({
          kind: "epay",
          label: "易支付（epay）",
          enabled: epay.enabled,
          account_masked: `mode=${epay.mode} · 商户 ${epay.merchant_id || "—"} · ${epay.methods.join("/") || "未选支付方式"}`,
        });
      }
      const input: MoneyPageInput = { requests, ledgerIncome: income, channels, mode: money.mode, options };
      if (epay !== null) input.epayConfig = epay;
      return sendHtml(res, 200, renderMoneyPage(input));
    }
    const moneyRequestMatch = /^\/money\/request\/([^/]+)$/.exec(pathname);
    if (moneyRequestMatch !== null) {
      if (chatProvider === undefined) return chatUnavailablePage(res, "变现");
      const requestId = decodeURIComponent(moneyRequestMatch[1] ?? "");
      const requests = await chatProvider.listMoneyRequests();
      const request = requests.find((item) => item.id === requestId);
      const options = await pageOptions("money");
      if (request === undefined) {
        return sendHtml(res, 404, renderErrorPage(options, 404, "收款请求不存在", `未找到收款请求：${requestId}`));
      }
      return sendHtml(res, 200, renderMoneyRequestPage({ request, options }));
    }
    const chatSessionMatch = /^\/chat\/([^/]+)$/.exec(pathname);
    if (chatSessionMatch !== null) {
      const sessionId = decodeURIComponent(chatSessionMatch[1] ?? "");
      const options = await pageOptions("chat");
      if (runtimeProvider !== undefined) {
        const liveSession = runtimeProvider.getSession(sessionId);
        if (liveSession !== null) {
          const liveRuns = await runtimeProvider.listRuns();
          const liveRun = liveRuns.find((item) => item.session_id === sessionId) ?? null;
          if (liveRun !== null) {
            const mapped: Record<string, ChatSessionStatus> = {
              queued: "planning",
              running: "running",
              paused: "paused",
              awaiting_approval: "running",
              interrupted: "paused",
              done: "done",
              blocked: "blocked",
              failed: "blocked",
            };
            const mappedStatus = mapped[liveRun.status];
            if (mappedStatus !== undefined) liveSession.status = mappedStatus;
          }
          return sendHtml(res, 200, renderChatSessionPage({ session: liveSession, liveRun, options }));
        }
      }
      if (chatProvider === undefined) return chatUnavailablePage(res, "对话");
      const session = await chatProvider.getSession(sessionId);
      if (session === null) {
        return sendHtml(res, 404, renderErrorPage(options, 404, "会话不存在", `未找到会话：${sessionId}`));
      }
      return sendHtml(res, 200, renderChatSessionPage({ session, liveRun: null, options }));
    }
    const agentRoleMatch = /^\/agents\/([^/]+)$/.exec(pathname);
    if (agentRoleMatch !== null) {
      if (chatProvider === undefined && runtimeProvider === undefined) return chatUnavailablePage(res, "智能体对话记录");
      const role = decodeURIComponent(agentRoleMatch[1] ?? "");
      const transcriptMap = new Map<string, { agent_role: string; title: string; turns: Array<{ seq: number; at: string; input_summary: string; output_summary: string; tokens: number; status: string; evidence_ref?: string }> }>();
      if (chatProvider !== undefined) {
        for (const item of await chatProvider.getAgentTranscripts(role)) {
          transcriptMap.set(item.agent_role, { ...item, turns: [...item.turns] });
        }
      }
      if (runtimeProvider !== undefined) {
        for (const item of runtimeProvider.getAgentTranscripts(role)) {
          const existing = transcriptMap.get(item.agent_role);
          if (existing === undefined) transcriptMap.set(item.agent_role, { ...item, turns: [...item.turns] });
          else existing.turns.push(...item.turns);
        }
      }
      const transcripts = [...transcriptMap.values()];
      const chatRuns = chatProvider === undefined ? [] : await chatProvider.listRuns();
      const liveRuns = runtimeProvider === undefined
        ? []
        : (await runtimeProvider.listRuns()).map((item) => ({ run_id: item.run_id, goal: item.goal, status: item.status, started_at: item.created_at, agent_count: 0, evidence_count: 0, session_id: item.session_id }));
      const runs = [...chatRuns, ...liveRuns];
      let agentInfo = null;
      if (adminProvider !== undefined) {
        try {
          agentInfo = await Promise.resolve(adminProvider.getAgentDetail(role));
        } catch {
          agentInfo = null;
        }
      }
      const roleArtifacts = await listRuntimeArtifacts({ agent_role: role });
      const roleReports = await listRuntimeReports({ agent_role: role });
      const options = await pageOptions("agents");
      return sendHtml(res, 200, renderAgentRolePage({ role, title: chatAgentTitle(role), transcripts, agentInfo, runs, artifacts: roleArtifacts, reports: roleReports, options }));
    }
    const runDetailMatch = /^\/runs\/([^/]+)$/.exec(pathname);
    if (runDetailMatch !== null) {
      const runId = decodeURIComponent(runDetailMatch[1] ?? "");
      const options = await pageOptions("run");
      const liveRun = runtimeProvider === undefined ? null : runtimeProvider.getRunDetail(runId);
      if (liveRun !== null) {
        const [runArtifacts, runReports, runMetrics] = await Promise.all([
          listRuntimeArtifacts({ run_id: runId }),
          listRuntimeReports({ run_id: runId }),
          getRuntimeMetrics(runId),
        ]);
        return sendHtml(res, 200, renderRunDetailPage({ run: liveRun, artifacts: runArtifacts, reports: runReports, metrics: runMetrics, options }));
      }
      if (chatProvider === undefined) return chatUnavailablePage(res, "run 证据");
      const run = await chatProvider.getRunDetail(runId);
      if (run === null) {
        return sendHtml(res, 404, renderErrorPage(options, 404, "run 不存在", `未找到 run：${runId}`));
      }
      return sendHtml(res, 200, renderRunDetailPage({ run, options }));
    }
    if (pathname === "/system") {
      if (systemProvider === undefined) return systemUnavailablePage(res, "系统总控");
      const [status, supervisorMessages, epay] = await Promise.all([
        systemProvider.getSystemStatus(),
        systemProvider.supervisorMessages(),
        systemProvider.getEpayConfig(),
      ]);
      const options = await pageOptions("system");
      return sendHtml(res, 200, renderSystemPage({ status, supervisorMessages, epay, options }));
    }
    if (pathname === "/artifacts") {
      const filter: RuntimeArtifactFilter = {};
      const runFilter = requestUrl.searchParams.get("run_id");
      if (runFilter !== null && runFilter !== "") filter.run_id = runFilter;
      const kindFilter = requestUrl.searchParams.get("kind");
      if (kindFilter !== null && kindFilter !== "") filter.kind = kindFilter;
      const agentFilter = requestUrl.searchParams.get("agent");
      if (agentFilter !== null && agentFilter !== "") filter.agent_role = agentFilter;
      const artifacts = await listRuntimeArtifacts(filter);
      const runs = runtimeProvider === undefined ? [] : (await runtimeProvider.listRuns()).map((run) => ({ run_id: run.run_id, goal: run.goal }));
      const options = await pageOptions("artifacts");
      return sendHtml(res, 200, renderArtifactsCenterPage({ artifacts, runs, options }));
    }
    if (pathname === "/reports") {
      const filter: RuntimeReportFilter = {};
      const runFilter = requestUrl.searchParams.get("run_id");
      if (runFilter !== null && runFilter !== "") filter.run_id = runFilter;
      const agentFilter = requestUrl.searchParams.get("agent");
      if (agentFilter !== null && agentFilter !== "") filter.agent_role = agentFilter;
      const reports = await listRuntimeReports(filter);
      const runs = runtimeProvider === undefined ? [] : (await runtimeProvider.listRuns()).map((run) => ({ run_id: run.run_id, goal: run.goal }));
      const options = await pageOptions("reports");
      return sendHtml(res, 200, renderReportsCenterPage({ reports, runs, options }));
    }
    if (pathname.startsWith("/project/")) {
      const projectId = pathname.slice("/project/".length).trim();
      const options = await pageOptions("projects");
      if (projectId === "") return sendHtml(res, 404, renderErrorPage(options, 404, "项目不存在", "缺少项目 ID"));
      const overview = await provider.overview();
      const project = overview.projects.find((item) => item.id === projectId);
      if (project === undefined) {
        return sendHtml(res, 404, renderErrorPage(options, 404, "项目不存在", `未找到项目：${projectId}`));
      }
      const timeline = await provider.projectTimeline(projectId);
      return sendHtml(res, 200, renderProjectPage({ project, timeline, options }));
    }
    return notFoundPage(res, `未找到页面：${pathname}`);
  };

  // -------------------------------------------------------------------------
  // 管理侧 API（v1.1）：配置中心 / 智能体中心 / 后台 / 数据管理
  // -------------------------------------------------------------------------

  const isAdminApiPath = (pathname: string): boolean =>
    pathname === "/api/config" ||
    pathname === "/api/config/export" ||
    pathname === "/api/config/apply-mode" ||
    pathname === "/api/config/reset" ||
    pathname === "/api/agents" ||
    /^\/api\/agents\/[^/]+$/.test(pathname) ||
    pathname === "/api/flow" ||
    pathname === "/api/queue" ||
    pathname === "/api/data/stats" ||
    pathname === "/api/data/reset" ||
    pathname === "/api/data/reset-demo" ||
    pathname === "/api/token-budget" ||
    pathname === "/api/payment-config" ||
    pathname === "/api/admin/status" ||
    pathname === "/api/admin/audit";

  const parseRunMode = (value: unknown): RunMode | null => {
    if (value === "demo" || value === "personal" || value === "enterprise") return value;
    return null;
  };

  const requireAdmin = (res: ServerResponse): number | null => {
    if (adminProvider !== undefined) return null;
    return sendJson(res, 503, {
      ok: false,
      error: "admin_unavailable",
      message: "管理 API 未启用：createConsoleServer 需要传入 adminProvider（演示可用 createDemoAdminProvider）",
    });
  };

  const handleAdminApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number | null> => {
    if (!isAdminApiPath(pathname)) return null;
    const unavailable = requireAdmin(res);
    if (unavailable !== null) return unavailable;
    const admin = adminProvider;
    if (admin === undefined) return null;
    const isRead = method === "GET" || method === "HEAD";

    if (pathname === "/api/config") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await admin.getConfig() });
      if (method !== "PUT") return methodNotAllowed(res, ["GET", "HEAD", "PUT"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const nested = body.value.patch;
      const patchValue = nested !== null && typeof nested === "object" && !Array.isArray(nested) ? nested : body.value;
      const result = await admin.saveConfig(patchValue as unknown as Partial<StewardConfig>);
      if (!result.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: "invalid_config",
          message: result.errors.join("；") || "配置校验未通过",
          data: { errors: result.errors },
        });
      }
      return sendJson(res, 200, { ok: true, data: { config: result.config } });
    }

    if (pathname === "/api/config/export" && isRead) {
      return sendJson(res, 200, { ok: true, data: { json: await admin.exportConfig(), filename: "steward-config.json" } });
    }

    if (pathname === "/api/config/apply-mode") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const mode = parseRunMode(body.value.mode);
      if (mode === null) {
        return sendJson(res, 400, { ok: false, error: "invalid_mode", message: 'mode 只支持 "demo" / "personal" / "enterprise"' });
      }
      const result = await admin.applyMode(mode);
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: "invalid_mode", message: result.errors.join("；") || "模式切换失败", data: result });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/config/reset") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      let mode: RunMode | undefined;
      if (body.value.mode !== undefined) {
        const parsed = parseRunMode(body.value.mode);
        if (parsed === null) {
          return sendJson(res, 400, { ok: false, error: "invalid_mode", message: 'mode 只支持 "demo" / "personal" / "enterprise"' });
        }
        mode = parsed;
      }
      const config = mode === undefined ? await admin.resetConfig() : await admin.resetConfig(mode);
      return sendJson(res, 200, { ok: true, data: { config } });
    }

    if (pathname === "/api/agents") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.getAgents() });
    }

    const agentMatch = /^\/api\/agents\/([^/]+)$/.exec(pathname);
    if (agentMatch !== null) {
      const role = agentMatch[1] ?? "";
      if (isRead) {
        const agent = await admin.getAgentDetail(role);
        if (agent === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `智能体不存在：${role}` });
        return sendJson(res, 200, { ok: true, data: agent });
      }
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const patch: Partial<AgentConfig> = {};
      if (typeof body.value.enabled === "boolean") patch.enabled = body.value.enabled;
      const autonomy = body.value.autonomy;
      if (autonomy === "readonly" || autonomy === "draft" || autonomy === "approval_required" || autonomy === "autonomous_limited") {
        patch.autonomy = autonomy;
      }
      if (typeof body.value.token_limit === "number" && Number.isFinite(body.value.token_limit)) {
        patch.token_limit = body.value.token_limit;
      }
      const result = await admin.updateAgent(role, patch);
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: "invalid_agent", message: result.errors.join("；") || "智能体参数不合法", data: { errors: result.errors } });
      }
      return sendJson(res, 200, { ok: true, data: { config: result.config } });
    }

    if (pathname === "/api/flow") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const filter: { phase?: string; run_id?: string; limit?: number } = {};
      const phase = requestUrl.searchParams.get("phase");
      if (phase !== null && phase !== "") filter.phase = phase;
      const runId = requestUrl.searchParams.get("run_id");
      if (runId !== null && runId !== "") filter.run_id = runId;
      const limitText = requestUrl.searchParams.get("limit");
      if (limitText !== null && /^\d+$/.test(limitText)) filter.limit = Number.parseInt(limitText, 10);
      return sendJson(res, 200, { ok: true, data: await admin.getFlow(filter) });
    }

    if (pathname === "/api/queue") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.getQueue() });
    }

    if (pathname === "/api/data/stats") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.getDataStats() });
    }

    if (pathname === "/api/data/reset") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      if (body.value.confirm !== true) {
        return sendJson(res, 400, {
          ok: false,
          error: "confirm_required",
          message: "清空数据需要二次确认：请求体必须包含 {\"confirm\": true}",
        });
      }
      return sendJson(res, 200, { ok: true, data: await admin.resetData() });
    }

    if (pathname === "/api/data/reset-demo") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      return sendJson(res, 200, { ok: true, data: await admin.resetDemoData() });
    }

    if (pathname === "/api/token-budget") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.getTokenBudget() });
    }

    if (pathname === "/api/payment-config") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.getPaymentConfig() });
    }

    if (pathname === "/api/admin/status") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const [status, takeover] = await Promise.all([admin.getAdminStatus(), safeTakeoverStatus()]);
      return sendJson(res, 200, {
        ok: true,
        data: { ...status, halted: status.halted || (takeover !== null && takeover.halted === true) },
      });
    }

    if (pathname === "/api/admin/audit") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await admin.auditTrail() });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到管理 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // 对话 / 智能体记录 / 证据 / 变现 / 模型配置 API（v1.2）
  // -------------------------------------------------------------------------

  const isChatApiPath = (pathname: string): boolean =>
    pathname.startsWith("/api/chat/") ||
    pathname === "/api/model-settings" ||
    pathname === "/api/model-settings/sync" ||
    pathname === "/api/prompts" ||
    pathname.startsWith("/api/money/");

  const requireChat = (res: ServerResponse): number | null => {
    if (chatProvider !== undefined) return null;
    return sendJson(res, 503, {
      ok: false,
      error: "chat_unavailable",
      message:
        "对话/变现 API 未启用：createConsoleServer 默认启用内置 createDemoChatProvider()；若显式传了 chatProvider: null，请改为传入 createDemoChatProvider() 或真实 Orchestrator 适配器",
    });
  };

  const requireRuntime = (res: ServerResponse): number | null => {
    if (runtimeProvider !== undefined) return null;
    return sendJson(res, 503, {
      ok: false,
      error: "runtime_unavailable",
      message:
        "运行时 API 未启用：createConsoleServer 默认启用内置 createDemoRuntimeProvider()；若显式传了 runtimeProvider: null，请改为传入 createDemoRuntimeProvider() 或真实 RunManager 适配器",
    });
  };

  /** v1.4 SSE：`GET /api/chat/runs/:id/stream?since=<seq>`（只读、无需 token；Last-Event-ID 续传）。 */
  const handleRunSse = (req: IncomingMessage, res: ServerResponse, runId: string, requestUrl: URL): number => {
    const unavailable = requireRuntime(res);
    if (unavailable !== null) return unavailable;
    const runtime = runtimeProvider;
    if (runtime === undefined) return 503;
    let since = 0;
    const rawSince = Number.parseInt(requestUrl.searchParams.get("since") ?? "0", 10);
    if (Number.isFinite(rawSince) && rawSince > 0) since = rawSince;
    const headerValue = req.headers["last-event-id"];
    const headerSince = typeof headerValue === "string" ? Number.parseInt(headerValue, 10) : Number.NaN;
    if (Number.isFinite(headerSince) && headerSince > since) since = headerSince;
    res.writeHead(
      200,
      baseHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      }),
    );
    res.flushHeaders?.();
    res.write(": connected\n\n");
    activeSseStreams += 1;
    let closed = false;
    let unsubscribe: () => void = () => {};
    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        res.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, 15000);
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
      activeSseStreams = Math.max(0, activeSseStreams - 1);
      log(`[sse] 订阅结束 ${runId}（活跃 ${String(activeSseStreams)}）`);
    };
    const writeEvent = (event: ConsoleRuntimeEvent): void => {
      if (closed) return;
      try {
        res.write(`id: ${String(event.seq)}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };
    unsubscribe = runtime.subscribeRun(runId, since, writeEvent);
    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("error", cleanup);
    log(`[sse] 订阅开始 ${runId} since=${String(since)}（活跃 ${String(activeSseStreams)}）`);
    return 200;
  };

  // -------------------------------------------------------------------------
  // v1.5.1：ChatGPT 式对话总控 API（会话 / 消息流 / SSE / 记忆 / 状态）
  // -------------------------------------------------------------------------
  const isChatEngineApiPath = (pathname: string): boolean =>
    pathname.startsWith("/api/chat/conversations") || pathname === "/api/chat/memory" || pathname.startsWith("/api/chat/memory/") || pathname === "/api/chat/status";

  const chatStreams = new Map<
    string,
    {
      conversationId: string;
      parts: ConsoleChatPart[];
      done: boolean;
      listeners: Set<(event: { part?: ConsoleChatPart; done: boolean; seq: number }) => void>;
      runId?: string;
      step?: number;
      approvedAt?: string;
      cancel: () => void;
    }
  >();
  let chatStreamCounter = 0;

  const broadcastChatStream = (hub: { parts: ConsoleChatPart[]; done: boolean; listeners: Set<(event: { part?: ConsoleChatPart; done: boolean; seq: number }) => void> }, part?: ConsoleChatPart): void => {
    const event = { ...(part === undefined ? {} : { part }), done: hub.done, seq: hub.parts.length };
    for (const listener of [...hub.listeners]) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  };

  const handleChatEngineApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number | null> => {
    if (!isChatEngineApiPath(pathname)) return null;
    const engine = chatEngineProvider;
    if (engine === undefined) {
      return sendJson(res, 503, { ok: false, error: "chat_engine_unavailable", message: "对话总控需要 chatEngineProvider（默认 createDemoChatEngineProvider）" });
    }
    const isRead = method === "GET" || method === "HEAD";

    // SSE：GET /api/chat/conversations/:id/stream?assistant_id=&since=（只读，无需 token）
    const streamMatch = /^\/api\/chat\/conversations\/([^/]+)\/stream$/.exec(pathname);
    if (streamMatch !== null) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      const assistantId = requestUrl.searchParams.get("assistant_id") ?? "";
      const rawSince = Number.parseInt(requestUrl.searchParams.get("since") ?? "0", 10);
      const since = Number.isFinite(rawSince) ? rawSince : 0;
      res.writeHead(200, baseHeaders({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }));
      res.flushHeaders?.();
      res.write(": connected\n\n");
      const hub = chatStreams.get(assistantId);
      let closed = false;
      const listeners = hub === undefined ? null : hub.listeners;
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (listeners !== null) listeners.delete(listener);
      };
      const writeEvent = (event: { part?: ConsoleChatPart; done: boolean; seq: number }): void => {
        if (closed) return;
        try {
          res.write(`id: ${String(event.seq)}\ndata: ${JSON.stringify({ seq: event.seq, part: event.part, done: event.done })}\n\n`);
        } catch {
          cleanup();
        }
      };
      const listener = (event: { part?: ConsoleChatPart; done: boolean; seq: number }): void => writeEvent(event);
      if (hub === undefined) {
        writeEvent({ done: true, seq: 0 });
        res.end();
        return 200;
      }
      for (let index = since; index < hub.parts.length; index += 1) {
        const part = hub.parts[index];
        if (part !== undefined) writeEvent({ part, done: false, seq: index + 1 });
      }
      if (hub.done) {
        writeEvent({ done: true, seq: hub.parts.length });
        res.end();
        return 200;
      }
      hub.listeners.add(listener);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          res.write(": heartbeat\n\n");
        } catch {
          cleanup();
        }
      }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        cleanup();
      });
      res.on("error", () => {
        clearInterval(heartbeat);
        cleanup();
      });
      return 200;
    }

    if (pathname === "/api/chat/conversations") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await engine.listConversations() });
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const conversation = await engine.createConversation(readString(body.value.title, "新对话"));
      return sendJson(res, 200, { ok: true, data: conversation });
    }

    const convMatch = /^\/api\/chat\/conversations\/([^/]+)(?:\/(messages|approvals))?$/.exec(pathname);
    if (convMatch !== null) {
      const conversationId = decodeURIComponent(convMatch[1] ?? "");
      const action = convMatch[2];
      if (action === undefined) {
        if (isRead) {
          const detail = await engine.getConversation(conversationId);
          if (detail === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到对话：${conversationId}` });
          return sendJson(res, 200, { ok: true, data: detail });
        }
        if (method === "PATCH") {
          const auth = requireWriteAuth(req, res);
          if (auth !== null) return auth;
          const body = await readJsonBody(req);
          if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
          const conversation = await engine.renameConversation(conversationId, readString(body.value.title, ""));
          if (conversation === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到对话：${conversationId}` });
          return sendJson(res, 200, { ok: true, data: conversation });
        }
        if (method === "DELETE") {
          const auth = requireWriteAuth(req, res);
          if (auth !== null) return auth;
          const deleted = await engine.deleteConversation(conversationId);
          return sendJson(res, deleted ? 200 : 404, { ok: deleted, data: { deleted } });
        }
        return methodNotAllowed(res, ["GET", "HEAD", "PATCH", "DELETE"]);
      }
      if (action === "approvals") {
        if (method !== "POST") return methodNotAllowed(res, ["POST"]);
        const auth = requireWriteAuth(req, res);
        if (auth !== null) return auth;
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
        const approvalId = readString(body.value.approval_id, "");
        const decision = body.value.decision === "reject" ? "reject" : "approve";
        let ok = false;
        if (engine.decideApproval !== undefined) ok = await engine.decideApproval(conversationId, approvalId, decision);
        for (const [, hub] of chatStreams) {
          if (hub.conversationId !== conversationId) continue;
          if (hub.runId === undefined) continue;
          try {
            await runtimeProvider?.approve?.(hub.runId, hub.step ?? 5, decision);
          } catch {
            /* runtime approval best-effort */
          }
          hub.approvedAt = new Date().toISOString();
          break;
        }
        return sendJson(res, ok ? 200 : 400, { ok, data: { approval_id: approvalId, decision } });
      }
      // POST .../messages：创建用户消息 + 启动流（返回 assistant_id，再 GET SSE）
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const text = readString(body.value.text, "");
      if (text === "") return sendJson(res, 400, { ok: false, error: "invalid_text", message: "消息不能为空" });
      if (body.value.stream === false) {
        try {
          const messages = await engine.sendMessage(conversationId, text);
          return sendJson(res, 200, { ok: true, data: messages });
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: "send_failed", message: errorMessage(error) });
        }
      }
      chatStreamCounter += 1;
      const assistantId = `chat-stream-${String(chatStreamCounter).padStart(3, "0")}`;
      const hub: {
        conversationId: string;
        parts: ConsoleChatPart[];
        done: boolean;
        listeners: Set<(event: { part?: ConsoleChatPart; done: boolean; seq: number }) => void>;
        runId?: string;
        step?: number;
        approvedAt?: string;
        cancel: () => void;
      } = { conversationId, parts: [], done: false, listeners: new Set(), cancel: () => {} };
      chatStreams.set(assistantId, hub);
      // 若像任务请求：同时创建真实 runtime run，并注入“查看完整运行过程”链接（深度视图）
      if (runtimeProvider !== undefined && options.autoCreateChatRuns !== false && /帮我|做|查|执行|跑|生成|整理|汇总|产物|报告|项目|页面|代码/.test(text)) {
        try {
          const result = await runtimeProvider.createAndStart({ goal: text, budget_cny: 3000, token_limit: 200_000, mode: "demo" });
          hub.runId = result.run.run_id;
          const pendingStep = result.run.pending_approval?.step;
          if (pendingStep !== undefined) hub.step = pendingStep;
          hub.parts.push({
            type: "text",
            text: "已创建一次真实运行，可查看完整实时过程与证据：",
            run_link: { id: "chat-run-link", href: `/chat/${encodeURIComponent(result.session.id)}`, text: "查看完整运行过程与证据 →" },
          });
          broadcastChatStream(hub);
        } catch {
          /* runtime best-effort */
        }
      }
      hub.cancel = engine.streamMessage(conversationId, text, (part) => {
        if (part.type === "_done") {
          hub.done = true;
          broadcastChatStream(hub);
          return;
        }
        hub.parts.push(part);
        if (part.type === "approval") {
          const stepValue = Number(part.step ?? hub.step ?? 5);
          if (Number.isFinite(stepValue)) hub.step = stepValue;
        }
        broadcastChatStream(hub, part);
      });
      return sendJson(res, 200, {
        ok: true,
        data: {
          conversation_id: conversationId,
          user: { id: `user-local-${String(chatStreamCounter)}`, role: "user", at: new Date().toISOString(), parts: [{ type: "text", text }] },
          assistant: { id: assistantId, role: "assistant", at: new Date().toISOString(), parts: [] },
          stream: { assistant_id: assistantId, assistant_message_id: assistantId, url: `/api/chat/conversations/${encodeURIComponent(conversationId)}/stream?assistant_id=${encodeURIComponent(assistantId)}&since=0` },
        },
      });
    }

    if (pathname === "/api/chat/memory") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await engine.listMemory(requestUrl.searchParams.get("query") ?? undefined) });
    }
    const memoryMatch = /^\/api\/chat\/memory\/([^/]+)$/.exec(pathname);
    if (memoryMatch !== null) {
      if (method !== "DELETE") return methodNotAllowed(res, ["DELETE"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const deleted = await engine.deleteMemory(decodeURIComponent(memoryMatch[1] ?? ""));
      return sendJson(res, deleted ? 200 : 404, { ok: deleted, data: { deleted } });
    }
    if (pathname === "/api/chat/status") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await engine.status() });
    }
    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到对话 API：${pathname}` });
  };

  const handleChatApi = async (

    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number | null> => {
    if (!isChatApiPath(pathname)) return null;
    // v1.4 SSE：只读、无需 token，不依赖 chatProvider（独立 runtime）
    const streamMatch = /^\/api\/chat\/runs\/([^/]+)\/stream$/.exec(pathname);
    if (streamMatch !== null) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return handleRunSse(req, res, decodeURIComponent(streamMatch[1] ?? ""), requestUrl);
    }
    const unavailable = requireChat(res);
    if (unavailable !== null) return unavailable;
    const chat = chatProvider;
    if (chat === undefined) return null;
    const runtime = runtimeProvider;
    const isRead = method === "GET" || method === "HEAD";

    const sessionMatch = /^\/api\/chat\/sessions\/([^/]+)(?:\/(messages|start|interrupt|resume|approvals))?$/.exec(pathname);
    if (pathname === "/api/chat/sessions") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await chat.listSessions() });
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      try {
        const session = await chat.createSession({
          goal: readString(body.value.goal, ""),
          budget_cny: Number(body.value.budget_cny ?? 0),
          token_limit: Number(body.value.token_limit ?? 200_000),
          mode: readString(body.value.mode, "demo"),
        });
        return sendJson(res, 200, { ok: true, data: session });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "invalid_session", message: errorMessage(error) });
      }
    }

    if (sessionMatch !== null) {
      const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
      const action = sessionMatch[2];
      if (action === undefined) {
        if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
        const session = await chat.getSession(sessionId);
        if (session === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到会话：${sessionId}` });
        return sendJson(res, 200, { ok: true, data: session });
      }
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      if (action === "start" || action === "interrupt" || action === "resume") {
        const session =
          action === "start"
            ? await chat.startProject(sessionId)
            : action === "interrupt"
              ? await chat.interrupt(sessionId)
              : await chat.resume(sessionId);
        if (session === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到会话：${sessionId}` });
        return sendJson(res, 200, { ok: true, data: session });
      }
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      if (action === "messages") {
        const text = readString(body.value.text, "");
        if (text === "") return sendJson(res, 400, { ok: false, error: "invalid_message", message: "消息不能为空" });
        try {
          const session = await chat.sendMessage(sessionId, text);
          if (session === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到会话：${sessionId}` });
          return sendJson(res, 200, { ok: true, data: session });
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: "invalid_message", message: errorMessage(error) });
        }
      }
      // approvals
      const step = Number(body.value.step ?? 0);
      const decision = body.value.decision;
      if (decision !== "approve" && decision !== "reject") {
        return sendJson(res, 400, { ok: false, error: "invalid_decision", message: 'decision 只支持 "approve" / "reject"' });
      }
      try {
        const session = await chat.decideApproval(sessionId, step, decision);
        if (session === null) return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到会话：${sessionId}` });
        return sendJson(res, 200, { ok: true, data: session });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "invalid_approval", message: errorMessage(error) });
      }
    }

    // ---- v1.4：发送即执行 + SSE 实时流（runtime provider） ----
    if (pathname === "/api/chat/runs") {
      if (isRead) {
        const base = chat === undefined ? [] : await chat.listRuns();
        const live = runtime === undefined ? [] : await runtime.listRuns();
        const seen = new Set(base.map((item) => item.run_id));
        const liveRuns = live
          .filter((item) => !seen.has(item.run_id))
          .map((item) => ({
            run_id: item.run_id,
            goal: item.goal,
            status: item.status,
            started_at: item.created_at,
            agent_count: 0,
            evidence_count: 0,
            session_id: item.session_id,
            steps_total: item.steps_total,
            steps_done: item.steps_done,
            token_used: item.token_used,
          }));
        return sendJson(res, 200, { ok: true, data: [...base, ...liveRuns] });
      }
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const unavailable = requireRuntime(res);
      if (unavailable !== null) return unavailable;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      try {
        const result = await runtimeProvider!.createAndStart({
          goal: readString(body.value.goal, ""),
          budget_cny: Number(body.value.budget_cny ?? 0),
          token_limit: Number(body.value.token_limit ?? 200_000),
          mode: readString(body.value.mode, "demo"),
        });
        return sendJson(res, 200, { ok: true, data: result });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "invalid_run", message: errorMessage(error) });
      }
    }

    const runDetailMatch = /^\/api\/chat\/runs\/([^/]+)$/.exec(pathname);
    if (runDetailMatch !== null) {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const runId = decodeURIComponent(runDetailMatch[1] ?? "");
      if (runtime !== undefined) {
        const record = await runtime.getRun(runId);
        if (record !== null) return sendJson(res, 200, { ok: true, data: record });
      }
      if (chat !== undefined) {
        const run = await chat.getRunDetail(runId);
        if (run !== null) return sendJson(res, 200, { ok: true, data: run });
      }
      return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到 run：${runId}` });
    }

    const metricsMatch = /^\/api\/chat\/runs\/([^/]+)\/metrics$/.exec(pathname);
    if (metricsMatch !== null) {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const runId = decodeURIComponent(metricsMatch[1] ?? "");
      const metrics = await getRuntimeMetrics(runId);
      if (metrics === null) return sendJson(res, 404, { ok: false, error: "metrics_not_found", message: `未找到 run 指标：${runId}` });
      return sendJson(res, 200, { ok: true, data: metrics });
    }

    const runtimeActionMatch = /^\/api\/chat\/runs\/([^/]+)\/(approvals|interrupt|resume)$/.exec(pathname);
    if (runtimeActionMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const unavailable = requireRuntime(res);
      if (unavailable !== null) return unavailable;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const runId = decodeURIComponent(runtimeActionMatch[1] ?? "");
      const actionName = runtimeActionMatch[2];
      try {
        const runtimeApi = runtimeProvider!;
        if (actionName === "interrupt") return sendJson(res, 200, { ok: true, data: await runtimeApi.interrupt(runId) });
        if (actionName === "resume") return sendJson(res, 200, { ok: true, data: await runtimeApi.resume(runId) });
        const decision = body.value.decision;
        if (decision !== "approve" && decision !== "reject") {
          return sendJson(res, 400, { ok: false, error: "invalid_decision", message: 'decision 只支持 "approve" / "reject"' });
        }
        const run = await runtimeApi.approve(runId, Number(body.value.step ?? 0), decision);
        return sendJson(res, 200, { ok: true, data: run });
      } catch (error) {
        const message = errorMessage(error);
        const status = message.includes("不存在") ? 404 : 400;
        return sendJson(res, status, { ok: false, error: "runtime_action_failed", message });
      }
    }

    const transcriptMatch = /^\/api\/chat\/agents\/([^/]+)\/transcripts$/.exec(pathname);
    if (transcriptMatch !== null) {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const role = decodeURIComponent(transcriptMatch[1] ?? "");
      return sendJson(res, 200, { ok: true, data: await chat.getAgentTranscripts(role) });
    }
    if (pathname === "/api/chat/evidence") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const runId = requestUrl.searchParams.get("run_id");
      if (runId === null || runId === "") {
        return sendJson(res, 400, { ok: false, error: "missing_run_id", message: "需要 query 参数 run_id" });
      }
      return sendJson(res, 200, { ok: true, data: await chat.listEvidence(runId) });
    }

    if (pathname === "/api/model-settings") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await chat.getModelSettings() });
      if (method !== "PUT") return methodNotAllowed(res, ["GET", "HEAD", "PUT"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const providersRaw = body.value.providers;
      const bindingsRaw = body.value.agent_bindings;
      if (providersRaw !== undefined && !Array.isArray(providersRaw)) {
        return sendJson(res, 400, { ok: false, error: "invalid_providers", message: "providers 必须是数组" });
      }
      if (bindingsRaw !== undefined && !Array.isArray(bindingsRaw)) {
        return sendJson(res, 400, { ok: false, error: "invalid_bindings", message: "agent_bindings 必须是数组" });
      }
      const partial: {
        providers?: ModelProviderConfig[];
        agent_bindings?: AgentModelBinding[];
        default_provider_id?: string;
      } = {};
      if (providersRaw !== undefined) partial.providers = providersRaw as ModelProviderConfig[];
      if (bindingsRaw !== undefined) partial.agent_bindings = bindingsRaw as AgentModelBinding[];
      if (typeof body.value.default_provider_id === "string") partial.default_provider_id = body.value.default_provider_id;
      const result = await chat.saveModelSettings(partial);
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: "invalid_model_settings", message: result.errors.join("；"), data: { errors: result.errors } });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/model-settings/sync") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const result = await chat.syncKeysToAll();
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/prompts") {
      if (isRead) {
        const settings = await chat.getModelSettings();
        return sendJson(res, 200, { ok: true, data: settings.prompts });
      }
      if (method !== "PUT") return methodNotAllowed(res, ["GET", "HEAD", "PUT"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const rawPrompts = body.value.prompts;
      if (!Array.isArray(rawPrompts) || rawPrompts.length === 0) {
        return sendJson(res, 400, { ok: false, error: "invalid_prompts", message: "prompts 必须是非空数组 [{id, content}]" });
      }
      const patches: Array<{ id: string; content: string }> = [];
      for (const item of rawPrompts) {
        if (item === null || typeof item !== "object") {
          return sendJson(res, 400, { ok: false, error: "invalid_prompts", message: "prompts[] 必须是 {id, content}" });
        }
        const record = item as Record<string, unknown>;
        patches.push({ id: readString(record.id, ""), content: typeof record.content === "string" ? record.content : "" });
      }
      const result = await chat.savePrompts(patches);
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: "invalid_prompts", message: result.errors.join("；"), data: { errors: result.errors } });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/money/requests") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await chat.listMoneyRequests() });
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const methodValue = readString(body.value.payment_method, "manual");
      const paymentMethod = (MONEY_METHODS as readonly string[]).includes(methodValue) ? (methodValue as MoneyMethod) : null;
      if (paymentMethod === null) {
        return sendJson(res, 400, {
          ok: false,
          error: "invalid_method",
          message: `payment_method 只支持：${MONEY_METHODS.join(" / ")}`,
        });
      }
      const result = await chat.createMoneyRequest({
        amount_cny: Number(body.value.amount_cny ?? 0),
        client: readString(body.value.client, ""),
        purpose: readString(body.value.purpose, ""),
        payment_method: paymentMethod,
      });
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: "invalid_money_request", message: result.errors.join("；"), data: { errors: result.errors } });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    const moneyConfirmMatch = /^\/api\/money\/requests\/([^/]+)\/confirm$/.exec(pathname);
    if (moneyConfirmMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const requestId = decodeURIComponent(moneyConfirmMatch[1] ?? "");
      const by = readString(body.value.by, "人工确认（控制台）");
      const result = await chat.confirmMoneyReceived(requestId, by);
      if (!result.ok) {
        const status = result.errors.some((line) => line.includes("不存在")) ? 404 : 400;
        return sendJson(res, status, { ok: false, error: "confirm_failed", message: result.errors.join("；"), data: result });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到对话/变现 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // 系统总控 API（v1.3）：supervisor 对话 / 程序 / 插件 / 日志 / 危险动作 / 易支付
  // -------------------------------------------------------------------------

  const isSystemApiPath = (pathname: string): boolean => pathname.startsWith("/api/system/");

  const requireSystem = (res: ServerResponse): number | null => {
    if (systemProvider !== undefined) return null;
    return sendJson(res, 503, {
      ok: false,
      error: "system_unavailable",
      message:
        "系统总控 API 未启用：createConsoleServer 默认启用内置 createDemoSystemProvider()；若显式传了 systemProvider: null，请改为传入 createDemoSystemProvider() 或真实 supervisor/程序管理适配器",
    });
  };

  const handleSystemApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number | null> => {
    if (!isSystemApiPath(pathname)) return null;
    const unavailable = requireSystem(res);
    if (unavailable !== null) return unavailable;
    const system = systemProvider;
    if (system === undefined) return null;
    const isRead = method === "GET" || method === "HEAD";

    if (pathname === "/api/system/status") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendJson(res, 200, { ok: true, data: await system.getSystemStatus() });
    }

    if (pathname === "/api/system/supervisor/messages") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await system.supervisorMessages() });
      if (method !== "POST") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      try {
        const messages = await system.sendSupervisorMessage(readString(body.value.text, ""));
        return sendJson(res, 200, { ok: true, data: messages });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: "invalid_message", message: errorMessage(error) });
      }
    }

    if (pathname === "/api/system/logs") {
      if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);
      const limitText = requestUrl.searchParams.get("limit");
      const limit = limitText !== null && /^\d+$/.test(limitText) ? Number.parseInt(limitText, 10) : undefined;
      return sendJson(res, 200, { ok: true, data: await system.getSystemLogs(limit) });
    }

    const programActionMatch = /^\/api\/system\/programs\/([^/]+)\/action$/.exec(pathname);
    if (programActionMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const actionValue = body.value.action;
      if (actionValue !== "start" && actionValue !== "stop" && actionValue !== "restart") {
        return sendJson(res, 400, { ok: false, error: "invalid_action", message: 'action 只支持 "start" / "stop" / "restart"' });
      }
      const programId = decodeURIComponent(programActionMatch[1] ?? "");
      const result = await system.programAction(programId, actionValue);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: "program_action_failed", message: result.message, data: result });
      return sendJson(res, 200, { ok: true, data: result });
    }

    const pluginActionMatch = /^\/api\/system\/plugins\/([^/]+)\/action$/.exec(pathname);
    if (pluginActionMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      if (typeof body.value.enabled !== "boolean") {
        return sendJson(res, 400, { ok: false, error: "invalid_body", message: "enabled 必须是布尔值" });
      }
      const pluginId = decodeURIComponent(pluginActionMatch[1] ?? "");
      const result = await system.pluginAction(pluginId, body.value.enabled);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: "plugin_action_failed", message: result.message, data: result });
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/system/command") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const command = readString(body.value.command, "");
      if (command === "") return sendJson(res, 400, { ok: false, error: "invalid_command", message: "command 不能为空" });
      const result = await system.runQuickCommand(command);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: "command_failed", message: result.message, data: result });
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/system/danger/prepare") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const actionValue = body.value.action;
      if (actionValue !== "delete_program" && actionValue !== "delete_plugin") {
        return sendJson(res, 400, { ok: false, error: "invalid_action", message: 'action 只支持 "delete_program" / "delete_plugin"' });
      }
      const targetId = readString(body.value.target_id, "");
      if (targetId === "") return sendJson(res, 400, { ok: false, error: "invalid_target", message: "target_id 不能为空" });
      const confirm = await system.prepareDangerousAction({ action: actionValue, target_id: targetId });
      if (!confirm.ok) return sendJson(res, 400, { ok: false, error: "danger_prepare_failed", message: confirm.errors.join("；"), data: confirm });
      return sendJson(res, 200, { ok: true, data: confirm });
    }

    if (pathname === "/api/system/danger/execute") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const actionValue = body.value.action;
      if (actionValue !== "delete_program" && actionValue !== "delete_plugin") {
        return sendJson(res, 400, { ok: false, error: "invalid_action", message: 'action 只支持 "delete_program" / "delete_plugin"' });
      }
      const result = await system.executeDangerousAction({
        action: actionValue,
        target_id: readString(body.value.target_id, ""),
        confirm_token: readString(body.value.confirm_token, ""),
        confirm_text: readString(body.value.confirm_text, ""),
      });
      if (!result.ok) return sendJson(res, 400, { ok: false, error: "danger_execute_rejected", message: result.message, data: result });
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/system/epay") {
      if (isRead) return sendJson(res, 200, { ok: true, data: await system.getEpayConfig() });
      if (method !== "PUT") return methodNotAllowed(res, ["GET", "HEAD", "PUT"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      const partial: Partial<EpayConfig> = {};
      if (typeof body.value.enabled === "boolean") partial.enabled = body.value.enabled;
      if (body.value.mode === "demo" || body.value.mode === "live") partial.mode = body.value.mode;
      for (const key of ["gateway_url", "merchant_id", "api_key_ref", "notify_url", "return_url"] as const) {
        if (typeof body.value[key] === "string") partial[key] = body.value[key] as string;
      }
      if (Array.isArray(body.value.methods)) {
        partial.methods = body.value.methods.filter((method): method is EpayMethod => method === "alipay" || method === "wxpay");
      }
      const result = await system.saveEpayConfig(partial);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: "invalid_epay_config", message: result.errors.join("；"), data: { errors: result.errors } });
      return sendJson(res, 200, { ok: true, data: result });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到系统 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // v1.5：产物 / 报告 API（只读；防路径穿越：仅按 provider 白名单 ID 查找）
  // -------------------------------------------------------------------------

  const isHarnessApiPath = (pathname: string): boolean =>
    pathname === "/api/artifacts" ||
    /^\/api\/artifacts\/[^/]+\/(preview|download|raw)$/.test(pathname) ||
    pathname === "/api/reports" ||
    /^\/api\/reports\/[^/]+$/.test(pathname);

  const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,160}$/;

  const isSafeRelPath = (relPath: string): boolean => {
    const text = String(relPath ?? "");
    if (text === "" || text.length > 512) return false;
    if (text.includes("..") || text.includes("\\") || text.startsWith("/") || text.includes("\0")) return false;
    return /^[A-Za-z0-9._/-]+$/.test(text);
  };

  const findRuntimeArtifact = async (artifactId: string): Promise<HarnessArtifactView | null> => {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) return null;
    for (const artifact of await listRuntimeArtifacts()) {
      if (artifact.id !== artifactId) continue;
      if (!isSafeRelPath(artifact.rel_path)) continue;
      return artifact;
    }
    return null;
  };

  const findRuntimeReport = async (reportId: string): Promise<HarnessReportView | null> => {
    if (!ARTIFACT_ID_PATTERN.test(reportId)) return null;
    for (const report of await listRuntimeReports()) {
      if (report.id === reportId) return report;
    }
    return null;
  };

  const artifactContentType = (artifact: HarnessArtifactView): string => {
    switch (artifact.kind) {
      case "html":
        return "text/html; charset=utf-8";
      case "markdown":
        return "text/markdown; charset=utf-8";
      case "json":
        return "application/json; charset=utf-8";
      case "image":
        return artifact.mime || "image/svg+xml";
      default:
        return artifact.mime || "text/plain; charset=utf-8";
    }
  };

  const artifactFileName = (artifact: HarnessArtifactView): string => {
    const base = artifact.rel_path.split("/").pop() ?? "artifact.txt";
    return base.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact.txt";
  };

  /** v1.5：下载/预览文件绝对路径安全校验——必须绝对路径、规范化后位于 runs/ 目录内、无路径穿越。 */
  const isSafeHarnessPath = (filePath: string): boolean => {
    if (typeof filePath !== "string" || filePath === "") return false;
    if (!isAbsolute(filePath)) return false;
    const normalized = normalize(filePath);
    if (normalized.includes("..")) return false;
    const segments = normalized.split(/[\\/]/);
    if (!segments.includes("runs")) return false;
    return segments.includes("harness");
  };

  /** 解析产物内容：优先真实 provider（getArtifactContent / getArtifactFilePath 白名单路径），否则演示 preview_text。 */
  const resolveArtifactContent = async (
    artifact: HarnessArtifactView,
  ): Promise<{ content: string; mime: string; fileName: string; source: "provider_content" | "provider_file" | "inline" }> => {
    if (runtimeProvider?.getArtifactContent !== undefined) {
      try {
        const result = await runtimeProvider.getArtifactContent(artifact.id);
        if (result.ok && typeof result.content === "string") {
          return { content: result.content, mime: result.mime ?? artifactContentType(artifact), fileName: artifactFileName(artifact), source: "provider_content" };
        }
      } catch {
        /* fallback */
      }
    }
    if (runtimeProvider?.getArtifactFilePath !== undefined) {
      try {
        const filePath = runtimeProvider.getArtifactFilePath(artifact.id);
        if (filePath !== null && isSafeHarnessPath(filePath)) {
          const content = await readFile(filePath, "utf8");
          return { content, mime: artifactContentType(artifact), fileName: basename(filePath), source: "provider_file" };
        }
      } catch {
        /* fallback */
      }
    }
    return { content: artifact.preview_text ?? "", mime: artifactContentType(artifact), fileName: artifactFileName(artifact), source: "inline" };
  };

  const sendRawArtifact = async (res: ServerResponse, artifact: HarnessArtifactView, disposition: "inline" | "attachment"): Promise<number> => {
    const resolved = await resolveArtifactContent(artifact);
    const body = resolved.content;
    const extra: Record<string, string> = {
      "Content-Type": resolved.mime,
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
    };
    if (artifact.kind === "html") {
      // 预览 iframe 为 sandbox（无脚本）；再叠加 CSP 禁止脚本/外部资源
      extra["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'";
    } else if (artifact.kind === "image") {
      extra["Content-Security-Policy"] = "default-src 'none'";
    }
    if (disposition === "attachment") {
      extra["Content-Disposition"] = `attachment; filename="${resolved.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
    }
    res.writeHead(200, baseHeaders(extra));
    res.end(body);
    return 200;
  };

  const handleHarnessApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number | null> => {
    if (!isHarnessApiPath(pathname)) return null;
    if (runtimeProvider === undefined) {
      return sendJson(res, 503, {
        ok: false,
        error: "runtime_unavailable",
        message: "产物/报告需要 runtimeProvider（createConsoleServer 默认启用 createDemoRuntimeProvider）",
      });
    }
    const isRead = method === "GET" || method === "HEAD";
    if (!isRead) return methodNotAllowed(res, ["GET", "HEAD"]);

    if (pathname === "/api/artifacts") {
      const filter: RuntimeArtifactFilter = {};
      const runId = requestUrl.searchParams.get("run_id");
      if (runId !== null && runId !== "") filter.run_id = runId;
      const agentRole = requestUrl.searchParams.get("agent");
      if (agentRole !== null && agentRole !== "") filter.agent_role = agentRole;
      const kind = requestUrl.searchParams.get("kind");
      if (kind !== null && kind !== "") filter.kind = kind;
      return sendJson(res, 200, { ok: true, data: await listRuntimeArtifacts(filter) });
    }

    const artifactMatch = /^\/api\/artifacts\/([^/]+)\/(preview|download|raw)$/.exec(pathname);
    if (artifactMatch !== null) {
      const artifactId = decodeURIComponent(artifactMatch[1] ?? "");
      const action = artifactMatch[2];
      const artifact = await findRuntimeArtifact(artifactId);
      if (artifact === null) {
        return sendJson(res, 404, { ok: false, error: "artifact_not_found", message: `产物不存在或路径不安全：${artifactId}` });
      }
      if (action === "download") return await sendRawArtifact(res, artifact, "attachment");
      if (action === "raw") return await sendRawArtifact(res, artifact, "inline");
      // preview：默认返回 JSON；raw=1 直接返回内容（供 iframe/img 使用）
      if (requestUrl.searchParams.get("raw") === "1") return await sendRawArtifact(res, artifact, "inline");
      return sendJson(res, 200, {
        ok: true,
        data: {
          id: artifact.id,
          run_id: artifact.run_id,
          session_id: artifact.session_id,
          title: artifact.title,
          kind: artifact.kind,
          mime: artifactContentType(artifact),
          size: artifact.size,
          rel_path: artifact.rel_path,
          preview_text: artifact.preview_text ?? "",
          download_url: artifact.download_url ?? `/api/artifacts/${artifact.id}/download`,
        },
      });
    }

    if (pathname === "/api/reports") {
      const filter: RuntimeReportFilter = {};
      const runId = requestUrl.searchParams.get("run_id");
      if (runId !== null && runId !== "") filter.run_id = runId;
      const agentRole = requestUrl.searchParams.get("agent");
      if (agentRole !== null && agentRole !== "") filter.agent_role = agentRole;
      return sendJson(res, 200, { ok: true, data: await listRuntimeReports(filter) });
    }

    const reportMatch = /^\/api\/reports\/([^/]+)$/.exec(pathname);
    if (reportMatch !== null) {
      const reportId = decodeURIComponent(reportMatch[1] ?? "");
      const report = await findRuntimeReport(reportId);
      if (report === null) return sendJson(res, 404, { ok: false, error: "report_not_found", message: `报告不存在：${reportId}` });
      return sendJson(res, 200, { ok: true, data: report });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到产物/报告 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // API 路由
  // -------------------------------------------------------------------------
  const handleApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    requestUrl: URL,
  ): Promise<number> => {
    const adminResult = await handleAdminApi(req, res, method, pathname, requestUrl);
    if (adminResult !== null) return adminResult;
    const chatEngineResult = await handleChatEngineApi(req, res, method, pathname, requestUrl);
    if (chatEngineResult !== null) return chatEngineResult;
    const chatResult = await handleChatApi(req, res, method, pathname, requestUrl);
    if (chatResult !== null) return chatResult;
    const systemResult = await handleSystemApi(req, res, method, pathname, requestUrl);
    if (systemResult !== null) return systemResult;
    const harnessResult = await handleHarnessApi(req, res, method, pathname, requestUrl);
    if (harnessResult !== null) return harnessResult;

    const isRead = method === "GET" || method === "HEAD";
    const readOnlyRoute =
      pathname === "/api/overview" ||
      pathname === "/api/approvals" ||
      pathname === "/api/ledger" ||
      pathname === "/api/monthly-report" ||
      pathname === "/api/summary" ||
      /^\/api\/projects\/[^/]+\/timeline$/.test(pathname) ||
      /^\/api\/evidence\/[^/]+$/.test(pathname) ||
      /^\/api\/ledger\/[^/]+\/facts$/.test(pathname);

    if (readOnlyRoute && !isRead) return methodNotAllowed(res, ["GET", "HEAD"]);

    if (pathname === "/api/overview" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.overview() });
    }

    const timelineMatch = /^\/api\/projects\/([^/]+)\/timeline$/.exec(pathname);
    if (timelineMatch !== null && isRead) {
      const projectId = timelineMatch[1] ?? "";
      return sendJson(res, 200, { ok: true, data: await provider.projectTimeline(projectId) });
    }

    const evidenceMatch = /^\/api\/evidence\/([^/]+)$/.exec(pathname);
    if (evidenceMatch !== null && isRead) {
      const ref = evidenceMatch[1] ?? "";
      const evidence = await provider.evidenceDetail(ref);
      if (evidence === null) {
        return sendJson(res, 404, { ok: false, error: "not_found", message: `证据不存在：${ref}` });
      }
      return sendJson(res, 200, { ok: true, data: evidence });
    }

    if (pathname === "/api/ledger" && isRead) {
      const filter: ConsoleLedgerFilter = {};
      const projectId = requestUrl.searchParams.get("project_id");
      if (projectId !== null && projectId !== "") filter.project_id = projectId;
      const type = requestUrl.searchParams.get("type");
      if (type !== null && type !== "") filter.type = type;
      const limitText = requestUrl.searchParams.get("limit");
      if (limitText !== null && /^\d+$/.test(limitText)) filter.limit = Number.parseInt(limitText, 10);
      return sendJson(res, 200, { ok: true, data: await provider.ledger(filter) });
    }

    const factsMatch = /^\/api\/ledger\/([^/]+)\/facts$/.exec(pathname);
    if (factsMatch !== null && isRead) {
      const entryId = factsMatch[1] ?? "";
      const facts = await provider.ledgerFacts(entryId);
      if (facts === null) {
        return sendJson(res, 404, { ok: false, error: "not_found", message: `账本记录不存在：${entryId}` });
      }
      return sendJson(res, 200, { ok: true, data: facts });
    }

    if (pathname === "/api/approvals" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.approvals() });
    }

    const decideMatch = /^\/api\/approvals\/([^/]+)\/decide$/.exec(pathname);
    if (decideMatch !== null) {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const decisionValue = body.value.decision;
      if (decisionValue !== "approve" && decisionValue !== "reject") {
        return sendJson(res, 400, {
          ok: false,
          error: "invalid_decision",
          message: 'decision 只支持 "approve" 或 "reject"',
        });
      }
      const approvalId = decideMatch[1] ?? "";
      const by = readString(body.value.by, "web-console");
      const result = await provider.decideApproval(approvalId, decisionValue, by);
      if (result.status === "not_found") {
        return sendJson(res, 404, { ok: false, error: "not_found", message: result.reason ?? `审批不存在：${approvalId}` });
      }
      if (!result.ok) {
        return sendJson(res, 409, {
          ok: false,
          error: "conflict",
          message: result.reason ?? `审批已处理：${result.status}`,
          data: result,
        });
      }
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === "/api/takeover" && isRead) {
      const status = await provider.takeoverStatus();
      return sendJson(res, 200, { ok: true, data: status });
    }
    if (pathname === "/api/takeover" && method === "POST") {
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const reason = readString(body.value.reason, "人工接管（Web 控制台）");
      const by = readString(body.value.by, "web-console");
      const result = await provider.takeover(reason, by);
      return sendJson(res, 200, { ok: true, data: result });
    }
    if (pathname === "/api/takeover/resume") {
      if (method !== "POST") return methodNotAllowed(res, ["POST"]);
      const auth = requireWriteAuth(req, res);
      if (auth !== null) return auth;
      const body = await readJsonBody(req);
      if (!body.ok) {
        return sendJson(res, body.status, { ok: false, error: "invalid_body", message: body.message });
      }
      const by = readString(body.value.by, "web-console");
      return sendJson(res, 200, { ok: true, data: await provider.resume(by) });
    }
    if (pathname === "/api/takeover") return methodNotAllowed(res, ["GET", "HEAD", "POST"]);

    if (pathname === "/api/monthly-report" && isRead) {
      return sendJson(res, 200, { ok: true, data: await provider.monthlyReport() });
    }

    if (pathname === "/api/summary" && isRead) {
      const rawLevel = (requestUrl.searchParams.get("level") ?? "L0").toUpperCase();
      if (rawLevel !== "L0" && rawLevel !== "L1" && rawLevel !== "L2") {
        return sendJson(res, 400, { ok: false, error: "invalid_level", message: "level 只支持 L0 / L1 / L2" });
      }
      const level = rawLevel as ConsoleSummaryLevel;
      return sendJson(res, 200, { ok: true, data: await provider.summary(level) });
    }

    return sendJson(res, 404, { ok: false, error: "not_found", message: `未找到 API：${pathname}` });
  };

  // -------------------------------------------------------------------------
  // 入口分发
  // -------------------------------------------------------------------------
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<number> => {
    const method = req.method ?? "GET";
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad_request", message: "请求 URL 不合法" });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad_request", message: "URL 编码不合法" });
    }

    if (pathname === "/assets/app.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", BASE_CSS);
    }
    if (pathname === "/assets/app.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", CLIENT_JS);
    }
    if (pathname === "/assets/pro.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", PRO_CSS);
    }
    if (pathname === "/assets/admin.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", ADMIN_JS);
    }
    if (pathname === "/assets/chat.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", CHAT_CSS);
    }
    if (pathname === "/assets/chat.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", CHAT_JS);
    }
    if (pathname === "/assets/gpt.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", GPT_CSS);
    }
    if (pathname === "/assets/gpt.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", GPT_JS);
    }
    if (pathname === "/assets/system.css") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/css; charset=utf-8", SYSTEM_CSS);
    }
    if (pathname === "/assets/system.js") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      return sendText(res, "text/javascript; charset=utf-8", SYSTEM_JS);
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204, baseHeaders());
      res.end();
      return 204;
    }
    if (pathname === "/health") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
      const status = await safeTakeoverStatus();
      let mode: string | null = null;
      if (adminProvider !== undefined) {
        try {
          mode = (await adminProvider.getConfig()).profile.mode;
        } catch {
          mode = null;
        }
      }
      return sendJson(res, 200, {
        ok: true,
        service: "steward-console",
        version: "1.5.3",
        host,
        port,
        local_only: true,
        admin_enabled: adminProvider !== undefined,
        chat_enabled: chatProvider !== undefined,
        system_enabled: systemProvider !== undefined,
        runtime_enabled: runtimeProvider !== undefined,
        sse_active_streams: activeSseStreams,
        artifacts_enabled: runtimeProvider?.listArtifacts !== undefined,
        reports_enabled: runtimeProvider?.listReports !== undefined,
        metrics_enabled: runtimeProvider?.getRunMetrics !== undefined,
        chat_engine_enabled: chatEngineProvider !== undefined,
        mode,
        halted: status !== null && status.halted === true,
        started_at: startedAt,
        uptime_ms: Date.now() - Date.parse(startedAt),
      });
    }
    if (pathname.startsWith("/api/")) return handleApi(req, res, method, pathname, requestUrl);

    if (method !== "GET" && method !== "HEAD") return methodNotAllowed(res, ["GET", "HEAD"]);
    return handlePage(res, pathname, requestUrl);
  };

  const server = createServer((req, res) => {
    const startedMs = Date.now();
    res.on("error", () => {
      // 客户端提前断开（E2E 关闭浏览器）时不抛未处理异常
    });
    void handleRequest(req, res)
      .then((statusCode) => {
        log(`${req.method ?? "?"} ${req.url ?? "/"} → ${String(statusCode)} ${String(Date.now() - startedMs)}ms`);
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        log(`${req.method ?? "?"} ${req.url ?? "/"} → 500 ${message}`);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: "internal_error", message });
        } else {
          res.end();
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const urlHost = host === "::1" ? "[::1]" : host;
  const url = `http://${urlHost}:${String(actualPort)}`;
  log(`[console] 已启动 ${url}（只监听 ${host}，写操作需 X-Steward-Token）`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // 断开 keep-alive 连接，避免 E2E/CLI 退出时挂起或端口残留
      server.closeAllConnections();
    });
    log("[console] 已关闭");
  };

  return {
    server,
    url,
    host,
    port: actualPort,
    token,
    provider,
    ...(adminProvider === undefined ? {} : { adminProvider }),
    ...(chatProvider === undefined ? {} : { chatProvider }),
    ...(systemProvider === undefined ? {} : { systemProvider }),
    ...(runtimeProvider === undefined ? {} : { runtimeProvider }),
    close,
  };
}
