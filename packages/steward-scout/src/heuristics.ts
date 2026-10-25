/**
 * 评分启发式（纯函数、零依赖、确定性）。
 * 只用于“缺失字段时给合理默认值”，显式传入的字段永远优先（见 ScoutEngine#scoreLead）。
 */

import type { BudgetRange, ScoutFixtureLead } from "./types.js";

/** 需求信号关键词：命中越多，need 越高（与 prompts/scout.md 的口径一致）。 */
export const NEED_KEYWORDS: readonly string[] = [
  "每周",
  "每天",
  "手动",
  "麻烦",
  "需要",
  "求工具",
  "自动化",
  "重复",
  "耗时",
  "对账",
  "报表",
  "崩溃",
  "加班",
  "费时",
  "人工",
];

/** 预算区间 → 预算/规模因子（0.3 / 0.6 / 1）。 */
export const BUDGET_SCORES: Readonly<Record<BudgetRange, number>> = {
  low: 0.3,
  medium: 0.6,
  high: 1,
};

/** 渠道 → 可触达性启发式（平台私信最直接，表单最弱）。 */
export const CHANNEL_REACHABILITY: Readonly<Record<string, number>> = {
  email: 0.6,
  platform_dm: 0.7,
  form: 0.5,
};

/** 把任意数字收敛到 [0,1]；NaN/Infinity → 0。 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Unicode 码点长度（中文按 1 字计，避免 emoji 被算成 2）。 */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/** 取前 maxChars 个码点（中文按 1 字计）。 */
export function excerptText(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return Array.from(value).slice(0, maxChars).join("");
}

/** signal 缺省需求强度：基础 0.3 + 长度（≤0.3）+ 关键词（≤0.35）。 */
export function heuristicNeed(signal: string): number {
  const text = signal.trim();
  if (text.length === 0) return 0;
  let score = 0.3 + Math.min(charLength(text) / 80, 0.3);
  let keywordHits = 0;
  for (const keyword of NEED_KEYWORDS) {
    if (text.includes(keyword)) keywordHits += 1;
  }
  score += Math.min(keywordHits * 0.08, 0.35);
  return clamp01(score);
}

/** 是否为合法预算区间。 */
export function isBudgetRange(value: unknown): value is BudgetRange {
  return value === "low" || value === "medium" || value === "high";
}

/** 预算/规模缺省分：budget_range 优先，其次 company_size，未知取中性 0.5。 */
export function heuristicBudget(lead: Partial<ScoutFixtureLead> | null | undefined): number {
  const range = lead?.budget_range;
  if (isBudgetRange(range)) return BUDGET_SCORES[range];
  const size = lead?.company_size;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    if (size >= 500) return 1;
    if (size >= 100) return 0.8;
    if (size >= 50) return 0.7;
    if (size >= 20) return 0.6;
    if (size >= 5) return 0.4;
    return 0.3;
  }
  return 0.5;
}

/** 可触达性缺省分：按 channel 映射，未知渠道取 0.5。 */
export function heuristicReachability(lead: Partial<ScoutFixtureLead> | null | undefined): number {
  const channel = typeof lead?.channel === "string" ? lead.channel : "";
  return CHANNEL_REACHABILITY[channel] ?? 0.5;
}

/** 合规风险缺省分：有像样 consent_basis → 0.2；过短 → 0.45；为空 → 0.9（随后会被丢弃）。 */
export function heuristicComplianceRisk(
  lead: Partial<ScoutFixtureLead> | null | undefined,
): number {
  const basis = typeof lead?.consent_basis === "string" ? lead.consent_basis.trim() : "";
  if (basis.length === 0) return 0.9;
  return charLength(basis) >= 8 ? 0.2 : 0.45;
}
