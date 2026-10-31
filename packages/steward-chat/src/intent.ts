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

const DANGER_ACTIONS: readonly string[] = ["删除", "卸载", "移除", "停用", "禁用", "付款", "支付", "转账", "打款", "签约", "发布", "外发", "授权"];

/** 只返回契约要求的 {intent, confidence}。 */
export function classifyIntent(text: string): ChatClassification {
  const raw = typeof text === "string" ? text.trim() : "";
  if (raw.length === 0) return { intent: "chat", confidence: 0.1 };
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
  return { ...classification, entities };
}

/** 危险动作关键词（供 README/控制台提示复用）。 */
export const CHAT_DANGER_ACTIONS: readonly string[] = DANGER_ACTIONS;
