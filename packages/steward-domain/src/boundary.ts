/**
 * 边界规则目录与判定（阶段二 P1）。
 *
 * 设计目标（对应方案 §5.3 与验收 B7）：
 * - 每条规则对象含 rule_id / trigger / must / user_message / mode / test_case_id；
 * - 个人模式可枚举 ≥12 条；四类越界请求（无证业务、借用资质、陌生外呼、超预算）
 *   必须 **100% deny**，理由可读并留痕；
 * - 支付/退款/合同签署/账号权限 → 人工（human）或仅草稿（draft_only）；
 * - 验证码/2FA/人脸 → human（交人，不代过）；
 * - 未授权承诺 → deny；
 * - 规则按数组顺序判定，第一条命中即返回（deny 规则集中在最前，保证「第 1 步拒绝」）。
 */

import type {
  BoundaryCheckRequest,
  BoundaryCheckResult,
  BoundaryMode,
  BoundaryRule,
  BudgetSnapshot,
  Mandate,
} from "./types.js";

/** 判定上下文：预算快照（超预算规则用）与当前委托（承诺授权用）。 */
export interface BoundaryContext {
  mandate?: Mandate | null;
  budget?: BudgetSnapshot | null;
  now?: Date;
}

interface BoundaryRuleDefinition {
  rule: BoundaryRule;
  match: (request: BoundaryCheckRequest, context: BoundaryContext) => boolean;
}

function textOf(request: BoundaryCheckRequest): string {
  return typeof request.text === "string" ? request.text : "";
}

function amountOf(request: BoundaryCheckRequest): number | null {
  const value = request.amount_cny;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function has(rule: Omit<BoundaryRule, "mode"> & { mode?: BoundaryMode }, mode: BoundaryMode = "both"): BoundaryRule {
  return { ...rule, mode: rule.mode ?? mode };
}

// ---------------------------------------------------------------------------
// 规则目录（顺序 = 判定优先级）
// ---------------------------------------------------------------------------

const DEFINITIONS: BoundaryRuleDefinition[] = [
  // ===== 拒绝组（四类越界 + 其他红线，必须第 1 步拒绝）=====
  {
    rule: has({
      rule_id: "B-01",
      trigger: "业务需要经营资质（requires_license=true）或请求属无证经营范围",
      must: "deny",
      user_message:
        "该业务需要经营资质，个人模式下不承接无证业务。已拒绝；请先取得资质，或改做无需资质的业务线（可在选题里换一条）。",
      test_case_id: "B-01-no-license",
    }),
    match: (request) =>
      request.requires_license === true ||
      (request.kind === "business_scope" && /无证|没有资质|无资质|资质不全/u.test(textOf(request))),
  },
  {
    rule: has({
      rule_id: "B-02",
      trigger: "借用/挂靠/租用他人资质、营业执照或许可证",
      must: "deny",
      user_message:
        "借用、挂靠或租用他人资质接单属于违法经营，已拒绝。请以自己或授权主体的真实资质开展业务。",
      test_case_id: "B-02-borrowed-license",
    }),
    match: (request) => {
      const text = textOf(request);
      return (
        /(?:借用|挂靠|租用|租借|借).{0,12}(?:资质|执照|证书|许可证)/u.test(text) ||
        /(?:资质|执照|证书|许可证).{0,12}(?:借用|挂靠|租用)/u.test(text)
      );
    },
  },
  {
    rule: has({
      rule_id: "B-03",
      trigger: "陌生外呼/陌生触达（is_unknown_outreach=true，或 outreach 含陌生名单/群发意图）",
      must: "deny",
      user_message:
        "陌生外呼/陌生名单触达属于骚扰与合规高风险行为，已拒绝。只允许对明确同意或既有客户关系触达，且需人工确认。",
      test_case_id: "B-03-unknown-outreach",
    }),
    match: (request) =>
      request.is_unknown_outreach === true ||
      (request.kind === "outreach" && /(?:陌生|冷启动|购买名单|名单|批量|群发)/u.test(textOf(request))),
  },
  {
    rule: has({
      rule_id: "B-04",
      trigger: "请求金额超出委托预算（单笔额度或本月剩余额度）",
      must: "deny",
      user_message:
        "该请求金额超出委托预算（单笔或本月剩余额度），已拒绝并留痕。如确需继续，请授权人先调整委托预算或提高单笔额度。",
      test_case_id: "B-04-over-budget",
    }),
    match: (request, context) => {
      const amount = amountOf(request);
      const budget = context.budget;
      if (amount === null || budget === null || budget === undefined) return false;
      return amount > budget.per_txn_limit_cny + 1e-9 || amount > budget.month_left_cny + 1e-9;
    },
  },
  {
    rule: has({
      rule_id: "B-05",
      trigger: "对外承诺但无授权条款（未授权承诺）",
      must: "deny",
      user_message:
        "该承诺没有可追溯的对话原文与委托授权条款，属未授权承诺，已拒绝。请先由授权人确认，再记录承诺并留下依据。",
      test_case_id: "B-05-unauthorized-promise",
    }),
    match: (request) => {
      if (request.has_authorization === true) return false;
      if (request.kind === "promise") return true;
      return /(?:承诺|保证|答应).{0,12}(?:退款|赔偿|全额|一定|百分之百|百分百|交付|完成|负责)/u.test(textOf(request));
    },
  },
  {
    rule: has({
      rule_id: "B-06",
      trigger: "垫资/借贷/贷款等资金风险行为",
      must: "deny",
      user_message: "垫资、借贷或任何对外融资行为不在个人版代理授权范围内，已拒绝。请由本人处理资金安排。",
      test_case_id: "B-06-funds",
    }),
    match: (request) => /(?:垫资|垫付|借贷|贷款|借款|借我|过桥)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-07",
      trigger: "代实名/刷单/刷评/水军/冒用身份等违规操作",
      must: "deny",
      user_message: "代实名、刷单刷评、水军或冒用身份属于违规甚至违法行为，已拒绝并留痕。",
      test_case_id: "B-07-identity-fraud",
    }),
    match: (request) => /(?:代实名|刷单|刷评|水军|冒用|代考|实名认证代过)/u.test(textOf(request)),
  },

  // ===== 人工组（必须真人审批/处理）=====
  {
    rule: has({
      rule_id: "B-08",
      trigger: "支付/退款/转账等资金动作",
      must: "human",
      user_message:
        "支付、退款与转账必须由授权人本人在审批卡上确认后执行，AI 不直接发起资金动作。已生成待办，等待你处理。",
      test_case_id: "B-08-payment",
    }),
    match: (request) =>
      request.kind === "payment" ||
      request.kind === "refund" ||
      /(?:付款|打款|转账|退款)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-09",
      trigger: "合同签署/盖章/代签",
      must: "human",
      user_message: "合同签署与盖章必须本人完成，AI 只生成待签草案与签署位置，不代签。已转人工处理。",
      test_case_id: "B-09-contract",
    }),
    match: (request) => request.kind === "contract" || /(?:签合同|签署|盖章|签字|代签|合同签)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-10",
      trigger: "账号权限/密码/管理员操作",
      must: "human",
      user_message: "账号权限、密码与管理操作必须由本人在受控环境完成，AI 不代管。已转人工处理。",
      test_case_id: "B-10-account",
    }),
    match: (request) =>
      request.kind === "account_permission" ||
      /(?:密码|权限|授权登录|改绑|管理员|账号归属)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-11",
      trigger: "验证码/2FA/人脸/指纹等身份验证环节",
      must: "human",
      user_message: "验证码、2FA、人脸/指纹验证必须由你本人完成，AI 一律停下交人（不代过、不留存凭据）。",
      test_case_id: "B-11-captcha",
    }),
    match: (request) =>
      request.kind === "captcha" || /(?:验证码|2FA|二次验证|人脸|指纹|活体|短信验证)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-12",
      trigger: "需要线下到场/面签的业务",
      must: "human",
      user_message: "该业务需要线下到场或当面办理，AI 无法替代。已转人工，请你安排线下时间。",
      test_case_id: "B-12-offline",
    }),
    match: (request) => request.requires_offline === true,
  },
  {
    rule: has({
      rule_id: "B-13",
      trigger: "开票/发票/税务相关动作",
      must: "human",
      user_message: "开票与税务动作需核对抬头、税号与合同一致性，必须由本人确认提交。已转人工。",
      test_case_id: "B-13-invoice",
    }),
    match: (request) => request.kind === "invoice" || /(?:开票|发票|税号)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-14",
      trigger: "客户投诉/纠纷/维权/仲裁",
      must: "human",
      user_message: "客户投诉、纠纷与维权事项超出代理权限，已停下交人处理。请本人先与客户沟通并留存证据。",
      test_case_id: "B-14-complaint",
    }),
    match: (request) => /(?:投诉|维权|仲裁|诉讼|差评|举报)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-15",
      trigger: "导出客户名单/个人信息等隐私数据",
      must: "human",
      user_message: "导出客户名单或个人信息涉及隐私合规，需本人确认用途与授权后处理。已转人工。",
      test_case_id: "B-15-privacy",
    }),
    match: (request) =>
      /(?:导出.{0,8}(?:客户|用户|名单)|客户名单|个人信息|身份证|手机号|住址)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-16",
      trigger: "企业模式：增值税专票/对公账户/税务登记",
      must: "human",
      user_message: "企业专票、对公账户与税务登记需主体资质与双人复核，已转人工处理。",
      test_case_id: "B-16-enterprise-invoice",
      mode: "enterprise",
    }),
    match: (request) => /(?:增值税专票|专票|对公账户|开户|税务登记)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-17",
      trigger: "企业模式：组织级权限/多代理复核",
      must: "human",
      user_message: "组织级权限与多代理复核需管理员审批，已转人工处理。",
      test_case_id: "B-17-enterprise-permission",
      mode: "enterprise",
    }),
    match: (request) => /(?:多代理|组织级|双人复核|员工权限)/u.test(textOf(request)),
  },

  // ===== 草稿组（可起草，不得自动对外）=====
  {
    rule: has({
      rule_id: "B-18",
      trigger: "对外报价",
      must: "draft_only",
      user_message: "对外报价只生成草稿，需你确认价格与条款后再发送；AI 不自动报价。",
      test_case_id: "B-18-quote-draft",
    }),
    match: (request) => request.kind === "quote" || /(?:报价|报个价|价格发)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-19",
      trigger: "对外触达/私信/邮件/电话",
      must: "draft_only",
      user_message: "对外触达只生成草稿，需你确认收件人与内容后再发送；AI 不自动群发。",
      test_case_id: "B-19-outreach-draft",
    }),
    match: (request) => request.kind === "outreach" || /(?:私信|群发|外呼|打电话|发邮件给客户)/u.test(textOf(request)),
  },
  {
    rule: has({
      rule_id: "B-20",
      trigger: "交付物对外发送",
      must: "draft_only",
      user_message: "交付物对外发送前需你确认内容与收件人，AI 只准备草稿与证据清单。",
      test_case_id: "B-20-delivery-draft",
      mode: "personal",
    }),
    match: (request) => request.kind === "delivery" || /(?:发给客户|发送交付|交付物)/u.test(textOf(request)),
  },
];

/** 完整规则目录（只读；UI/文档枚举用）。 */
export const BOUNDARY_RULES: readonly BoundaryRule[] = DEFINITIONS.map((definition) => ({ ...definition.rule }));

/** 按模式列出规则：personal = personal + both（个人模式可枚举 ≥12 条）。 */
export function listBoundaryRules(mode: BoundaryMode = "personal"): BoundaryRule[] {
  return BOUNDARY_RULES.filter((rule) => rule.mode === mode || rule.mode === "both").map((rule) => ({ ...rule }));
}

/** 规则总数（含企业模式）。 */
export function boundaryRuleCount(): number {
  return BOUNDARY_RULES.length;
}

/** 判定请求：按顺序匹配第一条规则；无命中 → allow。 */
export function evaluateBoundary(request: BoundaryCheckRequest, context: BoundaryContext = {}): BoundaryCheckResult {
  for (const definition of DEFINITIONS) {
    let matched = false;
    try {
      matched = definition.match(request, context);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    return {
      decision: definition.rule.must,
      rule_id: definition.rule.rule_id,
      user_message: definition.rule.user_message,
    };
  }
  return {
    decision: "allow",
    rule_id: "ALLOW",
    user_message: "未命中任何边界规则，可代理按委托范围与预算继续执行。",
  };
}

/** 脱敏请求原文：只保留长度与少量字符，避免把敏感原文写进事件/月报。 */
export function digestBoundaryText(text: string): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (value.length === 0) return "（空）";
  const head = [...value].slice(0, 6).join("");
  return `${head}…（共 ${[...value].length} 字）`;
}
