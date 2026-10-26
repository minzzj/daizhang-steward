/**
 * v1.2：变现/收款 CLI（个人模式：微信/支付宝/个人银行卡；企业模式：对公）。
 * 依赖 packages/steward-money + steward-config（读取模式/收款账户/发票配置）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import { ConfigEngine } from "../../../packages/steward-config/src/index.js";
import { EpayClient, MoneyEngine, MoneyValidationError, maskKeyRef, type EpayConfig } from "../../../packages/steward-money/src/index.js";

type Flags = Record<string, string | boolean>;
export interface MoneyArgs {
  flags: Flags;
}
const flag = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const printJson = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function resolveEpayKey(root: string, ref: string): string | null {
  if (!ref) return null;
  if (ref.startsWith("env:")) {
    const value = process.env[ref.slice(4)];
    return value && value.length > 0 ? value : null;
  }
  if (ref.startsWith("file:")) {
    const match = /^file:([^#]+)#(.+)$/.exec(ref);
    if (!match) return null;
    const file = join(root, ".steward", match[1] ?? "");
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, { api_key?: string }>;
      return parsed[match[2] ?? ""]?.api_key ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function buildEpayClient(root: string, cfg: ReturnType<ConfigEngine["getEpayConfig"]>): EpayClient {
  return new EpayClient({ config: cfg as EpayConfig, resolveKey: (ref) => resolveEpayKey(root, ref) });
}
export async function cmdMoney(parsed: MoneyArgs): Promise<number> {
  const root = findRepoRoot();
  const config = new ConfigEngine({ root: join(root, ".steward") });
  const cfg = config.load();
  const moneyRoot = join(root, ".steward", "money");
  const engine = new MoneyEngine({
    root: moneyRoot,
    mode: cfg.profile.mode,
    payout: cfg.payments.payout_account,
    invoice: cfg.payments.invoice,
  });
  const action = (flag(parsed.flags, "action") ?? "summary").toLowerCase();
  const json = parsed.flags.json === true;
  try {
    switch (action) {
      case "create": {
        const request = engine.createRequest({
          amount_cny: Number(flag(parsed.flags, "amount") ?? "10"),
          client: flag(parsed.flags, "client") ?? "示例客户（虚构）",
          purpose: flag(parsed.flags, "purpose") ?? "项目交付",
          method: flag(parsed.flags, "method") as never,
        });
        await engine.persist();
        if (json) printJson({ ok: true, request, payout: cfg.payments.payout_account, demo_channel: true });
        else {
          console.log(`已创建收款请求：${request.id}`);
          console.log(`  金额：¥${request.amount_cny}  客户：${request.client}  用途：${request.purpose}`);
          console.log(`  收款渠道：${request.method}  收款链接/二维码（演示）：${request.qr_payload}`);
          console.log(`  收款账户：${cfg.payments.payout_account.bank_name} ${cfg.payments.payout_account.card_no_masked}`);
          console.log(`  ⚠️ 当前为演示资金渠道，不会真的到账；请客户付款后执行：steward money --action confirm --id ${request.id}`);
        }
        return 0;
      }
      case "list": {
        const rows = engine.list();
        if (json) printJson({ ok: true, requests: rows });
        else {
          console.log(`收款请求（${rows.length}）`);
          for (const row of rows) console.log(`- ${row.id} | ¥${row.amount_cny} | ${row.client} | ${row.status} | ${row.created_at}`);
        }
        return 0;
      }
      case "confirm": {
        const id = flag(parsed.flags, "id");
        if (!id) {
          console.error("用法：steward money --action confirm --id <pay-id> [--json]");
          return 2;
        }
        const request = engine.confirmReceived(id, { confirmed_by: flag(parsed.flags, "by") ?? "本人（人工确认到账）" });
        await engine.persist();
        if (json) printJson({ ok: true, request, ledger: engine.ledgerEntries().slice(-1) });
        else {
          console.log(`已确认到账：${request.id}  ¥${request.amount_cny}（${request.confirmed_by}）`);
          console.log(`  账本：${request.ledger_entry_id}；发票草稿：${request.invoice_draft?.type ?? "无"}（${request.invoice_draft?.status ?? "-"}）`);
        }
        return 0;
      }
      case "cancel": {
        const id = flag(parsed.flags, "id");
        if (!id) {
          console.error("用法：steward money --action cancel --id <pay-id>");
          return 2;
        }
        const request = engine.cancel(id, flag(parsed.flags, "reason"));
        await engine.persist();
        if (json) printJson({ ok: true, request });
        else console.log(`已取消：${request.id}`);
        return 0;
      }
      case "summary": {
        const summary = engine.summary();
        if (json) printJson({ ok: true, summary, explain: engine.explain() });
        else {
          const s = summary;
          console.log(`变现概览（模式：${s.mode}；演示渠道=${s.demo_channel}）`);
          console.log(`  待收：${s.pending_count} 笔 / ¥${s.pending_cny}`);
          console.log(`  已收：${s.paid_count} 笔 / ¥${s.paid_cny}`);
          console.log(`  取消：${s.cancelled_count} 笔`);
          console.log(`  收款账户：${s.payout?.bank_name ?? "-"} ${s.payout?.card_no_masked ?? ""}（${s.payout?.type ?? "-"}）`);
          if (s.payout?.wechat_id_masked) console.log(`  微信：${s.payout.wechat_id_masked}；支付宝：${s.payout.alipay_id_masked ?? "-"}`);
        }
        return 0;
      }
      case "explain": {
        const explanation = engine.explain();
        if (json) printJson({ ok: true, explanation });
        else {
          console.log(explanation.title);
          for (const point of explanation.points) console.log(`- ${point}`);
        }
        return 0;
      }
      case "ledger": {
        const rows = engine.ledgerEntries();
        if (json) printJson({ ok: true, ledger: rows });
        else {
          console.log(`变现账本（${rows.length} 笔）`);
          for (const row of rows) console.log(`- ${row.entry_id} | ¥${row.amount_cny} | ${row.payee_or_payer} | 回执 ${row.receipt_ref}`);
        }
        return 0;
      }
      case "epay": {
        const epay = config.getEpayConfig();
        if (!epay.enabled) {
          console.error("易支付未启用：请先在配置中心/控制台启用并填写商家信息（demo 模式也可生成演示链接）");
          return 2;
        }
        const request = engine.createRequest({
          amount_cny: Number(flag(parsed.flags, "amount") ?? "10"),
          client: flag(parsed.flags, "client") ?? "示例客户（虚构）",
          purpose: flag(parsed.flags, "purpose") ?? "项目交付",
          method: "manual",
        });
        await engine.persist();
        const client = buildEpayClient(root, epay);
        const pay = client.createPayment({
          out_trade_no: request.payment_ref,
          name: request.purpose,
          amount_cny: request.amount_cny,
          type: (flag(parsed.flags, "type") ?? "alipay") as "alipay" | "wxpay",
        });
        if (json) printJson({ ok: true, request, epay: client.describe(), pay });
        else {
          console.log(`已创建易支付收款请求：${request.id}  ¥${request.amount_cny}`);
          console.log(`  商户：${client.describe().pid_masked}；模式：${client.describe().mode}；密钥：${maskKeyRef(epay.key_ref)}${pay.mock ? "（演示链接，不真实扣款）" : ""}`);
          console.log(`  收款链接：${pay.pay_url}`);
          console.log(`  到账后：steward money --action epay-notify --file notify.json（或 --action confirm --id ${request.id} 人工确认）`);
        }
        return 0;
      }
      case "epay-notify": {
        const file = flag(parsed.flags, "file");
        if (!file || !existsSync(file)) {
          console.error("用法：steward money --action epay-notify --file <notify.json>（易支付异步通知参数）");
          return 2;
        }
        const epay = config.getEpayConfig();
        const client = buildEpayClient(root, epay);
        const params = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
        const verified = client.verifyNotify({ params });
        if (!verified.ok) {
          console.error(`易支付通知校验未通过：${verified.reason ?? "未知原因"}（签名=${verified.verify_ok}，状态=${verified.trade_status ?? "-"}）`);
          return 1;
        }
        const pending = engine.list({ status: "pending" }).find((item) => item.payment_ref === verified.out_trade_no);
        if (!pending) {
          console.error(`未找到待收款请求：out_trade_no=${verified.out_trade_no ?? "-"}`);
          return 1;
        }
        const request = engine.confirmReceived(pending.id, { confirmed_by: "易支付回调（签名校验通过）" });
        await engine.persist();
        if (json) printJson({ ok: true, verified, request, ledger: engine.ledgerEntries().slice(-1) });
        else {
          console.log(`易支付通知校验通过 ✓ 已确认到账：${request.id} ¥${request.amount_cny}`);
          console.log(`  账本：${request.ledger_entry_id}；发票草稿：${request.invoice_draft?.type ?? "无"}`);
        }
        return 0;
      }
      case "epay-info": {
        const epay = config.getEpayConfig();
        const client = buildEpayClient(root, epay);
        const info = { ...client.describe(), notify_url: epay.notify_url, return_url: epay.return_url, pay_types: epay.pay_types, key_ref_masked: maskKeyRef(epay.key_ref) };
        if (json) printJson({ ok: true, epay: info });
        else {
          console.log(`易支付配置：${info.enabled ? "已启用" : "未启用"} / ${info.mode} / 商户 ${info.pid_masked || "未配置"} / live_ready=${info.live_ready}`);
          console.log(`  网关：${info.gateway}；密钥：${info.key_ref_masked}；回调：${info.notify_url}`);
        }
        return 0;
      }
      case "reset": {
        if (parsed.flags.yes !== true) {
          console.error("清空收款数据需要 --yes");
          return 2;
        }
        const file = join(moneyRoot, "money.json");
        if (existsSync(file)) {
          const { rmSync } = await import("node:fs");
          rmSync(file, { force: true });
        }
        if (json) printJson({ ok: true, reset: true });
        else console.log("已清空收款数据");
        return 0;
      }
      default:
        console.error(`未知 action：${action}（create|list|confirm|cancel|summary|explain|ledger|reset）`);
        return 2;
    }
  } catch (error) {
    if (error instanceof MoneyValidationError) {
      console.error(`收款校验失败：${error.message}`);
      return 2;
    }
    console.error(`收款命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
