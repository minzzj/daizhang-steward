/**
 * EnterpriseEngine：阶段二 P3「企业版」核心引擎（纯逻辑、零第三方依赖、无网络）。
 *
 * 企业增量：
 * - 企业认证主体（营业执照/经办人/公司授权书人签/用印）与 validateEntity 硬校验；
 * - 用印流程：只生成待签草案并定位签署页，**AI 不代签**（只有人工接口可置 signed）；
 * - 对公账户、增值税普票/专票、开票校验（抬头/税号/合同一致）、申报草稿（人确认提交）；
 * - 双人复核（收款账户变更：2 个不同角色都批准才生效）、组织级审批链（按金额分档）；
 * - 多代理/多账号串行（同 profile 同时只允许一个代理占用）；
 * - 30 条边界双模式标注表（个人/企业 已实现/人工/不适用）+ 四类越界双模式 deny；
 * - B8：个人/企业模式各跑一单 + 6 类不一致全部阻断（不产生发票/收款动作）。
 *
 * 安全默认：
 * - 模式/主体/抬头/收款/发票类型不一致 → block（`blocked=true`），只留审计，不产生发票与收款；
 * - 所有操作追加 audit（时间/操作/对象/结果/原因），`auditLog()` 可导出；
 * - 无任何真实资金、税务、开票动作；不联网、不启动进程。
 */

import {
  DualReviewRequiredError,
  EnterpriseValidationError,
  InvalidInvoiceError,
  ModeConflictError,
} from "./errors.js";
import {
  boundaryRuleCount30,
  boundaryRows30,
  boundaryTableMarkdown,
  evaluateBoundary30,
} from "./boundary.js";
import {
  defaultEnterpriseProfile,
  defaultPersonalEntity as makeDefaultPersonalEntity,
} from "./fixtures.js";
import type {
  AccountChangeInput,
  AccountChangeRequest,
  ApprovalChain,
  ApprovalSubmission,
  AuditEntry,
  AuditResult,
  BankAccount,
  BoundaryRow30,
  BusinessEntity,
  ClientType,
  DualModeMismatchEvidence,
  DualModeOrderEvidence,
  DualModeResult,
  EnterpriseBoundaryKind,
  EnterpriseBoundaryRequest,
  EnterpriseBoundaryResult,
  EnterpriseEngineOptions,
  EnterpriseProfile,
  EntityValidation,
  InvoiceType,
  InvoiceValidation,
  ModeConflict,
  OrderContext,
  OrderMode,
  OrderRunResult,
  PaymentCheck,
  PaymentMethod,
  SealFlow,
  SealFlowInput,
  SerialSlotResult,
  SignatureCheck,
  SignTaskStatus,
  TaxFilingDraft,
} from "./types.js";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 模式冲突码（B8 六类不一致；与 examples/demo-enterprise/enterprise.json 的 conflict_codes 对齐；只增不减）。 */
export const MODE_CONFLICT_CODES = {
  /** ① 模式与客户主体类型不一致（personal 只接 individual；enterprise 只接 company）。 */
  CLIENT_TYPE_MISMATCH: "MODE_CLIENT_TYPE_MISMATCH",
  /** ② 模式与收款方式不一致（enterprise → 对公；personal → 个人）。 */
  PAYMENT_METHOD_MISMATCH: "MODE_PAYMENT_METHOD_MISMATCH",
  /** ③ 模式与发票类型不一致（personal 仅 none / vat_general）。 */
  INVOICE_TYPE_MISMATCH: "MODE_INVOICE_TYPE_MISMATCH",
  /** ④ 企业模式 + 公司授权书未人签（pending_human/none）。 */
  AUTHORIZATION_LETTER_NOT_SIGNED: "AUTHORIZATION_LETTER_NOT_SIGNED",
  /** ⑤ 企业主体抬头与订单开票抬头不一致。 */
  INVOICE_TITLE_MISMATCH: "INVOICE_TITLE_MISMATCH",
  /** ⑤ 企业主体税号与订单开票税号不一致。 */
  TAX_NO_MISMATCH: "TAX_NO_MISMATCH",
  /** ⑥ 签署人非授权经办人/法定代表人。 */
  SIGNATORY_NOT_AUTHORIZED: "SIGNATORY_NOT_AUTHORIZED",
  /** ⑦ 需用印但用印未人签（AI 不代签 → 转人工）。 */
  SEAL_NOT_SIGNED: "SEAL_NOT_SIGNED",
} as const;

/** 双人复核需要不同角色数。 */
export const DUAL_REVIEW_REQUIRED_COUNT = 2;
/** 组织级审批链分档阈值（元）。 */
export const APPROVAL_TIER_SMALL_CNY = 5_000;
export const APPROVAL_TIER_MEDIUM_CNY = 50_000;
/** 个人模式合同约定的默认发票类型（普票）。 */
export const PERSONAL_CONTRACT_INVOICE_TYPE: InvoiceType = "vat_general";

const ORDER_MODES: readonly OrderMode[] = ["personal", "enterprise"];
const CLIENT_TYPES: readonly ClientType[] = ["individual", "company"];
const PAYMENT_METHODS: readonly PaymentMethod[] = ["personal_account", "corporate_account"];
const INVOICE_TYPES: readonly InvoiceType[] = ["none", "vat_general", "vat_special"];
const DECISIONS: readonly ("approve" | "reject")[] = ["approve", "reject"];
const ENTITY_KINDS = ["individual", "company"] as const;
const SIGN_STATUSES = ["none", "pending_human", "signed"] as const;
const ACCOUNT_TYPES = ["personal", "corporate"] as const;
const BOUNDARY_KINDS: readonly EnterpriseBoundaryKind[] = [
  "payment",
  "refund",
  "contract",
  "invoice",
  "tax",
  "account_change",
  "account_permission",
  "captcha",
  "promise",
  "quote",
  "outreach",
  "business_scope",
  "expense",
  "employment_dispatch",
  "qualification",
  "data_privacy",
  "other",
];

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 签署人是否像 AI/机器人（AI 一律不得代签/代盖，授权书必须自然人签署）。 */
export function isAiLikeSigner(value: string): boolean {
  const text = normalizeText(value);
  if (text.length === 0) return false;
  if (/(?:人工智能|机器人|虚拟人|数字人|智能助手|AI\s*代理|虚拟助理)/iu.test(text)) return true;
  return /(?:^|[^a-z])(?:ai|bot|robot|agent|assistant|llm)(?:[^a-z]|$)/iu.test(text);
}

function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EnterpriseValidationError(message ?? `${field} 不能为空`, "INVALID_INPUT", field);
  }
  return value.trim();
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new EnterpriseValidationError(`${field} 必须是 ${allowed.join(" / ")} 之一`, "INVALID_INPUT", field);
  }
  return value as T;
}

function requireNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EnterpriseValidationError(`${field} 必须是有限数字`, "INVALID_INPUT", field);
  }
  if (options.min !== undefined && value < options.min) {
    throw new EnterpriseValidationError(`${field} 不能小于 ${options.min}`, "INVALID_INPUT", field);
  }
  if (options.max !== undefined && value > options.max) {
    throw new EnterpriseValidationError(`${field} 不能大于 ${options.max}`, "INVALID_INPUT", field);
  }
  return value;
}

function requireStringArray(value: unknown, field: string, options: { min?: number } = {}): string[] {
  if (!Array.isArray(value)) {
    throw new EnterpriseValidationError(`${field} 必须是字符串数组`, "INVALID_INPUT", field);
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  if (options.min !== undefined && items.length < options.min) {
    throw new EnterpriseValidationError(`${field} 至少需要 ${options.min} 项`, "INVALID_INPUT", field);
  }
  return items.map((item) => item.trim());
}

/** 脱敏审计文本：只留摘要，避免敏感原文进入审计。 */
function digestText(value: string): string {
  const text = normalizeText(value);
  if (text.length === 0) return "（空）";
  return `${[...text].slice(0, 16).join("")}…（共 ${[...text].length} 字）`;
}

// ---------------------------------------------------------------------------
// 结构归一化（构造/入参）
// ---------------------------------------------------------------------------

function normalizeBankAccount(value: unknown, field: string): BankAccount {
  if (!isRecord(value)) throw new EnterpriseValidationError(`${field} 必须是对象`, "INVALID_INPUT", field);
  return {
    account_name: requireString(value.account_name, `${field}.account_name`),
    account_no_masked: requireString(value.account_no_masked, `${field}.account_no_masked`),
    bank_name: requireString(value.bank_name, `${field}.bank_name`),
    type: requireEnum(value.type, ACCOUNT_TYPES, `${field}.type`),
  };
}

/** 归一化主体（结构合法即可；认证完整性由 validateEntity 判定）。 */
function normalizeEntity(value: unknown, field: string): BusinessEntity {
  if (!isRecord(value)) throw new EnterpriseValidationError(`${field} 必须是对象`, "INVALID_INPUT", field);
  const entity: BusinessEntity = {
    id: requireString(value.id, `${field}.id`),
    kind: requireEnum(value.kind, ENTITY_KINDS, `${field}.kind`),
    name: requireString(value.name, `${field}.name`),
    bank_account: normalizeBankAccount(value.bank_account, `${field}.bank_account`),
    scope: typeof value.scope === "string" ? value.scope.trim() : "",
  };
  const license = value.license_no;
  if (license !== undefined) entity.license_no = requireString(license, `${field}.license_no`);
  const legal = value.legal_representative;
  if (legal !== undefined) entity.legal_representative = requireString(legal, `${field}.legal_representative`);
  const agent = value.agent_name;
  if (agent !== undefined) entity.agent_name = requireString(agent, `${field}.agent_name`);
  const taxNo = value.tax_no;
  if (taxNo !== undefined) entity.tax_no = requireString(taxNo, `${field}.tax_no`);
  const letter = value.authorization_letter;
  if (letter !== undefined) {
    if (!isRecord(letter)) {
      throw new EnterpriseValidationError(`${field}.authorization_letter 必须是对象`, "INVALID_INPUT", `${field}.authorization_letter`);
    }
    const normalized: NonNullable<BusinessEntity["authorization_letter"]> = {
      status: requireEnum(letter.status, SIGN_STATUSES, `${field}.authorization_letter.status`),
    };
    if (letter.signed_by !== undefined) {
      normalized.signed_by = requireString(letter.signed_by, `${field}.authorization_letter.signed_by`);
    }
    if (letter.path !== undefined) normalized.path = requireString(letter.path, `${field}.authorization_letter.path`);
    entity.authorization_letter = normalized;
  }
  const seal = value.seal;
  if (seal !== undefined) {
    if (!isRecord(seal)) {
      throw new EnterpriseValidationError(`${field}.seal 必须是对象`, "INVALID_INPUT", `${field}.seal`);
    }
    const normalized: NonNullable<BusinessEntity["seal"]> = {
      status: requireEnum(seal.status, SIGN_STATUSES, `${field}.seal.status`),
    };
    if (seal.signed_by !== undefined) normalized.signed_by = requireString(seal.signed_by, `${field}.seal.signed_by`);
    entity.seal = normalized;
  }
  return entity;
}

/** 归一化企业档案（构造时校验结构；主体认证完整性由 validateEntity 判定）。 */
function normalizeProfile(value: unknown): EnterpriseProfile {
  if (!isRecord(value)) throw new EnterpriseValidationError("profile 必须是对象", "INVALID_INPUT", "profile");
  const entity = normalizeEntity(value.entity, "profile.entity");
  const defaults = value.invoice_defaults;
  if (!isRecord(defaults)) {
    throw new EnterpriseValidationError("profile.invoice_defaults 必须是对象", "INVALID_INPUT", "profile.invoice_defaults");
  }
  const invoiceDefaults = {
    type: requireEnum(defaults.type, INVOICE_TYPES, "profile.invoice_defaults.type"),
    title: requireString(defaults.title, "profile.invoice_defaults.title"),
    tax_no: typeof defaults.tax_no === "string" ? defaults.tax_no.trim() : "",
  };
  if (invoiceDefaults.type !== "none" && invoiceDefaults.tax_no.length === 0) {
    throw new EnterpriseValidationError(
      "profile.invoice_defaults.tax_no 不能为空（开票必须税号一致）",
      "INVALID_INPUT",
      "profile.invoice_defaults.tax_no",
    );
  }
  const policy = value.review_policy;
  if (!isRecord(policy)) {
    throw new EnterpriseValidationError("profile.review_policy 必须是对象", "INVALID_INPUT", "profile.review_policy");
  }
  const reviewPolicy = {
    dual_review_threshold_cny: requireNumber(
      policy.dual_review_threshold_cny,
      "profile.review_policy.dual_review_threshold_cny",
      { min: 0 },
    ),
    dual_review_roles: requireStringArray(policy.dual_review_roles, "profile.review_policy.dual_review_roles", { min: 2 }),
    approval_chain: requireStringArray(policy.approval_chain, "profile.review_policy.approval_chain", { min: 1 }),
  };
  const seats = requireNumber(value.seats, "profile.seats", { min: 1 });
  if (typeof value.multi_agent_serial !== "boolean") {
    throw new EnterpriseValidationError("profile.multi_agent_serial 必须是布尔值", "INVALID_INPUT", "profile.multi_agent_serial");
  }
  return {
    entity,
    invoice_defaults: invoiceDefaults,
    review_policy: reviewPolicy,
    seats,
    multi_agent_serial: value.multi_agent_serial,
  };
}

type OptionalStringField = "client_invoice_title" | "client_tax_no" | "signatory" | "scope_hint" | "agent_id";

const OPTIONAL_STRING_FIELDS: readonly OptionalStringField[] = [
  "client_invoice_title",
  "client_tax_no",
  "signatory",
  "scope_hint",
  "agent_id",
];

/** 归一化订单上下文（所有枚举/数字字段强校验；可选项仅在提供时写入）。 */
function normalizeOrderContext(value: unknown): OrderContext {
  if (!isRecord(value)) throw new EnterpriseValidationError("订单上下文必须是对象", "INVALID_INPUT", "order");
  const order: OrderContext = {
    mode: requireEnum(value.mode, ORDER_MODES, "mode"),
    client_type: requireEnum(value.client_type, CLIENT_TYPES, "client_type"),
    quote_cny: requireNumber(value.quote_cny, "quote_cny", { min: 0 }),
    invoice_type_requested: requireEnum(value.invoice_type_requested, INVOICE_TYPES, "invoice_type_requested"),
    payment_method: requireEnum(value.payment_method, PAYMENT_METHODS, "payment_method"),
  };
  if (order.quote_cny <= 0) throw new EnterpriseValidationError("quote_cny 必须大于 0", "INVALID_INPUT", "quote_cny");
  for (const field of OPTIONAL_STRING_FIELDS) {
    const raw = value[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new EnterpriseValidationError(`${field} 必须是字符串`, "INVALID_INPUT", field);
    const text = raw.trim();
    if (text.length > 0) order[field] = text;
  }
  if (value.seal_required !== undefined && value.seal_required !== null) {
    if (typeof value.seal_required !== "boolean") {
      throw new EnterpriseValidationError("seal_required 必须是布尔值", "INVALID_INPUT", "seal_required");
    }
    order.seal_required = value.seal_required;
  }
  // fixtures 允许按单覆盖授权书/用印状态（例如模拟 pending_human）；"not_required" 归一为 none。
  for (const field of ["authorization_letter_status", "seal_status"] as const) {
    const raw = value[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      throw new EnterpriseValidationError(`${field} 必须是字符串`, "INVALID_INPUT", field);
    }
    order[field] = raw === "not_required" ? "none" : requireEnum(raw, SIGN_STATUSES, field);
  }
  return order;
}

/** 归一化边界请求。 */
function normalizeBoundaryRequest(value: unknown): EnterpriseBoundaryRequest {
  if (!isRecord(value)) throw new EnterpriseValidationError("边界请求必须是对象", "INVALID_INPUT", "request");
  if (typeof value.text !== "string") {
    throw new EnterpriseValidationError("边界请求 text 必须是字符串", "INVALID_INPUT", "text");
  }
  const kind = requireEnum(value.kind, BOUNDARY_KINDS, "kind");
  const request: EnterpriseBoundaryRequest = { kind, text: value.text };
  if (value.mode !== undefined) request.mode = requireEnum(value.mode, ORDER_MODES, "mode");
  const numberFields = ["amount_cny", "budget_cny"] as const;
  for (const field of numberFields) {
    const raw = value[field];
    if (raw === undefined) continue;
    request[field] = requireNumber(raw, field, { min: 0 });
  }
  const booleanFields = [
    "requires_license",
    "requires_offline",
    "is_unknown_outreach",
    "has_authorization",
    "out_of_scope",
  ] as const;
  for (const field of booleanFields) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") throw new EnterpriseValidationError(`${field} 必须是布尔值`, "INVALID_INPUT", field);
    request[field] = raw;
  }
  return request;
}

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

/** 企业版核心引擎：一个实例对应一次企业版运行（档案 + 内存审计/流程状态）。 */
export class EnterpriseEngine {
  /** 企业档案（只读引用；CLI/证据可直接读取；修改请通过方法）。 */
  readonly profile: EnterpriseProfile;
  private readonly personalEntity: BusinessEntity;
  private readonly now: () => Date;

  private readonly auditEntries: AuditEntry[] = [];
  private auditSeq = 0;
  private accountChangeSeq = 0;
  private approvalSeq = 0;
  private taxSeq = 0;
  private readonly accountChanges: AccountChangeRequest[] = [];
  private readonly sealFlowsById = new Map<string, SealFlow>();
  private agentSlotHolder: string | null = null;

  constructor(options: EnterpriseEngineOptions = {}) {
    const raw = isRecord(options) ? options : {};
    this.now = typeof raw.now === "function" ? (raw.now as () => Date) : () => new Date();
    this.profile = raw.profile === undefined ? defaultEnterpriseProfile() : normalizeProfile(raw.profile);
    this.personalEntity =
      raw.personal_entity === undefined ? makeDefaultPersonalEntity() : normalizeEntity(raw.personal_entity, "personal_entity");
  }

  // -------------------------------------------------------------------------
  // 0) 只读视图
  // -------------------------------------------------------------------------

  /** 虚构企业默认档案（深拷贝；CLI 演示用，非真实公司）。 */
  defaultProfile(): EnterpriseProfile {
    return defaultEnterpriseProfile();
  }

  get currentProfile(): EnterpriseProfile {
    return clone(this.profile);
  }

  get currentEntity(): BusinessEntity {
    return clone(this.profile.entity);
  }

  get currentPersonalEntity(): BusinessEntity {
    return clone(this.personalEntity);
  }

  /** 已追加的审计行数（测试/CLI 核对追加用）。 */
  get auditCount(): number {
    return this.auditEntries.length;
  }

  /** 审计日志（时间/操作/对象/结果/原因，追加顺序；返回副本防篡改）。 */
  auditLog(): AuditEntry[] {
    return clone(this.auditEntries);
  }

  // -------------------------------------------------------------------------
  // 1) 主体认证校验
  // -------------------------------------------------------------------------

  /** 企业认证硬校验：license_no + authorization_letter.signed + corporate 账户 + tax_no。 */
  validateEntity(entity?: BusinessEntity): EntityValidation {
    const target = entity === undefined ? this.profile.entity : normalizeEntity(entity, "entity");
    const issues: string[] = [];
    if (target.kind === "company") {
      if (normalizeText(target.license_no).length === 0) issues.push("缺少营业执照号 license_no");
      if (target.authorization_letter?.status !== "signed") {
        issues.push("公司授权书 authorization_letter 必须由自然人签署（status 必须为 signed）");
      }
      if (target.bank_account.type !== "corporate") {
        issues.push("企业主体必须绑定对公账户（bank_account.type 必须为 corporate）");
      }
      if (normalizeText(target.tax_no).length === 0) issues.push("缺少纳税人识别号 tax_no");
    } else {
      if (normalizeText(target.name).length === 0) issues.push("个人主体缺少名称 name");
      if (target.bank_account.type !== "personal") {
        issues.push("个人主体必须使用个人账户（bank_account.type 必须为 personal）");
      }
    }
    const letterSigner = target.authorization_letter?.signed_by;
    if (letterSigner !== undefined && isAiLikeSigner(letterSigner)) {
      issues.push("公司授权书签署人不能是 AI/机器人（必须自然人签署）");
    }
    const sealSigner = target.seal?.signed_by;
    if (sealSigner !== undefined && isAiLikeSigner(sealSigner)) {
      issues.push("用印签署人不能是 AI/机器人（必须自然人签署）");
    }
    return { ok: issues.length === 0, entity_id: target.id, kind: target.kind, issues };
  }

  /** 断言式主体校验：不完整时抛 EnterpriseValidationError（CLI 动作前调用）。 */
  assertValidEntity(entity?: BusinessEntity): EntityValidation {
    const result = this.validateEntity(entity);
    if (!result.ok) {
      throw new EnterpriseValidationError(
        `企业主体认证不完整：${result.issues.join("；")}`,
        "INVALID_INPUT",
        "entity",
      );
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 2) 模式一致性（B8：六类不一致必须阻断）
  // -------------------------------------------------------------------------

  /** 模式一致性校验：返回 block/warn 级冲突（block 必须阻断）。 */
  checkModeConsistency(order: OrderContext): ModeConflict[] {
    return this.checkModeConsistencyInternal(
      normalizeOrderContext(order),
      this.profile,
      this.personalEntity,
    );
  }

  /** 断言式模式一致性校验：存在 block 冲突抛 ModeConflictError。 */
  assertNoModeConflict(order: OrderContext): ModeConflict[] {
    const conflicts = this.checkModeConsistency(order);
    const blocks = conflicts.filter((conflict) => conflict.severity === "block");
    if (blocks.length > 0) {
      throw new ModeConflictError(
        `模式一致性校验未通过（B8 阻断）：${blocks.map((conflict) => `${conflict.code}@${conflict.field}`).join("; ")}`,
        conflicts,
      );
    }
    return conflicts;
  }

  private checkModeConsistencyInternal(
    order: OrderContext,
    profile: EnterpriseProfile,
    personalEntity: BusinessEntity,
  ): ModeConflict[] {
    const conflicts: ModeConflict[] = [];
    const push = (
      code: string,
      field: string,
      message: string,
      severity: "block" | "warn" = "block",
    ): void => {
      conflicts.push({ code, field, message, severity });
    };

    // ① 模式与客户主体类型不一致（personal 只接 individual；enterprise 只接 company）。
    const allowedClientTypes: readonly ClientType[] = order.mode === "personal" ? ["individual"] : ["company"];
    if (!allowedClientTypes.includes(order.client_type)) {
      push(
        MODE_CONFLICT_CODES.CLIENT_TYPE_MISMATCH,
        "client_type",
        `${order.mode} 模式只允许 ${allowedClientTypes.join(" / ")} 客户：当前为 ${order.client_type}，主体/客户类型不一致（B8），已阻断。`,
      );
    }

    // ② 收款方式与模式不一致（enterprise → 对公；personal → 个人）。
    const expectedPaymentMethod: PaymentMethod =
      order.mode === "personal" ? "personal_account" : "corporate_account";
    if (order.payment_method !== expectedPaymentMethod) {
      push(
        MODE_CONFLICT_CODES.PAYMENT_METHOD_MISMATCH,
        "payment_method",
        `${order.mode} 模式必须使用 ${expectedPaymentMethod} 收款：当前为 ${order.payment_method}，主体/收款不一致（B8），已阻断。`,
      );
    }

    // ③ 发票类型与模式不一致（personal 仅 none / vat_general；enterprise 允许普票/专票/无票）。
    const allowedInvoiceTypes: readonly InvoiceType[] =
      order.mode === "personal" ? ["none", "vat_general"] : ["none", "vat_general", "vat_special"];
    if (!allowedInvoiceTypes.includes(order.invoice_type_requested)) {
      push(
        MODE_CONFLICT_CODES.INVOICE_TYPE_MISMATCH,
        "invoice_type_requested",
        `${order.mode} 模式不允许开具 ${order.invoice_type_requested}：发票类型与模式不一致（B8），已阻断。请切换模式或改用允许的发票类型。`,
      );
    }

    // ④ 企业模式 + 公司授权书必须已完成人签（订单级覆盖只能更严格，不能伪造已签）。
    if (order.mode === "enterprise") {
      const authStatus = effectiveSignStatus(
        order.authorization_letter_status,
        profile.entity.authorization_letter?.status,
      );
      if (authStatus !== "signed") {
        push(
          MODE_CONFLICT_CODES.AUTHORIZATION_LETTER_NOT_SIGNED,
          "authorization_letter",
          `企业模式必须先完成公司授权书人签（当前 ${authStatus}）：AI 不代签，已阻断并转人工签署后再执行。`,
        );
      }
    }

    // ⑤ 开票校验：企业主体抬头/税号必须与订单开票信息一致（抬头与税号分开上报，便于定位）。
    if (order.mode === "enterprise" && order.invoice_type_requested !== "none") {
      const identity = enterpriseInvoiceIdentity(profile);
      const title = normalizeText(order.client_invoice_title);
      const taxNo = normalizeText(order.client_tax_no);
      if (title !== identity.title) {
        push(
          MODE_CONFLICT_CODES.INVOICE_TITLE_MISMATCH,
          "client_invoice_title",
          `开票抬头不一致（订单「${title || "缺失"}」≠ 认证主体「${identity.title}」）：已阻断（不产生发票），请核对合同/抬头。`,
        );
      }
      if (taxNo !== identity.tax_no) {
        push(
          MODE_CONFLICT_CODES.TAX_NO_MISMATCH,
          "client_tax_no",
          `开票税号不一致（订单「${taxNo || "缺失"}」≠ 认证主体「${identity.tax_no}」）：已阻断并转人工核对，AI 不猜测/补全税号。`,
        );
      }
    }

    // ⑥ 签署人必须是有权代表（企业 = 授权经办人/法定代表人；个人模式由客户本人签署，不拦）。
    if (order.mode === "enterprise") {
      const signatory = normalizeText(order.signatory);
      if (signatory.length > 0) {
        const allowed = signatoriesFor(order.mode, profile, personalEntity);
        if (!allowed.includes(signatory)) {
          push(
            MODE_CONFLICT_CODES.SIGNATORY_NOT_AUTHORIZED,
            "signatory",
            `签署人「${signatory}」不是授权经办人/法定代表人（允许：${allowed.join("、") || "无"}），已阻断并转人工。`,
          );
        }
      }
    }

    // ⑦ 需用印但用印未人签 → 转人工（AI 不代签；订单级覆盖只能更严格）。
    if (order.seal_required === true) {
      const baseSealStatus =
        order.mode === "enterprise" ? profile.entity.seal?.status : personalEntity.seal?.status;
      const sealStatus = effectiveSignStatus(order.seal_status, baseSealStatus);
      if (sealStatus !== "signed") {
        push(
          MODE_CONFLICT_CODES.SEAL_NOT_SIGNED,
          "seal",
          "本单需要签署/用印，但用印尚未由自然人完成：AI 不代签，已阻断并转人工签署后再执行。",
        );
      }
    }

    return conflicts;
  }

  // -------------------------------------------------------------------------
  // 3) 跑单（blocked 时不产生发票/收款，只留审计）
  // -------------------------------------------------------------------------

  /**
   * 跑一单：六类不一致 → blocked=true，只写审计，**不产生发票、不发生收款动作**。
   * 未阻断时：校验收款路径 + 生成开票草稿（draft_pending_human，等待人工确认提交）。
   */
  runOrder(order: OrderContext): OrderRunResult {
    return this.runOrderInternal(normalizeOrderContext(order), this.profile, this.personalEntity);
  }

  private runOrderInternal(
    order: OrderContext,
    profile: EnterpriseProfile,
    personalEntity: BusinessEntity,
  ): OrderRunResult {
    const auditStart = this.auditEntries.length;
    const conflicts = this.checkModeConsistencyInternal(order, profile, personalEntity);
    const blocks = conflicts.filter((conflict) => conflict.severity === "block");
    const blocked = blocks.length > 0;
    const expectedAccountType: "personal" | "corporate" = order.mode === "personal" ? "personal" : "corporate";

    const signatureRequired = order.seal_required === true;
    const signatories = signatoriesFor(order.mode, profile, personalEntity);
    const providedSignatory = normalizeText(order.signatory);
    const signatoryOk =
      order.mode === "personal"
        ? true // 个人模式由客户本人签署，AI 不代签即可，不校验我方经办人
        : providedSignatory.length === 0
          ? !signatureRequired
          : signatories.includes(providedSignatory);

    const signature: SignatureCheck = {
      required: signatureRequired,
      signatory_ok: signatoryOk,
      ai_may_sign: false,
    };
    if (signatureRequired) {
      signature.message = signatoryOk
        ? "用印已由自然人完成；本单签署人合法（AI 不代签），可进入人工确认环节。"
        : "本单需用印但签署人不是授权经办人：已转人工，AI 不代签。";
    } else if (providedSignatory.length > 0) {
      signature.message =
        order.mode === "personal"
          ? "本单无需用印；个人模式由客户本人签署，AI 不代签。"
          : "本单无需用印；签署人已按授权经办人校验。";
    } else {
      signature.message = "本单无需签署/用印。";
    }

    const payment: PaymentCheck = blocked
      ? {
          ok: false,
          account_type: expectedAccountType,
          message: `订单被阻断：未产生任何收款动作（未发生真实资金流，未变更收款账户）。阻断原因：${blocks
            .map((conflict) => conflict.code)
            .join(", ")}`,
        }
      : {
          ok: true,
          account_type: expectedAccountType,
          message:
            order.mode === "enterprise"
              ? "对公账户收款路径校验通过（仅记录校验结果，未发生真实收款）。"
              : "个人账户收款路径校验通过（仅记录校验结果，未发生真实收款）。",
        };

    this.recordAudit(
      "order.run",
      `order:${order.mode}/${order.client_type}`,
      blocked ? "blocked" : "ok",
      blocked
        ? `模式/主体/抬头/收款/发票类型不一致，已阻断：${blocks.map((conflict) => conflict.code).join(", ")}`
        : `mode=${order.mode}; quote=${order.quote_cny}; invoice=${order.invoice_type_requested}; payment=${order.payment_method}`,
    );

    let invoice: InvoiceValidation | undefined;
    if (!blocked && order.invoice_type_requested !== "none") {
      invoice = this.createInvoiceDraftInternal(order, profile, personalEntity);
    }

    const result: OrderRunResult = {
      blocked,
      conflicts,
      payment,
      signature,
      audit: clone(this.auditEntries.slice(auditStart)),
    };
    if (invoice !== undefined) result.invoice = invoice;
    return result;
  }

  /** 开票草稿：校验抬头/税号/合同一致，只返回 draft_pending_human（绝不自动提交/开票）。 */
  createInvoiceDraft(order: OrderContext): InvoiceValidation {
    return this.createInvoiceDraftInternal(normalizeOrderContext(order), this.profile, this.personalEntity);
  }

  private createInvoiceDraftInternal(
    order: OrderContext,
    profile: EnterpriseProfile,
    personalEntity: BusinessEntity,
  ): InvoiceValidation {
    const invoiceType = order.invoice_type_requested;
    if (invoiceType === "vat_special" && order.mode === "personal") {
      throw new InvalidInvoiceError(
        "个人模式不能开具增值税专用发票：缺少企业主体与对公账户，请切换企业模式。",
        "invoice_type_requested",
      );
    }

    const subject = order.mode === "enterprise" ? profile.entity : personalEntity;
    const identity =
      order.mode === "enterprise"
        ? enterpriseInvoiceIdentity(profile)
        : { title: normalizeText(personalEntity.name), tax_no: normalizeText(personalEntity.tax_no) };
    const title = normalizeText(order.client_invoice_title);
    const taxNo = normalizeText(order.client_tax_no);

    if (invoiceType === "none") {
      const validation: InvoiceValidation = {
        ok: true,
        invoice_type: "none",
        title,
        tax_no: taxNo,
        checks: { title_matches: true, tax_no_matches: true, contract_matches: true },
        draft_status: "draft_pending_human",
        message: "本单无需开票（invoice_type=none）：未生成发票草稿，也不自动提交任何税务动作。",
      };
      this.recordAudit("invoice.draft", `invoice:${order.mode}`, "pending", "invoice_type=none，无需开票");
      return validation;
    }

    const titleMatches = title.length > 0 && title === identity.title;
    const taxNoMatches = identity.tax_no.length > 0 ? taxNo === identity.tax_no : taxNo.length === 0;
    const contractType =
      order.mode === "enterprise" ? profile.invoice_defaults.type : PERSONAL_CONTRACT_INVOICE_TYPE;
    const typeMatches = contractType !== "none" && invoiceType === contractType;
    const contractMatches = titleMatches && taxNoMatches && typeMatches;
    const ok = titleMatches && taxNoMatches && contractMatches;

    const problems: string[] = [];
    if (!titleMatches) {
      problems.push(`抬头不一致（订单「${title || "缺失"}」≠ 主体「${identity.title}」）`);
    }
    if (!taxNoMatches) {
      problems.push(`税号不一致（订单「${taxNo || "缺失"}」≠ 主体「${identity.tax_no || "无税号"}」）`);
    }
    if (!typeMatches) {
      problems.push(`发票类型与合同约定不一致（申请 ${invoiceType}，合同约定 ${contractType}）`);
    }

    const validation: InvoiceValidation = {
      ok,
      invoice_type: invoiceType,
      title,
      tax_no: taxNo,
      checks: { title_matches: titleMatches, tax_no_matches: taxNoMatches, contract_matches: contractMatches },
      draft_status: "draft_pending_human",
      message: ok
        ? "发票抬头/税号/合同一致：已生成开票草稿，等待人工确认提交（不自动提交、不自动开票）。"
        : `开票校验未通过（${problems.join("；")}）：不生成可提交发票，已转人工核对。`,
    };
    this.recordAudit(
      "invoice.draft",
      `invoice:${invoiceType}`,
      ok ? "pending" : "blocked",
      validation.message,
    );
    return validation;
  }

  // -------------------------------------------------------------------------
  // 4) 双人复核（收款账户变更）
  // -------------------------------------------------------------------------

  /** 发起收款账户变更：默认 pending_dual_review，绝不自动生效。 */
  requestAccountChange(input: AccountChangeInput): AccountChangeRequest {
    if (!isRecord(input)) throw new EnterpriseValidationError("账户变更请求必须是对象", "INVALID_INPUT", "input");
    const raw = input as AccountChangeInput;
    const from = requireString(raw.from ?? raw.from_account, "from");
    const to = requireString(raw.to ?? raw.to_account, "to");
    const requestedBy = requireString(raw.requested_by, "requested_by");
    if (from === to) throw new EnterpriseValidationError("新旧收款账户不能相同", "INVALID_INPUT", "to");
    this.accountChangeSeq += 1;
    const request: AccountChangeRequest = {
      id: `acr-${pad3(this.accountChangeSeq)}`,
      from_account: from,
      to_account: to,
      requested_by: requestedBy,
      status: "pending_dual_review",
      reviews: [],
      applied: false,
      created_at: this.nowIso(),
    };
    this.accountChanges.push(request);
    this.recordAudit(
      "account_change.requested",
      `account_change:${request.id}`,
      "pending",
      `由「${requestedBy}」发起：${from} → ${to}；需 ${DUAL_REVIEW_REQUIRED_COUNT} 个不同角色复核批准后生效`,
    );
    return clone(request);
  }

  /** 复核收款账户变更：2 个不同角色都 approve 才 applied；重复/拒绝不生效。 */
  reviewAccountChange(
    id: string,
    reviewer: string,
    decision: "approve" | "reject",
  ): AccountChangeRequest {
    const requestId = requireString(id, "id");
    const reviewerName = requireString(reviewer, "reviewer");
    const decisionValue = requireEnum(decision, DECISIONS, "decision");
    const change = this.accountChanges.find((item) => item.id === requestId);
    if (change === undefined) {
      throw new EnterpriseValidationError(`未找到收款账户变更请求：${requestId}`, "NOT_FOUND", "id");
    }
    if (change.status === "rejected") {
      throw new DualReviewRequiredError(`请求 ${requestId} 已被驳回，不能继续复核；需要重新发起变更`, requestId);
    }
    if (change.status === "approved") {
      throw new DualReviewRequiredError(`请求 ${requestId} 已生效，不能重复复核`, requestId);
    }
    const role = this.resolveReviewRole(reviewerName);
    const existingRoles = change.reviews.map((review) => this.resolveReviewRole(review.reviewer));
    if (existingRoles.includes(role)) {
      throw new DualReviewRequiredError(
        `重复复核无效：角色「${role}」已复核过，本次不计入；需要 ${DUAL_REVIEW_REQUIRED_COUNT} 个不同角色分别批准`,
        requestId,
      );
    }

    change.reviews.push({ reviewer: reviewerName, decision: decisionValue, at: this.nowIso() });
    if (decisionValue === "reject") {
      change.status = "rejected";
      change.applied = false;
      this.recordAudit(
        "account_change.rejected",
        `account_change:${requestId}`,
        "blocked",
        `复核人「${reviewerName}」（${role}）驳回：收款账户不变更（不生效）`,
      );
      return clone(change);
    }

    const approvals = new Set(
      change.reviews
        .filter((review) => review.decision === "approve")
        .map((review) => this.resolveReviewRole(review.reviewer)),
    );
    if (approvals.size >= DUAL_REVIEW_REQUIRED_COUNT) {
      change.status = "approved";
      change.applied = true;
      const account = this.profile.entity.bank_account;
      this.profile.entity.bank_account = { ...account, account_no_masked: change.to_account };
      this.recordAudit(
        "account_change.applied",
        `account_change:${requestId}`,
        "ok",
        `${approvals.size} 个不同角色批准（${[...approvals].join("、")}）：收款账户已切换为 ${change.to_account}`,
      );
    } else {
      this.recordAudit(
        "account_change.review",
        `account_change:${requestId}`,
        "pending",
        `已收到 ${approvals.size}/${DUAL_REVIEW_REQUIRED_COUNT} 个不同角色批准（${[...approvals].join("、")}），仍需其他角色复核`,
      );
    }
    return clone(change);
  }

  /** 收款账户变更列表（证据导出用）。 */
  accountChangesList(): AccountChangeRequest[] {
    return clone(this.accountChanges);
  }

  private resolveReviewRole(reviewer: string): string {
    const roles = this.profile.review_policy.dual_review_roles;
    const name = reviewer.trim();
    const exact = roles.find((role) => role === name);
    if (exact !== undefined) return exact;
    const partial = roles.find((role) => name.includes(role) || role.includes(name));
    return partial ?? name;
  }

  // -------------------------------------------------------------------------
  // 5) 组织级审批链
  // -------------------------------------------------------------------------

  /** 组织级审批链：≤5000 负责人；5000–50000 负责人+财务；>50000 负责人+财务+法人。 */
  approvalChainFor(amount_cny: number): ApprovalChain {
    const amount = requireNumber(amount_cny, "amount_cny", { min: 0 });
    const roles = this.profile.review_policy.approval_chain;
    const owner = roles[0] ?? "负责人";
    const finance = roles[1] ?? "财务";
    const legal = roles[2] ?? "法人";
    let chain: string[];
    if (amount <= APPROVAL_TIER_SMALL_CNY) {
      chain = [owner];
    } else if (amount <= APPROVAL_TIER_MEDIUM_CNY) {
      chain = [owner, finance];
    } else {
      chain = [owner, finance, legal];
    }
    return { amount_cny: amount, chain, roles: [...chain] };
  }

  /** 提交组织审批：只产生 pending 待办，绝不自动放行。 */
  submitForApproval(order: OrderContext): ApprovalSubmission {
    const context = normalizeOrderContext(order);
    this.approvalSeq += 1;
    const chain = this.approvalChainFor(context.quote_cny).chain;
    const submission: ApprovalSubmission = {
      id: `apv-${pad3(this.approvalSeq)}`,
      status: "pending",
      amount_cny: context.quote_cny,
      chain,
      submitted_at: this.nowIso(),
    };
    this.recordAudit(
      "approval.submitted",
      `approval:${submission.id}`,
      "pending",
      `金额 ¥${context.quote_cny} 进入组织级审批链：${chain.join(" → ")}（等待人工审批，不自动放行）`,
    );
    return submission;
  }

  // -------------------------------------------------------------------------
  // 6) 用印流程（AI 不代签）
  // -------------------------------------------------------------------------

  /** 生成待签草案并定位签署页：状态 pending_human，AI 永不代签。 */
  sealFlow(doc: SealFlowInput | string): SealFlow {
    let docId = "";
    let hint: string | undefined;
    let title: string | undefined;
    if (typeof doc === "string") {
      docId = requireString(doc, "doc_id");
    } else if (isRecord(doc)) {
      docId = requireString(doc.doc_id, "doc_id");
      const rawHint = doc.signing_page_hint;
      if (rawHint !== undefined) hint = requireString(rawHint, "signing_page_hint");
      const rawTitle = doc.title;
      if (rawTitle !== undefined) title = requireString(rawTitle, "title");
    } else {
      throw new EnterpriseValidationError("sealFlow 需要 doc_id 或 { doc_id }", "INVALID_INPUT", "doc");
    }
    const existing = this.sealFlowsById.get(docId);
    if (existing !== undefined) return clone(existing);
    const defaultHint =
      title !== undefined
        ? `「${title}」签署页/盖章页（需人工定位）`
        : `合同「${docId}」签署页/盖章页（需人工定位）`;
    const flow: SealFlow = {
      doc_id: docId,
      status: "pending_human",
      ai_may_sign: false,
      signing_page_hint: hint ?? defaultHint,
      next_action: "请人工在签署页完成签名/用印并回传证据；AI 只生成待签草案并定位签署页，不代签。",
    };
    this.sealFlowsById.set(docId, flow);
    this.recordAudit(
      "seal.pending_human",
      `seal:${docId}`,
      "pending",
      "已生成待签草案并定位签署页，等待自然人签署/用印（AI 不代签）",
    );
    return clone(flow);
  }

  /** 仅人工可调用：把用印流程置为 signed；AI/机器人署名一律拒绝（AI 不代签）。 */
  markSealSignedByHuman(doc_id: string, by: string): SealFlow {
    const docId = requireString(doc_id, "doc_id");
    const signer = requireString(by, "by");
    const flow = this.sealFlowsById.get(docId);
    if (flow === undefined) {
      throw new EnterpriseValidationError(`未找到用印流程 ${docId}：请先 sealFlow(doc) 生成待签草案`, "NOT_FOUND", "doc_id");
    }
    if (flow.status === "signed") return clone(flow);
    if (isAiLikeSigner(signer)) {
      throw new EnterpriseValidationError(
        "AI 不代签：用印必须由自然人完成，签署人不能是 AI/机器人/代理（agent）",
        "INVALID_INPUT",
        "by",
      );
    }
    flow.status = "signed";
    flow.signed_by = signer;
    flow.signed_at = this.nowIso();
    flow.next_action = "人工签署/用印已完成并留痕，可进入归档与交付。";
    this.recordAudit("seal.signed_by_human", `seal:${docId}`, "ok", `由自然人「${signer}」完成签署/用印`);
    return clone(flow);
  }

  /** 用印流程列表（证据导出用）。 */
  sealFlows(): SealFlow[] {
    return [...this.sealFlowsById.values()].map((flow) => clone(flow));
  }

  // -------------------------------------------------------------------------
  // 7) 税务申报草稿（人确认提交）
  // -------------------------------------------------------------------------

  /** 生成税务申报草稿：人确认后才能提交，AI 不自动申报。 */
  createTaxFilingDraft(period: string): TaxFilingDraft {
    const value = requireString(period, "period");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) {
      throw new EnterpriseValidationError("period 格式必须为 YYYY-MM（如 2026-10）", "INVALID_INPUT", "period");
    }
    this.taxSeq += 1;
    const draft: TaxFilingDraft = {
      draft_id: `tax-${pad3(this.taxSeq)}`,
      period: value,
      status: "draft_pending_human",
      ai_may_submit: false,
      next_action: "人工核对申报数据后在税务系统确认提交；AI 不自动申报、不代签税务材料。",
    };
    this.recordAudit(
      "tax.filing_draft",
      `tax:${draft.draft_id}`,
      "pending",
      `已生成 ${value} 申报草稿，等待人工确认提交`,
    );
    return draft;
  }

  // -------------------------------------------------------------------------
  // 8) 多代理/多账号串行
  // -------------------------------------------------------------------------

  /** 获取串行执行槽：同 profile 同一时刻只允许一个代理（多代理/多账号必须串行）。 */
  acquireAgentSlot(agent_id: string): SerialSlotResult {
    const agent = requireString(agent_id, "agent_id");
    if (!this.profile.multi_agent_serial) {
      return {
        ok: true,
        holder: this.agentSlotHolder,
        message: "当前档案未启用 multi_agent_serial（单代理模式），无需串行锁。",
      };
    }
    if (this.agentSlotHolder !== null && this.agentSlotHolder !== agent) {
      this.recordAudit(
        "multi_agent.serial_blocked",
        `agent:${agent}`,
        "blocked",
        `串行执行槽被「${this.agentSlotHolder}」占用，拒绝并发执行`,
      );
      return {
        ok: false,
        holder: this.agentSlotHolder,
        message: `多代理串行：当前由「${this.agentSlotHolder}」占用，请等待其释放后再执行（不允许并发）。`,
      };
    }
    this.agentSlotHolder = agent;
    this.recordAudit("multi_agent.serial_acquired", `agent:${agent}`, "ok", "已获取串行执行槽");
    return { ok: true, holder: agent, message: "已获取串行执行槽（同一时刻仅一个代理/账号操作）。" };
  }

  /** 释放串行执行槽。 */
  releaseAgentSlot(agent_id: string): SerialSlotResult {
    const agent = requireString(agent_id, "agent_id");
    if (this.agentSlotHolder !== agent) {
      const holder = this.agentSlotHolder;
      return {
        ok: false,
        holder,
        message:
          holder === null
            ? "当前没有代理占用串行执行槽。"
            : `串行执行槽由「${holder}」占用，不能由「${agent}」释放。`,
      };
    }
    this.agentSlotHolder = null;
    this.recordAudit("multi_agent.serial_released", `agent:${agent}`, "ok", "已释放串行执行槽");
    return { ok: true, holder: null, message: "已释放串行执行槽。" };
  }

  // -------------------------------------------------------------------------
  // 9) 30 条边界（双模式标注 + 判定）
  // -------------------------------------------------------------------------

  /** 30 条边界规则（恰好 30 条；双模式标注齐全）。 */
  boundaryRules30(): BoundaryRow30[] {
    return boundaryRows30();
  }

  /** 规则总数（必须恰好 30）。 */
  boundaryRuleCount(): number {
    return boundaryRuleCount30();
  }

  /** 可直接入库的 30 条边界双模式标注表（中文表头 Markdown）。 */
  boundaryTableMarkdown(): string {
    return boundaryTableMarkdown();
  }

  /** 边界判定：四类越界（无证/借资质/陌生外呼/超预算）个人+企业双模式都 deny。 */
  checkBoundary(request: EnterpriseBoundaryRequest): EnterpriseBoundaryResult {
    const normalized = normalizeBoundaryRequest(request);
    const result = evaluateBoundary30(normalized, {
      review_policy: this.profile.review_policy,
      entity: {
        name: this.profile.entity.name,
        scope: this.profile.entity.scope,
        kind: this.profile.entity.kind,
      },
    });
    const auditResult: AuditResult =
      result.decision === "allow" ? "ok" : result.decision === "deny" ? "blocked" : "pending";
    this.recordAudit(
      "boundary.check",
      `boundary:${normalized.kind}`,
      auditResult,
      `${result.rule_id} ${result.decision}（mode=${result.mode}；${digestText(normalized.text)}）`,
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // 10) B8：个人/企业双模式各跑一单 + 6 类不一致全部阻断
  // -------------------------------------------------------------------------

  /**
   * B8 双模式验收：
   * - 个人模式：个人主体 + 个人收款 + 普票 + 个人客户；
   * - 企业模式：企业主体 + 对公收款 + 专票 + 企业客户 + 已签授权书；
   * - 6 个 mismatch 场景逐一 runOrder，必须 blocked（不产生发票、不发生收款）。
   */
  runDualModeOrders(): DualModeResult {
    const profile = this.profile;
    const personalEntity = this.personalEntity;

    const personalOrder = this.runOrderInternal(
      normalizeOrderContext({
        mode: "personal",
        client_type: "individual",
        quote_cny: 3_000,
        invoice_type_requested: "vat_general",
        payment_method: "personal_account",
        client_invoice_title: personalEntity.name,
        signatory: personalEntity.name,
        seal_required: false,
      }),
      profile,
      personalEntity,
    );
    const enterpriseOrder = this.runOrderInternal(
      normalizeOrderContext({
        mode: "enterprise",
        client_type: "company",
        quote_cny: 20_000,
        invoice_type_requested: "vat_special",
        payment_method: "corporate_account",
        client_invoice_title: profile.invoice_defaults.title,
        client_tax_no: profile.invoice_defaults.tax_no,
        signatory: profile.entity.agent_name ?? profile.entity.legal_representative ?? "",
        seal_required: true,
      }),
      profile,
      personalEntity,
    );

    const personalEvidence: DualModeOrderEvidence = {
      order: personalOrder,
      block: personalOrder.blocked,
      conflicts: personalOrder.conflicts,
      invoice: personalOrder.invoice ?? null,
    };
    const enterpriseEvidence: DualModeOrderEvidence = {
      order: enterpriseOrder,
      block: enterpriseOrder.blocked,
      conflicts: enterpriseOrder.conflicts,
      invoice: enterpriseOrder.invoice ?? null,
    };

    // 6 个 mismatch 场景（B8：主体/抬头/收款/发票类型/授权/用印；订单级状态覆盖模拟 pending_human）。
    const scenarios: Array<{ id: string; label: string; run: () => OrderRunResult }> = [
      {
        id: "mismatch-1-personal-company-special-invoice",
        label: "个人模式 + 企业客户 + 专票（① 模式/发票类型不一致）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "personal",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "personal_account",
              client_invoice_title: "某企业客户（虚构）",
              client_tax_no: "91330100MA2CUSTOMER01X",
            }),
            profile,
            personalEntity,
          ),
      },
      {
        id: "mismatch-2-enterprise-personal-account",
        label: "企业模式 + 个人账户收款（② 主体/收款不一致）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "enterprise",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "personal_account",
              client_invoice_title: profile.invoice_defaults.title,
              client_tax_no: profile.invoice_defaults.tax_no,
            }),
            profile,
            personalEntity,
          ),
      },
      {
        id: "mismatch-3-authorization-unsigned",
        label: "企业模式 + 公司授权书未人签（③ 认证不一致，AI 不代签）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "enterprise",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "corporate_account",
              client_invoice_title: profile.invoice_defaults.title,
              client_tax_no: profile.invoice_defaults.tax_no,
              signatory: profile.entity.agent_name ?? profile.entity.legal_representative ?? "",
              authorization_letter_status: "none",
            }),
            profile,
            personalEntity,
          ),
      },
      {
        id: "mismatch-4-invoice-identity",
        label: "企业模式 + 抬头/税号与主体不一致（④ 开票校验不一致）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "enterprise",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "corporate_account",
              client_invoice_title: "另一家公司（虚构）",
              client_tax_no: "TAX-WRONG-0000",
            }),
            profile,
            personalEntity,
          ),
      },
      {
        id: "mismatch-5-signatory",
        label: "企业模式 + 签署人非授权经办人（⑤ 签署主体不一致）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "enterprise",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "corporate_account",
              client_invoice_title: profile.invoice_defaults.title,
              client_tax_no: profile.invoice_defaults.tax_no,
              signatory: "路人甲（未授权）",
            }),
            profile,
            personalEntity,
          ),
      },
      {
        id: "mismatch-6-seal-unsigned",
        label: "企业模式 + 需用印但未人签（⑥ 用印不一致，AI 不代签）",
        run: () =>
          this.runOrderInternal(
            normalizeOrderContext({
              mode: "enterprise",
              client_type: "company",
              quote_cny: 8_000,
              invoice_type_requested: "vat_special",
              payment_method: "corporate_account",
              client_invoice_title: profile.invoice_defaults.title,
              client_tax_no: profile.invoice_defaults.tax_no,
              signatory: profile.entity.agent_name ?? profile.entity.legal_representative ?? "",
              seal_required: true,
              seal_status: "pending_human",
            }),
            profile,
            personalEntity,
          ),
      },
    ];

    const mismatchesBlocked: ModeConflict[][] = [];
    const mismatchScenarios: DualModeMismatchEvidence[] = [];
    for (const scenario of scenarios) {
      const result = scenario.run();
      mismatchesBlocked.push(result.conflicts);
      mismatchScenarios.push({
        id: scenario.id,
        label: scenario.label,
        blocked: result.blocked,
        conflicts: result.conflicts,
        invoice_produced: result.invoice !== undefined,
        payment_captured: result.payment.ok,
      });
    }

    const personalInvoice = personalEvidence.invoice;
    const enterpriseInvoice = enterpriseEvidence.invoice;
    const checks = {
      subject_consistent:
        !personalEvidence.block &&
        !enterpriseEvidence.block &&
        personalInvoice !== null &&
        personalInvoice.checks.title_matches &&
        personalInvoice.checks.tax_no_matches &&
        enterpriseInvoice !== null &&
        enterpriseInvoice.checks.title_matches &&
        enterpriseInvoice.checks.tax_no_matches,
      invoice_consistent:
        personalInvoice !== null &&
        enterpriseInvoice !== null &&
        personalInvoice.ok &&
        enterpriseInvoice.ok &&
        personalInvoice.invoice_type === "vat_general" &&
        enterpriseInvoice.invoice_type === "vat_special" &&
        personalInvoice.draft_status === "draft_pending_human" &&
        enterpriseInvoice.draft_status === "draft_pending_human",
      payment_consistent:
        personalEvidence.order.payment.ok &&
        personalEvidence.order.payment.account_type === "personal" &&
        enterpriseEvidence.order.payment.ok &&
        enterpriseEvidence.order.payment.account_type === "corporate",
      all_mismatches_blocked:
        mismatchScenarios.length === 6 &&
        mismatchScenarios.every(
          (scenario) =>
            scenario.blocked &&
            !scenario.invoice_produced &&
            !scenario.payment_captured &&
            scenario.conflicts.some((conflict) => conflict.severity === "block"),
        ),
    };
    const ok =
      checks.subject_consistent &&
      checks.invoice_consistent &&
      checks.payment_consistent &&
      checks.all_mismatches_blocked;
    return {
      personal: personalEvidence,
      enterprise: enterpriseEvidence,
      mismatches_blocked: mismatchesBlocked,
      checks,
      ok,
      mismatch_scenarios: mismatchScenarios,
    };
  }

  // -------------------------------------------------------------------------
  // 内部：审计与时钟
  // -------------------------------------------------------------------------

  private recordAudit(action: string, object: string, result: AuditResult, reason: string): AuditEntry {
    this.auditSeq += 1;
    const entry: AuditEntry = {
      seq: this.auditSeq,
      at: this.nowIso(),
      action,
      object,
      result,
      reason: normalizeText(reason).replace(/\s+/gu, " "),
    };
    this.auditEntries.push(entry);
    return entry;
  }

  private nowIso(): string {
    const date = this.now();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new EnterpriseValidationError("注入的 now() 必须返回合法 Date", "INVALID_INPUT", "now");
    }
    return date.toISOString();
  }
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

/** 签署状态合并：订单级覆盖只能更严格，不能把「未人签」伪造成「已签」。 */
function effectiveSignStatus(
  override: SignTaskStatus | undefined,
  profileStatus: SignTaskStatus | undefined,
): SignTaskStatus {
  const base = profileStatus ?? "none";
  if (override === undefined) return base;
  return override === "signed" ? base : override;
}

/** 企业主体开票身份（抬头/税号）：优先 invoice_defaults，其次主体字段。 */
function enterpriseInvoiceIdentity(profile: EnterpriseProfile): { title: string; tax_no: string } {
  return {
    title: normalizeText(profile.invoice_defaults.title) || normalizeText(profile.entity.name),
    tax_no: normalizeText(profile.invoice_defaults.tax_no) || normalizeText(profile.entity.tax_no),
  };
}

/** 可用签署人：企业 = 授权经办人 + 法定代表人；个人 = 本人。 */
function signatoriesFor(
  mode: OrderMode,
  profile: EnterpriseProfile,
  personalEntity: BusinessEntity,
): string[] {
  if (mode === "personal") {
    return personalEntity.name.trim().length > 0 ? [personalEntity.name.trim()] : [];
  }
  return [normalizeText(profile.entity.agent_name), normalizeText(profile.entity.legal_representative)].filter(
    (name) => name.length > 0,
  );
}

/** 主体账户是否对公（导出便于 CLI 断言）。 */
export function isCorporateAccount(account: BankAccount): boolean {
  return account.type === "corporate";
}
