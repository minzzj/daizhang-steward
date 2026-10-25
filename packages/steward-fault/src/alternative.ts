/**
 * AlternativePlan：平台封禁时的可读替代方案（B4 要求「生成替代方案通知」）。
 *
 * 纯本地生成，不依赖网络；内容面向「人」可读：每个渠道给出 为什么/下一步/负责人。
 */

import { nowIso } from "./io.js";
import type { AlternativePlanContext, AlternativePlanItem, AlternativePlanResult } from "./types.js";

interface ChannelTemplate extends AlternativePlanItem {}

/** 内置替代渠道模板（按封禁场景优先级排列）。 */
const DEFAULT_TEMPLATES: readonly ChannelTemplate[] = [
  {
    channel: "企业微信 / 邮件（既有客户关系）",
    why: "不依赖被封平台 B，客户已在私域/邮件列表里，可继续沟通与留痕。",
    next_action: "把待发的报价/进度同步改走既有私域或邮件，标题带项目编号，正文附证据链接。",
    owner: "客户代理（customer）",
  },
  {
    channel: "电话 / 语音人工跟进（本人）",
    why: "封禁期间客户可能困惑，关键客户需要真人解释风险与替代时间表。",
    next_action: "30 分钟内由本人电话同步 3 个高价值客户：说明平台暂停、交付不受影响、恢复时间点。",
    owner: "授权人（本人）",
  },
  {
    channel: "本地交付（离线可完成部分）",
    why: "交付物（代码/文档/对账）不依赖平台在线，可先把可离线部分做完并归档证据。",
    next_action: "开发代理先完成交付物与验收证据，写入项目时间线；平台恢复后只补对外发送。",
    owner: "开发代理（developer）",
  },
  {
    channel: "Outbox 暂存 + 恢复后幂等重放",
    why: "封禁/断网期间不产生新的不可控外发；动作进 Outbox，恢复后按幂等键补发并核对账本。",
    next_action: "所有待发动作 enqueue 到 Outbox（幂等键=业务单号）；解禁后 replay + 对账，duplicates_found 必须为 0。",
    owner: "总调度（conductor）",
  },
  {
    channel: "平台恢复探测（冷却后重试）",
    why: "封禁通常有冷却期（retry_after / 平台公告），盲目重试会加重风控。",
    next_action: "按检测到的 retry_after_ms 设定冷静期，冷却结束后先跑只读探测（/health），再恢复业务动作。",
    owner: "总调度（conductor）",
  },
];

export class AlternativePlan {
  /** 生成替代方案（可传入平台/原因/可用渠道，便于按场景裁剪文案）。 */
  generate(context: AlternativePlanContext = {}): AlternativePlanResult {
    const platform = typeof context.platform === "string" && context.platform.trim() !== "" ? context.platform.trim() : "平台 B";
    const reason = typeof context.reason === "string" && context.reason.trim() !== "" ? context.reason.trim() : "平台封禁/风控限制";
    const available = Array.isArray(context.available_channels) ? context.available_channels.filter((item) => item.trim() !== "") : [];
    const items =
      available.length === 0
        ? DEFAULT_TEMPLATES.map((template) => ({ ...template }))
        : DEFAULT_TEMPLATES.filter((template) => available.some((channel) => template.channel.includes(channel))).map((template) => ({ ...template }));
    const finalItems = items.length > 0 ? items : DEFAULT_TEMPLATES.map((template) => ({ ...template }));
    return {
      title: `${platform} 暂停期间替代方案：${reason}`,
      items: finalItems,
      generated_at: nowIso(context.now),
      platform,
      reason,
    };
  }
}
