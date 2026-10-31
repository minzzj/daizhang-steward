/**
 * 意图识别（纯规则、0 token）：中文关键词/句式 → 18 类意图（≥15 类要求）。
 *
 * 顺序即优先级：记忆 > 审批 > 危险动作 > 报告内容 > 产物预览 > 报告 > 指标 > 日志 > 配置 >
 * 账本 > 智能体 > 系统 > 产物 > run 详情 > run 列表 > 项目执行 > harness 小任务 > 闲聊。
 * 无法确定 → `chat`（闲聊 + 建议，不调模型）。
 */

import type { ChatClassification, ChatEntities, ChatIntent } from "./types.js";

interface IntentRule {
  intent: ChatIntent;
  confidence: number;
  test: RegExp;
}

const RULES: readonly IntentRule[] = [
  // 1) 记忆（含"记住/还记得/我的偏好/忘掉/删除记忆"）
  {
    intent: "memory",
    confidence: 0.9,
    test: /(记住|记一下|记下|还记得|你还记得|回忆一下|记忆里|我的偏好|之前说过|之前提到|忘掉|删除记忆)/u,
  },
  // 2) 审批（"批准/驳回 run-x 第 n 步"）
  {
    intent: "approve",
    confidence: 0.88,
    test: /^(请)?(批准|同意|通过|驳回|拒绝)|(批准|驳回|拒绝).{0,14}(步骤|审批|run|卡|申请)/u,
  },
  // 3) 危险动作（删程序/插件、付款/转账、签约、对外发布/发送）
  {
    intent: "danger_action",
    confidence: 0.9,
    test: /(删除|删掉|卸载|移除|停用|禁用).{0,10}(程序|应用|插件|服务)|(付款|支付|转账|打款|签约|合同签署|对外发布|发布到|发给客户|发送给客户|外发|授权)/u,
  },
  // 4) 报告内容
  {
    intent: "report_content",
    confidence: 0.86,
    test: /报告.{0,8}(内容|全文|详情)|(打开|查看|看看|读一下|读取|展示).{0,8}报告/u,
  },
  // 5) 产物预览
  {
    intent: "artifact_preview",
    confidence: 0.86,
    test: /(预览|打开|查看|看一下|查看详情).{0,10}(产物|文件|截图|图片|artifact|附件)|产物详情|附件预览/u,
  },
  // 6) 报告列表
  { intent: "reports", confidence: 0.82, test: /报告|report/iu },
  // 7) 指标 / token
  { intent: "metrics", confidence: 0.8, test: /token|用量|耗时|指标|metrics|性能|统计|成本|花费|预算/iu },
  // 8) 日志 / 审计
  { intent: "logs", confidence: 0.8, test: /日志|审计|log|报错|错误记录|异常记录/iu },
  // 9) 配置
  { intent: "config", confidence: 0.8, test: /配置|设置|密钥|api\s*key|profile|参数|提示词/iu },
  // 10) 账本 / 收款
  { intent: "ledger", confidence: 0.82, test: /账本|收款|收入|支出|账单|财务|ledger|余额|到账/iu },
  // 11) 智能体 / 模型
  { intent: "agents", confidence: 0.8, test: /智能体|agent|模型列表|有哪些模型|角色列表|prompt/iu },
  // 12) 系统状态（程序/插件/服务/资源）
  { intent: "system", confidence: 0.8, test: /系统|健康|运行状况|程序|插件|服务|内存|cpu|磁盘|机器状态/iu },
  // 13) 产物列表
  { intent: "artifacts", confidence: 0.82, test: /产物|交付物|附件|artifact|截图|图片|文件列表/iu },
  // 14) run 详情
  {
    intent: "run_detail",
    confidence: 0.84,
    test: /(run-[a-z0-9-]+).{0,14}(详情|状态|进度|步骤)|(详情|进度|步骤|卡在哪|到哪一步).{0,10}(run|运行|会话|项目)|第\s*[0-9一二三四五六七八九十]+\s*步/iu,
  },
  // 15) run 列表
  {
    intent: "runs",
    confidence: 0.82,
    test: /(run|运行|任务|会话|项目).{0,10}(列表|有哪些|列出来|列出|列一下|看看|状态|历史|几个|在跑|正在|进度|情况)|(列出|查看|看看|最近).{0,8}(run|运行|任务|会话|项目)/iu,
  },
  // 16) 项目类 → 项目执行器（executeGoal）
  {
    intent: "execute_goal",
    confidence: 0.78,
    test: /项目|整个|完整方案|方案|搭建|开发一个|上线|交付|策划|实施|建一个系统|做一个项目/u,
  },
  // 17) 小任务 → DSH harness
  {
    intent: "harness_task",
    confidence: 0.72,
    test: /写个|写一个|写一下|做个|做一个|生成|创建|修复|修一下|改一下|分析|总结|跑一下|执行|代码|脚本|文件|页面|html|表格|文档/iu,
  },
];

/** v1.5.4：智能体角色 + 中文别名（点名发送用）。 */
export const AGENT_ROLE_TITLES: Record<string, string> = {
  supervisor: "系统总控",
  conductor: "项目总调度",
  operator: "办公执行",
  harness: "编码代理",
  customer: "客户沟通",
  finance: "财务",
  reviewer: "核查复核",
  backend: "后台运维",
  scout: "线索发现",
  content: "内容创作",
  research: "调研分析",
};

const AGENT_ALIASES: Record<string, string> = {
  supervisor: "supervisor",
  系统总控: "supervisor",
  超级总调度: "supervisor",
  conductor: "conductor",
  项目总调度: "conductor",
  总调度: "conductor",
  operator: "operator",
  办公执行: "operator",
  harness: "harness",
  编码代理: "harness",
  写代码: "harness",
  customer: "customer",
  客户沟通: "customer",
  finance: "finance",
  财务: "finance",
  reviewer: "reviewer",
  核查: "reviewer",
  审核: "reviewer",
  backend: "backend",
  后台运维: "backend",
  运维: "backend",
  scout: "scout",
  线索: "scout",
  content: "content",
  内容: "content",
  research: "research",
  调研: "research",
};

const AGENT_ROLES = new Set(Object.values(AGENT_ALIASES));
const CJK_ALIAS_ENTRIES = Object.entries(AGENT_ALIASES).filter(([alias]) => /^[\u4e00-\u9fa5]+$/u.test(alias));

function normalizeAgentKey(key: string): string | undefined {
  const trimmed = key.trim().replace(/[：:，,。.!！?？]+$/u, "");
  if (trimmed.length === 0) return undefined;
  const lower = trimmed.toLowerCase();
  if (AGENT_ROLES.has(lower)) return lower;
  const exact = AGENT_ALIASES[trimmed];
  if (exact !== undefined) return exact;
  for (const [alias, role] of CJK_ALIAS_ENTRIES) {
    if (trimmed.includes(alias)) return role;
  }
  return undefined;
}

/** 识别"点名发送"的目标智能体（@role / role: / 点名 X / 让/叫/请 X 去…）。 */
export function detectAgentRole(text: string): string | undefined {
  const raw = typeof text === "string" ? text.trim() : "";
  if (raw.length === 0) return undefined;
  const atStart = /^@([A-Za-z_]{3,})[\s:：,，]*(.*)$/u.exec(raw);
  if (atStart !== null && atStart[1] !== undefined) {
    const role = normalizeAgentKey(atStart[1]);
    if (role !== undefined) return role;
  }
  const atAnywhere = /@([A-Za-z_]{3,})/u.exec(raw);
  if (atAnywhere !== null && atAnywhere[1] !== undefined) {
    const role = normalizeAgentKey(atAnywhere[1]);
    if (role !== undefined) return role;
  }
  const asciiPrefix = /^([A-Za-z_]{3,})[\s:：,，]+/u.exec(raw);
  if (asciiPrefix !== null && asciiPrefix[1] !== undefined) {
    const role = normalizeAgentKey(asciiPrefix[1]);
    if (role !== undefined) return role;
  }
  const cnPrefix = /^([\u4e00-\u9fa5]{2,6})[\s:：,，]+/u.exec(raw);
  if (cnPrefix !== null && cnPrefix[1] !== undefined) {
    const role = normalizeAgentKey(cnPrefix[1]);
    if (role !== undefined) return role;
  }
  const named = /(?:点名|让|叫|请|交给|派给|安排)\s*([A-Za-z_]{3,}|[\u4e00-\u9fa5]{2,6})\s*(?:去|来|帮|处理|执行|做|看一下|看看|干)/u.exec(raw);
  if (named !== null && named[1] !== undefined) {
    const role = normalizeAgentKey(named[1]);
    if (role !== undefined) return role;
  }
  const rolled = /(?:点名|交给|派给)\s*([A-Za-z_]{3,}|[\u4e00-\u9fa5]{2,6})/u.exec(raw);
  if (rolled !== null && rolled[1] !== undefined) {
    const role = normalizeAgentKey(rolled[1]);
    if (role !== undefined) return role;
  }
  return undefined;
}

/** 去掉消息里"@role / role: / 点名 X 去"等前缀，得到真正的任务文本。 */
export function stripAgentPrefix(text: string, role: string): string {
  const raw = typeof text === "string" ? text.trim() : "";
  const names = [role, ...Object.entries(AGENT_ALIASES).filter(([, value]) => value === role).map(([alias]) => alias)];
  let out = raw;
  for (const name of names.sort((left, right) => right.length - left.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\const DANGER_ACTIONS: readonly string[] = ");
    out = out.replace(new RegExp("^@" + escaped + "[\\s:：,，]*", "iu"), "");
    out = out.replace(new RegExp("^" + escaped + "[\\s:：,，]+", "iu"), "");
    out = out.replace(new RegExp("^(?:点名|交给|派给|让|叫|请|安排)\\s*" + escaped + "\\s*(?:去|来|帮|处理|执行|做|看一下|看看|干)?[\\s:：,，]*", "iu"), "");
  }
  out = out.replace(/^(?:去|来|帮|处理|执行|做|看一下|看看|干)\s*/u, "").trim();
  return out.length > 0 ? out : raw;
}

const DANGER_ACTIONS: readonly string[] = ["删除", "卸载", "移除", "停用", "禁用", "付款", "支付", "转账", "打款", "签约", "发布", "外发", "授权"];

/** 只返回契约要求的 {intent, confidence}。 */
export function classifyIntent(text: string): ChatClassification {
  const raw = typeof text === "string" ? text.trim() : "";
  if (raw.length === 0) return { intent: "chat", confidence: 0.1 };
  if (detectAgentRole(raw) !== undefined) return { intent: "agent_direct", confidence: 0.93 };
  for (const rule of RULES) {
    if (rule.test.test(raw)) return { intent: rule.intent, confidence: rule.confidence };
  }
  return { intent: "chat", confidence: 0.35 };
}

/** 分类 + 实体抽取（引擎路由参数用）。 */
export function analyzeIntent(text: string): ChatClassification & { entities: ChatEntities } {
  const raw = typeof text === "string" ? text.trim() : "";
  const classification = classifyIntent(raw);
  const entities: ChatEntities = {};
  const detectedRole = detectAgentRole(raw);
  if (detectedRole !== undefined) entities.agent_role = detectedRole;
  const runMatch = /((?:run-|system:)[A-Za-z0-9-]{3,})/u.exec(raw);
  if (runMatch?.[1] !== undefined) entities.run_id = runMatch[1];
  const stepMatch = /第\s*(\d+)\s*步|步骤\s*(\d+)/u.exec(raw);
  const stepValue = stepMatch?.[1] ?? stepMatch?.[2];
  if (stepValue !== undefined) {
    const step = Number.parseInt(stepValue, 10);
    if (Number.isFinite(step) && step >= 0) entities.step = step;
  }
  if (entities.run_id !== undefined && entities.run_id.startsWith("system:") && entities.step === undefined) entities.step = 0;
  const artifactMatch = /(art-[A-Za-z0-9-]{1,})/u.exec(raw);
  if (artifactMatch?.[1] !== undefined) entities.artifact_id = artifactMatch[1];
  const reportMatch = /(rep-[A-Za-z0-9-]{1,})/u.exec(raw);
  if (reportMatch?.[1] !== undefined) entities.report_id = reportMatch[1];
  if (classification.intent === "approve") {
    entities.decision = /驳回|拒绝|不同意|不批准/u.test(raw) ? "reject" : "approve";
  }
  if (classification.intent === "danger_action") {
    for (const action of DANGER_ACTIONS) {
      if (!raw.includes(action)) continue;
      entities.action = action;
      const targetMatch = new RegExp(`${action}\\s*([^，。,.!?！？\\n]{1,40})`, "u").exec(raw);
      let target = targetMatch?.[1] ?? "";
      target = target
        .replace(/^(程序|应用|插件|服务|给|对|向|到|一下|这个|那个)[\s：:]*/u, "")
        .replace(/(程序|应用|插件|给客户|客户|的)[\s：:]*/gu, "")
        .trim();
      if (target.length > 0) entities.target = target;
      break;
    }
    if (entities.action === undefined) entities.action = "危险动作";
  }
  entities.query = raw;
  const effectiveIntent = detectedRole !== undefined && classification.intent !== "approve" && classification.intent !== "danger_action" ? { intent: "agent_direct" as ChatIntent, confidence: 0.93 } : classification;
  return { ...effectiveIntent, entities };
}

/** 危险动作关键词（供 README/控制台提示复用）。 */
export const CHAT_DANGER_ACTIONS: readonly string[] = DANGER_ACTIONS;
