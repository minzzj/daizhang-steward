/**
 * 掩码工具：敏感字段**只存掩码**（银行卡只留后 4 位、微信/支付宝 id 打码、税号/营业执照号打码），
 * 绝不落明文。所有输入会先清洗（去空格/连字符），再按类型掩码。
 */

/** 清洗为纯数字/字母串。 */
function clean(value: string): string {
  return String(value ?? "").replace(/[\s-]/gu, "");
}

/** 银行卡号掩码：只保留后 4 位（`**** **** **** 7890`）。 */
export function maskBankCard(value: string): string {
  const digits = clean(value).replace(/\D/gu, "");
  if (digits.length === 0) return "****";
  const last4 = digits.slice(-4);
  if (digits.length <= 4) return "****";
  return `**** **** **** ${last4}`;
}

/** 通用账号/id 掩码：首 2 位 + *** + 末 2 位（短值全掩码）。 */
export function maskAccountId(value: string): string {
  const raw = String(value ?? "").trim();
  const chars = [...raw];
  if (chars.length === 0) return "***";
  if (chars.length <= 4) return "*".repeat(Math.max(3, chars.length));
  return `${chars.slice(0, 2).join("")}***${chars.slice(-2).join("")}`;
}

/** 税号掩码：保留前 4 与末 2（企业专票校验时人工核对）。 */
export function maskTaxNo(value: string): string {
  const raw = clean(value);
  const chars = [...raw];
  if (chars.length === 0) return "****";
  if (chars.length <= 6) return maskAccountId(raw);
  return `${chars.slice(0, 4).join("")}******${chars.slice(-2).join("")}`;
}

/** 营业执照号/统一社会信用代码掩码（同税号规则）。 */
export function maskLicenseNo(value: string): string {
  return maskTaxNo(value);
}

/** 是否已掩码（包含 * 即视为已掩码）。 */
export function isMaskedValue(value: string): boolean {
  return String(value ?? "").includes("*");
}

/**
 * 自动掩码：纯数字且长度 ≥ 12 视为银行卡号；否则按账号 id 处理。
 * 微信/支付宝 id 也走这里（含字母）。
 */
export function maskAccount(value: string): string {
  const raw = String(value ?? "").trim();
  const digitsOnly = /^\d{12,}$/u.test(clean(raw));
  return digitsOnly ? maskBankCard(raw) : maskAccountId(raw);
}

/** 是否疑似明文银行卡号（13 位以上连续数字）——validate() 用来拒绝把明文写进配置。 */
export function looksLikePlaintextCard(value: string): boolean {
  return /\d{13,}/u.test(clean(value));
}

/** 是否疑似明文手机号（11 位连续数字，1 开头）。 */
export function looksLikePlaintextPhone(value: string): boolean {
  return /(?<!\d)1\d{10}(?!\d)/u.test(clean(value));
}
