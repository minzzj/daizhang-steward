/**
 * v1.5.1：`steward ai` —— 对话式 AI 总控 CLI（真实 ChatTools + ChatEngine）。
 *
 * 用法：
 *   steward ai "系统现在怎么样"
 *   steward ai --conversation <id> "把最新报告给我看"
 *   steward ai --history
 *   steward ai --memory [查询词]
 *   steward ai --delete-memory <id>
 */
import { ChatEngine, type ChatConversation, type ChatMemoryEntry, type ChatPart } from "../../../packages/steward-chat/src/index.js";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { createRealChatTools } from "./chat-tools.js";

interface AiParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

interface AiOptions {
  action: "send" | "history" | "memory" | "delete-memory";
  conversation?: string;
  query?: string;
  text: string;
  json: boolean;
}

const stringFlag = (flags: Record<string, string | boolean>, name: string): string | undefined => {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
};

export function parseAiOptions(parsed: AiParsedArgs): AiOptions {
  const flags = parsed.flags;
  const action = flags["history"] ? "history" : flags["memory"] !== undefined ? "memory" : flags["delete-memory"] !== undefined ? "delete-memory" : "send";
  const json = flags["json"] === true;
  const conversation = stringFlag(flags, "conversation");
  const memoryQuery = stringFlag(flags, "memory");
  const deleteMemory = stringFlag(flags, "delete-memory");
  return {
    action,
    ...(conversation ? { conversation } : {}),
    ...(memoryQuery ? { query: memoryQuery } : {}),
    ...(action === "delete-memory" && deleteMemory ? { query: deleteMemory } : {}),
    text: parsed.positionals.join(" ").trim(),
    json,
  };
}

function printPart(part: ChatPart): void {
  switch (part.type) {
    case "text":
      console.log(`\n🤖 ${part.text}`);
      break;
    case "markdown":
      console.log(`\n📄 ${part.title ?? "内容"}：\n${part.markdown}`);
      break;
    case "thinking":
      console.log(`\n💭 ${part.text.slice(0, 800)}`);
      break;
    case "tool_call":
      console.log(`\n🔧 调用工具：${part.tool} ${JSON.stringify(part.input ?? {})}`);
      break;
    case "tool_result":
      console.log(`\n📎 工具结果（${part.tool}）：${part.summary}`);
      break;
    case "artifact":
      console.log(`\n📦 产物：${part.artifact.title}（${part.artifact.kind}，${part.artifact.size}B）`);
      break;
    case "report":
      console.log(`\n📝 报告：${part.report.title}\n${part.report.markdown.slice(0, 1500)}`);
      break;
    case "data":
      console.log(`\n📊 ${part.data.title}`);
      for (const item of part.data.items) console.log(`   ${item.label}: ${item.value}`);
      break;
    case "approval":
      console.log(`\n🔔 需要人工确认（${part.approval.risk}）：${part.approval.summary}`);
      console.log(`   批准请回复：steward ai "批准 ${part.approval.run_id} 第 ${part.approval.step} 步"`);
      break;
    case "error":
      console.log(`\n❌ ${part.message}`);
      break;
  }
}

function printConversations(conversations: ChatConversation[]): void {
  if (conversations.length === 0) {
    console.log("还没有对话。直接运行：steward ai \"系统现在怎么样\"");
    return;
  }
  console.log("对话历史：");
  for (const conversation of conversations) {
    console.log(`  ${conversation.id}  ${conversation.title}  (${conversation.message_count} 条，更新 ${conversation.updated_at})`);
  }
  console.log("用法：steward ai --conversation <id> \"你的问题\"");
}

function printMemories(memories: ChatMemoryEntry[]): void {
  if (memories.length === 0) {
    console.log("长期记忆为空；对话/执行后会自动积累记忆。");
    return;
  }
  console.log("长期记忆：");
  for (const memory of memories) console.log(`  ${memory.id}  [${memory.kind}] ${memory.content}（重要度 ${memory.importance}）`);
}

export async function cmdAi(parsed: AiParsedArgs): Promise<number> {
  const root = findRepoRoot(process.cwd());
  const options = parseAiOptions(parsed);
  const real = createRealChatTools({ root });
  const chat = new ChatEngine({ tools: real.tools, root: root + "/.steward/chat" });
  if (options.action === "history") {
    printConversations(chat.listConversations());
    return 0;
  }
  if (options.action === "memory") {
    printMemories(chat.listMemory(options.query ? { query: options.query } : {}));
    return 0;
  }
  if (options.action === "delete-memory") {
    const deleted = options.query ? chat.deleteMemory(options.query) : false;
    if (options.json) console.log(JSON.stringify({ ok: deleted, id: options.query }, null, 2));
    else console.log(deleted ? `已删除记忆 ${options.query}` : `记忆不存在：${options.query}`);
    return deleted ? 0 : 1;
  }
  if (options.text.length === 0) {
    console.error("用法：steward ai \"你的问题\"（或 --history / --memory / --conversation <id>）");
    return 1;
  }
  let conversation = options.conversation ? chat.getConversation(options.conversation)?.conversation ?? null : null;
  if (conversation === null) {
    conversation = chat.createConversation(options.text.slice(0, 20));
    if (!options.json) console.log(`新对话：${conversation.id}`);
  } else if (!options.json) {
    console.log(`继续对话：${conversation.id}（${conversation.title}）`);
  }
  if (!options.json) console.log(`你：${options.text}`);
  if (options.json) {
    const parts: ChatPart[] = [];
    const result = await chat.send(conversation.id, options.text, (part) => {
      parts.push(part);
    });
    console.log(JSON.stringify({ ok: true, conversation_id: conversation.id, assistant: result.assistantMessage, parts }, null, 2));
    return 0;
  }
  await chat.send(conversation.id, options.text, (part) => printPart(part));
  console.log("");
  return 0;
}
