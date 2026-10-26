/**
 * `@daizhang/steward-system`：代掌 Steward 的系统总控动作层（v1.3-A）。
 *
 * 能力：受管应用/插件的枚举、启动/停止/重启、受管范围内删除（先备份 → 二次确认 → 再删除）、
 * 一次性确认令牌、审计 JSONL、备份恢复、系统摘要。
 *
 * 安全边界（详见 README.md）：
 * - 只操作「受管应用清单 + `<plugins_dir>` 直接子目录」，清单外一律拒绝（OutOfScopeError）；
 * - high/destructive 动作必须二次确认（一次性 token，120s TTL，绑定 request_id+action+target）；
 * - 删除先备份到 `<state_dir>/recycle/…`，绝不触碰系统关键路径；
 * - 全程审计（脱敏 JSONL），未知 ≠ 成功。
 *
 * 零第三方依赖；真实进程/删除动作仅在 Windows 上执行（默认 `WindowsProcessOps`，可注入替身）。
 */

export type {
  ActionName,
  ActionPlan,
  ActionReceipt,
  ActionRequest,
  AppKind,
  AuditEntry,
  ConfirmationRecord,
  ManagedApp,
  ManagedPlugin,
  ProcessInfo,
  ProcessOps,
  RestoreResult,
  RiskLevel,
  StartedProcess,
  SystemControllerOptions,
  SystemInfo,
} from "./types.js";
export {
  AUDIT_REASON_MAX,
  AUDIT_SUMMARY_MAX,
  CONFIRMATION_TTL_MS,
  MAX_MANAGED_APPS,
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
  SystemController,
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
  briefPath,
  displayPath,
  isPathInside,
  isSystemCriticalPath,
  isWindows,
  normalizeForCompare,
  processNameFor,
  resolvePluginDir,
  resolveWithin,
  safeRealpath,
  systemCriticalRoots,
} from "./scope.js";
