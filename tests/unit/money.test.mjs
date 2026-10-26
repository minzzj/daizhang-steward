import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoneyEngine, MoneyValidationError, PaymentRequestNotFoundError } from "../../dist/packages/steward-money/src/index.js";

function makeEngine(mode = "personal", invoiceType = "personal_receipt") {
  const root = mkdtempSync(join(tmpdir(), "steward-money-"));
  const engine = new MoneyEngine({
    root,
    mode,
    payout: {
      holder: "示例本人（虚构）",
      bank_name: "示例银行",
      card_no_masked: "**** **** **** 6789",
      type: mode === "enterprise" ? "corporate" : "personal",
      ...(mode === "personal" ? { wechat_id_masked: "wx_***89", alipay_id_masked: "ali***90" } : {}),
    },
    invoice: {
      default_type: invoiceType,
      title: "示例抬头（虚构）",
      draft_only: true,
      ...(mode === "enterprise" ? { tax_no_masked: "TAX***" } : {}),
    },
  });
  return { root, engine, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("个人模式允许微信/支付宝/个人银行卡/人工，不允许对公", () => {
  const { engine, cleanup } = makeEngine("personal");
  try {
    assert.deepEqual(engine.allowedMethods(), ["wechat_pay", "alipay", "personal_bank_card", "manual"]);
    assert.throws(() => engine.createRequest({ amount_cny: 10, client: "客户", purpose: "交付", method: "corporate_account" }), MoneyValidationError);
  } finally {
    cleanup();
  }
});

test("企业模式只允许对公账户/人工", () => {
  const { engine, cleanup } = makeEngine("enterprise");
  try {
    assert.deepEqual(engine.allowedMethods(), ["corporate_account", "manual"]);
    assert.throws(() => engine.createRequest({ amount_cny: 10, client: "客户", purpose: "交付", method: "wechat_pay" }), MoneyValidationError);
  } finally {
    cleanup();
  }
});

test("创建收款请求：待收 + 收款链接占位 + 引用号", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 10, client: "示例客户（虚构）", purpose: "项目周报交付", method: "wechat_pay" });
    assert.equal(request.status, "pending");
    assert.equal(request.amount_cny, 10);
    assert.match(request.payment_ref, /^PAY-/);
    assert.match(request.qr_payload, /^https:\/\/pay\.example\.com\/p\//);
    assert.equal(request.method, "wechat_pay");
    assert.equal(engine.list({ status: "pending" }).length, 1);
  } finally {
    cleanup();
  }
});

test("金额校验：0/负数/超上限/缺客户/缺用途均拒绝", () => {
  const { engine, cleanup } = makeEngine();
  try {
    assert.throws(() => engine.createRequest({ amount_cny: 0, client: "客户", purpose: "交付" }), MoneyValidationError);
    assert.throws(() => engine.createRequest({ amount_cny: -1, client: "客户", purpose: "交付" }), MoneyValidationError);
    assert.throws(() => engine.createRequest({ amount_cny: 2_000_000, client: "客户", purpose: "交付" }), MoneyValidationError);
    assert.throws(() => engine.createRequest({ amount_cny: 10, client: " ", purpose: "交付" }), MoneyValidationError);
    assert.throws(() => engine.createRequest({ amount_cny: 10, client: "客户", purpose: "" }), MoneyValidationError);
  } finally {
    cleanup();
  }
});

test("人工确认到账：paid + 账本 6 要素 + 发票草稿（不自动提交）", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 10, client: "示例客户（虚构）", purpose: "项目周报交付", method: "wechat_pay" });
    const paid = engine.confirmReceived(request.id, { confirmed_by: "本人（人工确认到账）" });
    assert.equal(paid.status, "paid");
    assert.ok(paid.paid_at);
    assert.ok(paid.ledger_entry_id);
    assert.equal(paid.invoice_draft?.status, "draft_pending_human");
    const ledger = engine.ledgerEntries();
    assert.equal(ledger.length, 1);
    const entry = ledger[0];
    for (const key of ["amount_cny", "payee_or_payer", "basis", "approved_by", "receipt_ref", "project_id"]) {
      assert.ok(entry[key] !== undefined && entry[key] !== "", `账本缺少 ${key}`);
    }
    assert.equal(entry.amount_cny, 10);
  } finally {
    cleanup();
  }
});

test("重复确认 / 取消后确认 均拒绝", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 10, client: "客户", purpose: "交付" });
    engine.confirmReceived(request.id);
    assert.throws(() => engine.confirmReceived(request.id), MoneyValidationError);
    const another = engine.createRequest({ amount_cny: 5, client: "客户2", purpose: "交付" });
    engine.cancel(another.id, "客户取消");
    assert.throws(() => engine.confirmReceived(another.id), MoneyValidationError);
  } finally {
    cleanup();
  }
});

test("取消：pending → cancelled，只有 pending 可取消", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 5, client: "客户", purpose: "交付" });
    const cancelled = engine.cancel(request.id, "客户取消");
    assert.equal(cancelled.status, "cancelled");
    assert.equal(engine.list({ status: "cancelled" }).length, 1);
    const paidRequest = engine.createRequest({ amount_cny: 6, client: "客户", purpose: "交付" });
    engine.confirmReceived(paidRequest.id);
    assert.throws(() => engine.cancel(paidRequest.id), MoneyValidationError);
  } finally {
    cleanup();
  }
});

test("不存在的收款请求报错", () => {
  const { engine, cleanup } = makeEngine();
  try {
    assert.throws(() => engine.confirmReceived("pay-not-exist"), PaymentRequestNotFoundError);
    assert.throws(() => engine.cancel("pay-not-exist"), PaymentRequestNotFoundError);
  } finally {
    cleanup();
  }
});

test("持久化：persist 后新实例可读回请求与账本", async () => {
  const { root, engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 10, client: "示例客户", purpose: "周报交付" });
    engine.confirmReceived(request.id);
    await engine.persist();
    const reloaded = new MoneyEngine({ root, mode: "personal" });
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.list()[0].status, "paid");
    assert.equal(reloaded.ledgerEntries().length, 1);
    const raw = readFileSync(join(root, "money.json"), "utf8");
    assert.ok(raw.includes("示例客户"));
    assert.ok(!raw.includes("6222")); // 不落明文卡号
  } finally {
    cleanup();
  }
});

test("summary 统计待收/已收/取消金额与笔数", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const a = engine.createRequest({ amount_cny: 10, client: "客户A", purpose: "交付" });
    engine.createRequest({ amount_cny: 20, client: "客户B", purpose: "交付" });
    const c = engine.createRequest({ amount_cny: 30, client: "客户C", purpose: "交付" });
    engine.confirmReceived(a.id);
    engine.cancel(c.id);
    const summary = engine.summary();
    assert.equal(summary.pending_count, 1);
    assert.equal(summary.pending_cny, 20);
    assert.equal(summary.paid_count, 1);
    assert.equal(summary.paid_cny, 10);
    assert.equal(summary.cancelled_count, 1);
    assert.equal(summary.demo_channel, true);
    assert.equal(summary.payout?.type, "personal");
  } finally {
    cleanup();
  }
});

test("explain 明确说明：演示渠道/为什么没收到钱/¥10是测试值/如何接真实资金", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const explanation = engine.explain();
    const text = explanation.points.join(" ");
    assert.ok(text.includes("演示资金渠道"));
    assert.ok(text.includes("¥10"));
    assert.ok(text.includes("人工确认到账"));
    assert.ok(text.includes("webhook"));
    assert.ok(text.includes("不会真的扣款"));
  } finally {
    cleanup();
  }
});

test("审计追加且不含明文卡号", () => {
  const { engine, cleanup } = makeEngine();
  try {
    const request = engine.createRequest({ amount_cny: 10, client: "客户", purpose: "交付" });
    engine.confirmReceived(request.id);
    const audit = engine.auditTrail();
    assert.ok(audit.some((entry) => entry.action === "money.create"));
    assert.ok(audit.some((entry) => entry.action === "money.confirm"));
    const text = JSON.stringify(audit);
    assert.ok(!/6222\s?\d{8,}/.test(text));
  } finally {
    cleanup();
  }
});

test("企业模式：对公收款 + 专票草稿", () => {
  const { engine, cleanup } = makeEngine("enterprise", "vat_special");
  try {
    const request = engine.createRequest({ amount_cny: 1000, client: "示例企业客户（虚构）", purpose: "企业项目交付", method: "corporate_account" });
    const paid = engine.confirmReceived(request.id);
    assert.equal(paid.invoice_draft?.type, "vat_special");
    assert.equal(paid.invoice_draft?.status, "draft_pending_human");
  } finally {
    cleanup();
  }
});
