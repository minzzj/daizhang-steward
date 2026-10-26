/**
 * 系统总控动作层错误类型。
 *
 * 约定：
 * - **策略拒绝**一律抛错（`OutOfScopeError` / `ConfirmationRequiredError`），绝不执行；
 * - **执行失败**（进程起不来、备份失败等）返回 `ActionReceipt{ok:false,executed:true,error}`，
 *   并在审计里留一条失败记录；只有环境级问题（非 Windows）抛 `UnsupportedPlatformError`。
 */

/** 系统动作层通用错误（带机器可读 code）。 */
export class SystemActionError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SystemActionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** 目标不在受管范围内（清单外 app / 插件 / 路径越界 / 系统关键路径）→ 拒绝。 */
export class OutOfScopeError extends SystemActionError {
  readonly action: string;
  readonly target: string;

  constructor(action: string, target: string, reason: string) {
    super("out-of-scope", `动作 ${action} 的目标「${target}」不在受管范围内：${reason}`, {
      action,
      target,
      reason,
    });
    this.name = "OutOfScopeError";
    this.action = action;
    this.target = target;
  }
}

/** 高风险/破坏性动作缺少有效的一次性确认令牌（未确认 / 过期 / 错配 / 已使用）。 */
export class ConfirmationRequiredError extends SystemActionError {
  readonly requestId: string;
  readonly action: string;
  readonly reason: string;

  constructor(requestId: string, action: string, reason: string) {
    super(
      "confirmation-required",
      `动作 ${action}（request_id=${requestId}）需要用户二次确认：${reason}。` +
        "请先调用 plan() 获取 confirmation_token，并由用户明确确认后再执行。",
      { requestId, action, reason },
    );
    this.name = "ConfirmationRequiredError";
    this.requestId = requestId;
    this.action = action;
    this.reason = reason;
  }
}

/** 当前平台不支持真实系统动作（默认 `WindowsProcessOps` 只在 Windows 可用）。 */
export class UnsupportedPlatformError extends SystemActionError {
  readonly platform: string;

  constructor(platform: string, detail: string) {
    super(
      "unsupported-platform",
      `系统总控动作层当前平台（${platform}）不支持真实执行：${detail}。` +
        "Windows 使用 child_process + PowerShell；Linux/macOS 可注入自定义 ProcessOps 实现。",
      { platform, detail },
    );
    this.name = "UnsupportedPlatformError";
    this.platform = platform;
  }
}

/** 把任意错误统一成可读文本。 */
export function formatSystemError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
