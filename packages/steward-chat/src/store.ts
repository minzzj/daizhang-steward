/**
 * ChatStore：对话/消息/长期记忆持久化。
 *
 * - `<root>/conversations/<id>.json`：`{ conversation, messages[] }`
 * - `<root>/index.json`：会话索引（list 用）
 * - `<root>/memory.json`：长期记忆
 * 全部 tmp+rename 原子写；读取对损坏 JSON 容错。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ChatError } from "./errors.js";
import {
  CHAT_DEFAULT_CONVERSATION_TITLE,
  type ChatConversation,
  type ChatMemoryEntry,
  type ChatMemoryFilter,
  type ChatMessage,
  type ChatPart,
  type MemoryKind,
} from "./types.js";

const MEMORY_KINDS: ReadonlySet<string> = new Set<MemoryKind>([
  "preference",
  "project",
  "decision",
  "run",
  "artifact",
  "report",
  "note",
]);
const MANUAL_TITLE_MAX_CHARS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIsoOf(clock: () => Date): string {
  return clock().toISOString();
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, filePath);
  } catch {
    // exFAT/Windows 上 rename 可能失败：回退为直接写目标文件（非原子但可用）。
    try {
      writeFileSync(filePath, content, "utf8");
    } catch {
      /* 写失败不抛：上层读取会容错 */
    }
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

function readJson(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** 消息摘要预览（取第一个文本/markdown part，最长 60 字）。 */
export function summarizeMessage(message: ChatMessage): string {
  const parts: ChatPart[] = Array.isArray(message.parts) ? message.parts : [];
  const textPart = parts.find((part) => part.type === "text" || part.type === "markdown" || part.type === "thinking");
  if (textPart !== undefined) {
    const raw =
      textPart.type === "markdown" ? textPart.markdown : textPart.type === "thinking" ? textPart.text : textPart.text;
    const text = String(raw ?? "").replace(/\s+/gu, " ").trim();
    if (text.length > 0) return Array.from(text).slice(0, 60).join("");
  }
  const labels: Record<string, string> = {
    tool_call: "工具调用",
    tool_result: "工具结果",
    artifact: "产物",
    report: "报告",
    data: "数据",
    approval: "审批卡",
    error: "错误",
  };
  const other = parts[0];
  return other === undefined ? "" : labels[other.type] ?? other.type;
}

export interface ChatStoreOptions {
  now?: () => Date;
}

export class ChatStore {
  readonly root: string;
  private readonly clock: () => Date;
  private readonly conversations = new Map<string, ChatConversation>();
  private memories: ChatMemoryEntry[] = [];
  private convSeq = 0;
  private memSeq = 0;

  constructor(root: string, options: ChatStoreOptions = {}) {
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new ChatError("ChatStore 需要非空 root", "CONFIG", "root");
    }
    this.root = root.trim();
    this.clock = typeof options.now === "function" ? options.now : () => new Date();
    mkdirSync(join(this.root, "conversations"), { recursive: true });
    this.restore();
  }

  // -------------------------------------------------------------------------
  // 会话
  // -------------------------------------------------------------------------

  listConversations(): ChatConversation[] {
    return [...this.conversations.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((conversation) => clone(conversation));
  }

  createConversation(title?: string): ChatConversation {
    const now = this.nowIso();
    const id = this.nextId("conv");
    const normalizedTitle =
      typeof title === "string" && title.trim().length > 0
        ? Array.from(title.trim()).slice(0, MANUAL_TITLE_MAX_CHARS).join("")
        : CHAT_DEFAULT_CONVERSATION_TITLE;
    const conversation: ChatConversation = {
      id,
      title: normalizedTitle,
      created_at: now,
      updated_at: now,
      message_count: 0,
    };
    this.conversations.set(id, conversation);
    this.writeConversation(conversation, []);
    this.writeIndex();
    return clone(conversation);
  }

  getConversation(id: string): ChatConversation | null {
    const key = this.requireId(id, "conversationId");
    const conversation = this.conversations.get(key);
    return conversation === undefined ? null : clone(conversation);
  }

  renameConversation(id: string, title: string): ChatConversation {
    const key = this.requireId(id, "conversationId");
    const conversation = this.conversations.get(key);
    if (conversation === undefined) throw new ChatError(`会话不存在：${key}`, "NOT_FOUND", "conversationId");
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new ChatError("标题不能为空", "INVALID_INPUT", "title");
    }
    conversation.title = Array.from(title.trim()).slice(0, MANUAL_TITLE_MAX_CHARS).join("");
    conversation.updated_at = this.nowIso();
    this.conversations.set(key, conversation);
    const messages = this.readMessages(key);
    this.writeConversation(conversation, messages);
    this.writeIndex();
    return clone(conversation);
  }

  deleteConversation(id: string): boolean {
    const key = this.requireId(id, "conversationId");
    if (!this.conversations.has(key)) return false;
    this.conversations.delete(key);
    const file = this.conversationPath(key);
    try {
      if (existsSync(file)) rmSync(file, { force: true });
    } catch {
      /* 删除文件失败不阻断索引更新 */
    }
    this.writeIndex();
    return true;
  }

  // -------------------------------------------------------------------------
  // 消息
  // -------------------------------------------------------------------------

  listMessages(conversationId: string): ChatMessage[] {
    const key = this.requireConversation(conversationId);
    return clone(this.readMessages(key));
  }

  appendMessage(conversationId: string, message: ChatMessage): void {
    const key = this.requireConversation(conversationId);
    const messages = this.readMessages(key);
    if (messages.some((item) => item.id === message.id)) {
      this.writeMessagePair(key, message, messages);
      return;
    }
    messages.push(clone(message));
    this.writeMessagePair(key, message, messages);
  }

  updateMessage(conversationId: string, message: ChatMessage): void {
    const key = this.requireConversation(conversationId);
    const messages = this.readMessages(key);
    const index = messages.findIndex((item) => item.id === message.id);
    if (index >= 0) messages[index] = clone(message);
    else messages.push(clone(message));
    this.writeMessagePair(key, message, messages);
  }

  // -------------------------------------------------------------------------
  // 长期记忆
  // -------------------------------------------------------------------------

  listMemory(filter: ChatMemoryFilter = {}): ChatMemoryEntry[] {
    const input = isRecord(filter) ? filter : {};
    const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const kind = typeof input.kind === "string" ? input.kind : "";
    const limit =
      typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0 ? input.limit : Number.MAX_SAFE_INTEGER;
    const filtered = this.memories.filter((entry) => {
      if (kind.length > 0 && entry.kind !== kind) return false;
      if (query.length === 0) return true;
      const haystack = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
      return query.split(/\s+/u).every((token) => haystack.includes(token));
    });
    filtered.sort((left, right) => {
      if (right.importance !== left.importance) return right.importance - left.importance;
      return right.created_at.localeCompare(left.created_at);
    });
    return filtered.slice(0, limit).map((entry) => clone(entry));
  }

  addMemory(entry: Omit<ChatMemoryEntry, "id" | "created_at">): ChatMemoryEntry {
    if (!isRecord(entry)) throw new ChatError("记忆条目必须是对象", "INVALID_INPUT", "memory");
    if (typeof entry.kind !== "string" || !MEMORY_KINDS.has(entry.kind)) {
      throw new ChatError("记忆 kind 非法", "INVALID_INPUT", "kind");
    }
    const content = typeof entry.content === "string" ? entry.content.replace(/\s+/gu, " ").trim() : "";
    if (content.length === 0) throw new ChatError("记忆内容不能为空", "INVALID_INPUT", "content");
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const importance: 1 | 2 | 3 = entry.importance === 3 ? 3 : entry.importance === 2 ? 2 : 1;
    const normalized = content.toLowerCase();
    const existing = this.memories.find((item) => item.content.toLowerCase() === normalized);
    if (existing !== undefined) {
      const mergedTags = [...new Set([...existing.tags, ...tags])];
      existing.tags = mergedTags;
      existing.importance = Math.max(existing.importance, importance) as 1 | 2 | 3;
      this.writeMemory();
      return clone(existing);
    }
    const created: ChatMemoryEntry = {
      id: this.nextId("mem"),
      kind: entry.kind,
      content,
      tags,
      importance,
      created_at: this.nowIso(),
      ...(typeof entry.source === "string" && entry.source.length > 0 ? { source: entry.source } : {}),
    };
    this.memories.push(created);
    this.writeMemory();
    return clone(created);
  }

  deleteMemory(id: string): boolean {
    const key = this.requireId(id, "memoryId");
    const index = this.memories.findIndex((entry) => entry.id === key);
    if (index < 0) return false;
    this.memories.splice(index, 1);
    this.writeMemory();
    return true;
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private nowIso(): string {
    return nowIsoOf(this.clock);
  }

  private nextId(prefix: "conv" | "mem"): string {
    const stamp = this.nowIso().replace(/[-:TZ.]/gu, "").slice(0, 14);
    if (prefix === "conv") {
      this.convSeq += 1;
      return `conv-${stamp}-${String(this.convSeq).padStart(4, "0")}`;
    }
    this.memSeq += 1;
    return `mem-${stamp}-${String(this.memSeq).padStart(4, "0")}`;
  }

  private requireId(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ChatError(`${field} 不能为空`, "INVALID_INPUT", field);
    }
    return value.trim();
  }

  private requireConversation(conversationId: unknown): string {
    const key = this.requireId(conversationId, "conversationId");
    if (!this.conversations.has(key)) throw new ChatError(`会话不存在：${key}`, "NOT_FOUND", "conversationId");
    return key;
  }

  private indexFile(): string {
    return join(this.root, "index.json");
  }

  private memoryFile(): string {
    return join(this.root, "memory.json");
  }

  private conversationPath(id: string): string {
    return join(this.root, "conversations", `${id}.json`);
  }

  private readMessages(conversationId: string): ChatMessage[] {
    const parsed = readJson(this.conversationPath(conversationId));
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return [];
    return parsed.messages.filter((message): message is ChatMessage => isRecord(message) && typeof message.id === "string");
  }

  private writeMessagePair(conversationId: string, lastTouched: ChatMessage, messages: ChatMessage[]): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) return;
    conversation.message_count = messages.length;
    conversation.last_message = summarizeMessage(lastTouched);
    conversation.updated_at = typeof lastTouched.at === "string" ? lastTouched.at : this.nowIso();
    this.conversations.set(conversationId, conversation);
    this.writeConversation(conversation, messages);
    this.writeIndex();
  }

  private writeConversation(conversation: ChatConversation, messages: ChatMessage[]): void {
    atomicWrite(
      this.conversationPath(conversation.id),
      `${JSON.stringify({ version: 1, conversation, messages }, null, 2)}\n`,
    );
  }

  private writeIndex(): void {
    const payload = {
      version: 1,
      generated_at: this.nowIso(),
      conversations: [...this.conversations.values()].sort((left, right) =>
        right.updated_at.localeCompare(left.updated_at),
      ),
    };
    atomicWrite(this.indexFile(), `${JSON.stringify(payload, null, 2)}\n`);
  }

  private writeMemory(): void {
    const payload = { version: 1, generated_at: this.nowIso(), memories: this.memories };
    atomicWrite(this.memoryFile(), `${JSON.stringify(payload, null, 2)}\n`);
  }

  private restore(): void {
    const index = readJson(this.indexFile());
    if (isRecord(index) && Array.isArray(index.conversations)) {
      for (const item of index.conversations) {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") continue;
        const conversation: ChatConversation = {
          id: item.id,
          title: item.title,
          created_at: typeof item.created_at === "string" ? item.created_at : this.nowIso(),
          updated_at: typeof item.updated_at === "string" ? item.updated_at : this.nowIso(),
          message_count: typeof item.message_count === "number" ? item.message_count : 0,
          ...(typeof item.last_message === "string" ? { last_message: item.last_message } : {}),
          ...(typeof item.status === "string" ? { status: item.status } : {}),
        };
        this.conversations.set(conversation.id, conversation);
      }
    }
    const memory = readJson(this.memoryFile());
    if (isRecord(memory) && Array.isArray(memory.memories)) {
      for (const item of memory.memories) {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") continue;
        if (typeof item.kind !== "string" || !MEMORY_KINDS.has(item.kind)) continue;
        this.memories.push({
          id: item.id,
          kind: item.kind as ChatMemoryEntry["kind"],
          content: item.content,
          tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
          importance: item.importance === 3 ? 3 : item.importance === 2 ? 2 : 1,
          created_at: typeof item.created_at === "string" ? item.created_at : this.nowIso(),
          ...(typeof item.source === "string" ? { source: item.source } : {}),
        });
      }
    }
  }
}
