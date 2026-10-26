/**
 * `steward-money`：v1.2 变现/收款引擎（个人：微信/支付宝/个人银行卡；企业：对公账户）。
 *
 * 用户问题「怎么变现 / 为什么没收到钱」的明确回答：
 * - 当前是**演示资金渠道**：创建收款请求只生成收款链接/二维码占位，不会真的扣款，所以钱不会自动到账；
 * - 金额可任意填写（此前 ¥10 只是测试金额）；
 * - 流程：创建收款请求 → 出示链接/二维码 → 人工确认到账 → 记入账本（6 要素）+ 生成发票草稿（AI 不自动开票）；
 * - 接入真实资金：把微信商户/支付宝当面付/银行 webhook 回调接到 confirmReceived() 即可自动入账。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type MoneyMethod = "wechat_pay" | "alipay" | "personal_bank_card" | "corporate_account" | "manual";
export type MoneyStatus = "pending" | "paid" | "cancelled";

export interface PaymentRequest {
  id: string;
  amount_cny: number;
  client: string;
  purpose: string;
  method: MoneyMethod;
  status: MoneyStatus;
  created_at: string;
  paid_at?: string;
  payment_ref: string;
  qr_payload: string;
  ledger_entry_id?: string;
  invoice_draft?: { type: string; title: string; status: "draft_pending_human" };
  confirmed_by?: string;
  note?: string;
}

export interface MoneyPayout {
  holder: string;
  bank_name: string;
  card_no_masked: string;
  type: "personal" | "corporate";
  wechat_id_masked?: string;
  alipay_id_masked?: string;
}

export interface MoneyInvoiceConfig {
  default_type: "none" | "personal_receipt" | "vat_general" | "vat_special";
  title: string;
  tax_no_masked?: string;
  draft_only: boolean;
}

export interface MoneyEngineOptions {
  root: string;
  mode?: "demo" | "personal" | "enterprise";
  payout?: MoneyPayout;
  invoice?: MoneyInvoiceConfig;
  now?: () => Date;
}

export interface MoneySummary {
  pending_count: number;
  pending_cny: number;
  paid_count: number;
  paid_cny: number;
  cancelled_count: number;
  total_paid_cny: number;
  mode: string;
  payout: MoneyPayout | null;
  demo_channel: boolean;
}

interface MoneyState {
  version: number;
  requests: PaymentRequest[];
  ledger: Array<Record<string, unknown>>;
  audit: Array<{ at: string; action: string; object: string; result: string; reason?: string }>;
}

const PERSONAL_METHODS: MoneyMethod[] = ["wechat_pay", "alipay", "personal_bank_card", "manual"];
const ENTERPRISE_METHODS: MoneyMethod[] = ["corporate_account", "manual"];

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

export class MoneyValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "MoneyValidationError";
  }
}

export class PaymentRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`收款请求不存在：${id}`);
    this.name = "PaymentRequestNotFoundError";
  }
}

export class MoneyEngine {
  private state: MoneyState;
  private readonly file: string;
  private readonly mode: "demo" | "personal" | "enterprise";
  private readonly payout: MoneyPayout | null;
  private readonly invoice: MoneyInvoiceConfig | null;
  private readonly now: () => Date;

  constructor(options: MoneyEngineOptions) {
    this.file = join(options.root, "money.json");
    this.mode = options.mode ?? "personal";
    this.payout = options.payout ?? null;
    this.invoice = options.invoice ?? null;
    this.now = options.now ?? (() => new Date());
    this.state = this.loadSync();
  }

  private loadSync(): MoneyState {
    if (!existsSync(this.file)) return { version: 1, requests: [], ledger: [], audit: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<MoneyState>;
      return {
        version: 1,
        requests: Array.isArray(parsed.requests) ? (parsed.requests as PaymentRequest[]) : [],
        ledger: Array.isArray(parsed.ledger) ? (parsed.ledger as Array<Record<string, unknown>>) : [],
        audit: Array.isArray(parsed.audit) ? (parsed.audit as MoneyState["audit"]) : [],
      };
    } catch {
      return { version: 1, requests: [], ledger: [], audit: [] };
    }
  }

  private async save(): Promise<void> {
    await mkdir(join(this.file, ".."), { recursive: true });
    await atomicWrite(this.file, JSON.stringify(this.state, null, 2) + "\n");
  }

  private record(action: string, object: string, result: string, reason?: string): void {
    this.state.audit.push({ at: this.now().toISOString(), action, object, result, ...(reason ? { reason } : {}) });
  }

  allowedMethods(): MoneyMethod[] {
    return this.mode === "enterprise" ? ENTERPRISE_METHODS : PERSONAL_METHODS;
  }

  createRequest(input: { amount_cny: number; client: string; purpose: string; method?: MoneyMethod; note?: string }): PaymentRequest {
    const amount = Number(input.amount_cny);
    if (!Number.isFinite(amount) || amount <= 0) throw new MoneyValidationError("收款金额必须大于 0", "amount_cny");
    if (amount > 1_000_000) throw new MoneyValidationError("收款金额不能超过 ¥1,000,000（演示上限）", "amount_cny");
    if (!input.client || input.client.trim().length === 0) throw new MoneyValidationError("客户名称不能为空", "client");
    if (!input.purpose || input.purpose.trim().length === 0) throw new MoneyValidationError("收款用途不能为空", "purpose");
    const method: MoneyMethod = input.method ?? this.allowedMethods()[0] ?? "manual";
    if (!this.allowedMethods().includes(method)) throw new MoneyValidationError(`当前模式不允许该收款方式：${method}`, "method");
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    const seq = this.state.requests.length + 1;
    const ref = `PAY-${stamp}-${seq}`;
    const request: PaymentRequest = {
      id: `pay-${stamp}-${String(seq).padStart(3, "0")}`,
      amount_cny: Math.round(amount * 100) / 100,
      client: input.client.trim(),
      purpose: input.purpose.trim(),
      method,
      status: "pending",
      created_at: this.now().toISOString(),
      payment_ref: ref,
      qr_payload: `https://pay.example.com/p/${encodeURIComponent(ref)}`,
      ...(input.note ? { note: input.note } : {}),
    };
    this.state.requests.push(request);
    this.record("money.create", request.id, "ok");
    return JSON.parse(JSON.stringify(request)) as PaymentRequest;
  }

  list(filter?: { status?: MoneyStatus }): PaymentRequest[] {
    const rows = filter?.status ? this.state.requests.filter((item) => item.status === filter.status) : this.state.requests;
    return rows.map((item) => JSON.parse(JSON.stringify(item)) as PaymentRequest);
  }

  get(id: string): PaymentRequest | null {
    const found = this.state.requests.find((item) => item.id === id);
    return found ? (JSON.parse(JSON.stringify(found)) as PaymentRequest) : null;
  }

  /** 人工确认到账：→ paid + 账本 6 要素 + 发票草稿（AI 不自动开票/不自动确认收款）。 */
  confirmReceived(id: string, options: { confirmed_by?: string; note?: string } = {}): PaymentRequest {
    const request = this.state.requests.find((item) => item.id === id);
    if (!request) throw new PaymentRequestNotFoundError(id);
    if (request.status === "paid") throw new MoneyValidationError("该收款请求已确认，请勿重复确认", "status");
    if (request.status === "cancelled") throw new MoneyValidationError("该收款请求已取消，无法确认", "status");
    const at = this.now().toISOString();
    const confirmedBy = options.confirmed_by ?? "本人（人工确认到账）";
    const receiptRef = `rcpt-${request.payment_ref}`;
    const ledgerEntry = {
      entry_id: `led-${request.payment_ref}`,
      project_id: `prj-${request.id}`,
      type: "income",
      amount_cny: request.amount_cny,
      payee_or_payer: request.client,
      basis: `收款请求 ${request.payment_ref}（${request.purpose}；渠道：${request.method}）`,
      approved_by: confirmedBy,
      receipt_ref: receiptRef,
      occurred_at: at,
    };
    this.state.ledger.push(ledgerEntry);
    request.status = "paid";
    request.paid_at = at;
    request.ledger_entry_id = ledgerEntry.entry_id;
    request.confirmed_by = confirmedBy;
    if (options.note) request.note = options.note;
    const invoiceType = this.invoice?.default_type ?? "none";
    if (invoiceType !== "none") {
      request.invoice_draft = { type: invoiceType, title: this.invoice?.title ?? request.client, status: "draft_pending_human" };
    }
    this.record("money.confirm", id, "ok", `amount=${request.amount_cny}`);
    return JSON.parse(JSON.stringify(request)) as PaymentRequest;
  }

  cancel(id: string, reason?: string): PaymentRequest {
    const request = this.state.requests.find((item) => item.id === id);
    if (!request) throw new PaymentRequestNotFoundError(id);
    if (request.status !== "pending") throw new MoneyValidationError("只有待收款请求可以取消", "status");
    request.status = "cancelled";
    if (reason) request.note = reason;
    this.record("money.cancel", id, "ok", reason);
    return JSON.parse(JSON.stringify(request)) as PaymentRequest;
  }

  ledgerEntries(): Array<Record<string, unknown>> {
    return this.state.ledger.map((entry) => ({ ...entry }));
  }

  summary(): MoneySummary {
    const pending = this.state.requests.filter((item) => item.status === "pending");
    const paid = this.state.requests.filter((item) => item.status === "paid");
    const cancelled = this.state.requests.filter((item) => item.status === "cancelled");
    const sum = (rows: PaymentRequest[]) => Math.round(rows.reduce((total, item) => total + item.amount_cny, 0) * 100) / 100;
    return {
      pending_count: pending.length,
      pending_cny: sum(pending),
      paid_count: paid.length,
      paid_cny: sum(paid),
      cancelled_count: cancelled.length,
      total_paid_cny: sum(paid),
      mode: this.mode,
      payout: this.payout,
      demo_channel: true,
    };
  }

  /** 变现说明（为什么现在收不到真实钱 / 怎么接真实收款 / 金额可自定）。 */
  explain(): { title: string; points: string[] } {
    const channel = this.mode === "enterprise" ? "对公账户（增值税发票）" : "微信支付 / 支付宝 / 个人银行卡";
    return {
      title: "变现说明",
      points: [
        `收款渠道：${channel}；金额由你自己填写（之前测试里的 ¥10 只是测试金额，不是固定值）。`,
        "当前为演示资金渠道：创建收款请求只会生成收款链接/二维码占位，不会真的扣款；因此钱不会自动到账。",
        "流程：创建收款请求 → 出示收款链接/二维码给客户 → 你人工确认到账 → 系统记入账本（6 要素）并生成发票草稿（AI 不自动开票）。",
        "接入真实资金：把微信商户/支付宝当面付/银行回调（webhook）接到 confirmReceived()，即可自动入账；未接入前必须人工点「确认到账」。",
        "企业模式：对公账户 + 增值税专票；个人模式：微信/支付宝/个人银行卡，无合同无签字（以人工确认到账为准）。",
      ],
    };
  }

  auditTrail(limit = 30): MoneyState["audit"] {
    return this.state.audit.slice(-limit);
  }

  async persist(): Promise<void> {
    await this.save();
  }
}

export * from "./epay.js";
