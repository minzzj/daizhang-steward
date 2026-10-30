/**
 * `@daizhang/steward-system`：代掌 Steward 的系统总控动作层（v1.3-A 基线 + v1.4-D 扩展）。
 *
 * 能力：受管应用/插件的枚举、启动/停止/重启/打开、受管范围内删除（先备份 → 二次确认 → 再删除）、
 * 受管工作区文件/目录操作、服务状态快照、定时任务（scheduler.json）、受管安装/卸载、
 * 一次性确认令牌、审计 JSONL、备份恢复、系统摘要。
 *
 * 安全边界（详见 README.md）：
 * - 只操作「受管应用清单 + `<plugins_dir>` 直接子目录 + 受管工作区 + 受管安装源」，
 *   清单/范围外一律拒绝（OutOfScopeError）；
 * - medium（默认）/high/destructive 动作必须二次确认（一次性 token，120s TTL，
 *   绑定 request_id+action+target；`auto_approve_medium: true` 仅放开 medium）；
 * - 删除先备份到 `<state_dir>/recycle/…`，绝不触碰系统关键路径，禁止软链接逃逸；
 * - 全程审计（脱敏 JSONL，文件内容只记大小/sha256），未知 ≠ 成功。
 *
 * 零第三方依赖；真实进程/删除动作仅在 Windows 上执行（默认 `WindowsProcessOps`，可注入替身）。
 */

export type {
  ActionName,
  ActionPlan,
  ActionReceipt,
  ActionRequest,
  AppKind,
  AppOpenResult,
  AuditEntry,
  ConfirmationRecord,
  InstalledFile,
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
  StartedProcess,
  SystemControllerOptions,
  SystemInfo,
  UrlOpener,
  WorkspaceFileEntry,
} from "./types.js";
export {
  AUDIT_REASON_MAX,
  AUDIT_SUMMARY_MAX,
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

export {
  ConfirmationRequiredError,
  OutOfScopeError,
  SystemActionError,
  UnsupportedPlatformError,
  formatSystemError,
} from "./errors.js";

export {
  ACTION_RISK,
  AUTO_APPROVE_MEDIUM_OPTION,
  SystemController,
  isValidCron5,
  newActionRequestId,
  requiresUserConfirmation,
} from "./controller.js";

export {
  JsonlAuditTrail,
  SYSTEM_AUDIT_FILE,
  redactAuditReason,
  redactAuditText,
} from "./audit.js";

export {
  backupToRecycle,
  isRecyclePath,
  recycleRoot,
  recycleStamp,
  restoreBackup,
} from "./recycle.js";

export {
  WindowsProcessOps,
  isProcessAlive,
  runPowerShell,
} from "./process-ops.js";
export type { PowerShellRunResult, WindowsProcessOpsOptions } from "./process-ops.js";

export {
  SAFE_ID_PATTERN,
  assertRemovableTarget,
  assertSafeId,
  assertSafeRelativePath,
  assertWorkspaceRemovable,
  briefPath,
  displayPath,
  isPathInside,
  isSystemCriticalPath,
  isWindows,
  normalizeForCompare,
  processNameFor,
  resolveInstallSource,
  resolvePluginDir,
  resolveProgramDir,
  resolveWithin,
  resolveWorkspaceEntry,
  safeRealpath,
  systemCriticalRoots,
} from "./scope.js";
