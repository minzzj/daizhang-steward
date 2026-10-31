/**
 * v1.5.2：消息呈现分相（phase）。
 *
 * 用户要求：默认只看到「我输入的内容」+「思考过程（收起）」+「最终结果」；
 * 展开思考过程才看到工具调用、查询结果、中间数据、记忆。
 *
 * 本模块负责把一条 assistant 消息的 parts 分类为 thinking / result 两相，
 * 合并 tool_call + tool_result（同一 callId 或同一工具），并计算思考摘要。
 * 旧消息没有 phase 字段时也能自动分类（向后兼容）。
 */
import type { ChatMessage, ChatPart, ChatThinkingSummary } from "./types.js";

export type ChatPhase = "thinking" | "result";

const THINKING_TYPES = new Set<ChatPart["type"]>(["thinking", "tool_call", "tool_result", "data"]);

function isTextLike(part: ChatPart): part is Extract<ChatPart, { type: "text" | "markdown" }> {
  return part.type === "text" || part.type === "markdown";
}

/** 合并 tool_result 到对应的 tool_call（同 callId 优先，其次同名未合并工具）。 */
export function mergeToolParts(parts: ChatPart[]): ChatPart[] {
  const merged: ChatPart[] = [];
  const callsById = new Map<string, Extract<ChatPart, { type: "tool_call" }>>();
  for (const part of parts) {
    if (part.type === "tool_call") {
      const call = { ...part, status: part.status ?? "done" };
      merged.push(call);
      if (part.callId !== undefined) callsById.set(part.callId, call);
      continue;
    }
    if (part.type === "tool_result") {
      const call =
        part.callId !== undefined
          ? callsById.get(part.callId)
          : [...merged].reverse().find((item): item is Extract<ChatPart, { type: "tool_call" }> => item.type === "tool_call" && item.tool === part.tool && item.result_preview === undefined);
      if (call !== undefined) {
        call.status = part.ok ? "ok" : "error";
        call.result_preview = part.summary;
        if (part.data !== undefined) call.result_data = part.data;
        if (part.duration_ms !== undefined) call.duration_ms = part.duration_ms;
        continue;
      }
    }
    merged.push(part);
  }
  return merged;
}

/**
 * 对 assistant 消息的 parts 分相（原地修改 phase 字段）。
 * 规则：
 * - approval / error：result（始终可见，不能折叠）
 * - artifact / report：result（交付物，显示在结果区）
 * - tool_call / tool_result / data / thinking / 有 title 的 markdown：thinking（折叠）
 * - text：最后一条文本是最终结果，之前的文本（如"好的我开始做…"）归入思考
 * - markdown：作为最终结果仅当没有 text 结果且它是最后一部分
 */
export function applyMessagePhases(message: ChatMessage): ChatMessage {
  const parts = mergeToolParts(Array.isArray(message.parts) ? message.parts : []);
  const textIndexes = parts
    .map((part, index) => (part.type === "text" ? index : -1))
    .filter((index) => index >= 0);
  const lastTextIndex = textIndexes.length > 0 ? (textIndexes[textIndexes.length - 1] as number) : -1;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as ChatPart;
    if (part.type === "approval" || part.type === "error" || part.type === "artifact" || part.type === "report") {
      part.phase = "result";
      continue;
    }
    if (part.type === "text") {
      part.phase = index === lastTextIndex ? "result" : "thinking";
      continue;
    }
    if (part.type === "markdown") {
      const isLast = index === parts.length - 1;
      part.phase = lastTextIndex < 0 && isLast ? "result" : "thinking";
      continue;
    }
    if (THINKING_TYPES.has(part.type)) {
      part.phase = "thinking";
      continue;
    }
    part.phase = "thinking";
  }

  const toolCalls = parts.filter((part) => part.type === "tool_call").length;
  const artifacts = parts.filter((part) => part.type === "artifact").length;
  const reports = parts.filter((part) => part.type === "report").length;
  const thinkingSteps = parts.filter((part) => part.phase === "thinking").length;
  const resultTextParts = parts.filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text" && part.phase === "result");
  const summary: ChatThinkingSummary = {
    steps: thinkingSteps,
    tool_calls: toolCalls,
    artifacts,
    reports,
  };
  message.parts = parts;
  message.thinking_summary = summary;
  const resultText = resultTextParts.map((part) => part.text).filter((text) => text.trim().length > 0).join("\n\n");
  if (resultText.length > 0) message.result_text = resultText;
  const errorPart = parts.find((part): part is Extract<ChatPart, { type: "error" }> => part.type === "error");
  if (errorPart !== undefined) message.result_text = errorPart.message;
  const approval = parts.find((part): part is Extract<ChatPart, { type: "approval" }> => part.type === "approval");
  if (approval !== undefined && message.result_text === undefined) message.result_text = `等待你审批：${approval.approval.summary}`;
  return message;
}

/** 按相拆分（渲染端用）。 */
export function splitPartsByPhase(parts: ChatPart[]): {
  thinking: ChatPart[];
  deliverables: ChatPart[];
  results: ChatPart[];
  approvals: ChatPart[];
  errors: ChatPart[];
} {
  const merged = mergeToolParts(Array.isArray(parts) ? parts : []);
  const synthetic: ChatMessage = { id: "tmp", conversation_id: "", role: "assistant", at: "", parts: merged };
  applyMessagePhases(synthetic);
  const finalized = synthetic.parts;
  return {
    thinking: finalized.filter((part) => part.phase === "thinking" && part.type !== "approval" && part.type !== "error"),
    deliverables: finalized.filter((part) => part.type === "artifact" || part.type === "report"),
    results: finalized.filter((part) => part.phase === "result" && part.type !== "artifact" && part.type !== "report" && part.type !== "approval" && part.type !== "error"),
    approvals: finalized.filter((part) => part.type === "approval"),
    errors: finalized.filter((part) => part.type === "error"),
  };
}
