/**
 * steward-chat 错误类型（入参/找不到会话/配置），便于 CLI/控制台映射。
 */

export type ChatErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFIG";

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly field: string | null;

  constructor(message: string, code: ChatErrorCode = "INVALID_INPUT", field: string | null = null) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.field = field;
  }
}
