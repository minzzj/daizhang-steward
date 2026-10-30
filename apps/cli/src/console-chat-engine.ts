/**
 * v1.5.1：控制台真实对话总控 Provider。
 * ConsoleChatProvider ← ChatEngine（steward-chat）+ 真实 ChatTools（RunManager/System/Config/Money/Harness）。
 */
import { join } from "node:path";
import { ChatEngine, type ChatConversation, type ChatMessage, type ChatPart } from "../../../packages/steward-chat/src/index.js";
import type {
  ConsoleChatConversation,
  ConsoleChatEngineProvider,
  ConsoleChatMemory,
  ConsoleChatMessage,
  ConsoleChatPart,
  ConsoleChatStatus,
} from "../../../packages/steward-console/src/index.js";
import { createRealChatTools } from "./chat-tools.js";
import { readHarnessArtifact, sanitizeLocalPaths } from "./harness-data.js";

export interface RealConsoleChatOptions {
  root: string;
  harnessTokenLimit?: number;
  harnessTimeoutMs?: number;
}

interface ArtifactLike {
  id?: string;
  title?: string;
  kind?: string;
  size?: number;
  agent_role?: string;
  step?: number;
  run_id?: string;
  session_id?: string;
  rel_path?: string;
  preview_text?: string;
  preview_url?: string;
  download_url?: string;
}

export function createRealConsoleChatEngineProvider(options: RealConsoleChatOptions): ConsoleChatEngineProvider {
  const root = options.root;
  const runsRoot = join(root, "runs");
  const real = createRealChatTools({
    root,
    ...(options.harnessTokenLimit !== undefined ? { harnessTokenLimit: options.harnessTokenLimit } : {}),
    ...(options.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: options.harnessTimeoutMs } : {}),
  });
  const chat = new ChatEngine({ tools: real.tools, root: join(root, ".steward", "chat"), dshEnabled: true });

  const toConversation = (conversation: ChatConversation): ConsoleChatConversation => ({
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    message_count: conversation.message_count,
    ...(conversation.last_message ? { last_message: conversation.last_message } : {}),
  });

  const toConsolePart = (part: ChatPart): ConsoleChatPart => {
    switch (part.type) {
      case "artifact": {
        const artifact = part.artifact as ArtifactLike;
        let previewText = artifact.preview_text ?? "";
        let relPath = artifact.rel_path ?? "";
        let kind = artifact.kind ?? "text";
        if (artifact.id) {
          const content = readHarnessArtifact(runsRoot, artifact.id);
          if (content.ok && content.content !== undefined && content.kind !== "image") {
            previewText = sanitizeLocalPaths(content.content).slice(0, 24_000);
          }
          if (relPath === "") relPath = artifact.id.slice(artifact.id.indexOf("::") + 2);
          if (kind === "other" && content.ok) kind = content.kind;
        }
        return {
          type: "artifact",
          artifact: {
            ...artifact,
            kind,
            rel_path: relPath,
            preview_text: previewText,
            demo: false,
          },
        } as ConsoleChatPart;
      }
      case "report":
        return { type: "report", report: part.report } as ConsoleChatPart;
      case "data":
        return {
          type: "data",
          kind: part.data.title,
          data: {
            rows: part.data.items.map((item) => ({ 项目: item.label, 值: item.value })),
          },
        } as ConsoleChatPart;
      case "thinking":
        return { type: "thinking", text: part.text } as ConsoleChatPart;
      case "tool_call":
        return { type: "tool_call", tool: part.tool, input: JSON.stringify(part.input ?? {}).slice(0, 300), callId: `chat-${Date.now()}`, status: "running" } as ConsoleChatPart;
      case "tool_result":
        return { type: "tool_result", tool: part.tool, callId: `chat-${Date.now()}`, status: part.ok ? "ok" : "error", result_preview: sanitizeLocalPaths(part.summary).slice(0, 400) } as ConsoleChatPart;
      case "approval":
        return {
          type: "approval",
          approval_id: `approval:${part.approval.run_id}:${part.approval.step}`,
          run_id: part.approval.run_id,
          step: part.approval.step,
          risk: part.approval.risk,
          summary: part.approval.summary,
          ...(part.approval.reason ? { reason: part.approval.reason } : {}),
        } as ConsoleChatPart;
      case "error":
        return { type: "error", message: part.message } as ConsoleChatPart;
      case "markdown":
        return { type: "markdown", markdown: part.markdown, ...(part.title ? { title: part.title } : {}) } as ConsoleChatPart;
      default:
        return { type: "text", markdown: part.text } as ConsoleChatPart;
    }
  };

  const toMessage = (message: ChatMessage): ConsoleChatMessage => ({
    id: message.id,
    role: message.role === "system" ? "system" : message.role,
    at: message.at,
    parts: message.parts.map(toConsolePart),
    ...(message.summary ? { summary: message.summary } : {}),
    ...(message.status ? { status: message.status } : {}),
  });

  const stat = (): ConsoleChatStatus => {
    const runs = real.manager.listRuns();
    return {
      runs_active: runs.filter((run) => run.status === "running" || run.status === "queued").length,
      awaiting_approval: runs.filter((run) => run.status === "awaiting_approval" || run.status === "paused").length,
      conversations: chat.listConversations().length,
      memories: chat.listMemory().length,
      data_source: "real",
    };
  };

  const provider: ConsoleChatEngineProvider = {
    listConversations: () => chat.listConversations().map(toConversation),
    createConversation: (title) => toConversation(chat.createConversation(title)),
    getConversation: (id) => {
      const detail = chat.getConversation(id);
      if (detail === null) return null;
      return { conversation: toConversation(detail.conversation), messages: detail.messages.map(toMessage) };
    },
    renameConversation: (id, title) => {
      try {
        return toConversation(chat.renameConversation(id, title));
      } catch {
        return null;
      }
    },
    deleteConversation: (id) => chat.deleteConversation(id),
    sendMessage: async (conversationId, text) => {
      const result = await chat.send(conversationId, text);
      return { user: toMessage(result.userMessage), assistant: toMessage(result.assistantMessage) };
    },
    streamMessage: (conversationId, text, onPart, _sinceSeq) => {
      let cancelled = false;
      void (async () => {
        try {
          const result = await chat.send(conversationId, text, (part: ChatPart) => {
            if (cancelled) return;
            onPart(toConsolePart(part), toMessage({ id: "pending", conversation_id: conversationId, role: "assistant", at: new Date().toISOString(), parts: [], status: "streaming" }));
          });
          if (!cancelled) onPart({ type: "_done" } as unknown as ConsoleChatPart, toMessage(result.assistantMessage));
        } catch (error) {
          if (!cancelled) {
            onPart({ type: "error", message: error instanceof Error ? error.message : String(error) } as unknown as ConsoleChatPart, toMessage({ id: "error", conversation_id: conversationId, role: "assistant", at: new Date().toISOString(), parts: [], status: "error" }));
            onPart({ type: "_done" } as unknown as ConsoleChatPart, toMessage({ id: "error", conversation_id: conversationId, role: "assistant", at: new Date().toISOString(), parts: [], status: "error" }));
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    },
    listMemory: (query) => chat.listMemory(query ? { query } : {}).map((memory): ConsoleChatMemory => ({ ...memory })),
    deleteMemory: (id) => chat.deleteMemory(id),
    status: stat,
    decideApproval: async (_conversationId, approvalId, decision) => {
      const match = /^approval:(.+):(\d+)$/.exec(approvalId);
      if (match === null) return false;
      const runId = match[1] ?? "";
      const step = Number(match[2] ?? 0);
      if (runId.length === 0 || !Number.isFinite(step)) return false;
      try {
        await real.manager.approve(runId, step, decision, "human:console");
        return true;
      } catch {
        return false;
      }
    },
  };
  return provider;
}
