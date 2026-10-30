/**
 * 长期记忆辅助（纯函数）：
 * - tokenizeForRecall：中文 2-gram + 拉丁词；
 * - recallMemories：按相关度/重要度/时间排序，最多 N 条；
 * - extractMemoryCandidates：从一轮对话（用户文本 + 意图 + 任务结果 + 卡片）抽取候选记忆。
 *
 * 去重与数量上限由 ChatStore/ChatEngine 负责。
 */

import type { ChatMemoryEntry, ChatPart, MemoryKind } from "./types.js";

export interface MemoryCandidate {
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: 1 | 2 | 3;
  source?: string;
}

const CJK = /[\u4e00-\u9fff]/u;
const CJK_ONLY = /[^\u4e00-\u9fff]+/gu;
const NON_CJK = /[^\u4e00-\u9fff]+/u;

function normalize(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function clampText(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join("");
}

/** 召回分词：拉丁词 + 中文整段（≤6 字）+ 中文 2-gram。 */
export function tokenizeForRecall(query: string): string[] {
  const text = normalize(query);
  if (text.length === 0) return [];
  const tokens = new Set<string>();
  for (const word of text.split(/[^a-z0-9_-]+/u)) {
    if (word.length >= 2) tokens.add(word);
  }
  const chunks = text.split(CJK_ONLY).filter((chunk) => chunk.length > 0);
  for (const chunk of chunks) {
    const chars = Array.from(chunk);
    if (chars.length <= 6) tokens.add(chunk);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      tokens.add(chars.slice(index, index + 2).join(""));
    }
  }
  return [...tokens].filter((token) => token.length >= 2).slice(0, 80);
}

/** 记忆召回：相关度（token 命中）→ 重要度 → 时间，最多 limit 条。 */
export function recallMemories(all: ChatMemoryEntry[], query: string, limit = 5): ChatMemoryEntry[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
  const tokens = tokenizeForRecall(query);
  if (tokens.length === 0) return all.slice(0, safeLimit);
  const whole = normalize(query);
  const scored = all
    .map((entry) => {
      const haystack = normalize(`${entry.content} ${entry.tags.join(" ")}`);
      let score = 0;
      for (const token of tokens) {
        if (token.length > 0 && haystack.includes(token)) score += token.length > 2 ? 3 : 2;
      }
      if (whole.length >= 2 && haystack.includes(whole)) score += 5;
      return { entry, score };
    })
    .filter((item) => item.score > 0);
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.entry.importance !== left.entry.importance) return right.entry.importance - left.entry.importance;
    return right.entry.created_at.localeCompare(left.entry.created_at);
  });
  return scored.slice(0, safeLimit).map((item) => item.entry);
}

export interface ExtractMemoryInput {
  userText: string;
  intent: string;
  /** 任务类执行结果摘要（execute_goal / harness_task）。 */
  taskSummary?: string;
  runId?: string;
  sessionId?: string;
  /** 本轮 assistant 的卡片 parts（产物/报告引用）。 */
  parts: ChatPart[];
}

/** 从一轮对话中抽取候选记忆（偏好/项目/决策/run/产物/报告/笔记）。 */
export function extractMemoryCandidates(input: ExtractMemoryInput): MemoryCandidate[] {
  const raw = typeof input.userText === "string" ? input.userText.trim() : "";
  if (raw.length === 0) return [];
  const candidates: MemoryCandidate[] = [];
  const push = (
    kind: MemoryKind,
    content: string,
    importance: 1 | 2 | 3,
    tags: string[],
    source = "conversation",
  ): void => {
    const normalized = content.replace(/\s+/gu, " ").trim();
    if (normalized.length >= 2) candidates.push({ kind, content: clampText(normalized, 160), tags, importance, source });
  };

  // 1) 显式"记住/记下"
  const explicit = /(?:记住|记一下|记下|请记住)[:：]?\s*(.+)/u.exec(raw);
  if (explicit?.[1] !== undefined) {
    const value = explicit[1].trim();
    const isPreference = /偏好|喜欢|不要|请用|每次|以后|简洁|中文|英文/u.test(value);
    push(isPreference ? "preference" : "note", value, 3, ["explicit"], "user_explicit");
  }

  // 2) 偏好句式（即使没说"记住"）
  const preference = /(?:我的偏好是|我偏好|我喜欢|我不喜欢|以后请|请用|每次都要)[:：]?\s*(.{2,120})/u.exec(raw);
  if (preference?.[1] !== undefined) push("preference", preference[1], 2, ["preference"]);

  // 3) 决策
  const decision = /(?:决定|确定|就按|采用|选择|同意|批准|驳回)[:：]?\s*(.{2,120})/u.exec(raw);
  if (decision?.[1] !== undefined) push("decision", decision[1], 2, ["decision"]);

  // 4) 项目（项目类任务 / 显式项目名）
  if (input.intent === "execute_goal") push("project", raw, 2, ["project"]);
  const projectName = /项目[:：]?\s*["“]?([^"”\n，。；;]{2,30})/u.exec(raw);
  if (projectName?.[1] !== undefined && input.intent !== "execute_goal") push("project", projectName[1], 2, ["project"]);

  // 5) run / 任务结果
  if (typeof input.runId === "string" && input.runId.length > 0) {
    const summary = typeof input.taskSummary === "string" && input.taskSummary.trim().length > 0 ? input.taskSummary.trim() : raw;
    push("run", `${input.runId}：${summary}`, 2, ["run", input.runId], "execute_goal");
  } else if (input.intent === "harness_task" && typeof input.taskSummary === "string") {
    push("run", `harness 任务：${clampText(raw, 80)} → ${clampText(input.taskSummary, 80)}`, 1, ["harness"], "harness_task");
  }

  // 6) 产物 / 报告引用（内嵌卡片）
  const seen = new Set<string>();
  for (const part of Array.isArray(input.parts) ? input.parts : []) {
    if (part.type === "artifact" && seen.add(`artifact:${part.artifact.id}`)) {
      push("artifact", `产物：${part.artifact.title}（${part.artifact.id}）`, 2, [part.artifact.id, "artifact"]);
    }
    if (part.type === "report" && seen.add(`report:${part.report.id}`)) {
      push("report", `报告：${part.report.title}（${part.report.id}）`, 2, [part.report.id, "report"]);
    }
  }

  return candidates;
}

/** 判断文本是否包含中文（README/分类调试用）。 */
export function hasCjk(text: string): boolean {
  return CJK.test(text) && NON_CJK.test(text) === false ? true : CJK.test(text);
}
