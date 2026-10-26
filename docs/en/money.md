# Monetization / Payments / Epay (v1.3)

## Why no money was received before, and why ¥10?

- No real payment channel was connected: the previous "payment" was a local demo flow — create request + payment link/QR placeholder + **manual confirmation**, **no real charge**, so money never arrived automatically.
- ¥10 was just a test amount: you can set any amount yourself.

## Flow (available now)

```
Create payment request (amount / client / purpose / channel)
  → show payment link/QR (demo placeholder / epay checkout link)
  → customer pays (demo channel does not charge; real channel is merchant-side)
  → you click "confirm received" (manual) or epay callback signature verified
  → ledger entry (6 elements) + invoice draft (AI never auto-invoices)
```

Console: `http://127.0.0.1:4180/money`.
CLI:

```bash
steward money --action summary
steward money --action create --amount 10 --client "Demo Client" --purpose "Quotation delivery" --method wechat_pay
steward money --action confirm --id <pay-id>
steward money --action explain
steward money --action epay --amount 10 --type alipay
steward money --action epay-notify --file notify.json
```

## Ledger 6 elements

Amount / payee-or-payer / basis / approver / receipt ref / project — all required, append-only.

## Epay integration

Configure in console `/settings` or `/money`: enabled, demo/live, gateway, merchant ID, key ref, notify/return URLs, methods (alipay/wxpay). 彩虹易支付-compatible MD5 signing; `--action epay` builds checkout URL; `epay-notify` verifies signature + `TRADE_SUCCESS` then auto-confirms. Demo never charges; live requires real merchant info and key references only (`env:` / local secrets).

## Invoices & contracts

Invoice drafts only, human submits; personal mode has no contract/signature (manual confirmation of receipt), enterprise mode uses authorization/seal + dual review; **AI never signs**.

## Evidence

Demo payment ¥10 confirmed → ledger 6 elements + monthly report; epay demo: request → checkout link → MD5-signed notify verified → auto confirm → ledger entry. Evidence: `docs/test-evidence/evidence-limit-2026-10-26_22-17-54/`, `docs/test-evidence/evidence-v13-real/`.
