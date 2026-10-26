# steward-money — v1.2 变现 / 收款引擎

零第三方依赖、本地 JSON 持久化（`<root>/money.json`）。

## 它解决什么

用户问过「怎么变现？为什么没收到钱？为什么只 ¥10？」

- **当前是演示资金渠道**：创建收款请求只会生成收款链接/二维码占位，不会真的扣款，所以钱不会自动到账。
- **金额可自定**：之前测试的 ¥10 只是测试金额，不是固定值。
- **流程**：创建收款请求 → 出示收款链接/二维码 → **人工确认到账** → 记入账本（金额/收付方/依据/审批人/回执/项目 6 要素）+ 生成发票草稿（AI 不自动开票）。
- **接真实资金**：把微信商户 / 支付宝当面付 / 银行 webhook 回调接到 `confirmReceived()` 即可自动入账；未接入前必须人工点「确认到账」。
- 个人模式支持：微信支付、支付宝、个人银行卡；企业模式：对公账户 + 增值税专票。

## API 摘要

```ts
const engine = new MoneyEngine({ root, mode: "personal", payout, invoice });
engine.createRequest({ amount_cny: 10, client: "示例客户", purpose: "项目周报交付", method: "wechat_pay" });
engine.list({ status: "pending" });
engine.confirmReceived(id, { confirmed_by: "本人（人工确认到账）" }); // → paid + 账本 6 要素 + 发票草稿
engine.cancel(id, "客户取消");
engine.summary();   // 待收 / 已收 / 取消 统计
engine.explain();   // 变现说明（为什么没收到钱 / 怎么接真实收款）
engine.ledgerEntries();
engine.auditTrail();
await engine.persist();
```

## CLI

```bash
node dist/apps/cli/src/index.js money --action create --amount 10 --client "示例客户" --purpose "项目周报交付" --method wechat_pay --json
node dist/apps/cli/src/index.js money --action list --json
node dist/apps/cli/src/index.js money --action confirm --id <pay-id> --json
node dist/apps/cli/src/index.js money --action summary --json
node dist/apps/cli/src/index.js money --action explain --json
```

## 安全边界

- 不存明文银行卡/密钥；收款账户只来自配置中心的掩码值。
- 不自动确认到账、不自动开票（发票只生成草稿，人工确认）。
- 演示渠道的二维码/链接是占位（`https://pay.example.com/...`），不要当作真实收款码。
- 未接真实支付渠道前，**不会**产生真实资金流。
