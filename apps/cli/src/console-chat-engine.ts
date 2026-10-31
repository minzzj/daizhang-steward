/**
 * v1.5.1/1.5.2：控制台真实对话总控 Provider。
 * ConsoleChatProvider ← ChatEngine（steward-chat）+ 真实 ChatTools（RunManager/System/Config/Money/Harness）。
 *
 * v1.5.2：消息分相（思考过程折叠 / 最终结果可见）；审批闭环（run 审批继续执行、系统动作 plan→确认→执行）。
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
import { harnessMetrics, readHarnessArtifact, sanitizeLocalPaths } from "./harness-data.js";

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
    const base: ConsoleChatPart = part.phase === undefined ? { type: part.type } : { type: part.type, phase: part.phase };
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
        return { ...base, type: "artifact", artifact: { ...artifact, kind, rel_path: relPath, preview_text: previewText, demo: false } };
      }
      case "report":
        return { ...base, type: "report", report: part.report };
      case "data":
        return {
          ...base,
          type: "data",
          kind: part.data.title,
          data: { rows: part.data.items.map((item) => ({ 项目: item.label, 值: item.value })) },
        };
      case "thinking":
        return { ...base, type: "thinking", text: part.text };
      case "tool_call":
        return {
          ...base,
          type: "tool_call",
          tool: part.tool,
          input: JSON.stringify(part.input ?? {}).slice(0, 300),
          callId: part.callId ?? `call-${Date.now()}`,
          status: part.status ?? "running",
          ...(part.result_preview ? { result_preview: part.result_preview } : {}),
          ...(part.duration_ms !== undefined ? { duration_ms: part.duration_ms } : {}),
        };
      case "tool_result":
        return {
          ...base,
          type: "tool_result",
          tool: part.tool,
          callId: part.callId ?? `call-${Date.now()}`,
          status: part.ok ? "ok" : "error",
          result_preview: sanitizeLocalPaths(part.summary).slice(0, 400),
          ...(part.duration_ms !== undefined ? { duration_ms: part.duration_ms } : {}),
        };
      case "approval":
        return {
          ...base,
          type: "approval",
          approval_id: `approval:${part.approval.run_id}:${part.approval.step}`,
          run_id: part.approval.run_id,
          step: part.approval.step,
          risk: part.approval.risk,
          summary: part.approval.summary,
          ...(part.approval.reason ? { reason: part.approval.reason } : {}),
        };
      case "error":
        return { ...base, type: "error", message: part.message };
      case "markdown":
        return { ...base, type: "markdown", markdown: part.markdown, ...(part.title ? { title: part.title } : {}) };
      default:
        return { ...base, type: "text", markdown: part.text };
    }
  };

  const toMessage = (message: ChatMessage): ConsoleChatMessage => ({
    id: message.id,
    role: message.role === "system" ? "system" : message.role,
    at: message.at,
    parts: message.parts.map(toConsolePart),
    ...(message.summary ? { summary: message.summary } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.result_text ? { result_text: message.result_text } : {}),
    ...(message.thinking_summary ? { thinking_summary: message.thinking_summary } : {}),
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

  /** 审批通过后：追加一条对话消息并订阅 Run 的后续进展，继续在对话里汇报。 */
  const continueRunInChat = (conversationId: string, runId: string, step: number): void => {
    void (async () => {
      try {
        await chat.appendAssistantMessage(conversationId, [
          { type: "text", text: `✅ 已批准 ${runId} 第 ${step} 步，Run 继续执行，进展会继续出现在这里。` },
        ]);
        const unsubscribe = real.manager.subscribeRun(runId, (event) => {
          if (event.type !== "run.completed" && event.type !== "run.failed" && event.type !== "run.blocked" && event.type !== "run.paused") return;
          unsubscribe();
          void (async () => {
            try {
              const record = real.manager.getRun(runId);
              const sessionId = record?.session_id;
              const parts: ChatPart[] = [];
              if (event.type === "run.completed") parts.push({ type: "text", text: `✅ Run ${runId} 已执行完成。` });
              else if (event.type === "run.paused") parts.push({ type: "text", text: `⏸ Run ${runId} 又遇到需要审批的步骤，请查看审批卡。` });
              else parts.push({ type: "error", message: `Run ${runId} 未成功（${event.type}）。` });
              if (sessionId !== undefined) {
                const metrics = harnessMetrics(runsRoot, sessionId);
                if (metrics !== null) {
                  parts.push({ type: "data", data: { title: "执行数据", items: [
                    { label: "Token 总计", value: metrics.token_total.toLocaleString("zh-CN") },
                    { label: "工具调用", value: String(metrics.tool_calls) },
                    { label: "步骤", value: String(metrics.steps) },
                  ] } });
                }
              }
              await chat.appendAssistantMessage(conversationId, parts);
            } catch { /* 后台汇报失败不影响主流程 */ }
          })();
        });
      } catch { /* 审批后续消息失败不影响审批结果 */ }
    })();
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
      const pendingMessage: ChatMessage = { id: "pending", conversation_id: conversationId, role: "assistant", at: new Date().toISOString(), parts: [], status: "streaming" };
      void (async () => {
        try {
          const result = await chat.send(conversationId, text, (part: ChatPart) => {
            if (cancelled) return;
            onPart(toConsolePart(part), toMessage(pendingMessage));
          });
          if (!cancelled) onPart({ type: "_done" } as unknown as ConsoleChatPart, toMessage(result.assistantMessage));
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : String(error);
            onPart({ type: "error", message } as unknown as ConsoleChatPart, toMessage(pendingMessage));
            onPart({ type: "_done" } as unknown as ConsoleChatPart, toMessage(pendingMessage));
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
    decideApproval: async (conversationId, approvalId, decision) => {
      const match = /^approval:(.+):(\d+)$/.exec(approvalId);
      if (match === null) return false;
      const runId = match[1] ?? "";
      const step = Number(match[2] ?? 0);
      if (runId.length === 0 || !Number.isFinite(step)) return false;
      if (runId.startsWith("system:")) {
        const outcome = await real.confirmSystemAction(runId, decision);
        try {
          await chat.appendAssistantMessage(conversationId, [
            { type: "text", text: outcome.summary },
            ...outcome.parts,
          ]);
        } catch { /* ignore */ }
        return outcome.ok;
      }
      try {
        await real.manager.approve(runId, step, decision, "human:console");
        if (decision === "approve") continueRunInChat(conversationId, runId, step);
        else {
          try {
            await chat.appendAssistantMessage(conversationId, [{ type: "text", text: `⛔ 已驳回 ${runId} 第 ${step} 步，Run 不会继续该步骤。` }]);
          } catch { /* ignore */ }
        }
        return true;
      } catch {
        return false;
      }
    },
  };
  return provider;
}
