/**
 * packages/steward-console/src/system.ts
 *
 * v1.3 扩展契约：**系统总控（/system）** + **易支付（epay）配置与收款**。
 *
 * - `ConsoleSystemProvider`：与「超级总调度（supervisor）」对话、两层结构（supervisor → 项目总调度 → 专项智能体）、
 *   受管程序（运行/停止/重启）、插件（启用/禁用/删除）、各 agent 当前模型与 Token、系统日志、
 *   快捷命令、**危险动作二次确认**（风险说明 + 备份路径 + 确认 token 才执行）。
 * - 易支付：商家设置（网关地址/商户 ID/密钥引用掩码/支付方式/回调/return_url/demo|live），
 *   收款请求可走 epay 跳转链接 + 二维码占位；demo 不真实扣款，确认到账仍人工。
 *
 * 与 ConsoleChatProvider/ConsoleDataProvider/ConsoleAdminProvider 解耦，内置 demo 实现内存生效；
 * Lead 接真实 supervisor/Orchestrator/程序管理器时按此契约写适配器。
 */

import type { MaybePromise } from "./provider.js";

// ---------------------------------------------------------------------------
// 超级总调度对话
// ---------------------------------------------------------------------------

export interface SupervisorMessage {
  id: string;
  role: "user" | "supervisor";
  text: string;
  summary?: string;
  at: string;
  kind?: "status" | "command" | "danger" | "result" | "error";
}

// ---------------------------------------------------------------------------
// 受管程序 / 插件 / 智能体模型
// ---------------------------------------------------------------------------

export type ProgramStatus = "running" | "stopped";
export type ProgramKind = "service" | "worker" | "gateway" | "scheduler" | "browser";

export interface SystemProgram {
  id: string;
  name: string;
  kind: ProgramKind;
  status: ProgramStatus;
  pid?: number;
  port?: number;
  since: string;
  health: "ok" | "degraded" | "unknown";
  description: string;
}

export interface SystemPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  description: string;
  requires_approval: boolean;
}

export interface SystemAgentModel {
  agent_role: string;
  title: string;
  layer: "supervisor" | "project_conductor" | "specialist";
  provider: string;
  model: string;
  tokens_today: number;
  token_limit: number;
  status: string;
}

export interface SystemLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

export interface SystemDangerRequest {
  action: "delete_program" | "delete_plugin";
  target_id: string;
  target_name?: string;
}

export interface SystemDangerConfirm {
  ok: boolean;
  request?: SystemDangerRequest;
  /** 风险说明（页面必须展示）。 */
  risk?: string;
  /** 备份路径（删除前必须展示；真实实现应先备份）。 */
  backup_path?: string;
  /** 确认令牌：页面展示并要求用户原样输入后才允许执行。 */
  confirm_token?: string;
  expires_at?: string;
  errors: string[];
}

export interface SystemDangerExecuteInput {
  action: "delete_program" | "delete_plugin";
  target_id: string;
  confirm_token: string;
  confirm_text: string;
}

export interface SystemActionResult {
  ok: boolean;
  message: string;
  status?: SystemStatus;
  errors: string[];
}

export interface SystemStatus {
  supervisor: { title: string; model: string; status: string; layer_label: string };
  project_conductor: { title: string; model: string; status: string; layer_label: string };
  agents: SystemAgentModel[];
  programs: SystemProgram[];
  plugins: SystemPlugin[];
  logs: SystemLogEntry[];
  mode: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 易支付（epay）
// ---------------------------------------------------------------------------

export type EpayMode = "demo" | "live";
export type EpayMethod = "alipay" | "wxpay";

export interface EpayConfig {
  enabled: boolean;
  mode: EpayMode;
  gateway_url: string;
  merchant_id: string;
  /** 密钥引用（env:/keychain:），不存明文。 */
  api_key_ref: string;
  api_key_masked: string;
  methods: EpayMethod[];
  notify_url: string;
  return_url: string;
  updated_at: string;
}

export interface EpaySaveResult {
  ok: boolean;
  config: EpayConfig;
  errors: string[];
}

export interface EpayPayLink {
  ok: boolean;
  pay_url?: string;
  qr_url?: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Provider 契约
// ---------------------------------------------------------------------------

export interface ConsoleSystemProvider {
  // 超级总调度对话
  supervisorMessages(): MaybePromise<SupervisorMessage[]>;
  sendSupervisorMessage(text: string): MaybePromise<SupervisorMessage[]>;
  // 系统状态 / 程序 / 插件 / 日志
  getSystemStatus(): MaybePromise<SystemStatus>;
  programAction(programId: string, action: "start" | "stop" | "restart"): MaybePromise<SystemActionResult>;
  pluginAction(pluginId: string, enabled: boolean): MaybePromise<SystemActionResult>;
  getSystemLogs(limit?: number): MaybePromise<SystemLogEntry[]>;
  /** 执行快捷命令（打开/关闭/重启程序、启用/禁用插件、切换模型、委派项目等）；自然语言解析为演示动作。 */
  runQuickCommand(command: string): MaybePromise<SystemActionResult>;
  // 危险动作二次确认
  prepareDangerousAction(request: SystemDangerRequest): MaybePromise<SystemDangerConfirm>;
  executeDangerousAction(input: SystemDangerExecuteInput): MaybePromise<SystemActionResult>;
  // 易支付
  getEpayConfig(): MaybePromise<EpayConfig>;
  saveEpayConfig(partial: Partial<EpayConfig>): MaybePromise<EpaySaveResult>;
  /** 生成易支付跳转链接 + 二维码占位（demo 模式不真实扣款）。 */
  buildEpayPayLink(input: { amount_cny: number; client: string; purpose: string; out_trade_no: string }): MaybePromise<EpayPayLink>;
}

// ---------------------------------------------------------------------------
// 演示实现
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

export interface DemoSystemProviderOptions {
  now?: () => Date;
  mode?: string;
  /** 当前 agent 模型列表（由 chat provider 提供，保证两处一致）。 */
  getAgentModels?: () => Array<{ agent_role: string; title: string; provider: string; model: string; tokens_today: number; token_limit: number; status: string }>;
}

export function createDemoSystemProvider(options: DemoSystemProviderOptions = {}): ConsoleSystemProvider {
  const now = options.now ?? (() => new Date());
  const iso = (offsetMs = 0): string => new Date(now().getTime() + offsetMs).toISOString();
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, "0")}`;
  };

  const programs: SystemProgram[] = [
    { id: "prog-console", name: "本地控制台 (steward console)", kind: "service", status: "running", pid: 48212, port: 4180, since: iso(-3 * 60 * MINUTE), health: "ok", description: "Web 控制台，只监听 127.0.0.1" },
    { id: "prog-orchestrator", name: "任务编排器 (orchestrator)", kind: "scheduler", status: "running", pid: 48240, since: iso(-3 * 60 * MINUTE), health: "ok", description: "总调度/项目总调度的任务编排与队列" },
    { id: "prog-browser", name: "浏览器执行器 (browser)", kind: "browser", status: "running", pid: 48299, since: iso(-2 * 60 * MINUTE), health: "ok", description: "真实有头浏览器执行（截图/证明）" },
    { id: "prog-gateway", name: "模型网关 (llm-gateway)", kind: "gateway", status: "running", pid: 48355, port: 11435, since: iso(-2 * 60 * MINUTE), health: "degraded", description: "模型 provider 网关（易支付/模型密钥同步经此）" },
    { id: "prog-scout-worker", name: "找客户 worker (scout-worker)", kind: "worker", status: "stopped", since: iso(-24 * 60 * MINUTE), health: "unknown", description: "合规 fixture 线索评分（停用时不发外联）" },
  ];
  const plugins: SystemPlugin[] = [
    { id: "plug-money", name: "变现/收款（money）", version: "1.2.0", enabled: true, requires_approval: true, description: "收款请求 / 确认到账 / 账本收入；含易支付渠道" },
    { id: "plug-epay", name: "易支付接入（epay）", version: "1.3.0", enabled: true, requires_approval: true, description: "支付宝/微信 epay 网关，demo 不真实扣款" },
    { id: "plug-harness", name: "编码回路（harness）", version: "1.1.0", enabled: true, requires_approval: true, description: "CodeTask → 补丁 → 真实浏览器验收" },
    { id: "plug-scout", name: "找客户分支（scout）", version: "1.2.0", enabled: false, requires_approval: true, description: "合规 fixture 线索与草稿（需审批外发）" },
    { id: "plug-fault", name: "故障演练（fault-drills）", version: "1.0.0", enabled: false, requires_approval: false, description: "注入故障验证停止/接管链路" },
  ];

  const defaultAgentSeeds = [
    { agent_role: "supervisor", title: "超级总调度", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 8_420, token_limit: 500_000, status: "running" },
    { agent_role: "conductor", title: "项目总调度", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 6_310, token_limit: 300_000, status: "running" },
    { agent_role: "operator", title: "执行（浏览器/桌面）", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 12_880, token_limit: 400_000, status: "running" },
    { agent_role: "harness", title: "写代码 Harness", provider: "DeepSeek（官方）", model: "deepseek-reasoner（示例）", tokens_today: 9_640, token_limit: 300_000, status: "running" },
    { agent_role: "reviewer", title: "核查复核", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 3_210, token_limit: 200_000, status: "idle" },
    { agent_role: "scout", title: "找客户", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 1_540, token_limit: 150_000, status: "idle" },
    { agent_role: "finance", title: "财务记账", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 2_760, token_limit: 200_000, status: "running" },
    { agent_role: "customer", title: "客户对接", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 1_980, token_limit: 150_000, status: "idle" },
    { agent_role: "backend", title: "后台值守", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 4_170, token_limit: 200_000, status: "running" },
    { agent_role: "content", title: "内容创作", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 860, token_limit: 100_000, status: "idle" },
    { agent_role: "research", title: "调研检索", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 1_120, token_limit: 100_000, status: "idle" },
    { agent_role: "enterprise_admin", title: "企业合规/用印", provider: "DeepSeek（官方）", model: "deepseek-chat", tokens_today: 0, token_limit: 100_000, status: "not_applicable" },
  ];

  const agentModels = (): SystemAgentModel[] => {
    const source = options.getAgentModels === undefined ? null : options.getAgentModels();
    const base = source === null ? defaultAgentSeeds : source;
    const merged = base.map((agent) => ({
      agent_role: agent.agent_role,
      title: agent.title,
      provider: agent.provider,
      model: agent.model,
      tokens_today: agent.tokens_today,
      token_limit: agent.token_limit,
      status: agent.status,
      layer: agent.agent_role === "supervisor" ? ("supervisor" as const) : agent.agent_role === "conductor" ? ("project_conductor" as const) : ("specialist" as const),
    }));
    if (!merged.some((agent) => agent.agent_role === "supervisor")) {
      merged.unshift({
        agent_role: "supervisor",
        title: "超级总调度",
        provider: defaultAgentSeeds[0]?.provider ?? "DeepSeek（官方）",
        model: defaultAgentSeeds[0]?.model ?? "deepseek-chat",
        tokens_today: 8_420,
        token_limit: 500_000,
        status: "running",
        layer: "supervisor",
      });
    }
    if (!merged.some((agent) => agent.agent_role === "conductor")) {
      merged.push({
        agent_role: "conductor",
        title: "项目总调度",
        provider: defaultAgentSeeds[1]?.provider ?? "DeepSeek（官方）",
        model: defaultAgentSeeds[1]?.model ?? "deepseek-chat",
        tokens_today: 6_310,
        token_limit: 300_000,
        status: "running",
        layer: "project_conductor",
      });
    }
    return merged;
  };

  const logs: SystemLogEntry[] = [
    { at: iso(-18 * MINUTE), level: "info", source: "supervisor", message: "系统巡检：5 个受管程序，4 运行 / 1 停止；插件 5 个（2 个停用）" },
    { at: iso(-12 * MINUTE), level: "warn", source: "llm-gateway", message: "模型网关延迟升高（p95 1.8s），已自动降级到备用 provider" },
    { at: iso(-6 * MINUTE), level: "info", source: "epay", message: "易支付 demo 模式：未接真实商户，收款链接为占位" },
    { at: iso(-3 * MINUTE), level: "info", source: "money", message: "收款请求 money-002（¥2,800.00）等待客户扫码；到账需人工确认" },
    { at: iso(-1 * MINUTE), level: "info", source: "system", message: "所有写操作需 X-Steward-Token；删除程序/插件需二次确认" },
  ];

  const pushLog = (level: SystemLogEntry["level"], source: string, message: string): void => {
    logs.unshift({ at: iso(0), level, source, message });
    if (logs.length > 200) logs.pop();
  };

  const messages: SupervisorMessage[] = [
    {
      id: nextId("sup"),
      role: "supervisor",
      at: iso(-20 * MINUTE),
      text:
        "我是超级总调度（supervisor），负责整个系统：程序与插件的生命周期、模型与密钥、项目委派、以及危险动作的二次确认。\n" +
        "两层结构：我 → 项目总调度（conductor）→ 12 个专项智能体。你可以直接下命令（我会先说明影响与风险），或告诉我要做什么项目，我委派给项目总调度。\n" +
        "注意：删除程序/插件属于危险动作，我会先展示风险与备份路径，并要求你输入确认 token 才会执行。",
      summary: "超级总调度上线：管理程序/插件/模型/项目委派，危险动作需二次确认",
      kind: "status",
    },
    {
      id: nextId("sup"),
      role: "user",
      at: iso(-15 * MINUTE),
      text: "帮我看看系统状态，顺便确认一下易支付配置好了没",
      summary: "用户：查看系统状态与易支付配置",
    },
    {
      id: nextId("sup"),
      role: "supervisor",
      at: iso(-14 * MINUTE),
      text:
        "系统状态：\n- 程序：本地控制台 running、编排器 running、浏览器执行器 running、模型网关 running（degraded：延迟高）、scout-worker stopped\n" +
        "- 插件：money/harness/epay 已启用，scout/fault-drills 停用\n- 模型：supervisor + 11 个 agent 均已绑定 DeepSeek（harness 用 deepseek-reasoner）\n" +
        "- 易支付：demo 模式已启用（网关与商户 ID 为演示占位，不会真实扣款）；切 live 需要商户号与密钥引用。",
      summary: "状态巡检完成：1 程序停止、网关降级、易支付 demo 已启用",
      kind: "result",
    },
  ];

  const epay: EpayConfig = {
    enabled: true,
    mode: "demo",
    gateway_url: "https://epay.example.com/submit.php",
    merchant_id: "1000-DEMO-E2E",
    api_key_ref: "env:EPAМ_API_KEY",
    api_key_masked: "epk-****7c31",
    methods: ["alipay", "wxpay"],
    notify_url: "http://127.0.0.1:4180/api/money/epay/notify",
    return_url: "http://127.0.0.1:4180/money",
    updated_at: iso(-60 * MINUTE),
  };

  const dangerTokens = new Map<string, { token: string; expiresAt: number; request: SystemDangerRequest }>();
  const backupRoot = "backups/system";

  const findProgram = (id: string): SystemProgram | undefined => programs.find((item) => item.id === id);
  const findPlugin = (id: string): SystemPlugin | undefined => plugins.find((item) => item.id === id);

  const status = (): SystemStatus => ({
    supervisor: { title: "超级总调度", model: "deepseek-chat", status: "running", layer_label: "第 1 层：超级总调度（系统级）" },
    project_conductor: { title: "项目总调度", model: "deepseek-chat", status: "running", layer_label: "第 2 层：项目总调度（项目级）" },
    agents: agentModels(),
    programs: programs.map((program) => ({ ...program })),
    plugins: plugins.map((plugin) => ({ ...plugin })),
    logs: logs.slice(0, 20).map((entry) => ({ ...entry })),
    mode: options.mode ?? "demo",
    updated_at: iso(0),
  });

  const supervisorReply = (text: string, summary: string, kind: SupervisorMessage["kind"]): SupervisorMessage[] => {
    messages.push({ id: nextId("sup"), role: "supervisor", text, at: iso(0), summary, ...(kind === undefined ? {} : { kind }) });
    return messages.map((item) => ({ ...item }));
  };

  const action = (ok: boolean, message: string, errors: string[] = []): SystemActionResult =>
    ok ? { ok: true, message, status: status(), errors: [] } : { ok: false, message, errors };

  return {
    supervisorMessages: () => messages.map((item) => ({ ...item })),
    sendSupervisorMessage: (text) => {
      const content = String(text ?? "").trim();
      if (content === "") throw new Error("命令/消息不能为空");
      messages.push({ id: nextId("sup"), role: "user", text: content, at: iso(0), summary: `用户：${content.slice(0, 40)}` });
      if (/删除|移除|卸载/.test(content)) {
        return supervisorReply(
          "收到删除意图：这是危险动作。请在下方「程序/插件」卡片点「删除」，我会展示风险与备份路径，并要求你输入确认 token 后才执行。",
          "删除属于危险动作：需二次确认（风险 + 备份路径 + 确认 token）",
          "danger",
        );
      }
      if (/重启/.test(content)) {
        const target = programs.find((program) => content.includes(program.name.split(" ")[0] ?? "") || content.includes("网关")) ?? programs[3];
        if (target !== undefined) {
          target.status = "running";
          target.since = iso(0);
          target.health = "ok";
          pushLog("info", "supervisor", `快捷命令：重启程序 ${target.name}（演示）`);
        }
        return supervisorReply(`已重启程序：${target?.name ?? "模型网关"}（演示）。当前所有受管程序 running。`, "已重启模型网关程序", "command");
      }
      if (/停止|关闭/.test(content)) {
        const target = programs.find((program) => content.includes(program.name.split(" ")[0] ?? "")) ?? programs.find((program) => program.id === "prog-scout-worker");
        if (target !== undefined) {
          target.status = "stopped";
          pushLog("warn", "supervisor", `快捷命令：停止程序 ${target.name}（演示，可再启动）`);
        }
        return supervisorReply(`已停止程序：${target?.name ?? "scout-worker"}。提示：危险动作（删除）需要二次确认。`, "已停止 scout-worker 程序", "command");
      }
      if (/启动|打开/.test(content)) {
        const target = programs.find((program) => program.id === "prog-scout-worker") ?? programs[0];
        if (target !== undefined) {
          target.status = "running";
          target.since = iso(0);
          pushLog("info", "supervisor", `快捷命令：启动程序 ${target.name}`);
        }
        return supervisorReply(`已启动程序：${target?.name ?? "scout-worker"}（演示）。`, "已启动 scout-worker 程序", "command");
      }
      if (/插件/.test(content) && /启用|禁用/.test(content)) {
        const target = plugins.find((plugin) => content.includes("epay") || content.includes("易支付")) ?? plugins[1];
        if (target !== undefined) {
          target.enabled = /启用/.test(content) && !/禁用/.test(content);
          pushLog("info", "supervisor", `快捷命令：${target.enabled ? "启用" : "禁用"}插件 ${target.name}`);
        }
        return supervisorReply(`已${target?.enabled === true ? "启用" : "禁用"}插件：${target?.name ?? "易支付接入"}（演示）。`, `插件状态已更新：${target?.name ?? "epay"}`, "command");
      }
      if (/模型/.test(content)) {
        return supervisorReply(
          "切换模型请在「各 agent 当前模型」处选择，或到 /settings → 模型与 API 密钥 修改绑定并一键同步；我记录每次变更到系统日志。",
          "模型切换入口：/system 模型列表 或 /settings → 模型与 API 密钥",
          "command",
        );
      }
      if (/提示词|prompt/i.test(content)) {
        return supervisorReply("系统提示词在 /settings → 系统提示词 编辑；supervisor 提示词也在其中，保存会升版本并写审计日志。", "提示词入口：/settings → 系统提示词", "command");
      }
      if (/项目|委派|做/.test(content)) {
        return supervisorReply("收到项目需求：建议到 /chat 新建项目并告诉项目总调度目标（预算/Token 上限），我会审批计划并监督执行。", "项目委派入口：/chat 新建项目", "command");
      }
      return supervisorReply(`收到：「${content}」。我可以：查看系统状态、打开/关闭/重启程序、启用/禁用插件、切换模型、修改提示词、委派项目给项目总调度。危险动作（删除）需要二次确认。`, "supervisor 已记录并给出可用命令", "result");
    },
    getSystemStatus: status,
    programAction: (programId, actionName) => {
      const program = findProgram(programId);
      if (program === undefined) return action(false, `程序不存在：${programId}`, [`程序不存在：${programId}`]);
      if (actionName === "stop") {
        if (program.id === "prog-console") return action(false, "不能停止当前控制台进程（会断开本页面）", ["禁止停止控制台自身"]);
        program.status = "stopped";
        program.health = "unknown";
        pushLog("warn", "supervisor", `停止程序 ${program.name}（pid ${String(program.pid ?? "—")}）`);
        return action(true, `已停止程序：${program.name}`);
      }
      program.status = "running";
      program.since = iso(0);
      program.health = "ok";
      program.pid = 48_000 + Math.floor(Math.random() * 900);
      pushLog("info", "supervisor", `${actionName === "restart" ? "重启" : "启动"}程序 ${program.name}（pid ${String(program.pid)}）`);
      return action(true, `已${actionName === "restart" ? "重启" : "启动"}程序：${program.name}`);
    },
    pluginAction: (pluginId, enabled) => {
      const plugin = findPlugin(pluginId);
      if (plugin === undefined) return action(false, `插件不存在：${pluginId}`, [`插件不存在：${pluginId}`]);
      plugin.enabled = enabled;
      pushLog(enabled ? "info" : "warn", "supervisor", `${enabled ? "启用" : "禁用"}插件 ${plugin.name}`);
      return action(true, `已${enabled ? "启用" : "禁用"}插件：${plugin.name}`);
    },
    getSystemLogs: (limit) => logs.slice(0, limit === undefined || limit <= 0 ? 50 : limit).map((entry) => ({ ...entry })),
    runQuickCommand: (command) => {
      const content = String(command ?? "").trim();
      if (content === "") return action(false, "命令不能为空", ["命令不能为空"]);
      messages.push({ id: nextId("sup"), role: "user", text: content, at: iso(0), summary: `快捷命令：${content.slice(0, 40)}` });
      if (/重启/.test(content)) {
        const program = programs.find((item) => content.includes(item.name.split(" ")[0] ?? "")) ?? programs[3];
        if (program !== undefined) {
          program.status = "running";
          program.since = iso(0);
          program.health = "ok";
        }
        pushLog("info", "supervisor", `快捷命令：重启 ${program?.name ?? "模型网关"}`);
        return action(true, `已重启：${program?.name ?? "模型网关"}`);
      }
      if (/启动|打开/.test(content)) {
        const program = programs.find((item) => content.includes(item.name.split(" ")[0] ?? "")) ?? programs.find((item) => item.id === "prog-scout-worker") ?? programs[0];
        if (program !== undefined) {
          program.status = "running";
          program.since = iso(0);
        }
        pushLog("info", "supervisor", `快捷命令：启动 ${program?.name ?? "scout-worker"}`);
        return action(true, `已启动：${program?.name ?? "scout-worker"}`);
      }
      if (/停止|关闭/.test(content)) {
        const program = programs.find((item) => content.includes(item.name.split(" ")[0] ?? "")) ?? programs.find((item) => item.id === "prog-scout-worker");
        if (program !== undefined) {
          if (program.id === "prog-console") return action(false, "不能停止当前控制台进程（会断开本页面）", ["禁止停止控制台自身"]);
          program.status = "stopped";
        }
        pushLog("warn", "supervisor", `快捷命令：停止 ${program?.name ?? "scout-worker"}`);
        return action(true, `已停止：${program?.name ?? "scout-worker"}`);
      }
      if (/插件/.test(content)) {
        const plugin = plugins.find((item) => content.includes("epay") || content.includes("易支付") || content.includes(item.id)) ?? plugins[1];
        if (plugin !== undefined) plugin.enabled = !/禁用/.test(content);
        pushLog("info", "supervisor", `快捷命令：${plugin?.enabled === true ? "启用" : "禁用"}插件 ${plugin?.name ?? "易支付接入"}`);
        return action(true, `插件已更新：${plugin?.name ?? "易支付接入"}（${plugin?.enabled === true ? "启用" : "禁用"}）`);
      }
      if (/模型/.test(content)) {
        pushLog("info", "supervisor", `快捷命令：模型切换提示（${content.slice(0, 30)}）`);
        return action(true, "模型切换请使用「各 agent 当前模型」或 /settings → 模型与 API 密钥（已记录日志）");
      }
      pushLog("info", "supervisor", `快捷命令：${content.slice(0, 60)}`);
      return action(true, `命令已执行（演示）：${content.slice(0, 60)}`);
    },
    prepareDangerousAction: (request) => {
      const isProgram = request.action === "delete_program";
      const target = isProgram ? findProgram(request.target_id) : findPlugin(request.target_id);
      if (target === undefined) {
        return { ok: false, errors: [`${isProgram ? "程序" : "插件"}不存在：${request.target_id}`] };
      }
      if (request.target_id === "prog-console") {
        return { ok: false, errors: ["禁止删除控制台自身（会丢失管理入口）"] };
      }
      if (request.target_id === "plug-money" || request.target_id === "plug-epay") {
        return { ok: false, errors: ["变现/易支付属于核心插件，禁止删除；可禁用"] };
      }
      const token = `DEL-${nextId("token").slice(-6).toUpperCase()}`;
      const expiresAt = iso(5 * 60_000);
      dangerTokens.set(`${request.action}:${request.target_id}`, { token, expiresAt: now().getTime() + 5 * 60_000, request });
      pushLog("warn", "supervisor", `危险动作待确认：${request.action} → ${target.name}（token 有效期 5 分钟）`);
      return {
        ok: true,
        request: { ...request, target_name: target.name },
        risk: isProgram
          ? "删除程序会立即停止该进程并移除管理条目；正在执行的任务会被中断，可能导致 run 失败/证据缺失。"
          : "删除插件会卸载其能力与数据入口；依赖该插件的智能体将无法工作，已有数据保留但不可再通过控制台访问。",
        backup_path: `${backupRoot}/${isProgram ? "programs" : "plugins"}/${request.target_id}-${iso(0).slice(0, 19).replaceAll(":", "")}.json`,
        confirm_token: token,
        expires_at: expiresAt,
        errors: [],
      };
    },
    executeDangerousAction: (input) => {
      const key = `${input.action}:${input.target_id}`;
      const pending = dangerTokens.get(key);
      if (pending === undefined) return action(false, "没有待确认的危险动作（或已过期），请重新发起", ["未找到待确认项"]);
      if (pending.token !== input.confirm_token) return action(false, "确认 token 不正确，拒绝执行", ["confirm_token 不匹配"]);
      if (now().getTime() > pending.expiresAt) {
        dangerTokens.delete(key);
        return action(false, "确认 token 已过期，请重新发起", ["confirm_token 已过期"]);
      }
      if (String(input.confirm_text ?? "").trim() !== "确认删除") {
        return action(false, '二次确认失败：请输入「确认删除」四个字', ["confirm_text 不匹配"]);
      }
      dangerTokens.delete(key);
      if (input.action === "delete_program") {
        const index = programs.findIndex((program) => program.id === input.target_id);
        if (index < 0) return action(false, `程序不存在：${input.target_id}`, ["程序不存在"]);
        const removed = programs.splice(index, 1)[0];
        pushLog("error", "supervisor", `危险动作已执行：删除程序 ${removed?.name ?? input.target_id}（备份 ${pending.request.target_id}）`);
        return action(true, `已删除程序：${removed?.name ?? input.target_id}（已记录备份路径与审计）`);
      }
      const index = plugins.findIndex((plugin) => plugin.id === input.target_id);
      if (index < 0) return action(false, `插件不存在：${input.target_id}`, ["插件不存在"]);
      const removed = plugins.splice(index, 1)[0];
      pushLog("error", "supervisor", `危险动作已执行：删除插件 ${removed?.name ?? input.target_id}`);
      return action(true, `已删除插件：${removed?.name ?? input.target_id}（已记录备份路径与审计）`);
    },
    getEpayConfig: () => ({ ...epay, methods: [...epay.methods] }),
    saveEpayConfig: (partial) => {
      const errors: string[] = [];
      const next: EpayConfig = { ...epay, methods: [...epay.methods] };
      if (partial.enabled !== undefined) next.enabled = partial.enabled === true;
      if (partial.mode !== undefined) next.mode = partial.mode === "live" ? "live" : "demo";
      if (partial.gateway_url !== undefined) next.gateway_url = String(partial.gateway_url).trim();
      if (partial.merchant_id !== undefined) next.merchant_id = String(partial.merchant_id).trim();
      if (partial.api_key_ref !== undefined) next.api_key_ref = String(partial.api_key_ref).trim();
      if (partial.methods !== undefined) next.methods = partial.methods.filter((method) => method === "alipay" || method === "wxpay");
      if (partial.notify_url !== undefined) next.notify_url = String(partial.notify_url).trim();
      if (partial.return_url !== undefined) next.return_url = String(partial.return_url).trim();
      if (next.enabled && next.mode === "live") {
        if (next.gateway_url === "" || !/^https?:\/\//.test(next.gateway_url)) errors.push("live 模式需要合法网关地址（http/https）");
        if (next.merchant_id === "") errors.push("live 模式需要商户 ID");
        if (next.api_key_ref === "") errors.push("live 模式需要密钥引用（env:/keychain:）");
        if (next.notify_url === "") errors.push("live 模式需要回调地址 notify_url");
        if (next.methods.length === 0) errors.push("至少选择一种支付方式（alipay / wxpay）");
      }
      if (next.gateway_url !== "" && !/^https?:\/\//.test(next.gateway_url)) errors.push("网关地址必须是 http/https");
      if (next.api_key_ref !== "" && !/^(env:|keychain:|none$)/.test(next.api_key_ref)) errors.push("密钥引用只支持 env:VAR / keychain:name / none（不存明文）");
      if (errors.length === 0) {
        epay.enabled = next.enabled;
        epay.mode = next.mode;
        epay.gateway_url = next.gateway_url;
        epay.merchant_id = next.merchant_id;
        epay.api_key_ref = next.api_key_ref;
        epay.api_key_masked = next.api_key_ref === "" ? "—" : `epk-****${String(Math.abs(hashString(next.api_key_ref))).padStart(4, "0").slice(0, 4)}`;
        epay.methods = next.methods;
        epay.notify_url = next.notify_url;
        epay.return_url = next.return_url;
        epay.updated_at = iso(0);
        pushLog("info", "epay", `易支付配置已保存：mode=${epay.mode} / 商户 ${epay.merchant_id || "—"} / 方式 ${epay.methods.join(",")}`);
      }
      return { ok: errors.length === 0, config: { ...epay, methods: [...epay.methods] }, errors };
    },
    buildEpayPayLink: (input) => {
      if (!epay.enabled) return { ok: false, errors: ["易支付未启用：请先在 /settings 支付与银行卡 或 /money 的易支付设置中启用"] };
      if (epay.mode === "live" && (epay.merchant_id === "" || epay.gateway_url === "" || epay.api_key_ref === "")) {
        return { ok: false, errors: ["live 模式配置不完整（网关/商户 ID/密钥引用），请先完善易支付商家设置"] };
      }
      const base = epay.gateway_url === "" ? "https://epay.example.com/submit.php" : epay.gateway_url;
      const method = epay.methods.includes("alipay") ? "alipay" : "wxpay";
      const payUrl = `${base}?pid=${encodeURIComponent(epay.merchant_id)}&type=${method}&out_trade_no=${encodeURIComponent(input.out_trade_no)}&money=${input.amount_cny.toFixed(2)}&name=${encodeURIComponent(input.purpose)}&notify_url=${encodeURIComponent(epay.notify_url)}&return_url=${encodeURIComponent(epay.return_url)}&__demo=${epay.mode === "demo" ? "1" : "0"}`;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="264" viewBox="0 0 230 264">` +
        `<rect width="230" height="264" rx="10" fill="#ffffff"/>` +
        `<rect x="18" y="18" width="194" height="194" rx="8" fill="#f4f6ff" stroke="#3b5bfd" stroke-width="2"/>` +
        `<text x="115" y="100" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="#3b5bfd">易支付 epay</text>` +
        `<text x="115" y="128" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#47536b">扫码收款（demo 占位）</text>` +
        `<text x="115" y="152" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#0f7a45">¥${input.amount_cny.toFixed(2)}</text>` +
        `<text x="115" y="238" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#7a4a00">${epay.mode === "demo" ? "演示模式：不会真实扣款" : "live 模式：需商户配置"}</text>` +
        `</svg>`;
      return {
        ok: true,
        pay_url: payUrl,
        qr_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        errors: [],
      };
    },
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) % 1_000_000;
  return hash;
}
