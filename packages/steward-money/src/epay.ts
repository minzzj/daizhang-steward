/**
 * v1.3：易支付（彩虹易支付兼容协议，MD5 签名）客户端。
 *
 * 用途：把「收款请求」变成可发给客户的易支付收银台链接/参数；并校验易支付异步通知（notify）签名，
 * 校验通过后可调用 MoneyEngine.confirmReceived() 自动入账。
 *
 * 安全：密钥只从配置引用的环境变量/本地 secrets 解析，不落盘、不写日志；demo 模式不产生真实支付。
 */
import { createHash } from "node:crypto";

export type EpayPayType = "alipay" | "wxpay";

export interface EpayConfig {
  enabled: boolean;
  gateway_url: string;
  pid: string;
  key_ref: string; // env:EPAY_KEY | file:secrets.json#epay
  pay_types: EpayPayType[];
  notify_url: string;
  return_url: string;
  mode: "demo" | "live";
  sign_type: "MD5";
}

export interface EpayCreateInput {
  out_trade_no: string;
  name: string;
  amount_cny: number;
  type: EpayPayType;
  notify_url?: string;
  return_url?: string;
}

export interface EpayCreateResult {
  ok: boolean;
  mock: boolean;
  pay_url: string;
  method: "GET" | "POST";
  params: Record<string, string>;
  error?: string;
}

export interface EpayNotifyInput {
  params: Record<string, string>;
}

export interface EpayNotifyResult {
  ok: boolean;
  verify_ok: boolean;
  trade_status: string | null;
  out_trade_no: string | null;
  amount_cny: number | null;
  pay_type: string | null;
  reason?: string;
}

export class EpayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpayConfigError";
  }
}

/** 易支付签名：参数按 key ASCII 升序、去掉 sign/sign_type/空值，拼接 `a=b&c=d` + 商户密钥，MD5 小写。 */
export function epaySign(params: Record<string, string | number | undefined>, key: string): string {
  const entries = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== undefined && value !== null && String(value) !== "")
    .map(([name, value]) => [name, String(value)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const raw = entries.map(([name, value]) => `${name}=${value}`).join("&") + key;
  return createHash("md5").update(raw, "utf8").digest("hex").toLowerCase();
}

export function verifyEpaySign(params: Record<string, string>, key: string): boolean {
  const provided = (params.sign ?? "").toLowerCase();
  if (!provided) return false;
  const expected = epaySign(params, key);
  return expected === provided;
}

export interface EpayClientOptions {
  config: EpayConfig;
  /** 运行时解析密钥（env/本地 secrets）；不返回给 UI/日志。 */
  resolveKey: (keyRef: string) => string | null;
  now?: () => Date;
}

export class EpayClient {
  private readonly config: EpayConfig;
  private readonly resolveKey: (keyRef: string) => string | null;
  private readonly now: () => Date;

  constructor(options: EpayClientOptions) {
    this.config = options.config;
    this.resolveKey = options.resolveKey;
    this.now = options.now ?? (() => new Date());
  }

  /** 是否已具备真实易支付配置（网关/商户/密钥）。 */
  isLiveReady(): boolean {
    return this.config.enabled && this.config.mode === "live" && Boolean(this.config.gateway_url) && Boolean(this.config.pid) && Boolean(this.getKey());
  }

  describe(): { enabled: boolean; mode: string; gateway: string; pid_masked: string; pay_types: string[]; live_ready: boolean; key_ref_masked: string } {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      gateway: this.config.gateway_url,
      pid_masked: this.maskPid(this.config.pid),
      pay_types: [...this.config.pay_types],
      live_ready: this.isLiveReady(),
      key_ref_masked: maskKeyRef(this.config.key_ref),
    };
  }

  createPayment(input: EpayCreateInput): EpayCreateResult {
    if (!this.config.enabled) throw new EpayConfigError("易支付未启用：请在配置中心「支付与银行卡 → 易支付」中启用并填写商家信息");
    if (!input.out_trade_no || !input.name) throw new EpayConfigError("out_trade_no / name 不能为空");
    if (!Number.isFinite(input.amount_cny) || input.amount_cny <= 0) throw new EpayConfigError("金额必须大于 0");
    if (!this.config.pay_types.includes(input.type)) throw new EpayConfigError(`该商户未启用支付方式：${input.type}`);
    const params: Record<string, string> = {
      pid: this.config.pid,
      type: input.type,
      out_trade_no: input.out_trade_no,
      notify_url: input.notify_url ?? this.config.notify_url,
      return_url: input.return_url ?? this.config.return_url,
      name: input.name,
      money: input.amount_cny.toFixed(2),
      sign_type: this.config.sign_type,
    };
    const key = this.getKey();
    const mock = !key || this.config.mode !== "live";
    if (mock) {
      const query = Object.entries(params)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("&");
      return {
        ok: true,
        mock: true,
        pay_url: `https://pay.example.com/epay/submit.php?${query}`,
        method: "GET",
        params,
      };
    }
    params.sign = epaySign(params, key);
    const query = Object.entries(params)
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("&");
    return {
      ok: true,
      mock: false,
      pay_url: `${this.config.gateway_url.replace(/\/+$/, "")}/submit.php?${query}`,
      method: "GET",
      params,
    };
  }

  /** 校验易支付异步通知（notify）：签名 + 交易状态。 */
  verifyNotify(input: EpayNotifyInput): EpayNotifyResult {
    const key = this.getKey();
    if (!key) {
      return { ok: false, verify_ok: false, trade_status: input.params.trade_status ?? null, out_trade_no: input.params.out_trade_no ?? null, amount_cny: null, pay_type: input.params.type ?? null, reason: "易支付密钥未配置（key_ref 无法解析）" };
    }
    const verifyOk = verifyEpaySign(input.params, key);
    const amount = Number(input.params.money);
    const tradeStatus = input.params.trade_status ?? null;
    const success = verifyOk && (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "SUCCESS");
    return {
      ok: success,
      verify_ok: verifyOk,
      trade_status: tradeStatus,
      out_trade_no: input.params.out_trade_no ?? null,
      amount_cny: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
      pay_type: input.params.type ?? null,
      ...(success ? {} : { reason: verifyOk ? `交易状态未成功：${tradeStatus ?? "unknown"}` : "签名校验失败" }),
    };
  }

  private getKey(): string | null {
    try {
      const key = this.resolveKey(this.config.key_ref);
      return key && key.length > 0 ? key : null;
    } catch {
      return null;
    }
  }

  private maskPid(pid: string): string {
    if (!pid) return "";
    if (pid.length <= 4) return `${pid[0] ?? ""}***`;
    return `${pid.slice(0, 2)}***${pid.slice(-2)}`;
  }
}

export function maskKeyRef(ref: string): string {
  if (!ref) return "未配置";
  if (ref.startsWith("env:")) {
    const name = ref.slice(4);
    return `env:${name.slice(0, 3)}***`;
  }
  if (ref.startsWith("file:")) return "本地密钥文件（已隐藏）";
  return "***";
}
