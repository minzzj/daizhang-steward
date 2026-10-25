/**
 * 企业版 30 条边界规则 + 双模式（个人 / 企业）标注表 + 判定器（阶段二 P3 / 验收 B8、边界 100% 拒绝）。
 *
 * 落地格式（对应方案 §5.3 与文档 2 的 30 条边界）：
 *   rule_id / 触发条件 / 必须行为 / 用户可见文案 / 模式(个人|企业|双模式) / 测试用例 / 证据，
 *   并且每条在个人、企业两种模式都标注「已实现 / 人工 / 不适用」。
 *
 * 四类重点越界（EB-01 无证业务、EB-02 借用资质、EB-03 陌生外呼、EB-04 超预算）在
 * **个人 + 企业两种模式都必须 100% deny**，理由可读并留痕。
 *
 * 判定顺序：deny 组在前（保证第 1 步拒绝），随后 human 组，最后 draft_only 组。
 * 纯函数、零依赖、无网络。
 */

import type {
  BoundaryDecision30,
  BoundaryImplementation,
  BoundaryMust30,
  BoundaryRow30,
  BoundaryRowMode,
  EnterpriseBoundaryRequest,
  EnterpriseBoundaryResult,
  EntityKind,
  OrderMode,
  ReviewPolicy,
} from "./types.js";

/** 判定上下文：组织级审批链阈值与主体经营范围。 */
export interface EnterpriseBoundaryContext {
  review_policy: ReviewPolicy;
  entity: { name: string; scope: string; kind: EntityKind };
}

type MatchFn = (request: EnterpriseBoundaryRequest, context: EnterpriseBoundaryContext) => boolean;

interface BoundaryDefinition {
  row: BoundaryRow30;
  match: MatchFn;
}

function textOf(request: EnterpriseBoundaryRequest): string {
  return typeof request.text === "string" ? request.text : "";
}

function amountOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function makeRow(
  rule_id: string,
  trigger: string,
  must: BoundaryMust30,
  user_message: string,
  mode: BoundaryRowMode,
  personal: BoundaryImplementation,
  enterprise: BoundaryImplementation,
  test_case_id: string,
  evidence: string,
): BoundaryRow30 {
  return { rule_id, trigger, must, user_message, mode, personal, enterprise, test_case_id, evidence };
}

function makeDefinition(
  row: BoundaryRow30,
  match: MatchFn,
): BoundaryDefinition {
  return { row, match };
}

const TEST_PREFIX = "tests/unit/enterprise.test.mjs#";

// ---------------------------------------------------------------------------
// 30 条规则目录（顺序 = 判定优先级；1–4 为四类重点越界）
// ---------------------------------------------------------------------------

export const BOUNDARY_ROWS_30: readonly BoundaryRow30[] = [
  // ===== deny 组：四类重点越界（个人 + 企业 双模式 100% 拒绝）=====
  makeRow(
    "EB-01",
    "无证业务：requires_license=true，或请求涉及无证/资质不全仍要接单",
    "deny",
    "该业务需要经营资质，个人/企业模式下均不承接无证业务。已拒绝；请先取得对应资质，或改做无需资质的业务线。",
    "both",
    "implemented",
    "implemented",
    "EB-01-no-license",
    `${TEST_PREFIX}EB-01`,
  ),
  makeRow(
    "EB-02",
    "借用资质：借用/挂靠/租用他人营业执照、资质证书或许可证",
    "deny",
    "借用、挂靠或租用他人资质接单属于违法经营，个人/企业模式都拒绝。请以自己或授权主体的真实资质开展业务。",
    "both",
    "implemented",
    "implemented",
    "EB-02-borrowed-license",
    `${TEST_PREFIX}EB-02`,
  ),
  makeRow(
    "EB-03",
    "陌生外呼/陌生名单触达（is_unknown_outreach=true，或 outreach 含陌生名单/群发意图）",
    "deny",
    "陌生外呼、购买名单与群发触达属于骚扰与高风险行为，个人/企业模式都拒绝。只允许对明确同意的客户触达，且需人工确认。",
    "both",
    "implemented",
    "implemented",
    "EB-03-unknown-outreach",
    `${TEST_PREFIX}EB-03`,
  ),
  makeRow(
    "EB-04",
    "超预算：请求金额超过当前预算/委托额度",
    "deny",
    "该请求金额超出预算，已拒绝并留痕。如确需继续，请先由负责人调整预算或改为分期小额方案。",
    "both",
    "implemented",
    "implemented",
    "EB-04-over-budget",
    `${TEST_PREFIX}EB-04`,
  ),
  // ===== deny 组：其他红线 =====
  makeRow(
    "EB-05",
    "代实名/刷单/刷评/水军/冒用身份等违规操作",
    "deny",
    "代实名、刷单刷评、水军或冒用身份属于违规甚至违法行为，个人/企业模式都拒绝并留痕。",
    "both",
    "implemented",
    "implemented",
    "EB-05-identity-fraud",
    `${TEST_PREFIX}EB-05`,
  ),
  makeRow(
    "EB-06",
    "垫资/垫付/借贷/贷款/过桥等资金风险行为",
    "deny",
    "垫资、借贷或对外融资不在代理授权范围内，个人/企业模式都拒绝。资金安排请由主体负责人本人处理。",
    "both",
    "implemented",
    "implemented",
    "EB-06-funds",
    `${TEST_PREFIX}EB-06`,
  ),
  makeRow(
    "EB-07",
    "未授权对外承诺（无对话原文与委托/授权条款支撑）",
    "deny",
    "该承诺没有可追溯的对话原文与授权条款，属未授权承诺，已拒绝。请先由授权人确认后再记录承诺。",
    "both",
    "implemented",
    "implemented",
    "EB-07-unauthorized-promise",
    `${TEST_PREFIX}EB-07`,
  ),
  makeRow(
    "EB-08",
    "虚开发票/阴阳合同/发票内容与实际不符",
    "deny",
    "虚开发票、阴阳合同与票实不符属于严重涉税违法，个人/企业模式都拒绝并留痕。",
    "both",
    "implemented",
    "implemented",
    "EB-08-invoice-fraud",
    `${TEST_PREFIX}EB-08`,
  ),
  makeRow(
    "EB-09",
    "企业业务走私账/个人账户收企业款（主体与收款账户不一致）",
    "deny",
    "企业业务必须走对公账户：个人账户收企业款会造成主体/收款不一致，个人/企业模式都拒绝。",
    "both",
    "implemented",
    "implemented",
    "EB-09-private-account",
    `${TEST_PREFIX}EB-09`,
  ),
  makeRow(
    "EB-10",
    "商业贿赂/回扣/返点/好处费",
    "deny",
    "回扣、返点、好处费等商业贿赂行为违法，个人/企业模式都拒绝并留痕。",
    "both",
    "implemented",
    "implemented",
    "EB-10-bribery",
    `${TEST_PREFIX}EB-10`,
  ),
  makeRow(
    "EB-11",
    "社保挂靠/代缴社保（无真实劳动关系）",
    "deny",
    "无真实劳动关系的社保挂靠/代缴属违规，个人/企业模式都拒绝。用工必须依法建立劳动关系。",
    "both",
    "implemented",
    "implemented",
    "EB-11-social-insurance",
    `${TEST_PREFIX}EB-11`,
  ),
  makeRow(
    "EB-12",
    "虚假宣传/保过承诺/绝对化用语",
    "deny",
    "保过、包过、绝对有效等虚假宣传违反广告法，个人/企业模式都拒绝。只能提供可核验的真实能力说明。",
    "both",
    "implemented",
    "implemented",
    "EB-12-false-advertising",
    `${TEST_PREFIX}EB-12`,
  ),
  makeRow(
    "EB-13",
    "绕过平台规则/风控/验证，或抓取登录后页面",
    "deny",
    "绕过平台规则、风控或抓取登录后页面属于违规，个人/企业模式都拒绝。只做公开允许范围内的只读操作。",
    "both",
    "implemented",
    "implemented",
    "EB-13-platform-bypass",
    `${TEST_PREFIX}EB-13`,
  ),
  makeRow(
    "EB-14",
    "超出登记经营范围的业务（out_of_scope=true 或明确超出经营范围）",
    "deny",
    "该业务超出主体登记经营范围，已拒绝。请先依法变更经营范围，或转人工评估合规路径。",
    "enterprise",
    "not_applicable",
    "implemented",
    "EB-14-out-of-scope",
    `${TEST_PREFIX}EB-14`,
  ),

  // ===== human 组：必须真人审批/处理 =====
  makeRow(
    "EB-15",
    "验证码/2FA/人脸/指纹等身份验证环节",
    "human",
    "验证码、2FA、人脸/指纹验证必须由本人完成，AI 一律停下交人（不代过、不留存凭据）。",
    "both",
    "human",
    "human",
    "EB-15-captcha",
    `${TEST_PREFIX}EB-15`,
  ),
  makeRow(
    "EB-16",
    "合同签署/盖章/用印（AI 不代签）",
    "human",
    "合同签署与盖章必须由本人完成；AI 只生成待签草案并定位签署页，不代签。已转人工处理。",
    "both",
    "human",
    "human",
    "EB-16-seal",
    `${TEST_PREFIX}EB-16`,
  ),
  makeRow(
    "EB-17",
    "支付/退款/转账/大额资金动作",
    "human",
    "支付、退款与转账必须由授权人本人在审批卡确认后执行，AI 不直接发起资金动作。已生成待办。",
    "both",
    "human",
    "human",
    "EB-17-payment",
    `${TEST_PREFIX}EB-17`,
  ),
  makeRow(
    "EB-18",
    "账号权限/密码/管理员/授权登录/改绑",
    "human",
    "账号权限、密码与管理操作必须由本人在受控环境完成，AI 不代管。已转人工处理。",
    "both",
    "human",
    "human",
    "EB-18-account",
    `${TEST_PREFIX}EB-18`,
  ),
  makeRow(
    "EB-19",
    "导出客户名单/个人信息等隐私数据",
    "human",
    "导出客户名单或个人信息涉及隐私合规，需本人确认用途与授权后处理。已转人工。",
    "both",
    "human",
    "human",
    "EB-19-privacy",
    `${TEST_PREFIX}EB-19`,
  ),
  makeRow(
    "EB-20",
    "客户投诉/纠纷/维权/仲裁/诉讼",
    "human",
    "客户投诉、纠纷与维权事项超出代理权限，已停下交人处理。请本人先沟通并留存证据。",
    "both",
    "human",
    "human",
    "EB-20-complaint",
    `${TEST_PREFIX}EB-20`,
  ),
  makeRow(
    "EB-21",
    "税务申报/纳税申报提交（只出草稿，人确认提交）",
    "human",
    "税务申报只能生成草稿，必须由财务/负责人核对后在税务系统确认提交；AI 不自动申报。",
    "both",
    "human",
    "human",
    "EB-21-tax-filing",
    `${TEST_PREFIX}EB-21`,
  ),
  makeRow(
    "EB-22",
    "增值税专用发票开具（需企业主体、对公账户与人工确认）",
    "human",
    "增值税专票开具需核对抬头、税号、合同一致并人工确认提交；AI 只生成草稿，不自动开票。",
    "enterprise",
    "not_applicable",
    "human",
    "EB-22-special-invoice",
    `${TEST_PREFIX}EB-22`,
  ),
  makeRow(
    "EB-23",
    "收款账户/对公账户变更（双人复核）",
    "human",
    "收款账户变更必须由两位不同角色复核批准后生效；AI 不自动变更账户。",
    "enterprise",
    "not_applicable",
    "human",
    "EB-23-account-change",
    `${TEST_PREFIX}EB-23`,
  ),
  makeRow(
    "EB-24",
    "组织级审批链（金额达到/超过组织阈值）",
    "human",
    "达到组织阈值的大额事项必须走组织级审批链（负责人/财务/法人），AI 只提交待审批，不越级执行。",
    "enterprise",
    "not_applicable",
    "implemented",
    "EB-24-approval-chain",
    `${TEST_PREFIX}EB-24`,
  ),
  makeRow(
    "EB-25",
    "多代理/多账号并发操作（必须串行）",
    "human",
    "多代理/多账号必须串行操作，避免并发冲突与越权；AI 自动串行排队，跨账号动作转人工确认。",
    "enterprise",
    "not_applicable",
    "implemented",
    "EB-25-multi-agent-serial",
    `${TEST_PREFIX}EB-25`,
  ),
  makeRow(
    "EB-26",
    "用工/劳务派遣/外包用工",
    "human",
    "用工、劳务派遣与外包用工涉及劳动关系与派遣资质，必须转人工依法处理；AI 不代为招工或签约。",
    "both",
    "human",
    "human",
    "EB-26-employment",
    `${TEST_PREFIX}EB-26`,
  ),
  makeRow(
    "EB-27",
    "资质代办/许可证代办/资质借用通道",
    "human",
    "资质与许可证代办需人工审核合法路径与主体资格，AI 不代为承诺办证结果。已转人工。",
    "both",
    "human",
    "human",
    "EB-27-qualification-agent",
    `${TEST_PREFIX}EB-27`,
  ),
  makeRow(
    "EB-28",
    "跨境支付/外汇/境外收款/结汇购汇",
    "human",
    "跨境支付与外汇结算受外汇管理监管，必须由人工按合规路径办理；AI 不发起跨境资金动作。",
    "both",
    "human",
    "human",
    "EB-28-cross-border",
    `${TEST_PREFIX}EB-28`,
  ),
  makeRow(
    "EB-29",
    "数据出境/敏感个人信息处理",
    "human",
    "数据出境与敏感个人信息处理需做合规评估并取得授权，必须转人工处理；AI 不擅自传输。",
    "both",
    "human",
    "human",
    "EB-29-data-export",
    `${TEST_PREFIX}EB-29`,
  ),

  // ===== draft_only 组：可起草，不得自动对外 =====
  makeRow(
    "EB-30",
    "对外报价/外联触达/私信/邮件（只出草稿）",
    "draft_only",
    "对外报价与触达只生成草稿，需本人确认收件人与内容后再发送；AI 不自动报价、不群发。",
    "both",
    "implemented",
    "implemented",
    "EB-30-quote-draft",
    `${TEST_PREFIX}EB-30`,
  ),
];

// ---------------------------------------------------------------------------
// 判定逻辑（顺序 = 上面的目录顺序）
// ---------------------------------------------------------------------------

/** 判定定义：与 BOUNDARY_ROWS_30 一一对应（顺序即判定优先级）。 */
const DEFINITIONS: BoundaryDefinition[] = [];

DEFINITIONS.push(
  makeDefinition(BOUNDARY_ROWS_30[0]!, (request) => {
    const text = textOf(request);
    return (
      request.requires_license === true ||
      ((request.kind === "business_scope" || request.kind === "other") &&
        /(?:无证|没有资质|无资质|资质不全)/u.test(text))
    );
  }),
  makeDefinition(BOUNDARY_ROWS_30[1]!, (request) => {
    const text = textOf(request);
    return (
      /(?:借用|挂靠|租用|租借|借).{0,12}(?:资质|执照|证书|许可证)/u.test(text) ||
      /(?:资质|执照|证书|许可证).{0,12}(?:借用|挂靠|租用|租借)/u.test(text)
    );
  }),
  makeDefinition(BOUNDARY_ROWS_30[2]!, (request) => {
    const text = textOf(request);
    return (
      request.is_unknown_outreach === true ||
      (request.kind === "outreach" && /(?:陌生|冷启动|购买名单|名单|批量|群发|外呼)/u.test(text))
    );
  }),
  makeDefinition(BOUNDARY_ROWS_30[3]!, (request) => {
    const amount = amountOf(request.amount_cny);
    const budget = amountOf(request.budget_cny);
    if (amount === null || budget === null) return false;
    return amount > budget + 1e-9;
  }),
  makeDefinition(BOUNDARY_ROWS_30[4]!, (request) =>
    /(?:代实名|刷单|刷评|水军|冒用|代考)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[5]!, (request) =>
    /(?:垫资|垫付|借贷|贷款|借款|过桥)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[6]!, (request) => {
    if (request.has_authorization === true) return false;
    if (request.kind === "promise") return true;
    return /(?:承诺|保证|答应).{0,12}(?:退款|赔偿|全额|一定|百分之百|百分百|交付|完成|负责)/u.test(
      textOf(request),
    );
  }),
  makeDefinition(BOUNDARY_ROWS_30[7]!, (request) =>
    /(?:虚开|阴阳合同|假发票|虚增|票实不符|开票内容与实际不符)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[8]!, (request) =>
    /(?:走个人账|私账|个人账户收(?:企业|对公)|对公.{0,6}个人(?:账|账户)|个人账户.{0,6}企业款)/u.test(
      textOf(request),
    ),
  ),
  makeDefinition(BOUNDARY_ROWS_30[9]!, (request) =>
    /(?:回扣|返点|贿赂|好处费|商业贿赂)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[10]!, (request) =>
    /(?:社保挂靠|挂靠社保|代缴社保|社保代缴)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[11]!, (request) =>
    /(?:保过|包过|保证通过|百分百|100%|虚假宣传|绝对有效|绝对能过)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[12]!, (request) =>
    /(?:绕过.{0,8}(?:平台|风控|规则)|刷接口|破解|爬取登录后|规避风控)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[13]!, (request) =>
    request.out_of_scope === true || /(?:经营范围外|超范围|不在经营范围内)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[14]!, (request) =>
    request.kind === "captcha" || /(?:验证码|2FA|二次验证|人脸|指纹|活体|短信验证)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[15]!, (request) =>
    request.kind === "contract" || /(?:签合同|签署|盖章|代签|用印)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[16]!, (request) =>
    request.kind === "payment" ||
    request.kind === "refund" ||
    request.kind === "expense" ||
    /(?:付款|打款|转账|退款)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[17]!, (request) =>
    request.kind === "account_permission" || /(?:密码|权限|管理员|改绑|授权登录)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[18]!, (request) =>
    /(?:客户名单|导出.{0,8}(?:客户|用户|名单)|个人信息|身份证|手机号|住址)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[19]!, (request) =>
    /(?:投诉|维权|仲裁|诉讼|差评|举报)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[20]!, (request) =>
    request.kind === "tax" || /(?:税务申报|纳税申报|报税|申报)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[21]!, (request) =>
    request.kind === "invoice" && /(?:专票|增值税专用)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[22]!, (request) =>
    request.kind === "account_change" || /(?:收款账户变更|对公账户变更|银行账户变更|改银行账户)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[23]!, (request, context) => {
    const amount = amountOf(request.amount_cny);
    return (
      /(?:组织审批|大额审批|超阈值)/u.test(textOf(request)) ||
      (amount !== null && amount > context.review_policy.dual_review_threshold_cny + 1e-9)
    );
  }),
  makeDefinition(BOUNDARY_ROWS_30[24]!, (request) =>
    /(?:多代理|多账号|并发)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[25]!, (request) =>
    request.kind === "employment_dispatch" || /(?:用工|派遣|劳务|外包用工)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[26]!, (request) =>
    request.kind === "qualification" || /(?:资质代办|代办资质|许可证代办|代办许可证)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[27]!, (request) =>
    /(?:跨境|外汇|境外收款|结汇|购汇)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[28]!, (request) =>
    request.kind === "data_privacy" ||
    /(?:数据出境|敏感个人信息|个人信息出境|隐私数据出境)/u.test(textOf(request)),
  ),
  makeDefinition(BOUNDARY_ROWS_30[29]!, (request) =>
    request.kind === "quote" ||
    request.kind === "outreach" ||
    /(?:报价|外联|私信|发邮件)/u.test(textOf(request)),
  ),
);

/** 30 条边界规则（深拷贝；只读目录用于文档/表格/验收）。 */
export function boundaryRows30(): BoundaryRow30[] {
  return BOUNDARY_ROWS_30.map((row) => ({ ...row }));
}

/** 规则总数（必须恰好 30）。 */
export function boundaryRuleCount30(): number {
  return BOUNDARY_ROWS_30.length;
}

const STATUS_LABEL: Record<BoundaryImplementation, string> = {
  implemented: "已实现",
  human: "人工",
  not_applicable: "不适用",
};

const MODE_LABEL: Record<BoundaryRowMode, string> = {
  personal: "个人",
  enterprise: "企业",
  both: "双模式",
};

const MUST_LABEL: Record<BoundaryMust30, string> = {
  deny: "deny（拒绝）",
  human: "human（转人工）",
  draft_only: "draft_only（仅草稿）",
};

function tableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

/** 可直接入库的 30 条边界双模式标注表（Markdown）。 */
export function boundaryTableMarkdown(): string {
  const lines: string[] = [
    "# 30 条边界规则双模式标注表（个人 / 企业）",
    "",
    "> 由 `packages/steward-enterprise` 的 `boundaryRules30()` 生成：每条规则在个人、企业两种模式都标注「已实现 / 人工 / 不适用」。",
    "> 四类重点越界（EB-01 无证业务、EB-02 借用资质、EB-03 陌生外呼、EB-04 超预算）在个人 + 企业两种模式都 **deny**，理由可读并留痕。",
    "",
    "| 规则 | 触发 | 必须行为 | 用户文案 | 模式 | 个人 | 企业 | 测试 | 证据 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of BOUNDARY_ROWS_30) {
    lines.push(
      `| ${tableCell(row.rule_id)} | ${tableCell(row.trigger)} | ${tableCell(MUST_LABEL[row.must])} | ${tableCell(
        row.user_message,
      )} | ${tableCell(MODE_LABEL[row.mode])} | ${tableCell(STATUS_LABEL[row.personal])} | ${tableCell(
        STATUS_LABEL[row.enterprise],
      )} | ${tableCell(row.test_case_id)} | ${tableCell(row.evidence)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function isApplicable(row: BoundaryRow30, mode: OrderMode): boolean {
  return mode === "personal" ? row.personal !== "not_applicable" : row.enterprise !== "not_applicable";
}

/**
 * 边界判定（纯函数）：按目录顺序命中第一条规则；无命中 → allow。
 * 四个重点 deny 规则排在最前，个人/企业模式都会命中（mode=both）。
 */
export function evaluateBoundary30(
  request: EnterpriseBoundaryRequest,
  context: EnterpriseBoundaryContext,
): EnterpriseBoundaryResult {
  const mode: OrderMode = request.mode === "personal" ? "personal" : "enterprise";
  for (const definition of DEFINITIONS) {
    if (!isApplicable(definition.row, mode)) continue;
    let matched = false;
    try {
      matched = definition.match(request, context);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    return {
      decision: definition.row.must as BoundaryDecision30,
      rule_id: definition.row.rule_id,
      user_message: definition.row.user_message,
      mode,
    };
  }
  return {
    decision: "allow",
    rule_id: "ALLOW",
    user_message:
      "未命中 30 条企业版边界规则：可按委托范围与审批链继续；资金/合同/用印/申报仍必须人工确认。",
    mode,
  };
}
