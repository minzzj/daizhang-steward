/**
 * 代掌 Steward · 系统总控动作层（v1.3-A 基线 + v1.4-D 扩展）· `SystemController`。
 *
 * 用户亲自下达的命令 → `plan()` 评估风险/受管范围并生成一次性确认令牌 → 用户确认 →
 * `execute()` 在**受管范围**内真实执行 → 全程 JSONL 审计。
 *
 * 安全铁律（与 README 一一对应）：
 * 1. **只碰受管范围**：只能操作构造时传入的 `apps` 清单内的 app、`plugins_dir` 下的插件子目录、
 *    受管工作区 `workspace_dir` 内的文件/目录、`install_sources_dir` 内的安装源；
 *    清单外目标一律 `OutOfScopeError`；路径穿越/绝对路径越界/系统关键路径/软链接逃逸一律拒绝。
 * 2. **危险动作必须二次确认**：`medium`（默认确认，auto 模式可执行）、`high`、`destructive`
 *    必须先用 `plan()` 拿 token，再 `execute()` 带上；token 一次性、120s 过期、绑定
 *    request_id + action + target。
 * 3. **删除先备份**：`app.remove` / `plugin.remove` / `file.remove` / `program.uninstall`
 *    先备份到 `<state_dir>/recycle/<timestamp>/…`，回执带 `backup_path`，可 `restoreBackup()` 恢复。
 * 4. **全程审计**：成功/执行失败/策略拒绝/确认缺失都追加 `<state_dir>/system-audit.jsonl`；
 *    摘要脱敏，文件内容只记大小/sha256，绝不记录密钥明文。
 * 5. **未知 ≠ 成功**：策略拒绝抛错；执行失败返回 `ok:false` 回执并留审计。
 *
 * v1.4-D 新增动作：
 * - 受管工作区文件：`file.list`（target=workspace）`file.read` `file.write` `file.mkdir`
 *   `file.copy` `file.move` `file.remove`；
 * - `app.open`（受管应用 id 或 `allowed_urls` 白名单内 http/https URL，防命令注入）；
 * - `service.status`（只读进程快照）；
 * - 定时任务：`task.list` `task.create` `task.remove`（持久化 `<state_dir>/scheduler.json`，
 *   **不调用 Windows 任务计划**，由上层 RunManager/调度器读取执行）；
 * - 受管安装/卸载：`program.install`（仅 `install_sources_dir` 内目录）`program.uninstall`
 *   （destructive：备份→删除→从受管清单移除，落 `<state_dir>/installed.json`）。
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, platform, release, totalmem, uptime } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { JsonlAuditTrail, SYSTEM_AUDIT_FILE, redactAuditReason, redactAuditText } from "./audit.js";
import { ConfirmationRequiredError, OutOfScopeError, SystemActionError, UnsupportedPlatformError, formatSystemError } from "./errors.js";
import { WindowsProcessOps } from "./process-ops.js";
import { backupToRecycle, isRecyclePath, restoreBackup as restoreFromRecycle } from "./recycle.js";
import {
  SAFE_ID_PATTERN,
  assertRemovableTarget,
  assertSafeId,
  assertWorkspaceRemovable,
  displayPath,
  isPathInside,
  resolveInstallSource,
  resolvePluginDir,
  resolveProgramDir,
  resolveWithin,
  resolveWorkspaceEntry,
  safeRealpath,
} from "./scope.js";
import {
  CONFIRMATION_TTL_MS,
  INSTALLED_FILE,
  INSTALL_SOURCES_DIR_NAME,
  MAX_FILE_READ_BYTES,
  MAX_FILE_WRITE_BYTES,
  MAX_MANAGED_APPS,
  MAX_TASK_INTERVAL_SECONDS,
  MIN_TASK_INTERVAL_SECONDS,
  PROGRAMS_DIR_NAME,
  SCHEDULER_FILE,
  TASK_GOAL_MAX_LENGTH,
  TASK_NAME_MAX_LENGTH,
  WORKSPACE_DIR_NAME,
} from "./types.js";
import type {
  ActionName,
  ActionPlan,
  ActionReceipt,
  ActionRequest,
  AppOpenResult,
  AuditEntry,
  ConfirmationRecord,
  InstalledProgramRecord,
  ManagedApp,
  ManagedPlugin,
  ProcessInfo,
  ProcessOps,
  RestoreResult,
  RiskLevel,
  ScheduledTaskRecord,
  SchedulerFile,
  ServiceSnapshot,
  SystemControllerOptions,
  SystemInfo,
  UrlOpener,
  WorkspaceFileEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// 风险分级
// ---------------------------------------------------------------------------

/** 每个动作的静态风险等级（readonly / low / medium / high / destructive）。 */
export const ACTION_RISK: Readonly<Record<ActionName, RiskLevel>> = {
  // 只读
  "app.list": "readonly",
  "plugin.list": "readonly",
  "file.list": "readonly",
  "file.read": "readonly",
  "service.status": "readonly",
  "task.list": "readonly",
  "system.info": "readonly",
  // 低风险
  "app.start": "low",
  "app.stop": "low",
  "plugin.enable": "low",
  "plugin.disable": "low",
  // 中风险：默认需要二次确认；auto_approve_medium=true 时可无令牌执行
  "app.open": "medium",
  "file.write": "medium",
  "file.mkdir": "medium",
  "file.copy": "medium",
  "file.move": "medium",
  "task.create": "medium",
  "task.remove": "medium",
  "program.install": "medium",
  // 高风险
  "app.restart": "high",
  // 破坏性：必须 token + 先备份
  "app.remove": "destructive",
  "plugin.remove": "destructive",
  "file.remove": "destructive",
  "program.uninstall": "destructive",
};

const ALL_ACTIONS: readonly ActionName[] = Object.keys(ACTION_RISK) as ActionName[];

/** 静态判断某动作是否「原则上需要用户确认」（medium/high/destructive）。 */
export function requiresUserConfirmation(action: ActionName): boolean {
  const risk = ACTION_RISK[action];
  return risk === "medium" || risk === "high" || risk === "destructive";
}

/** 中风险的「auto 模式」开关名（文档/配置提示用）。 */
export const AUTO_APPROVE_MEDIUM_OPTION = "auto_approve_medium";

// ---------------------------------------------------------------------------
// 内部类型 / 小工具
// ---------------------------------------------------------------------------

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

interface ValidatedTaskSpec {
  name: string;
  goal: string;
  enabled: boolean;
  interval_seconds?: number;
  cron?: string;
}

interface PreparedInstall {
  sourceId: string;
  sourceDir: string;
  app: ManagedApp;
  targetDir: string;
}

interface PreparedUninstall {
  app: ManagedApp;
  installed: InstalledProgramRecord;
  realPath: string;
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

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 5 段 cron 基础校验（分 时 日 月 周；支持数字/星号/范围/步长/列表/问号）。 */
export function isValidCron5(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fieldPattern = /^[0-9A-Za-z*/?,\-]+$/;
  return parts.every((part) => part !== "" && fieldPattern.test(part));
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
  if (app.installed_from !== undefined) copy.installed_from = app.installed_from;
  return copy;
}

function copyPlugin(plugin: ManagedPlugin): ManagedPlugin {
  const copy: ManagedPlugin = { id: plugin.id, name: plugin.name, path: plugin.path, enabled: plugin.enabled };
  if (plugin.version !== undefined) copy.version = plugin.version;
  if (plugin.note !== undefined) copy.note = plugin.note;
  return copy;
}

function copyTask(task: ScheduledTaskRecord): ScheduledTaskRecord {
  const copy: ScheduledTaskRecord = {
    id: task.id,
    name: task.name,
    goal: task.goal,
    enabled: task.enabled,
    created_at: task.created_at,
  };
  if (task.interval_seconds !== undefined) copy.interval_seconds = task.interval_seconds;
  if (task.cron !== undefined) copy.cron = task.cron;
  if (task.requested_by !== undefined) copy.requested_by = task.requested_by;
  return copy;
}

function isScheduledTaskRecord(value: unknown): value is ScheduledTaskRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<ScheduledTaskRecord>;
  return (
    typeof record.id === "string" &&
    record.id !== "" &&
    typeof record.name === "string" &&
    record.name !== "" &&
    typeof record.goal === "string" &&
    typeof record.enabled === "boolean"
  );
}

/**
 * 系统总控动作层：受管应用/插件/文件/服务/定时任务/安装卸载 + 风险评估 + 一次性确认 +
 * 备份/恢复 + 审计。
 *
 * ```ts
 * const ctl = new SystemController({
 *   apps: MANAGED_APPS, plugins_dir: join(root, "plugins"), root,
 *   workspace_dir: join(root, "workspace"),            // 可选：文件动作范围
 *   install_sources_dir: join(root, "install-sources"),// 可选：安装源范围
 *   allowed_urls: ["example.com"],                     // 可选：app.open URL 白名单
 *   auto_approve_medium: false,                        // 可选：medium 动作是否免确认
 * });
 * const plan = ctl.plan({ id: "req-1", action: "app.restart", target: "demo-app" });
 * await ctl.execute({ id: "req-1", action: "app.restart", target: "demo-app", confirmation_token: plan.confirmation_token });
 * ```
 */
export class SystemController {
  /** 受管根目录（app.path / 安装目标必须严格位于其中）。 */
  readonly root: string;
  /** 状态目录（审计 JSONL / recycle 回收站 / scheduler.json / installed.json）。 */
  readonly stateDir: string;
  /** 受管插件根目录。 */
  readonly pluginsDir: string;
  /** 受管工作区（文件/目录动作只允许在其中）。 */
  readonly workspaceDir: string;
  /** 受管安装源目录（program.install 只允许其中目录）。 */
  readonly installSourcesDir: string;
  /** 受管已安装程序目录（`<root>/programs`）。 */
  readonly programsDir: string;
  /** 是否 auto 模式（medium 动作免确认）。 */
  readonly autoApproveMedium: boolean;
  /** `app.open` 的 URL 白名单（域名/前缀）；空数组 = 禁止打开 URL。 */
  readonly allowedUrls: readonly string[];

  private apps: ManagedApp[];
  private readonly now: () => Date;
  private readonly audit: JsonlAuditTrail;
  private readonly injectedOps: ProcessOps | null;
  private readonly urlOpener: UrlOpener | null;
  private ops: ProcessOps | null = null;
  private readonly confirmations = new Map<string, ConfirmationRecord>();
  private lastConfirmationValue: ConfirmationRecord | null = null;
  private readonly installed = new Map<string, InstalledProgramRecord>();

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

    // v1.4-D：受管工作区 / 安装源 / auto 模式 / URL 白名单
    if (options.workspace_dir !== undefined && (typeof options.workspace_dir !== "string" || options.workspace_dir.trim() === "")) {
      throw new SystemActionError("invalid-workspace-dir", "options.workspace_dir 必须是非空路径（受管工作区）");
    }
    this.workspaceDir = resolve(options.workspace_dir ?? join(this.root, WORKSPACE_DIR_NAME));
    if (
      options.install_sources_dir !== undefined &&
      (typeof options.install_sources_dir !== "string" || options.install_sources_dir.trim() === "")
    ) {
      throw new SystemActionError("invalid-install-sources-dir", "options.install_sources_dir 必须是非空路径");
    }
    this.installSourcesDir = resolve(options.install_sources_dir ?? join(this.root, INSTALL_SOURCES_DIR_NAME));
    this.programsDir = join(this.root, PROGRAMS_DIR_NAME);
    if (options.auto_approve_medium !== undefined && typeof options.auto_approve_medium !== "boolean") {
      throw new SystemActionError("invalid-options", "options.auto_approve_medium 必须是布尔值");
    }
    this.autoApproveMedium = options.auto_approve_medium === true;
    if (options.allowed_urls !== undefined) {
      if (!Array.isArray(options.allowed_urls) || options.allowed_urls.some((item) => typeof item !== "string")) {
        throw new SystemActionError("invalid-options", "options.allowed_urls 必须是字符串数组");
      }
    }
    this.allowedUrls = (options.allowed_urls ?? []).map((item) => item.trim().toLowerCase()).filter((item) => item !== "");
    if (options.urlOpener !== undefined && typeof options.urlOpener !== "function") {
      throw new SystemActionError("invalid-options", "options.urlOpener 必须是函数");
    }
    this.urlOpener = options.urlOpener ?? null;
    this.now = options.now ?? ((): Date => new Date());
    this.audit = new JsonlAuditTrail(join(this.stateDir, SYSTEM_AUDIT_FILE));
    this.injectedOps = options.processOps ?? null;

    // 加载持久化的已安装程序（program.install 落 installed.json），恢复跨进程受管清单
    this.loadInstalledPrograms(seenIds);
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

  /** 定时任务清单（读 `<state_dir>/scheduler.json`；只读，供上层调度器/UI 展示）。 */
  listTasks(): ScheduledTaskRecord[] {
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) return [];
    return scheduler.tasks.map(copyTask);
  }

  /** 本地系统摘要（只读；不含用户名等敏感信息）。 */
  systemInfo(): SystemInfo {
    const scheduler = this.readSchedulerSafe();
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
      workspace_dir: displayPath(this.workspaceDir),
      install_sources_dir: displayPath(this.installSourcesDir),
      managed_apps: this.apps.length,
      managed_plugins: this.scanPlugins().length,
      scheduled_tasks: scheduler.ok ? scheduler.tasks.length : 0,
      installed_programs: this.installed.size,
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
   * - `medium`（默认）/`high`/`destructive` 且允许执行时，下发一次性 `confirmation_token`
   *   （TTL 120s，绑定 request_id + action + target）；`auto_approve_medium` 模式下 medium 免确认。
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
    const needsToken =
      risk === "high" || risk === "destructive" || (risk === "medium" && !this.autoApproveMedium);
    return {
      risk,
      evaluation,
      requiresConfirmation: evaluation.allowed && needsToken,
    };
  }

  // ---- 执行（受管范围内真实动作 + 审计）----------------------------------

  /**
   * 执行一条动作。
   * - 越界 → 抛 `OutOfScopeError`（先写审计，`executed:false`）；
   * - medium/high/destructive 缺有效令牌 → 抛 `ConfirmationRequiredError`（先写审计）；
   * - 参数/动作非法 → 抛 `SystemActionError`；
   * - 执行期失败 → 返回 `ActionReceipt{ok:false,executed:true,error}` 并写审计；
   * - 成功 → 返回回执（删除类/覆盖写动作含 `backup_path`）。
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
          summary: "策略拒绝：动作需要 confirmation_token（需要用户二次确认）",
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
    const installedFrom = asString(record.installed_from);
    if (installedFrom !== null) normalized.installed_from = installedFrom;
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

  // ---- 内部：请求校验 -----------------------------------------------------

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

  // ---- 内部：范围评估 -----------------------------------------------------

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
      case "service.status":
        return {
          allowed: true,
          summary: "读取服务/进程状态快照（只读）",
          details: { target: null },
          targetLabel: null,
        };
      case "file.list":
        return this.evaluateFileList(request);
      case "file.read":
      case "file.write":
      case "file.mkdir":
      case "file.copy":
      case "file.move":
      case "file.remove":
        return this.evaluateWorkspaceFile(request);
      case "app.start":
      case "app.stop":
      case "app.restart":
      case "app.remove":
        return this.evaluateAppAction(request);
      case "app.open":
        return this.evaluateAppOpen(request);
      case "plugin.enable":
      case "plugin.disable":
      case "plugin.remove":
        return this.evaluatePluginAction(request);
      case "task.list":
        return this.evaluateTaskList();
      case "task.create":
        return this.evaluateTaskCreate(request);
      case "task.remove":
        return this.evaluateTaskRemove(request);
      case "program.install":
        return this.evaluateProgramInstall(request);
      case "program.uninstall":
        return this.evaluateProgramUninstall(request);
      default:
        return {
          allowed: false,
          summary: `不支持的动作：${request.action}`,
          details: { target, reason: "unsupported-action" },
          targetLabel: target,
        };
    }
  }

  private deny(targetLabel: string | null, summary: string, details: Record<string, unknown> = {}): ScopeEvaluation {
    return { allowed: false, summary, details: { target: targetLabel, ...details }, targetLabel };
  }

  private findApp(appId: string | null): ManagedApp | null {
    if (appId === null) return null;
    return this.apps.find((app) => app.id === appId) ?? null;
  }

  private evaluateAppAction(request: ActionRequest): ScopeEvaluation {
    const target = request.target ?? null;
    const app = this.findApp(target);
    if (app === null) {
      return this.deny(target, `目标应用 ${String(target ?? "(未指定)")} 不在受管应用清单内（只允许清单内应用）`, {
        reason: "not-managed",
      });
    }
    const deny = (reason: string): ScopeEvaluation =>
      this.deny(app.id, `受管应用 ${app.id} 不允许${request.action}：${reason}`, { reason });
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
    const deny = (reason: string): ScopeEvaluation =>
      this.deny(target, `插件目标 ${String(target ?? "(未指定)")} 不可操作：${reason}`, { reason });
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

  /** file.list 的作用域：受管应用目录 / 受管插件目录 / `target: "workspace"` 受管工作区。 */
  private resolveFileScope(request: ActionRequest): FileScope {
    const target = request.target ?? null;
    if (target === null || target.trim() === "") {
      throw new SystemActionError("missing-target", "file.list 需要 target（受管应用 id、插件 id，或 \"workspace\"）");
    }
    const app = this.findApp(target);
    if (app !== null) {
      const baseDir = app.path ?? app.cwd ?? (isAbsolute(app.command) ? dirname(app.command) : null);
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
    // v1.4-D：target === "workspace" → 列受管工作区（文件动作范围）
    if (target === "workspace") {
      try {
        const dir = resolveWorkspaceEntry(this.workspaceDir, asRecord(request.params).path, "file.list 的 params.path", {
          allowRoot: true,
        });
        return {
          allowed: true,
          summary: `列出受管工作区目录：${displayPath(dir)}（只读）`,
          details: { target, scope_kind: "workspace", scope_id: "workspace", dir: displayPath(dir) },
          targetLabel: "workspace",
        };
      } catch (error) {
        if (error instanceof SystemActionError) return this.deny(target, error.message, { reason: error.code });
        throw error;
      }
    }
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
        return this.deny(target, error.message, { reason: error.code });
      }
      throw error;
    }
  }

  // ---- 内部：v1.4-D 受管工作区文件动作 -----------------------------------

  private evaluateWorkspaceFile(request: ActionRequest): ScopeEvaluation {
    const params = asRecord(request.params);
    try {
      switch (request.action) {
        case "file.read": {
          const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.read 的 params.path", {
            mustExist: true,
          });
          const info = statSync(target);
          if (!info.isFile()) {
            throw new SystemActionError("invalid-target", `file.read 目标不是普通文件：${displayPath(target)}`);
          }
          if (info.size > MAX_FILE_READ_BYTES) {
            throw new SystemActionError(
              "file-too-large",
              `文件过大（${info.size} 字节 > ${MAX_FILE_READ_BYTES}），拒绝读取全部内容：${displayPath(target)}`,
            );
          }
          return {
            allowed: true,
            summary: `读取受管工作区文件 ${displayPath(target)}（${info.size} 字节，只读）`,
            details: { target: displayPath(target), path: displayPath(target), size: info.size },
            targetLabel: displayPath(target),
          };
        }
        case "file.write": {
          const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.write 的 params.path");
          const content = params.content;
          if (typeof content !== "string") {
            throw new SystemActionError("invalid-content", "file.write 需要字符串参数 params.content");
          }
          const bytes = Buffer.byteLength(content, "utf8");
          if (bytes > MAX_FILE_WRITE_BYTES) {
            throw new SystemActionError(
              "content-too-large",
              `file.write 内容过大（${bytes} 字节 > ${MAX_FILE_WRITE_BYTES}），拒绝写入`,
            );
          }
          if (existsSync(target) && statSync(target).isDirectory()) {
            throw new SystemActionError("invalid-target", `file.write 目标是目录：${displayPath(target)}`);
          }
          const overwrites = existsSync(target);
          return {
            allowed: true,
            summary: `写入受管工作区文件 ${displayPath(target)}（${bytes} 字节${overwrites ? "，覆盖已有文件" : ""}）`,
            details: { target: displayPath(target), path: displayPath(target), size: bytes, overwrite: overwrites },
            targetLabel: displayPath(target),
          };
        }
        case "file.mkdir": {
          const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.mkdir 的 params.path");
          if (existsSync(target) && !statSync(target).isDirectory()) {
            throw new SystemActionError("invalid-target", `file.mkdir 目标已存在且不是目录：${displayPath(target)}`);
          }
          return {
            allowed: true,
            summary: `创建受管工作区目录 ${displayPath(target)}`,
            details: { target: displayPath(target), path: displayPath(target) },
            targetLabel: displayPath(target),
          };
        }
        case "file.copy":
        case "file.move": {
          const action = request.action;
          const sourceRaw = params.source;
          const destinationRaw = params.destination;
          if (typeof sourceRaw !== "string" || sourceRaw.trim() === "") {
            throw new SystemActionError("invalid-path", `${action} 需要非空字符串参数 params.source`);
          }
          if (typeof destinationRaw !== "string" || destinationRaw.trim() === "") {
            throw new SystemActionError("invalid-path", `${action} 需要非空字符串参数 params.destination`);
          }
          const source = resolveWorkspaceEntry(this.workspaceDir, sourceRaw, `${action} 的 params.source`, {
            mustExist: true,
          });
          const destination = resolveWorkspaceEntry(this.workspaceDir, destinationRaw, `${action} 的 params.destination`);
          if (existsSync(destination) && params.overwrite !== true) {
            throw new SystemActionError(
              "destination-exists",
              `${action} 目标已存在（如需覆盖请传 overwrite=true，覆盖前会先备份）：${displayPath(destination)}`,
            );
          }
          return {
            allowed: true,
            summary:
              `${action === "file.move" ? "移动" : "复制"}受管工作区条目 ${displayPath(source)} → ${displayPath(destination)}` +
              `（medium：默认需确认）`,
            details: {
              target: displayPath(destination),
              source: displayPath(source),
              destination: displayPath(destination),
              overwrite: params.overwrite === true,
            },
            targetLabel: displayPath(destination),
          };
        }
        case "file.remove": {
          const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.remove 的 params.path");
          const realTarget = assertWorkspaceRemovable(this.workspaceDir, target, "file.remove 的 params.path");
          return {
            allowed: true,
            summary: `删除受管工作区条目 ${displayPath(realTarget)}——破坏性：先备份到回收站再删除，需用户确认`,
            details: { target: displayPath(realTarget), path: displayPath(realTarget) },
            targetLabel: displayPath(realTarget),
          };
        }
        default:
          return this.deny(null, `不支持的文件动作：${request.action}`);
      }
    } catch (error) {
      if (error instanceof SystemActionError) return this.deny(null, error.message, { reason: error.code });
      throw error;
    }
  }

  /** 受管工作区目录列举（file.list target=workspace）。 */
  private listWorkspaceFiles(request: ActionRequest): DispatchOutcome {
    const params = asRecord(request.params);
    const dir = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.list 的 params.path", { allowRoot: true });
    if (!existsSync(dir)) {
      // 工作区尚未创建：返回空列表（读操作不产生副作用）
      return {
        ok: true,
        output: { scope_kind: "workspace", scope_id: "workspace", dir: displayPath(dir), entries: [] },
        summary: `受管工作区目录 ${displayPath(dir)} 尚不存在（0 项）`,
      };
    }
    const info = statSync(dir);
    if (!info.isDirectory()) {
      throw new SystemActionError("invalid-target", `file.list 目标不是目录：${displayPath(dir)}`);
    }
    const entries: WorkspaceFileEntry[] = readdirSync(dir, { withFileTypes: true }).map((entry) => {
      const fullPath = join(dir, entry.name);
      let size = 0;
      let modifiedAt = "";
      try {
        const itemInfo = statSync(fullPath);
        size = itemInfo.size;
        modifiedAt = itemInfo.mtime.toISOString();
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
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return {
      ok: true,
      output: { scope_kind: "workspace", scope_id: "workspace", dir: displayPath(dir), entries },
      summary: `列出受管工作区目录 ${displayPath(dir)} 共 ${entries.length} 项`,
    };
  }

  // ---- 内部：v1.4-D app.open ---------------------------------------------

  private evaluateAppOpen(request: ActionRequest): ScopeEvaluation {
    const params = asRecord(request.params);
    const rawUrl = params.target_url;
    if (typeof rawUrl === "string" && rawUrl.trim() !== "") {
      try {
        const url = this.parseAllowedUrl(rawUrl);
        return {
          allowed: true,
          summary: `打开白名单 URL：${this.auditUrl(url)}（medium：默认需确认）`,
          details: { target: "url", url: url.href },
          targetLabel: this.auditUrl(url),
        };
      } catch (error) {
        if (error instanceof SystemActionError) return this.deny("url", error.message, { reason: error.code });
        throw error;
      }
    }
    const target = request.target ?? null;
    const app = this.findApp(target);
    if (app === null) {
      return this.deny(
        target,
        `app.open 目标 ${String(target ?? "(未指定)")} 不在受管应用清单内（也不支持任意 URL：需 params.target_url + allowed_urls 白名单）`,
        { reason: "not-managed" },
      );
    }
    if (!app.allow_start) {
      return this.deny(app.id, `受管应用 ${app.id} 不允许打开（allow_start=false）`, { reason: "allow_start=false" });
    }
    return {
      allowed: true,
      summary: `打开受管应用 ${app.id}（${app.name}）（medium：默认需确认）`,
      details: { target: app.id, command: app.command },
      targetLabel: app.id,
    };
  }

  /** 解析并校验 URL：只允许 http/https、无内嵌凭据，且命中 allowed_urls 白名单。 */
  private parseAllowedUrl(raw: string): URL {
    const text = raw.trim();
    if (text.length > 2048) {
      throw new SystemActionError("invalid-url", "URL 过长（>2048）");
    }
    if (/[\0\r\n\t"'<>]/.test(text)) {
      throw new SystemActionError("invalid-url", "URL 含控制字符/引号/尖括号，已拒绝（防命令注入）");
    }
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new SystemActionError("invalid-url", `URL 非法：${text.slice(0, 120)}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SystemActionError("invalid-url", `只允许 http/https URL（收到 ${url.protocol}）`);
    }
    if (url.username !== "" || url.password !== "") {
      throw new SystemActionError("invalid-url", "URL 不允许内嵌用户名/密码");
    }
    if (this.allowedUrls.length === 0) {
      throw new SystemActionError(
        "url-not-allowed",
        "未配置 allowed_urls 白名单：禁止打开任何 URL（只允许打开受管应用清单内应用）",
      );
    }
    const href = url.href.toLowerCase();
    const host = url.hostname.toLowerCase();
    const allowed = this.allowedUrls.some((entry) => {
      if (entry === "") return false;
      if (entry.startsWith("http://") || entry.startsWith("https://") || entry.includes("/")) {
        return href.startsWith(entry.endsWith("/") ? entry : `${entry}`);
      }
      return host === entry || host.endsWith(`.${entry}`);
    });
    if (!allowed) {
      throw new SystemActionError("url-not-allowed", `URL 域名不在 allowed_urls 白名单：${host}`);
    }
    return url;
  }

  /** 审计用 URL 摘要：只保留 protocol://host/path（去掉 query/fragment，防密钥进审计）。 */
  private auditUrl(url: URL): string {
    return `${url.protocol}//${url.host}${url.pathname}`;
  }

  /** 真实打开 URL：注入 opener 优先；Windows 默认交给 explorer.exe（默认浏览器，无 shell 解释）。 */
  private async openUrl(url: URL): Promise<{ pid?: number }> {
    if (this.urlOpener !== null) {
      const result = await this.urlOpener(url.href);
      if (result !== null && typeof result === "object" && typeof result.pid === "number") {
        return { pid: result.pid };
      }
      return {};
    }
    if (process.platform !== "win32") {
      throw new UnsupportedPlatformError(process.platform, "app.open URL 需要 explorer.exe 或注入 urlOpener");
    }
    const child = spawn("explorer.exe", [url.href], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return typeof child.pid === "number" && child.pid > 0 ? { pid: child.pid } : {};
  }

  // ---- 内部：v1.4-D 定时任务（scheduler.json）-----------------------------

  private get schedulerPath(): string {
    return join(this.stateDir, SCHEDULER_FILE);
  }

  private readSchedulerSafe(): { ok: true; tasks: ScheduledTaskRecord[] } | { ok: false; reason: string } {
    const file = this.schedulerPath;
    if (!existsSync(file)) return { ok: true, tasks: [] };
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reason: `scheduler.json 格式错误：${file}` };
      }
      const rawTasks = (parsed as Partial<SchedulerFile>).tasks;
      if (!Array.isArray(rawTasks)) return { ok: true, tasks: [] };
      return { ok: true, tasks: rawTasks.filter(isScheduledTaskRecord).map(copyTask) };
    } catch (error) {
      return { ok: false, reason: `scheduler.json 损坏：${formatSystemError(error)}` };
    }
  }

  private writeScheduler(tasks: ScheduledTaskRecord[]): void {
    mkdirSync(this.stateDir, { recursive: true });
    const payload: SchedulerFile = {
      version: 1,
      tasks: [...tasks].sort((left, right) => left.created_at.localeCompare(right.created_at)),
    };
    writeFileSync(this.schedulerPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  private validateTaskSpec(request: ActionRequest): { ok: true; spec: ValidatedTaskSpec } | { ok: false; reason: string } {
    const params = asRecord(request.params);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const goal = typeof params.goal === "string" ? params.goal.trim() : "";
    if (name === "") return { ok: false, reason: "task.create 需要非空字符串 params.name" };
    if ([...name].length > TASK_NAME_MAX_LENGTH) {
      return { ok: false, reason: `任务名过长（>${TASK_NAME_MAX_LENGTH} 字符）：${name}` };
    }
    if (goal === "") return { ok: false, reason: "task.create 需要非空字符串 params.goal（要执行的目标）" };
    if ([...goal].length > TASK_GOAL_MAX_LENGTH) {
      return { ok: false, reason: `任务 goal 过长（>${TASK_GOAL_MAX_LENGTH} 字符）` };
    }
    const hasInterval = params.interval_seconds !== undefined && params.interval_seconds !== null;
    const cronRaw = params.cron;
    const hasCron = typeof cronRaw === "string" && cronRaw.trim() !== "";
    if (hasInterval && hasCron) {
      return { ok: false, reason: "params.interval_seconds 与 params.cron 只能二选一" };
    }
    if (!hasInterval && !hasCron) {
      return {
        ok: false,
        reason: `需要 params.interval_seconds（${MIN_TASK_INTERVAL_SECONDS}–${MAX_TASK_INTERVAL_SECONDS} 秒）或 5 段 params.cron`,
      };
    }
    const spec: ValidatedTaskSpec = { name, goal, enabled: true };
    if (hasInterval) {
      const interval = params.interval_seconds;
      if (typeof interval !== "number" || !Number.isInteger(interval)) {
        return { ok: false, reason: "interval_seconds 必须是整数（秒）" };
      }
      if (interval < MIN_TASK_INTERVAL_SECONDS || interval > MAX_TASK_INTERVAL_SECONDS) {
        return {
          ok: false,
          reason: `interval_seconds 超出范围（${MIN_TASK_INTERVAL_SECONDS}–${MAX_TASK_INTERVAL_SECONDS} 秒）：${interval}`,
        };
      }
      spec.interval_seconds = interval;
    }
    if (hasCron) {
      const cron = String(cronRaw).trim();
      if (!isValidCron5(cron)) {
        return { ok: false, reason: `cron 必须是 5 段（分 时 日 月 周，支持 */数字/范围/列表）：${cron}` };
      }
      spec.cron = cron;
    }
    if (params.enabled !== undefined) {
      const enabled = asBoolean(params.enabled);
      if (enabled === null) return { ok: false, reason: "params.enabled 必须是布尔值" };
      spec.enabled = enabled;
    }
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) return { ok: false, reason: scheduler.reason };
    if (scheduler.tasks.some((task) => task.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: `任务名已存在（必须唯一）：${name}` };
    }
    return { ok: true, spec };
  }

  private evaluateTaskList(): ScopeEvaluation {
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) return this.deny(null, scheduler.reason, { reason: "scheduler-corrupt" });
    return {
      allowed: true,
      summary: `列出定时任务：共 ${scheduler.tasks.length} 个（只读；持久化 ${displayPath(this.schedulerPath)}）`,
      details: { target: null, tasks: scheduler.tasks.map((task) => task.name), scheduler_path: displayPath(this.schedulerPath) },
      targetLabel: null,
    };
  }

  private evaluateTaskCreate(request: ActionRequest): ScopeEvaluation {
    const result = this.validateTaskSpec(request);
    if (!result.ok) return this.deny(null, result.reason, { reason: "invalid-task" });
    const { spec } = result;
    const schedule = spec.interval_seconds !== undefined ? `每 ${spec.interval_seconds} 秒` : `cron ${String(spec.cron)}`;
    return {
      allowed: true,
      summary: `创建定时任务「${spec.name}」（${schedule}，enabled=${spec.enabled}；medium：默认需确认）`,
      details: { target: spec.name, name: spec.name, schedule, goal: spec.goal },
      targetLabel: spec.name,
    };
  }

  private evaluateTaskRemove(request: ActionRequest): ScopeEvaluation {
    const params = asRecord(request.params);
    const rawKey =
      (typeof params.task_id === "string" && params.task_id.trim() !== "" ? params.task_id.trim() : null) ??
      (request.target !== undefined && request.target.trim() !== "" ? request.target.trim() : null);
    if (rawKey === null) return this.deny(null, "task.remove 需要 params.task_id 或 target（任务 id/名称）");
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) return this.deny(rawKey, scheduler.reason, { reason: "scheduler-corrupt" });
    const matched = scheduler.tasks.find((task) => task.id === rawKey || task.name === rawKey);
    if (matched === undefined) {
      return this.deny(rawKey, `定时任务不存在：${rawKey}（只有 scheduler.json 内任务可删除）`);
    }
    return {
      allowed: true,
      summary: `删除定时任务「${matched.name}」（只删 scheduler.json 配置；medium：默认需确认）`,
      details: { target: matched.name, task_id: matched.id, name: matched.name },
      targetLabel: matched.name,
    };
  }

  // ---- 内部：v1.4-D 受管安装/卸载 ---------------------------------------

  private get installedPath(): string {
    return join(this.stateDir, INSTALLED_FILE);
  }

  private loadInstalledPrograms(seen: Set<string>): void {
    const file = this.installedPath;
    if (!existsSync(file)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed === null || typeof parsed !== "object") return;
      const rawPrograms = (parsed as { programs?: unknown }).programs;
      if (!Array.isArray(rawPrograms)) return;
      for (const item of rawPrograms) {
        if (item === null || typeof item !== "object") continue;
        const record = item as Partial<InstalledProgramRecord>;
        const appRaw = record.app;
        if (appRaw === null || typeof appRaw !== "object") continue;
        try {
          const id = assertSafeId((appRaw as { id?: unknown }).id, "installed.json 的 app id");
          if (seen.has(id)) continue;
          const app = this.validateAppConfig(appRaw, seen);
          const installedRecord: InstalledProgramRecord = {
            id: app.id,
            source_id: typeof record.source_id === "string" ? record.source_id : "unknown",
            installed_at: typeof record.installed_at === "string" ? record.installed_at : this.now().toISOString(),
            app: copyApp(app),
          };
          this.installed.set(app.id, installedRecord);
          this.apps.push(copyApp(app));
        } catch {
          // 跳过损坏/冲突的安装记录，不阻断控制器创建
        }
      }
    } catch {
      // installed.json 损坏：忽略（可重新安装）
    }
  }

  private writeInstalled(): void {
    mkdirSync(this.stateDir, { recursive: true });
    const payload = {
      version: 1,
      programs: [...this.installed.values()]
        .map((record) => ({ ...record, app: copyApp(record.app) }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
    writeFileSync(this.installedPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  /** 从受管安装源读取 app.json 并构造 ManagedApp（安装前校验）。 */
  private buildAppFromManifest(sourceDir: string, sourceId: string, targetDir: string): ManagedApp {
    const manifestPath = join(sourceDir, "app.json");
    if (!existsSync(manifestPath)) {
      throw new SystemActionError("invalid-source", `安装源缺少 app.json 声明：${displayPath(manifestPath)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new SystemActionError("invalid-source", `app.json 不是合法 JSON：${formatSystemError(error)}`);
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SystemActionError("invalid-source", "app.json 必须是 JSON 对象");
    }
    const manifest = raw as Record<string, unknown>;
    const id = assertSafeId(manifest.id, "app.json 的 id");
    const name = asString(manifest.name);
    if (name === null || name.trim() === "") throw new SystemActionError("invalid-source", "app.json 缺少 name");
    const command = asString(manifest.command);
    if (command === null || command.trim() === "") {
      throw new SystemActionError("invalid-source", "app.json 缺少 command（启动命令）");
    }
    if (/[\0\r\n]/.test(command)) throw new SystemActionError("invalid-source", "app.json 的 command 含控制字符");
    const args = manifest.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== "string"))) {
      throw new SystemActionError("invalid-source", "app.json 的 args 必须是字符串数组");
    }
    const kindRaw = manifest.kind;
    const kind = kindRaw === "plugin" || kindRaw === "console" ? kindRaw : "program";
    const app: ManagedApp = {
      id,
      name,
      command,
      kind,
      allow_start: asBoolean(manifest.allow_start) ?? true,
      allow_stop: asBoolean(manifest.allow_stop) ?? true,
      allow_remove: asBoolean(manifest.allow_remove) ?? true,
      cwd: targetDir,
      path: targetDir,
      installed_from: sourceId,
    };
    if (args !== undefined) app.args = [...(args as string[])];
    const note = asString(manifest.note);
    if (note !== null) app.note = note;
    return app;
  }

  private prepareInstall(request: ActionRequest): PreparedInstall {
    const params = asRecord(request.params);
    const sourceRaw = params.source_id ?? request.target;
    if (typeof sourceRaw !== "string" || sourceRaw.trim() === "") {
      throw new SystemActionError("invalid-source", "program.install 需要 params.source_id（受管安装源目录名）");
    }
    const sourceId = assertSafeId(sourceRaw.trim(), "安装源 id（source_id）");
    const sourceDir = resolveInstallSource(this.installSourcesDir, sourceId);
    const probeApp = this.buildAppFromManifest(sourceDir, sourceId, "");
    if (this.apps.some((app) => app.id === probeApp.id)) {
      throw new SystemActionError("already-installed", `受管应用 id 已存在，拒绝重复安装：${probeApp.id}`);
    }
    const targetDir = resolveProgramDir(this.programsDir, probeApp.id);
    if (existsSync(targetDir)) {
      throw new SystemActionError("destination-exists", `安装目标目录已存在：${displayPath(targetDir)}`);
    }
    const app = this.buildAppFromManifest(sourceDir, sourceId, targetDir);
    return { sourceId, sourceDir, app, targetDir };
  }

  private evaluateProgramInstall(request: ActionRequest): ScopeEvaluation {
    try {
      const prepared = this.prepareInstall(request);
      return {
        allowed: true,
        summary:
          `安装受管程序 ${prepared.app.id}（${prepared.app.name}）← 安装源 ${prepared.sourceId}，` +
          `目标 ${displayPath(prepared.targetDir)}（medium：默认需确认）`,
        details: {
          target: prepared.app.id,
          source_id: prepared.sourceId,
          target_dir: displayPath(prepared.targetDir),
          command: prepared.app.command,
        },
        targetLabel: prepared.app.id,
      };
    } catch (error) {
      if (error instanceof SystemActionError) return this.deny(null, error.message, { reason: error.code });
      throw error;
    }
  }

  private prepareUninstall(request: ActionRequest): PreparedUninstall {
    const target = request.target ?? null;
    if (target === null || target.trim() === "") {
      throw new SystemActionError("missing-target", "program.uninstall 需要 target（已安装受管程序 id）");
    }
    const installed = this.installed.get(target);
    if (installed === undefined) {
      throw new SystemActionError(
        "not-installed",
        `受管程序 ${target} 不是通过 program.install 安装的（只允许卸载 installed.json 内程序）`,
      );
    }
    const app = this.findApp(target);
    if (app === null) {
      throw new SystemActionError("inconsistent-state", `installed.json 记录了 ${target}，但受管清单缺少该应用`);
    }
    const path = app.path ?? installed.app.path;
    if (path === undefined) {
      throw new SystemActionError("no-removal-path", `受管程序 ${app.id} 未声明安装目录（path）`);
    }
    const realPath = assertRemovableTarget({
      root: this.root,
      stateDir: this.stateDir,
      pluginsDir: this.pluginsDir,
      targetPath: path,
      label: `受管程序 ${app.id}`,
    });
    // 注意：temp 路径可能是 Windows 8.3 短名，realpath 会展开为长名；
    // 这里必须用 programsDir 的 realpath 比较，避免同目录不同形式导致误判越界。
    const realProgramsDir = existsSync(this.programsDir) ? safeRealpath(this.programsDir) : this.programsDir;
    if (!isPathInside(realProgramsDir, realPath, { strict: true })) {
      throw new SystemActionError(
        "out-of-scope",
        `program.uninstall 只能卸载 ${displayPath(this.programsDir)} 内的受管程序：${displayPath(realPath)}`,
      );
    }
    return { app, installed, realPath };
  }

  private evaluateProgramUninstall(request: ActionRequest): ScopeEvaluation {
    try {
      const prepared = this.prepareUninstall(request);
      return {
        allowed: true,
        summary:
          `卸载受管程序 ${prepared.app.id}（${prepared.app.name}）——破坏性：先备份到回收站再从受管清单移除，` +
          `目标 ${displayPath(prepared.realPath)}，需用户确认`,
        details: { target: prepared.app.id, removable_path: displayPath(prepared.realPath) },
        targetLabel: prepared.app.id,
      };
    } catch (error) {
      if (error instanceof SystemActionError) return this.deny(request.target ?? null, error.message, { reason: error.code });
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
      case "service.status":
        return this.serviceStatus();
      case "file.list":
        return this.listFiles(request);
      case "file.read":
        return this.fileRead(request);
      case "file.write":
        return this.fileWrite(request);
      case "file.mkdir":
        return this.fileMkdir(request);
      case "file.copy":
        return this.fileCopy(request);
      case "file.move":
        return this.fileMove(request);
      case "file.remove":
        return this.fileRemove(request);
      case "app.open":
        return this.appOpen(request);
      case "task.list":
        return this.taskList();
      case "task.create":
        return this.taskCreate(request);
      case "task.remove":
        return this.taskRemove(request);
      case "program.install":
        return this.programInstall(request);
      case "program.uninstall":
        return this.programUninstall(request);
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
      default:
        // 理论上 plan 已经拦截；这里防御性拒绝
        throw new SystemActionError("unsupported-action", `不支持的动作：${request.action}`);
    }
  }

  private listFiles(request: ActionRequest): DispatchOutcome {
    if ((request.target ?? "") === "workspace") return this.listWorkspaceFiles(request);
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
      output: { scope_kind: scope.kind, scope_id: scope.id, dir: displayPath(dir), entries },
      summary: `列出受管${scope.kind === "app" ? "应用" : "插件"} ${scope.id} 目录 ${displayPath(dir)} 共 ${entries.length} 项`,
    };
  }

  // ---- 内部：文件动作实现 -------------------------------------------------

  private fileRead(request: ActionRequest): DispatchOutcome {
    const params = asRecord(request.params);
    const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.read 的 params.path", {
      mustExist: true,
    });
    const info = statSync(target);
    if (!info.isFile()) throw new SystemActionError("invalid-target", `file.read 目标不是普通文件：${displayPath(target)}`);
    if (info.size > MAX_FILE_READ_BYTES) {
      throw new SystemActionError("file-too-large", `文件过大（${info.size} 字节 > ${MAX_FILE_READ_BYTES}）`);
    }
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch (error) {
      throw new SystemActionError("read-failed", `读取文件失败：${formatSystemError(error)}`);
    }
    const hash = sha256Hex(content);
    return {
      ok: true,
      output: { path: displayPath(target), size: Buffer.byteLength(content, "utf8"), content, sha256: hash },
      summary: `读取工作区文件 ${displayPath(target)}（${info.size} 字节，sha256=${hash.slice(0, 16)}…）`,
    };
  }

  private fileWrite(request: ActionRequest): DispatchOutcome {
    const params = asRecord(request.params);
    const content = params.content;
    if (typeof content !== "string") throw new SystemActionError("invalid-content", "file.write 需要字符串 params.content");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_WRITE_BYTES) {
      throw new SystemActionError("content-too-large", `内容过大（${bytes} > ${MAX_FILE_WRITE_BYTES} 字节）`);
    }
    const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.write 的 params.path");
    const existed = existsSync(target);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    const hash = sha256Hex(content);
    return {
      ok: true,
      output: { path: displayPath(target), size: bytes, sha256: hash, overwritten: existed },
      summary:
        `写入工作区文件 ${displayPath(target)}（${bytes} 字节，sha256=${hash.slice(0, 16)}…，` +
        `${existed ? "覆盖已有文件" : "新建文件"}）`,
    };
  }

  private fileMkdir(request: ActionRequest): DispatchOutcome {
    const params = asRecord(request.params);
    const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.mkdir 的 params.path");
    const existed = existsSync(target);
    mkdirSync(target, { recursive: true });
    return {
      ok: true,
      output: { path: displayPath(target), created: !existed },
      summary: `创建目录 ${displayPath(target)}（${existed ? "已存在" : "已创建"}）`,
    };
  }

  private async fileCopy(request: ActionRequest): Promise<DispatchOutcome> {
    const params = asRecord(request.params);
    const source = resolveWorkspaceEntry(this.workspaceDir, params.source, "file.copy 的 params.source", {
      mustExist: true,
    });
    const destination = resolveWorkspaceEntry(this.workspaceDir, params.destination, "file.copy 的 params.destination");
    const overwrite = params.overwrite === true;
    let backupPath: string | undefined;
    let overwritten = false;
    if (existsSync(destination)) {
      // overwrite 已在 plan 校验；这里再防御一次
      if (!overwrite) {
        throw new SystemActionError("destination-exists", `复制目标已存在：${displayPath(destination)}`);
      }
      overwritten = true;
      backupPath = await backupToRecycle({
        stateDir: this.stateDir,
        sourcePath: destination,
        label: `overwritten-${basename(destination)}`,
      });
      await rm(destination, { recursive: true, force: true });
    }
    await mkdir(dirname(destination), { recursive: true });
    try {
      await cp(source, destination, { recursive: true, force: false, errorOnExist: false });
    } catch (error) {
      throw new SystemActionError("copy-failed", `复制失败：${formatSystemError(error)}`);
    }
    return {
      ok: true,
      output: {
        source: displayPath(source),
        destination: displayPath(destination),
        overwritten,
        ...(backupPath !== undefined ? { backup_path: displayPath(backupPath) } : {}),
      },
      summary:
        `复制 ${displayPath(source)} → ${displayPath(destination)}` +
        `${overwritten ? `（覆盖前已备份到 ${backupPath === undefined ? "回收站" : displayPath(backupPath)}）` : ""}`,
      ...(backupPath !== undefined ? { backup_path: backupPath } : {}),
    };
  }

  private async fileMove(request: ActionRequest): Promise<DispatchOutcome> {
    const params = asRecord(request.params);
    const source = resolveWorkspaceEntry(this.workspaceDir, params.source, "file.move 的 params.source", {
      mustExist: true,
    });
    const destination = resolveWorkspaceEntry(this.workspaceDir, params.destination, "file.move 的 params.destination");
    if (source === destination) {
      return { ok: true, output: { source: displayPath(source), destination: displayPath(destination), moved: false }, summary: "移动源与目标相同（无操作）" };
    }
    const overwrite = params.overwrite === true;
    let backupPath: string | undefined;
    let overwritten = false;
    if (existsSync(destination)) {
      if (!overwrite) {
        throw new SystemActionError("destination-exists", `移动目标已存在：${displayPath(destination)}`);
      }
      overwritten = true;
      backupPath = await backupToRecycle({
        stateDir: this.stateDir,
        sourcePath: destination,
        label: `overwritten-${basename(destination)}`,
      });
      await rm(destination, { recursive: true, force: true });
    }
    await mkdir(dirname(destination), { recursive: true });
    try {
      await rename(source, destination);
    } catch (error) {
      // 跨卷/被占用等场景回退为「复制 + 删除」
      try {
        await cp(source, destination, { recursive: true, force: false });
        await rm(source, { recursive: true, force: true });
      } catch (fallbackError) {
        throw new SystemActionError(
          "move-failed",
          `移动失败：${formatSystemError(error)}；回退复制也失败：${formatSystemError(fallbackError)}`,
        );
      }
    }
    return {
      ok: true,
      output: {
        source: displayPath(source),
        destination: displayPath(destination),
        overwritten,
        ...(backupPath !== undefined ? { backup_path: displayPath(backupPath) } : {}),
      },
      summary:
        `移动 ${displayPath(source)} → ${displayPath(destination)}` +
        `${overwritten ? `（覆盖前已备份到 ${backupPath === undefined ? "回收站" : displayPath(backupPath)}）` : ""}`,
      ...(backupPath !== undefined ? { backup_path: backupPath } : {}),
    };
  }

  private async fileRemove(request: ActionRequest): Promise<DispatchOutcome> {
    const params = asRecord(request.params);
    const target = resolveWorkspaceEntry(this.workspaceDir, params.path, "file.remove 的 params.path");
    const realTarget = assertWorkspaceRemovable(this.workspaceDir, target, "file.remove 的 params.path");
    const backupPath = await backupToRecycle({
      stateDir: this.stateDir,
      sourcePath: realTarget,
      label: `file-${basename(realTarget)}`,
    });
    await rm(realTarget, { recursive: true, force: true });
    return {
      ok: true,
      output: { path: displayPath(realTarget), removed: true, backup_path: displayPath(backupPath) },
      summary: `删除工作区条目 ${displayPath(realTarget)}；备份于 ${displayPath(backupPath)}`,
      backup_path: backupPath,
    };
  }

  // ---- 内部：app.open / service.status / task / install 实现 --------------

  private async appOpen(request: ActionRequest): Promise<DispatchOutcome> {
    const params = asRecord(request.params);
    const rawUrl = params.target_url;
    if (typeof rawUrl === "string" && rawUrl.trim() !== "") {
      const url = this.parseAllowedUrl(rawUrl);
      const opened = await this.openUrl(url);
      const result: AppOpenResult = { mode: "url", target: this.auditUrl(url), url: url.href };
      if (opened.pid !== undefined) result.pid = opened.pid;
      return {
        ok: true,
        output: result,
        summary: `打开白名单 URL：${this.auditUrl(url)}`,
      };
    }
    const app = this.requireApp(request.target ?? null);
    const started = await this.getOps().start(app);
    const result: AppOpenResult = { mode: "managed-app", target: app.id, pid: started.pid };
    return {
      ok: true,
      output: result,
      summary: `打开受管应用 ${app.id}（${app.name}），pid=${started.pid}`,
    };
  }

  private async serviceStatus(): Promise<DispatchOutcome> {
    const processes = await this.getOps().list();
    const snapshot: ServiceSnapshot = {
      platform: process.platform,
      count: processes.length,
      processes: processes.map((item) => ({ pid: item.pid, name: item.name })),
      at: this.now().toISOString(),
    };
    return {
      ok: true,
      output: snapshot,
      summary: `服务状态快照：${snapshot.count} 个进程（只读）`,
    };
  }

  private taskList(): DispatchOutcome {
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) throw new SystemActionError("scheduler-corrupt", scheduler.reason);
    return {
      ok: true,
      output: { tasks: scheduler.tasks.map(copyTask), scheduler_path: displayPath(this.schedulerPath) },
      summary: `列出定时任务 ${scheduler.tasks.length} 个（${displayPath(this.schedulerPath)}）`,
    };
  }

  private taskCreate(request: ActionRequest): DispatchOutcome {
    const validated = this.validateTaskSpec(request);
    if (!validated.ok) throw new SystemActionError("invalid-task", validated.reason);
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) throw new SystemActionError("scheduler-corrupt", scheduler.reason);
    const { spec } = validated;
    const record: ScheduledTaskRecord = {
      id: `task-${randomUUID().slice(0, 8)}`,
      name: spec.name,
      goal: spec.goal,
      enabled: spec.enabled,
      created_at: this.now().toISOString(),
    };
    if (spec.interval_seconds !== undefined) record.interval_seconds = spec.interval_seconds;
    if (spec.cron !== undefined) record.cron = spec.cron;
    if (request.requested_by !== undefined) record.requested_by = request.requested_by;
    this.writeScheduler([...scheduler.tasks, record]);
    const schedule = spec.interval_seconds !== undefined ? `每 ${spec.interval_seconds} 秒` : `cron ${String(spec.cron)}`;
    return {
      ok: true,
      output: { task: record, scheduler_path: displayPath(this.schedulerPath) },
      summary: `创建定时任务「${record.name}」（${schedule}，id=${record.id}）`,
    };
  }

  private taskRemove(request: ActionRequest): DispatchOutcome {
    const params = asRecord(request.params);
    const rawKey =
      (typeof params.task_id === "string" && params.task_id.trim() !== "" ? params.task_id.trim() : null) ??
      (request.target !== undefined && request.target.trim() !== "" ? request.target.trim() : null);
    if (rawKey === null) throw new SystemActionError("missing-target", "task.remove 需要 params.task_id 或 target");
    const scheduler = this.readSchedulerSafe();
    if (!scheduler.ok) throw new SystemActionError("scheduler-corrupt", scheduler.reason);
    const matched = scheduler.tasks.find((task) => task.id === rawKey || task.name === rawKey);
    if (matched === undefined) throw new SystemActionError("not-found", `定时任务不存在：${rawKey}`);
    this.writeScheduler(scheduler.tasks.filter((task) => task.id !== matched.id));
    return {
      ok: true,
      output: { task_id: matched.id, name: matched.name, removed: true },
      summary: `删除定时任务「${matched.name}」（只删 scheduler.json 配置，未调用 Windows 任务计划）`,
    };
  }

  private async programInstall(request: ActionRequest): Promise<DispatchOutcome> {
    const prepared = this.prepareInstall(request);
    mkdirSync(dirname(prepared.targetDir), { recursive: true });
    if (existsSync(prepared.targetDir)) {
      throw new SystemActionError("destination-exists", `安装目标目录已存在：${displayPath(prepared.targetDir)}`);
    }
    try {
      await cp(prepared.sourceDir, prepared.targetDir, { recursive: true, force: false });
    } catch (error) {
      throw new SystemActionError("install-failed", `安装复制失败：${formatSystemError(error)}`);
    }
    this.apps.push(copyApp(prepared.app));
    this.installed.set(prepared.app.id, {
      id: prepared.app.id,
      source_id: prepared.sourceId,
      installed_at: this.now().toISOString(),
      app: copyApp(prepared.app),
    });
    this.writeInstalled();
    return {
      ok: true,
      output: {
        app_id: prepared.app.id,
        source_id: prepared.sourceId,
        path: displayPath(prepared.targetDir),
        installed_json: displayPath(this.installedPath),
      },
      summary:
        `安装受管程序 ${prepared.app.id}（${prepared.app.name}）成功：` +
        `${displayPath(prepared.sourceDir)} → ${displayPath(prepared.targetDir)}（已写入受管清单与 installed.json）`,
    };
  }

  private async programUninstall(request: ActionRequest): Promise<DispatchOutcome> {
    const prepared = this.prepareUninstall(request);
    // 先尝试停止正在运行的受管程序（best-effort；失败不阻断卸载）
    try {
      await this.getOps().stop(prepared.app, null);
    } catch {
      // 忽略停止失败：备份/删除仍会执行，失败会以回执上报
    }
    const backupPath = await backupToRecycle({
      stateDir: this.stateDir,
      sourcePath: prepared.realPath,
      label: `program-${prepared.app.id}`,
    });
    await rm(prepared.realPath, { recursive: true, force: true });
    this.apps = this.apps.filter((app) => app.id !== prepared.app.id);
    this.installed.delete(prepared.app.id);
    this.writeInstalled();
    return {
      ok: true,
      output: {
        app_id: prepared.app.id,
        removed: true,
        backup_path: displayPath(backupPath),
        installed_json: displayPath(this.installedPath),
      },
      summary:
        `卸载受管程序 ${prepared.app.id}（${prepared.app.name}）成功：备份于 ${displayPath(backupPath)}，` +
        "已从受管清单与 installed.json 移除（restoreBackup 可恢复文件）",
      backup_path: backupPath,
    };
  }

  // ---- 内部：插件 manifest 写入 ------------------------------------------

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
