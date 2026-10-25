/**
 * 内置仿真数据（个人版演示/验收用；不代表真实客户或真实商机）。
 *
 * - DEFAULT_BUSINESS_LINES：三条带来源的业务线（验收 B1：5 万预算 / 30 天 ≥3 条）；
 * - DEFAULT_CUSTOMER_INQUIRY：仿真客户询价消息（仅演示，不连接真实平台）；
 * - defaultMandateInput：仿真委托（预算三层：月 5 万 / 项目 2 万 / 单笔 5 千）。
 *
 * 来源 URL 使用 example.com 占位（离线可读、无真实采集），真实使用时替换为可打开的真实来源。
 */

import type { BusinessLine, CreateMandateInput } from "./types.js";

export const DEFAULT_BUSINESS_LINES: BusinessLine[] = [
  {
    id: "bl-shop-report-automation",
    name: "电商店铺日报自动化（多平台导出→清洗→日报）",
    who_pays: "淘宝/拼多多中小卖家（1-3 人运营团队）",
    quote_cny: 12_000,
    cost_cny: 3_000,
    gross_margin: 9_000,
    gross_margin_rate: 0.75,
    worst_case_cny: 5_000,
    sources: [
      {
        title: "商家社区：每天手动整理多平台报表耗时 2 小时（示例来源）",
        url: "https://example.com/sources/shop-report-pain",
      },
      {
        title: "同类自动化服务报价区间 8k-15k（示例来源）",
        url: "https://example.com/sources/automation-pricing",
      },
    ],
    risks: ["平台导出格式易变，需要维护适配", "客户数据敏感，需最小权限与本地处理"],
    requires_offline: false,
    requires_license: false,
    certainty: "certain",
    delivery_days: 10,
  },
  {
    id: "bl-local-video-pipeline",
    name: "本地商家短视频脚本 + 粗剪流水线",
    who_pays: "本地餐饮/美业门店老板",
    quote_cny: 18_000,
    cost_cny: 6_000,
    gross_margin: 12_000,
    gross_margin_rate: 0.667,
    worst_case_cny: 9_000,
    sources: [
      {
        title: "本地商家短视频代运营需求上升（示例来源）",
        url: "https://example.com/sources/local-video-demand",
      },
      {
        title: "同城服务商月度套餐报价参考（示例来源）",
        url: "https://example.com/sources/video-pricing",
      },
    ],
    risks: ["创意内容不确定性高，需明确修改轮次", "涉及版权素材，需客户提供授权"],
    requires_offline: false,
    requires_license: false,
    certainty: "probable",
    delivery_days: 14,
  },
  {
    id: "bl-sheet-reconcile-bot",
    name: "企业表格清洗与对账机器人（含交付文档）",
    who_pays: "有财务对账需求的小微企业",
    quote_cny: 20_000,
    cost_cny: 5_000,
    gross_margin: 15_000,
    gross_margin_rate: 0.75,
    worst_case_cny: 8_000,
    sources: [
      {
        title: "小微企业财务对账自动化需求调研（示例来源）",
        url: "https://example.com/sources/sme-reconcile",
      },
      {
        title: "RPA 对账工具市场报价参考（示例来源）",
        url: "https://example.com/sources/rpa-pricing",
      },
    ],
    risks: ["财务数据合规要求高，需签署保密条款", "对账口径需客户确认，避免重复劳动"],
    requires_offline: false,
    requires_license: false,
    certainty: "certain",
    delivery_days: 12,
  },
];

/** 仿真客户询价消息（只进项目时间线，不连接真实平台）。 */
export const DEFAULT_CUSTOMER_INQUIRY =
  "你好，我们两个平台店铺每天要手动整理销售日报，太耗时间了。想问下做一个自动导出+清洗+日报的工具有多贵？大概多久能交付？";

/** 仿真委托（默认预算三层：月 50000 / 项目 20000 / 单笔 5000）。 */
export function defaultMandateInput(now: Date = new Date()): CreateMandateInput {
  const from = now.toISOString();
  const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    principal: "个人经营者（本人）",
    scope: [
      "承接无需经营资质的软件/自动化小额订单，单笔不超过单笔额度",
      "对外报价、交付与收款须经本人审批后执行",
      "账本每笔须有依据、审批人与回执，可追溯",
    ],
    valid_from: from,
    valid_to: to,
    budget_limits: { month_cny: 50_000, project_cny: 20_000, per_txn_cny: 5_000 },
    prohibited: ["借用或挂靠资质", "陌生外呼与名单触达", "垫资/借贷", "未授权对外承诺", "代签合同"],
    confidence: "certain",
  };
}

/** 仿真人工审批标识（仅用于仿真业务线，明确标注非真人，避免混淆）。 */
export const SIMULATED_HUMAN_APPROVER = "sim-owner（仿真审批人，非真人）";
