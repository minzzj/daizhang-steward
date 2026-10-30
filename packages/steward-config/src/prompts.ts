/**
 * 专业系统提示词与 Harness 提示词组合（v1.2 / v1.5）。
 *
 * - 默认 11 篇 `system_prompts` = `prompts/v3/<role>.md`（version 3.0.0，已内嵌于 `./prompts-v3.ts`）；
 * - `DEFAULT_CONDUCTOR_PROMPT` = `prompts/v3/conductor.md`；
 * - `HARNESS_AGENT_DIRECTIVE`：简短统一执行指令（v3 原文已含详细条款，此处只做叠加，避免重复过重）；
 * - `composeHarnessPrompt(role)` = v3 角色文本 + 短指令 + 角色专属产物要求 + 完成判定；
 * - `buildDefaultSystemPrompts` / `buildDefaultOrchestratorSettings` 供配置中心默认值使用。
 *
 * 提示词是运行时配置（不是代码），用户可在配置中心/控制台修改，修改会写审计（不记录密钥）。
 */

import { PROMPT_V3_UPDATED_AT, PROMPT_V3_VERSION, V3_SYSTEM_PROMPTS, type PromptV3Entry } from "./prompts-v3.js";
import type { OrchestratorSettings, RunMode, SystemPromptConfig } from "./types.js";

export { PROMPT_V3_UPDATED_AT, PROMPT_V3_VERSION };
export type { PromptV3Entry };

/** 默认提示词覆盖的角色（supervisor + conductor + 9 专项 agent，共 11 个）。 */
export const SYSTEM_PROMPT_ROLES = [
  "supervisor",
  "conductor",
  "operator",
  "harness",
  "customer",
  "finance",
  "reviewer",
  "backend",
  "scout",
  "content",
  "research",
] as const;

export type SystemPromptRole = (typeof SYSTEM_PROMPT_ROLES)[number];

/** 安全检查关键词：提示词应至少涉及其中若干项（软校验，不阻断合法修改）。 */
export const PROMPT_SAFETY_KEYWORDS = ["证据", "审批", "不越界", "失败升级", "人工", "超时"] as const;

export function hasSafetyKeyword(prompt: string): boolean {
  return PROMPT_SAFETY_KEYWORDS.some((keyword) => prompt.includes(keyword));
}

/** 提示词文本校验（长度 ≥20；可选要求含安全关键词）。 */
export function validateSystemPromptText(prompt: string, options: { requireSafetyKeywords?: boolean } = {}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (text === "") errors.push("系统提示词不能为空");
  else if ([...text].length < 20) errors.push("系统提示词过短（至少 20 个字符）");
  if (options.requireSafetyKeywords === true && text !== "" && !hasSafetyKeyword(text)) {
    errors.push(`系统提示词应包含安全条款关键词（${PROMPT_SAFETY_KEYWORDS.join("/")} 至少一项）`);
  }
  return { ok: errors.length === 0, errors };
}

/** 取 v3 角色条目；未知角色抛错（角色以 v3 11 篇为准）。 */
function v3Entry(role: string): PromptV3Entry {
  const entry = V3_SYSTEM_PROMPTS[role];
  if (entry === undefined) {
    throw new Error(`未知系统提示词角色：${role}（可用：${SYSTEM_PROMPT_ROLES.join("/")}）`);
  }
  return entry;
}

/** 总调度核心系统提示词 = prompts/v3/conductor.md（v3.0.0）。 */
export const DEFAULT_CONDUCTOR_PROMPT = v3Entry("conductor").system_prompt;

/**
 * 统一的 Harness 执行指令（v1.5，**简短叠加**）：v3 角色原文已包含工具/产物/report.md/证据/
 * 确认/失败升级等详细条款，这里只补充运行器需要强制执行的统一约束，避免重复过重。
 */
export const HARNESS_AGENT_DIRECTIVE = [
  "## Harness 统一执行指令（v1.5）",
  "1. 必须真实使用工具执行（read/write/edit/bash/test/web_search 等），不得只输出计划，也不得声称未执行过的操作。",
  "2. 所有产物落盘到本角色工作区 workspace（相对 runDir）并写 `report.md`；report.md 必须给出证据（命令/退出码/日志/截图路径/文件 hash）。",
  "3. 危险动作交人：支付/退款/合同/账号权限/删除/部署默认拒绝或只出草稿，必须人工审批或二次确认，审批/确认缺失或超时即挂起。",
  "4. 不越界、不碰系统关键路径/安全策略/审计/密钥；未知 ≠ 成功，失败最多两轮后失败升级人工。",
].join("\n");

/** 各角色专属 Harness 产物要求（写入 report.md 并落盘；v3 原文已含产物方向，此处给验收清单）。 */
const HARNESS_ROLE_ARTIFACTS: Record<string, string[]> = {
  supervisor: [
    "**系统级产物**：系统动作执行记录、审计 JSONL 证据（audit_id）、受管清单快照、回滚/备份路径（backup_path）、危险动作二次确认记录。",
  ],
  conductor: [
    "**编排产物**：项目计划（步骤/负责角色/预算/依赖）、派发记录、验收结论与证据清单（覆盖率：完整/部分/未收录）、升级请求。",
  ],
  operator: [
    "**执行产物**：真实浏览器/桌面操作产出（HTML 存档、页面截图、DOM/窗口快照、下载文档），每步截图 + 时间戳 + 操作日志。",
  ],
  harness: [
    "**代码产物**：`patch.diff`（unified_diff）、`test.log`（真实测试命令/退出码/关键输出）、CodeResult（patch/summary/tests_run/risks/uncovered）、隔离 worktree 路径。",
  ],
  customer: [
    "**沟通产物**：客户消息草稿（待人工确认后发送）、对话摘要、待确认点清单、客户问题与事实依据。",
  ],
  finance: [
    "**财务产物**：账本条目（金额/收付方/依据/审批人/回执/项目 6 要素）、收款草稿、开票草稿与预算说明。",
  ],
  reviewer: [
    "**核查产物**：review 报告（结论：通过/退回）、证据链核对明细、越界/风险清单、未知项标注（不臆测通过）。",
  ],
  backend: [
    "**运维产物**：数据备份/清理统计报告（文件数/字节数/路径）、日志轮转记录、健康检查输出与恢复步骤。",
  ],
  scout: [
    "**线索产物**：线索评分报告（source_url/signal/consent_basis）、外联草稿（只起草不发送）、来源与合规依据。",
  ],
  content: [
    "**内容产物**：内容草稿（文案/素材/排版）、事实与来源核对清单、发布前人工审阅点与风险标注。",
  ],
  research: [
    "**调研产物**：调研报告（结论/来源 URL/访问时间/置信度）、事实与推断区分、未覆盖问题清单。",
  ],
};

/** 取某角色的 Harness 产物要求文本。 */
export function harnessArtifactRequirement(role: string): string | undefined {
  const lines = HARNESS_ROLE_ARTIFACTS[role];
  return lines === undefined ? undefined : lines.join("\n");
}

/** 默认的 11 份专业系统提示词（v3 原文，updated_at 固定为 v3 更新时间，便于持久化稳定比较）。 */
export function buildDefaultSystemPrompts(now: Date = new Date()): SystemPromptConfig[] {
  void now; // 保留参数兼容旧调用；v3 用固定更新时间，避免每次生成漂移
  return SYSTEM_PROMPT_ROLES.map((role) => {
    const entry = v3Entry(role);
    return {
      role,
      title: entry.title,
      system_prompt: entry.system_prompt,
      updated_at: PROMPT_V3_UPDATED_AT,
    };
  });
}

/** 总调度核心设置默认值（auto_plan/max_steps/ask_before_commit 按运行模式微调）。 */
export function buildDefaultOrchestratorSettings(mode: RunMode, now: Date = new Date()): OrchestratorSettings {
  return {
    conductor_prompt: DEFAULT_CONDUCTOR_PROMPT,
    system_prompts: buildDefaultSystemPrompts(now),
    auto_plan: true,
    max_steps_per_run: mode === "demo" ? 10 : mode === "enterprise" ? 50 : 20,
    ask_before_commit: true,
  };
}

/**
 * 组合 Harness 提示词 = v3 角色原文 + 简短统一指令 + 角色专属产物要求 + 完成判定。
 * 供运行时创建真实 Harness agent 时使用；未知角色抛错。
 */
export function composeHarnessPrompt(role: string): string {
  const entry = v3Entry(role);
  const artifact = harnessArtifactRequirement(role) ?? "产物写入工作区并写 report.md（含证据路径）。";
  return [
    entry.system_prompt,
    "",
    HARNESS_AGENT_DIRECTIVE,
    "",
    "## 角色专属产物要求（v1.5 Harness）",
    artifact,
    "",
    "## 完成判定（v1.5）",
    "只有「真实工具执行 + 产物已落盘 workspace + report.md 含证据 + 验收标准逐条通过」才算完成；否则为未通过或未知，并写明下一步与升级对象。",
  ].join("\n");
}
