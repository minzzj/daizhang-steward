import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EpayClient, EpayConfigError, epaySign, maskKeyRef, verifyEpaySign } from "../../dist/packages/steward-money/src/epay.js";

function referenceSign(params, key) {
  const raw = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&") + key;
  return createHash("md5").update(raw, "utf8").digest("hex");
}

const baseConfig = {
  enabled: true,
  gateway_url: "https://pay.example.com/",
  pid: "10001",
  key_ref: "env:EPAY_KEY",
  pay_types: ["alipay", "wxpay"],
  notify_url: "https://merchant.example.com/notify",
  return_url: "https://merchant.example.com/return",
  mode: "live",
  sign_type: "MD5",
};

function makeClient(overrides = {}, key = "test-secret-key") {
  return new EpayClient({
    config: { ...baseConfig, ...overrides },
    resolveKey: () => key,
  });
}

test("MD5 签名与参考实现一致（ASCII 排序、去空值、去 sign）", () => {
  const params = { pid: "10001", type: "alipay", out_trade_no: "PAY-001", name: "项目周报", money: "10.00", notify_url: "https://m.example.com/n" };
  const expected = referenceSign(params, "test-secret-key");
  assert.equal(epaySign(params, "test-secret-key"), expected);
  assert.equal(epaySign({ ...params, sign: "xxx", sign_type: "MD5" }, "test-secret-key"), expected);
});

test("验签：正确签名通过，篡改/空签名失败", () => {
  const params = { pid: "10001", type: "alipay", out_trade_no: "PAY-001", money: "10.00", trade_status: "TRADE_SUCCESS" };
  const sign = epaySign(params, "test-secret-key");
  assert.equal(verifyEpaySign({ ...params, sign }, "test-secret-key"), true);
  assert.equal(verifyEpaySign({ ...params, money: "9.00", sign }, "test-secret-key"), false);
  assert.equal(verifyEpaySign(params, "test-secret-key"), false);
});

test("createPayment：live 模式生成易支付收银台链接与参数（含 sign）", () => {
  const client = makeClient();
  const result = client.createPayment({ out_trade_no: "PAY-001", name: "项目周报交付", amount_cny: 10, type: "alipay" });
  assert.equal(result.ok, true);
  assert.equal(result.mock, false);
  assert.match(result.pay_url, /^https:\/\/pay\.example\.com\/submit\.php\?/);
  assert.equal(result.params.pid, "10001");
  assert.equal(result.params.money, "10.00");
  assert.equal(result.params.sign_type, "MD5");
  assert.ok(result.params.sign && result.params.sign.length === 32);
  assert.equal(result.params.sign, referenceSign(result.params, "test-secret-key"));
});

test("createPayment：缺少密钥时 mock 模式（明确标记，不出真实收银台）", () => {
  const client = makeClient({}, null);
  const result = client.createPayment({ out_trade_no: "PAY-002", name: "交付", amount_cny: 10, type: "wxpay" });
  assert.equal(result.mock, true);
  assert.match(result.pay_url, /^https:\/\/pay\.example\.com\/epay\//);
  assert.equal(client.isLiveReady(), false);
});

test("createPayment：未启用的支付方式/非法金额/缺字段均拒绝", () => {
  const client = makeClient({ pay_types: ["alipay"] });
  assert.throws(() => client.createPayment({ out_trade_no: "P", name: "n", amount_cny: 10, type: "wxpay" }), EpayConfigError);
  assert.throws(() => client.createPayment({ out_trade_no: "P", name: "n", amount_cny: 0, type: "alipay" }), EpayConfigError);
  assert.throws(() => client.createPayment({ out_trade_no: "", name: "n", amount_cny: 10, type: "alipay" }), EpayConfigError);
  assert.throws(() => client.createPayment({ out_trade_no: "P", name: "n", amount_cny: -1, type: "alipay" }), EpayConfigError);
});

test("未启用的易支付整体拒绝", () => {
  const client = makeClient({ enabled: false });
  assert.throws(() => client.createPayment({ out_trade_no: "P", name: "n", amount_cny: 10, type: "alipay" }), EpayConfigError);
  assert.equal(client.isLiveReady(), false);
});

test("verifyNotify：签名正确 + TRADE_SUCCESS → ok", () => {
  const client = makeClient();
  const params = { pid: "10001", trade_no: "EP123", out_trade_no: "PAY-001", type: "alipay", money: "10.00", trade_status: "TRADE_SUCCESS", name: "项目周报" };
  const notify = { ...params, sign: epaySign(params, "test-secret-key"), sign_type: "MD5" };
  const result = client.verifyNotify({ params: notify });
  assert.equal(result.verify_ok, true);
  assert.equal(result.ok, true);
  assert.equal(result.out_trade_no, "PAY-001");
  assert.equal(result.amount_cny, 10);
});

test("verifyNotify：签名错误 / 状态未成功 / 缺密钥 均不通过", () => {
  const client = makeClient();
  const okParams = { pid: "10001", trade_no: "EP1", out_trade_no: "PAY-001", type: "alipay", money: "10.00", trade_status: "TRADE_SUCCESS" };
  assert.equal(client.verifyNotify({ params: { ...okParams, sign: "bad" } }).ok, false);
  const pendingParams = { ...okParams, trade_status: "WAIT_BUYER_PAY" };
  const pending = { ...pendingParams, sign: epaySign(pendingParams, "test-secret-key") };
  const pendingResult = client.verifyNotify({ params: pending });
  assert.equal(pendingResult.verify_ok, true);
  assert.equal(pendingResult.ok, false);
  const noKey = makeClient({}, null);
  const noKeyResult = noKey.verifyNotify({ params: { ...okParams, sign: "x" } });
  assert.equal(noKeyResult.ok, false);
  assert.match(noKeyResult.reason ?? "", /密钥未配置/);
});

test("describe：只暴露掩码/非敏感字段，不包含密钥", () => {
  const client = makeClient();
  const info = client.describe();
  assert.equal(info.enabled, true);
  assert.equal(info.mode, "live");
  assert.equal(info.live_ready, true);
  assert.equal(info.pid_masked.includes("10001"), false);
  assert.equal(info.key_ref_masked.includes("EPAY_KEY"), false);
  assert.equal(JSON.stringify(info).includes("test-secret-key"), false);
});

test("maskKeyRef：env/file 引用只显示脱敏形式", () => {
  assert.equal(maskKeyRef("env:EPAY_SECRET_KEY").includes("EPAY_SECRET_KEY"), false);
  assert.equal(maskKeyRef("file:secrets.json#epay"), "本地密钥文件（已隐藏）");
  assert.equal(maskKeyRef(""), "未配置");
});
