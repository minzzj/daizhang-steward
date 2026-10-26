# 变现 / 收款 / 易支付（v1.3）

## 1. 为什么之前「没收到钱」？为什么只有 ¥10？

- **之前没有接真实支付渠道**：测试中的「收款」是本地演示流程——创建收款请求 + 生成收款链接/二维码占位 + **人工确认到账**，**不会真的扣款**，所以钱不会自动到账。
- **¥10 只是测试金额**：金额由你自己填写，不是固定值（你可以在控制台随便填 ¥1、¥880、¥1000…）。

## 2. 变现流程（当前可用）

```
创建收款请求（金额/客户/用途/渠道）
  → 展示收款链接/二维码（演示占位 / 易支付收银台链接）
  → 客户付款（演示渠道不真实扣款；真实渠道由商户收款）
  → 你点「确认到账」（人工确认）或易支付回调验签通过
  → 自动记入账本（6 要素）+ 生成发票草稿（AI 不自动开票）
```

控制台：`http://127.0.0.1:4180/money`（收款请求列表 / 新建 / 确认到账 / 易支付设置）。
CLI：

```bash
node dist/apps/cli/src/index.js money --action summary
node dist/apps/cli/src/index.js money --action create --amount 10 --client "示例客户" --purpose "报价单交付" --method wechat_pay
node dist/apps/cli/src/index.js money --action confirm --id <pay-id>        # 人工确认到账 → 账本收入
node dist/apps/cli/src/index.js money --action explain                      # 变现说明
node dist/apps/cli/src/index.js money --action epay --amount 10 --type alipay   # 易支付收银台链接
node dist/apps/cli/src/index.js money --action epay-notify --file notify.json   # 易支付回调验签 → 自动确认到账
```

## 3. 账本 6 要素

每笔收入：金额 / 收付方 / 依据 / 审批人 / 回执号 / 项目，缺一不可；只追加，不删除。

## 4. 易支付（epay）集成

- 控制台 `/settings` 或 `/money` 配置：启用、模式 demo/live、网关地址、商户 ID、密钥引用、回调/返回 URL、支付方式（alipay/wxpay）。
- 协议：彩虹易支付兼容（MD5 签名）；`steward money --action epay` 生成收银台链接；`epay-notify` 校验签名 + `TRADE_SUCCESS` → `confirmReceived()` 自动入账。
- **demo**：不真实扣款，只生成演示链接；**live**：需真实商户信息与网关，密钥只存引用（`env:` / 本地 secrets），明文不入库。
- 接真实资金的另一种方式：把微信商户/支付宝当面付/银行回调（webhook）接到 `confirmReceived()`。

## 5. 发票 / 合同

- 发票只出**草稿**，由人工确认提交；AI 不自动开票。
- 个人模式：无合同、无签字，以人工确认到账为准；企业模式：授权书/用印/双人复核，**AI 不代签**。

## 6. 实测证据

- 演示收款 ¥10（微信支付）→ 人工确认到账 → 账本 6 要素 + 月报收入；
- 易支付 demo：创建请求 → 生成收银台链接 → MD5 签名通知校验通过 → 自动确认到账 → 账本条目；
- 证据：`docs/test-evidence/evidence-limit-2026-10-26_22-17-54/`、`docs/test-evidence/evidence-v13-real/`。
