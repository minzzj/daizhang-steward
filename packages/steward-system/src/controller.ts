/**
 * 代掌 Steward · 系统总控动作层（v1.3-A）· `SystemController`。
 *
 * 用户亲自下达的命令 → `plan()` 评估风险/受管范围并生成一次性确认令牌 → 用户确认 →
 * `execute()` 在**受管范围**内真实执行 → 全程 JSONL 审计。
 *
 * 安全铁律（与 README 一一对应）：
 * 1. **只碰受管范围**：只能操作构造时传入的 `apps` 清单内的 app，和 `plugins_dir` 下的插件子目录；
 *    清单外目标一律 `OutOfScopeError`；路径穿越/绝对路径越界/系统关键路径一律拒绝。
 * 2. **危险动作必须二次确认**：`high`（app.restart）与 `destructive`（app.remove / plugin.remove）
 *    必须先用 `plan()` 拿 token，再 `execute()` 带上；token 一次性、120s 过期、绑定
 *    request_id + action + target。
 * 3. **删除先备份**：`app.remove` / `plugin.remove` 先备份到
 *    `<state_dir>/recycle/<timestamp>/…`，回执带 `backup_path`，可 `restoreBackup()` 恢复。
 * 4. **全程审计**：成功/执行失败/策略拒绝/确认缺失都追加 `<state_dir>/system-audit.jsonl`；
 *    摘要脱敏，绝不记录密钥明文。
 * 5. **未知 ≠ 成功**：策略拒绝抛错；执行失败返回 `ok:false` 回执并留审计。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, hostname, platform, release, totalmem, uptime } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { JsonlAuditTrail, SYSTEM_AUDIT_FILE, redactAuditReason, redactAuditText } from "./audit.js";
import { ConfirmationRequiredError, OutOfScopeError, SystemActionError, UnsupportedPlatformError, formatSystemError } from "./errors.js";
import { WindowsProcessOps } from "./process-ops.js";
import { backupToRecycle, isRecyclePath, restoreBackup as restoreFromRecycle } from "./recycle.js";
import {
  SAFE_ID_PATTERN,
  assertRemovableTarget,
  assertSafeId,
  displayPath,
  isPathInside,
  resolvePluginDir,
  resolveWithin,
  safeRealpath,
} from "./scope.js";
import {
  CONFIRMATION_TTL_MS,
  MAX_MANAGED_APPS,
} from "./types.js";
import type {
  ActionName,
  ActionPlan,
  ActionReceipt,
  ActionRequest,
  AuditEntry,
  ConfirmationRecord,
  ManagedApp,
  ManagedPlugin,
  ProcessOps,
  RestoreResult,
  RiskLevel,
  SystemControllerOptions,
  SystemInfo,
} from "./types.js";

/** 每个动作的静态风险等级（readonly / low / high / destructive）。 */
export const ACTION_RISK: Readonly<Record<ActionName, RiskLevel>> = {
  "app.list": "readonly",
  "plugin.list": "readonly",
  "file.list": "readonly",
  "system.info": "readonly",
  "app.start": "low",
  "app.stop": "low",
  "plugin.enable": "low",
  "plugin.disable": "low",
  "app.restart": "high",
  "app.remove": "destructive",
  "plugin.remove": "destructive",
};

const ALL_ACTIONS: readonly ActionName[] = Object.keys(ACTION_RISK) as ActionName[];

/** 是否必须用户二次确认（high / destructive）。 */
export function requiresUserConfirmation(action: ActionName): boolean {
  const risk = ACTION_RISK[action];
  return risk === "high" || risk === "destructive";
}

interface ScopeEvaluation {
  allowed: boolean;
  summary: string;
  details: Record<string, unknown>;
  /** 目标的人类可读标识（写审计）。 */
  targetLabel: string | null;
}

interface DispatchOutcome {
  ok: boolean;
  output: unknown;
  summary: string;
  backup_path?: string;
  error?: string;
}

interface FileScope {
  kind: "app" | "plugin";
  id: string;
  baseDir: string;
}

interface PluginManifest {
  id?: string;
  name?: string;
  version?: string;
  enabled?: boolean;
  note?: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function copyApp(app: ManagedApp): ManagedApp {
  const copy: ManagedApp = {
    id: app.id,
    name: app.name,
    command: app.command,
    kind: app.kind,
    allow_start: app.allow_start,
    allow_stop: app.allow_stop,
    allow_remove: app.allow_remove,
  };
  if (app.args !== undefined) copy.args = [...app.args];
  if (app.cwd !== undefined) copy.cwd = app.cwd;
  if (app.path !== undefined) copy.path = app.path;
  if (app.note !== undefined) copy.note = app.note;
  return copy;
}

function copyPlugin(plugin: ManagedPlugin): ManagedPlugin {
  const copy: ManagedPlugin = { id: plugin.id, name: plugin.name, path: plugin.path, enabled: plugin.enabled };
  if (plugin.version !== undefined) copy.version = plugin.version;
  if (plugin.note !== undefined) copy.note = plugin.note;
  return copy;
}

/**
 * 系统总控动作层：受管应用/插件管理 + 风险评估 + 一次性确认 + 备份/恢复 + 审计。
 *
 * ```ts
 * const ctl = new SystemController({ apps: MANAGED_APPS, plugins_dir: join(root, "plugins"), root });
 * const plan = ctl.plan({ id: "req-1", action: "app.restart", target: "demo-app", reason: "按用户要求重开" });
 * // 用户确认后：
 * await ctl.execute({ id: "req-1", action: "app.restart", target: "demo-app", confirmation_token: plan.confirmation_token });
 * ```
 */
export class SystemController {
  /** 受管根目录（app.path 必须严格位于其中）。 */
  readonly root: string;
  /** 状态目录（审计 JSONL / recycle 回收站）。 */
  readonly stateDir: string;
  /** 受管插件根目录。 */
  readonly pluginsDir: string;

  private readonly apps: ManagedApp[];
  private readonly now: () => Date;
  private readonly audit: JsonlAuditTrail;
  private readonly injectedOps: ProcessOps | null;
  private ops: ProcessOps | null = null;
  private readonly confirmations = new Map<string, ConfirmationRecord>();
  private lastConfirmationValue: ConfirmationRecord | null = null;

  constructor(options: SystemControllerOptions) {
    if (options === null || typeof options !== "object") {
      throw new SystemActionError("invalid-options", "SystemController 需要 options 对象");
    }
    if (!Array.isArray(options.apps)) {
      throw new SystemActionError("invalid-apps", "options.apps 必须是 ManagedApp[]（受管应用清单）");
    }
    if (options.apps.length > MAX_MANAGED_APPS) {
      throw new SystemActionError("invalid-apps", `受管应用数量超限（>${MAX_MANAGED_APPS}）：${options.apps.length}`);
    }
    const seenIds = new Set<string>();
    this.apps = options.apps.map((app) => this.validateAppConfig(app, seenIds));

    this.root = resolve(options.root ?? process.cwd());
    this.stateDir = resolve(options.state_dir ?? join(this.root, ".steward", "system"));
    if (typeof options.plugins_dir !== "string" || options.plugins_dir.trim() === "") {
      throw new SystemActionError("invalid-plugins-dir", "options.plugins_dir 必须是非空路径（受管插件根目录）");
    }
    this.pluginsDir = resolve(options.plugins_dir);
    this.now = options.now ?? ((): Date => new Date());
    this.audit = new JsonlAuditTrail(join(this.stateDir, SYSTEM_AUDIT_FILE));
    this.injectedOps = options.processOps ?? null;
  }

  // ---- 只读观察 -----------------------------------------------------------

  /** 受管应用清单（副本，调用方修改不影响内部控制状态）。 */
  listApps(): ManagedApp[] {
    return this.apps.map(copyApp);
  }

  /** 受管插件清单（扫描 `<plugins_dir>` 下的插件子目录）。 */
  listPlugins(): ManagedPlugin[] {
    return this.scanPlugins().map(copyPlugin);
  }

  /** 本地系统摘要（只读；不含用户名等敏感信息）。 */
  systemInfo(): SystemInfo {
    return {
      platform: platform(),
      release: release(),
      arch: arch(),
      node_version: process.version,
      cpu_count: cpus().length,
      total_memory_bytes: totalmem(),
      free_memory_bytes: freemem(),
      uptime_seconds: Math.round(uptime()),
      root: displayPath(this.root),
      state_dir: displayPath(this.stateDir),
      plugins_dir: displayPath(this.pluginsDir),
      managed_apps: this.apps.length,
      managed_plugins: this.scanPlugins().length,
      at: this.now().toISOString(),
    };
  }

  /** 最近 N 条审计记录（同步只读；默认 50）。 */
  auditTrail(limit = 50): AuditEntry[] {
    return this.audit.tail(limit);
  }

  /** 最近一次下发的确认请求（UI 展示用）；没有则为 null。 */
  lastConfirmation(): ConfirmationRecord | null {
    if (this.lastConfirmationValue === null) return null;
    return { ...this.lastConfirmationValue };
  }

  /** 所有尚未使用/未过期的确认令牌（UI 可展示「待确认」列表）。 */
  listPendingConfirmations(): ConfirmationRecord[] {
    const nowMs = this.now().getTime();
    const pending: ConfirmationRecord[] = [];
    for (const record of this.confirmations.values()) {
      if (!record.used && record.expires_at_ms >= nowMs) pending.push({ ...record });
    }
    return pending.sort((a, b) => a.expires_at_ms - b.expires_at_ms);
  }

  // ---- 计划（风险评估 + 二次确认令牌）------------------------------------

  /**
   * 评估一条动作：风险分级、是否在受管范围、是否需要用户确认。
   * - 越界不会抛错（返回 `allowed:false` + 原因摘要），由 `execute()` 统一拒绝并写审计；
   * - `high` / `destructive` 且允许执行时，下发一次性 `confirmation_token`（TTL 120s，
   *   绑定 request_id + action + target）。
   */
  plan(request: ActionRequest): ActionPlan {
    const validated = this.validateRequest(request);
    const { risk, evaluation, requiresConfirmation } = this.assess(validated);
    this.pruneConfirmations();
    const plan: ActionPlan = {
      request_id: validated.id,
      action: validated.action,
      risk,
      allowed: evaluation.allowed,
      requires_confirmation: requiresConfirmation,
      summary: evaluation.summary,
      details: evaluation.details,
    };
    if (requiresConfirmation) {
      const token = randomUUID();
      const issuedAt = this.now();
      const expiresAtMs = issuedAt.getTime() + CONFIRMATION_TTL_MS;
      const record: ConfirmationRecord = {
        token,
        request_id: validated.id,
        action: validated.action,
        target: evaluation.targetLabel,
        risk,
        summary: evaluation.summary,
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(expiresAtMs).toISOString(),
        expires_at_ms: expiresAtMs,
        used: false,
      };
      this.confirmations.set(token, record);
      this.lastConfirmationValue = record;
      plan.confirmation_token = token;
    }
    return plan;
  }

  /** 风险评估 + 受管范围评估（plan/execute 共用，**不下发**令牌）。 */
  private assess(request: ActionRequest): {
    risk: RiskLevel;
    evaluation: ScopeEvaluation;
    requiresConfirmation: boolean;
  } {
    const risk = ACTION_RISK[request.action];
    const evaluation = this.evaluateScope(request);
    return {
      risk,
      evaluation,
      requiresConfirmation: evaluation.allowed && (risk === "high" || risk === "destructive"),
    };
  }

  // ---- 执行（受管范围内真实动作 + 审计）----------------------------------

  /**
   * 执行一条动作。
   * - 越界 → 抛 `OutOfScopeError`（先写审计，`executed:false`）；
   * - high/destructive 缺有效令牌 → 抛 `ConfirmationRequiredError`（先写审计）；
   * - 参数/动作非法 → 抛 `SystemActionError`；
   * - 执行期失败 → 返回 `ActionReceipt{ok:false,executed:true,error}` 并写审计；
   * - 成功 → 返回回执（删除类动作含 `backup_path`）。
   */
  async execute(request: ActionRequest): Promise<ActionReceipt> {
    const validated = this.validateRequest(request);
    const { risk, evaluation, requiresConfirmation } = this.assess(validated);
    const targetLabel = evaluation.targetLabel;

    if (!evaluation.allowed) {
      this.writeAudit({
        request: validated,
        target: targetLabel,
        risk,
        ok: false,
        executed: false,
        summary: `策略拒绝：${evaluation.summary}`,
      });
      throw new OutOfScopeError(validated.action, targetLabel ?? "（未指定目标）", evaluation.summary);
    }

    if (requiresConfirmation) {
      const token = validated.confirmation_token;
      if (token === undefined || token.trim() === "") {
        this.writeAudit({
          request: validated,
          target: targetLabel,
          risk,
          ok: false,
          executed: false,
          summary: "策略拒绝：高风险动作缺少 confirmation_token（需要用户二次确认）",
        });
        throw new ConfirmationRequiredError(validated.id, validated.action, "缺少 confirmation_token（需要用户二次确认）");
      }
      const check = this.consumeConfirmation(validated, targetLabel);
      if (!check.ok) {
        this.writeAudit({
          request: validated,
          target: targetLabel,
          risk,
          ok: false,
          executed: false,
          summary: `策略拒绝：${check.reason}`,
        });
        throw new ConfirmationRequiredError(validated.id, validated.action, check.reason);
      }
    }

    const auditId = randomUUID();
    let outcome: DispatchOutcome;
    try {
      outcome = await this.dispatch(validated);
    } catch (error) {
      if (error instanceof UnsupportedPlatformError) {
        this.writeAudit({
          request: validated,
          target: targetLabel,
          risk,
          ok: false,
          executed: false,
          summary: `环境不支持：${formatSystemError(error)}`,
        });
        throw error;
      }
      const message = formatSystemError(error);
      this.writeAudit({
        request: validated,
        target: targetLabel,
        risk,
        ok: false,
        executed: true,
        summary: `执行失败：${message}`,
      });
      const failed: ActionReceipt = {
        request_id: validated.id,
        action: validated.action,
        risk,
        ok: false,
        executed: true,
        output: {},
        error: message,
        at: this.now().toISOString(),
        audit_id: auditId,
      };
      return failed;
    }

    this.writeAudit({
      request: validated,
      target: targetLabel,
      risk,
      ok: outcome.ok,
      executed: true,
      summary: outcome.summary,
      ...(outcome.backup_path !== undefined ? { backup_path: outcome.backup_path } : {}),
    });
    const receipt: ActionReceipt = {
      request_id: validated.id,
      action: validated.action,
      risk,
      ok: outcome.ok,
      executed: true,
      output: outcome.output,
      at: this.now().toISOString(),
      audit_id: auditId,
    };
    if (outcome.error !== undefined) receipt.error = outcome.error;
    if (outcome.backup_path !== undefined) receipt.backup_path = outcome.backup_path;
    return receipt;
  }

  /** 从本控制器回收站恢复备份到目标位置。 */
  async restoreBackup(backupPath: string, destination: string, options: { force?: boolean } = {}): Promise<RestoreResult> {
    if (!isRecyclePath(this.stateDir, backupPath)) {
      throw new SystemActionError("out-of-scope", `只能恢复本控制器回收站内的备份：${backupPath}`);
    }
    return restoreFromRecycle(backupPath, destination, options);
  }

  // ---- 内部：配置校验 / 插件扫描 -----------------------------------------

  private validateAppConfig(app: unknown, seen: Set<string>): ManagedApp {
    if (app === null || typeof app !== "object") {
      throw new SystemActionError("invalid-app", "受管应用条目必须是对象");
    }
    const record = app as Record<string, unknown>;
    const id = assertSafeId(record.id, "受管应用 id");
    if (seen.has(id)) {
      throw new SystemActionError("duplicate-app", `受管应用 id 重复：${id}（清单内 id 必须唯一）`);
    }
    seen.add(id);
    const name = asString(record.name);
    if (name === null || name.trim() === "") {
      throw new SystemActionError("invalid-app", `受管应用 ${id} 缺少 name`);
    }
    const command = asString(record.command);
    if (command === null || command.trim() === "") {
      throw new SystemActionError("invalid-app", `受管应用 ${id} 缺少 command（启动命令）`);
    }
    const kind = record.kind;
    if (kind !== "program" && kind !== "plugin" && kind !== "console") {
      throw new SystemActionError("invalid-app", `受管应用 ${id} 的 kind 必须是 program/plugin/console`);
    }
    const allow_start = asBoolean(record.allow_start);
    const allow_stop = asBoolean(record.allow_stop);
    const allow_remove = asBoolean(record.allow_remove);
    if (allow_start === null || allow_stop === null || allow_remove === null) {
      throw new SystemActionError("invalid-app", `受管应用 ${id} 必须显式配置 allow_start/allow_stop/allow_remove 布尔值`);
    }
    const args = record.args;
    if (args !== undefined) {
      if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
        throw new SystemActionError("invalid-app", `受管应用 ${id} 的 args 必须是字符串数组`);
      }
    }
    const normalized: ManagedApp = {
      id,
      name,
      command,
      kind,
      allow_start,
      allow_stop,
      allow_remove,
    };
    const cwd = asString(record.cwd);
    if (cwd !== undefined && cwd !== null && cwd.trim() !== "") normalized.cwd = resolve(cwd);
    const appPath = asString(record.path);
    if (appPath !== undefined && appPath !== null && appPath.trim() !== "") normalized.path = resolve(appPath);
    const note = asString(record.note);
    if (note !== null) normalized.note = note;
    if (args !== undefined) normalized.args = [...(args as string[])];
    return normalized;
  }

  private scanPlugins(): ManagedPlugin[] {
    if (!existsSync(this.pluginsDir)) return [];
    let entries: Dirent[];
    try {
      entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const plugins: ManagedPlugin[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = String(entry.name);
      if (id.startsWith(".") || !SAFE_ID_PATTERN.test(id)) continue;
      const dir = join(this.pluginsDir, id);
      if (!isPathInside(this.pluginsDir, dir, { strict: true })) continue;
      const manifest = this.readPluginManifest(dir);
      const plugin: ManagedPlugin = {
        id,
        name: asString(manifest?.name) ?? id,
        path: dir,
        enabled: manifest?.enabled === true,
      };
      const version = asString(manifest?.version);
      if (version !== null) plugin.version = version;
      const note = asString(manifest?.note);
      if (note !== null) plugin.note = note;
      plugins.push(plugin);
    }
    plugins.sort((left, right) => left.id.localeCompare(right.id));
    return plugins;
  }

  private readPluginManifest(pluginDir: string): PluginManifest | null {
    const manifestPath = join(pluginDir, "plugin.json");
    if (!existsSync(manifestPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as PluginManifest;
    } catch {
      return null;
    }
  }

  // ---- 内部：范围评估 -----------------------------------------------------

  private validateRequest(request: ActionRequest): ActionRequest {
    if (request === null || typeof request !== "object") {
      throw new SystemActionError("invalid-request", "ActionRequest 必须是对象");
    }
    const id = asString(request.id);
    if (id === null || id.trim() === "") {
      throw new SystemActionError("invalid-request", "ActionRequest.id 必须是非空字符串（确认令牌绑定该 id）");
    }
    const action = asString(request.action);
    if (action === null || !ALL_ACTIONS.includes(action as ActionName)) {
      throw new SystemActionError(
        "invalid-action",
        `未知动作：${String(request.action)}（允许：${ALL_ACTIONS.join(", ")}）`,
      );
    }
    const params = request.params;
    if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
      throw new SystemActionError("invalid-request", "ActionRequest.params 必须是对象");
    }
    const normalized: ActionRequest = { id, action: action as ActionName };
    const target = asString(request.target);
    if (target !== null) normalized.target = target;
    if (params !== undefined) normalized.params = params;
    const reason = asString(request.reason);
    if (reason !== null) normalized.reason = reason;
    const token = asString(request.confirmation_token);
    if (token !== null) normalized.confirmation_token = token;
    const requestedBy = asString(request.requested_by);
    if (requestedBy !== null) normalized.requested_by = requestedBy;
    return normalized;
  }

  private evaluateScope(request: ActionRequest): ScopeEvaluation {
    const target = request.target ?? null;
    switch (request.action) {
      case "app.list":
        return {
          allowed: true,
          summary: `列出受管应用：共 ${this.apps.length} 个`,
          details: { target: null, apps: this.apps.map((app) => app.id) },
          targetLabel: null,
        };
      case "plugin.list":
        return {
          allowed: true,
          summary: `列出受管插件：共 ${this.scanPlugins().length} 个`,
          details: { target: null, plugins: this.scanPlugins().map((plugin) => plugin.id) },
          targetLabel: null,
        };
      case "system.info":
        return {
          allowed: true,
          summary: "读取本地系统摘要信息（只读）",
          details: { target: null },
          targetLabel: null,
        };
      case "file.list":
        return this.evaluateFileList(request);
      case "app.start":
      case "app.stop":
      case "app.restart":
      case "app.remove":
        return this.evaluateAppAction(request);
      case "plugin.enable":
      case "plugin.disable":
      case "plugin.remove":
        return this.evaluatePluginAction(request);
      default:
        return {
          allowed: false,
          summary: `不支持的动作：${request.action}`,
          details: { target, reason: "unsupported-action" },
          targetLabel: target,
        };
    }
  }

  private findApp(appId: string | null): ManagedApp | null {
    if (appId === null) return null;
    return this.apps.find((app) => app.id === appId) ?? null;
  }

  private evaluateAppAction(request: ActionRequest): ScopeEvaluation {
    const target = request.target ?? null;
    const app = this.findApp(target);
    if (app === null) {
      return {
        allowed: false,
        summary: `目标应用 ${String(target ?? "(未指定)")} 不在受管应用清单内（只允许清单内应用）`,
        details: { target, reason: "not-managed" },
        targetLabel: target,
      };
    }
    const deny = (reason: string): ScopeEvaluation => ({
      allowed: false,
      summary: `受管应用 ${app.id} 不允许${request.action}：${reason}`,
      details: { target: app.id, reason },
      targetLabel: app.id,
    });
    switch (request.action) {
      case "app.start": {
        if (!app.allow_start) return deny("未授权启动（allow_start=false）");
        if (app.cwd !== undefined && !existsSync(app.cwd)) return deny(`工作目录不存在：${app.cwd}`);
        return {
          allowed: true,
          summary: `启动受管应用 ${app.id}（${app.name}）`,
          details: { target: app.id, command: app.command, cwd: app.cwd ?? null },
          targetLabel: app.id,
        };
      }
      case "app.stop": {
        if (!app.allow_stop) return deny("未授权停止（allow_stop=false）");
        return {
          allowed: true,
          summary: `停止受管应用 ${app.id}（${app.name}）`,
          details: { target: app.id },
          targetLabel: app.id,
        };
      }
      case "app.restart": {
        if (!app.allow_stop) return deny("未授权停止（allow_stop=false，restart 需要先停止）");
        if (!app.allow_start) return deny("未授权启动（allow_start=false，restart 需要重新启动）");
        return {
          allowed: true,
          summary: `重启受管应用 ${app.id}（${app.name}）——高风险：会中断程序并由用户确认`,
          details: { target: app.id },
          targetLabel: app.id,
        };
      }
      case "app.remove": {
        if (!app.allow_remove) return deny("未授权删除（allow_remove=false）");
        const removablePath = app.path ?? app.cwd ?? (isAbsolute(app.command) ? app.command : null);
        if (removablePath === null) return deny("未声明可删除路径（需要 path/cwd）");
        try {
          const realTarget = assertRemovableTarget({
            root: this.root,
            stateDir: this.stateDir,
            pluginsDir: this.pluginsDir,
            targetPath: removablePath,
            label: `受管应用 ${app.id}`,
          });
          return {
            allowed: true,
            summary:
              `删除受管应用 ${app.id}（${app.name}）——破坏性：先备份到回收站再删除，` +
              `目标 ${displayPath(realTarget)}，需用户确认`,
            details: { target: app.id, removable_path: displayPath(realTarget) },
            targetLabel: app.id,
          };
        } catch (error) {
          if (error instanceof SystemActionError) return deny(error.message);
          throw error;
        }
      }
      default:
        return deny("不支持的应用动作");
    }
  }

  private findPlugin(pluginId: string | null): ManagedPlugin | null {
    if (pluginId === null) return null;
    return this.scanPlugins().find((plugin) => plugin.id === pluginId) ?? null;
  }

  private evaluatePluginAction(request: ActionRequest): ScopeEvaluation {
    const target = request.target ?? null;
    const deny = (reason: string): ScopeEvaluation => ({
      allowed: false,
      summary: `插件目标 ${String(target ?? "(未指定)")} 不可操作：${reason}`,
      details: { target, reason },
      targetLabel: target,
    });
    let plugin: ManagedPlugin | null;
    try {
      resolvePluginDir(this.pluginsDir, target);
      plugin = this.findPlugin(target);
    } catch (error) {
      return deny(error instanceof SystemActionError ? error.message : formatSystemError(error));
    }
    if (plugin === null) {
      return deny("不在受管插件目录（plugins_dir 的直接子目录）内");
    }
    switch (request.action) {
      case "plugin.enable":
        return {
          allowed: true,
          summary: `启用受管插件 ${plugin.id}（写 plugin.json: enabled=true）`,
          details: { target: plugin.id },
          targetLabel: plugin.id,
        };
      case "plugin.disable":
        return {
          allowed: true,
          summary: `禁用受管插件 ${plugin.id}（写 plugin.json: enabled=false）`,
          details: { target: plugin.id },
          targetLabel: plugin.id,
        };
      case "plugin.remove":
        try {
          const realTarget = assertRemovableTarget({
            root: this.root,
            stateDir: this.stateDir,
            pluginsDir: this.pluginsDir,
            targetPath: plugin.path,
            label: `受管插件 ${plugin.id}`,
          });
          return {
            allowed: true,
            summary: `删除受管插件 ${plugin.id}——破坏性：先备份到回收站再删除，目标 ${displayPath(realTarget)}，需用户确认`,
            details: { target: plugin.id, removable_path: displayPath(realTarget) },
            targetLabel: plugin.id,
          };
        } catch (error) {
          return deny(error instanceof SystemActionError ? error.message : formatSystemError(error));
        }
      default:
        return deny("不支持的插件动作");
    }
  }

  /** file.list 的作用域：受管应用的目录（path/cwd/command 目录）或受管插件目录。 */
  private resolveFileScope(request: ActionRequest): FileScope {
    const target = request.target ?? null;
    if (target === null || target.trim() === "") {
      throw new SystemActionError("missing-target", "file.list 需要 target（受管应用 id 或插件 id）");
    }
    const app = this.findApp(target);
    if (app !== null) {
      const baseDir =
        app.path ?? app.cwd ?? (isAbsolute(app.command) ? dirname(app.command) : null);
      if (baseDir === null) {
        throw new SystemActionError("no-file-scope", `受管应用 ${app.id} 未声明可列出的目录（path/cwd）`);
      }
      if (!existsSync(baseDir)) {
        throw new SystemActionError("not-found", `受管应用 ${app.id} 的目录不存在：${baseDir}`);
      }
      return { kind: "app", id: app.id, baseDir: resolve(baseDir) };
    }
    const plugin = this.findPlugin(target);
    if (plugin === null) {
      throw new SystemActionError("out-of-scope", `file.list 目标 ${target} 不在受管应用清单/受管插件目录内`);
    }
    return { kind: "plugin", id: plugin.id, baseDir: resolve(plugin.path) };
  }

  private evaluateFileList(request: ActionRequest): ScopeEvaluation {
    const target = request.target ?? null;
    try {
      const scope = this.resolveFileScope(request);
      const relative = asRecord(request.params).path;
      const dir = resolveWithin(scope.baseDir, relative, "file.list 的 params.path");
      return {
        allowed: true,
        summary: `列出受管${scope.kind === "app" ? "应用" : "插件"} ${scope.id} 的目录：${displayPath(dir)}（只读）`,
        details: { target: target, scope_kind: scope.kind, scope_id: scope.id, dir: displayPath(dir) },
        targetLabel: target,
      };
    } catch (error) {
      if (error instanceof SystemActionError) {
        return {
          allowed: false,
          summary: error.message,
          details: { target, reason: error.code },
          targetLabel: target,
        };
      }
      throw error;
    }
  }

  // ---- 内部：确认令牌 -----------------------------------------------------

  private pruneConfirmations(): void {
    const nowMs = this.now().getTime();
    for (const [token, record] of this.confirmations) {
      if (record.used || record.expires_at_ms < nowMs) this.confirmations.delete(token);
    }
  }

  private consumeConfirmation(
    request: ActionRequest,
    targetLabel: string | null,
  ): { ok: true } | { ok: false; reason: string } {
    const token = request.confirmation_token;
    if (token === undefined) return { ok: false, reason: "缺少 confirmation_token" };
    const record = this.confirmations.get(token);
    if (record === undefined) {
      return { ok: false, reason: "确认令牌不存在或已被使用（一次性令牌）" };
    }
    const nowMs = this.now().getTime();
    if (nowMs > record.expires_at_ms) {
      this.confirmations.delete(token);
      return { ok: false, reason: `确认令牌已过期（TTL ${Math.round(CONFIRMATION_TTL_MS / 1000)} 秒）` };
    }
    if (record.request_id !== request.id || record.action !== request.action) {
      return {
        ok: false,
        reason: `确认令牌与请求不匹配（令牌绑定 request_id=${record.request_id} action=${record.action}）`,
      };
    }
    if (record.target !== targetLabel) {
      return {
        ok: false,
        reason: `确认令牌与目标不匹配（令牌绑定 target=${String(record.target)}）`,
      };
    }
    record.used = true;
    this.lastConfirmationValue = { ...record };
    this.confirmations.delete(token);
    return { ok: true };
  }

  // ---- 内部：真实动作派发 -------------------------------------------------

  private getOps(): ProcessOps {
    if (this.ops !== null) return this.ops;
    if (this.injectedOps !== null) {
      this.ops = this.injectedOps;
      return this.ops;
    }
    // 非 Windows 在这里抛出 UnsupportedPlatformError（清晰错误，由 execute 审计后上抛）
    this.ops = new WindowsProcessOps({ root: this.root, stateDir: this.stateDir, pluginsDir: this.pluginsDir });
    return this.ops;
  }

  private requireApp(target: string | null): ManagedApp {
    const app = this.findApp(target);
    if (app === null) {
      throw new OutOfScopeError("app", String(target ?? "(未指定)"), "不在受管应用清单内");
    }
    return app;
  }

  private requirePlugin(target: string | null): ManagedPlugin {
    const plugin = this.findPlugin(target);
    if (plugin === null) {
      throw new OutOfScopeError("plugin", String(target ?? "(未指定)"), "不在受管插件目录内");
    }
    return plugin;
  }

  private async dispatch(request: ActionRequest): Promise<DispatchOutcome> {
    switch (request.action) {
      case "app.list":
        return { ok: true, output: { apps: this.listApps() }, summary: `列出受管应用 ${this.apps.length} 个` };
      case "plugin.list":
        return { ok: true, output: { plugins: this.listPlugins() }, summary: `列出受管插件 ${this.scanPlugins().length} 个` };
      case "system.info":
        return { ok: true, output: this.systemInfo(), summary: "读取本地系统摘要信息" };
      case "file.list":
        return this.listFiles(request);
      case "app.start": {
        const app = this.requireApp(request.target ?? null);
        const started = await this.getOps().start(app);
        return {
          ok: true,
          output: {
            app_id: app.id,
            pid: started.pid,
            ...(started.started_at !== undefined ? { started_at: started.started_at } : {}),
            command: app.command,
          },
          summary: `启动受管应用 ${app.id}（${app.name}），pid=${started.pid}`,
        };
      }
      case "app.stop": {
        const app = this.requireApp(request.target ?? null);
        const stopped = await this.getOps().stop(app, null);
        return {
          ok: true,
          output: { app_id: app.id, stopped },
          summary: stopped ? `停止受管应用 ${app.id}（${app.name}）成功` : `受管应用 ${app.id} 当前未在运行（无需停止）`,
        };
      }
      case "app.restart": {
        const app = this.requireApp(request.target ?? null);
        const ops = this.getOps();
        const stopped = await ops.stop(app, null);
        const started = await ops.start(app);
        return {
          ok: true,
          output: {
            app_id: app.id,
            stopped,
            pid: started.pid,
            ...(started.started_at !== undefined ? { started_at: started.started_at } : {}),
          },
          summary: `重启受管应用 ${app.id}（${app.name}）：stop=${stopped ? "yes" : "no"} → start pid=${started.pid}`,
        };
      }
      case "app.remove": {
        const app = this.requireApp(request.target ?? null);
        const backupPath = await this.getOps().remove(app);
        return {
          ok: true,
          output: { app_id: app.id, removed: true },
          summary: `删除受管应用 ${app.id}（${app.name}）成功；备份于 ${displayPath(backupPath)}`,
          backup_path: backupPath,
        };
      }
      case "plugin.enable":
        return this.setPluginEnabled(request, true);
      case "plugin.disable":
        return this.setPluginEnabled(request, false);
      case "plugin.remove": {
        const plugin = this.requirePlugin(request.target ?? null);
        const removable = assertRemovableTarget({
          root: this.root,
          stateDir: this.stateDir,
          pluginsDir: this.pluginsDir,
          targetPath: plugin.path,
          label: `受管插件 ${plugin.id}`,
        });
        const backupPath = await backupToRecycle({
          stateDir: this.stateDir,
          sourcePath: removable,
          label: `plugin-${plugin.id}`,
        });
        await rm(removable, { recursive: true, force: true });
        return {
          ok: true,
          output: { plugin_id: plugin.id, removed: true },
          summary: `删除受管插件 ${plugin.id}（${plugin.name}）成功；备份于 ${displayPath(backupPath)}`,
          backup_path: backupPath,
        };
      }
      default: {
        // 理论上 plan 已经拦截；这里防御性拒绝
        throw new SystemActionError("unsupported-action", `不支持的动作：${request.action}`);
      }
    }
  }

  private listFiles(request: ActionRequest): DispatchOutcome {
    const scope = this.resolveFileScope(request);
    const dir = resolveWithin(scope.baseDir, asRecord(request.params).path, "file.list 的 params.path");
    let entries: Array<{ name: string; type: "dir" | "file"; size: number; modified_at: string }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((entry) => {
        const fullPath = join(dir, entry.name);
        let size = 0;
        let modifiedAt = "";
        try {
          const info = statSync(fullPath);
          size = info.size;
          modifiedAt = info.mtime.toISOString();
        } catch {
          // 单项读取失败不影响整体列表
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          size,
          modified_at: modifiedAt,
        };
      });
    } catch (error) {
      throw new SystemActionError("list-failed", `列出目录失败：${dir}：${formatSystemError(error)}`);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return {
      ok: true,
      output: {
        scope_kind: scope.kind,
        scope_id: scope.id,
        dir: displayPath(dir),
        entries,
      },
      summary: `列出受管${scope.kind === "app" ? "应用" : "插件"} ${scope.id} 目录 ${displayPath(dir)} 共 ${entries.length} 项`,
    };
  }

  private async setPluginEnabled(request: ActionRequest, enabled: boolean): Promise<DispatchOutcome> {
    const plugin = this.requirePlugin(request.target ?? null);
    const manifestPath = join(plugin.path, "plugin.json");
    const existing: PluginManifest = this.readPluginManifest(plugin.path) ?? {};
    if (existsSync(manifestPath)) {
      const parsed = this.readPluginManifest(plugin.path);
      if (parsed === null) {
        throw new SystemActionError("manifest-invalid", `插件 manifest 损坏，拒绝改写：${manifestPath}`);
      }
    }
    const manifest: PluginManifest = {
      ...existing,
      id: typeof existing.id === "string" && existing.id.trim() !== "" ? existing.id : plugin.id,
      name: typeof existing.name === "string" && existing.name.trim() !== "" ? existing.name : plugin.name,
      version: typeof existing.version === "string" && existing.version.trim() !== "" ? existing.version : "0.0.0",
      enabled,
    };
    await mkdir(plugin.path, { recursive: true });
    const tempPath = `${manifestPath}.tmp-${randomUUID().slice(0, 8)}`;
    await writeFile(tempPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await rename(tempPath, manifestPath);
    return {
      ok: true,
      output: {
        plugin_id: plugin.id,
        enabled,
        manifest_path: displayPath(manifestPath),
        version: manifest.version,
      },
      summary: `${enabled ? "启用" : "禁用"}受管插件 ${plugin.id} 成功（manifest: ${displayPath(manifestPath)}）`,
    };
  }

  // ---- 内部：审计 ---------------------------------------------------------

  private writeAudit(input: {
    request: ActionRequest;
    target: string | null;
    risk: RiskLevel;
    ok: boolean;
    executed: boolean;
    summary: string;
    backup_path?: string;
  }): AuditEntry {
    const entry: AuditEntry = {
      audit_id: randomUUID(),
      at: this.now().toISOString(),
      request_id: input.request.id,
      action: input.request.action,
      target: input.target,
      risk: input.risk,
      ok: input.ok,
      executed: input.executed,
      summary: redactAuditText(input.summary),
      platform: process.platform,
    };
    if (input.backup_path !== undefined) entry.backup_path = displayPath(input.backup_path);
    if (input.request.requested_by !== undefined) entry.requested_by = redactAuditText(input.request.requested_by, 120);
    if (input.request.reason !== undefined) entry.reason = redactAuditReason(input.request.reason);
    this.audit.append(entry);
    return entry;
  }
}

/** 生成一个可用于 `ActionRequest.id` 的唯一请求 id（便于上层调用）。 */
export function newActionRequestId(prefix = "sys"): string {
  return `${prefix}-${randomUUID()}`;
}

/** 判断路径是否是系统关键路径（对外暴露便于上层预检/测试）。 */
export { isSystemCriticalPath } from "./scope.js";
