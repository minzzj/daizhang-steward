# Adapters

> Adapters are **replaceable implementations**: the same interface can have a real and a mock
> implementation; CI and demos default to mock/local fixtures. Every adapter declares capability,
> risk level, approval requirement, evidence type and failure boundaries
> (timeout / unavailable / unknown result).

## 1. Browser adapter (phase 1, Playwright)

- Capabilities: open/navigate, click, type, select, scroll, screenshot, DOM snapshot, console logs,
  downloads, uploads, tabs, headed/headless, network/timeout config, profile isolation.
- Evidence: per-step screenshot + page URL + DOM snapshot path + console log file.
- Failure classes: element-not-found / navigation timeout / permission denied / risk-control block
  (→ stop and hand off) / unknown (→ suspend and reconcile).
- Hard rule: **UI acceptance runs real headed Chromium/Edge**; no mock DOM or API substitutes.
- Implementation: `packages/steward-browser`; borrows patterns from `dsh-browser` (MIT) and extends
  the missing capabilities.

## 2. Desktop adapter (Windows-first)

- Capabilities: list windows, focus window, screenshot, click, double-click, right-click, drag,
  type text, key press, UIA accessibility tree.
- Allowlist: only allowlisted processes/window titles; everything else denied by default.
- Evidence: per-step window/full-screen screenshot + target window title + timestamp.
- Safety: detecting a password/credential field pauses the branch and creates a handoff card; no
  credential autofill ever.
- Failure classes: window missing / focus lost / element unreachable / timeout / unknown result
  (always suspend and reconcile, never guess).
- Implementation: `packages/steward-desktop` (Windows: UIA + SendInput + screenshots); document
  Linux/macOS paths; optional cua-driver compatibility aligned with DSH `dsh-computer-use` semantics.

## 3. Model / Harness adapters

| Implementation | Purpose | Dependency |
|---|---|---|
| `MockHarness` | CI, offline demos, failure injection | none |
| `DshHeadlessHarness` | real coding loop producing patches | `@deepseek-ai/dsh` (pinned) |
| `DeepSeekApiHarness` | direct API fallback for integration tests | env-var key |

The Harness receives CodeTask text only and returns CodeResult; it never touches production
credentials or performs deployments.

## 4. Notification adapters

Windows Toast / SMTP email / Webhook (WeCom, Feishu, Slack) / CLI approval queue; SMS and voice are
evaluated in phase 2. Notifications carry summaries and links only — never credentials or raw
personal data. Failed sends are retried and recorded.

## 5. IoT adapter (phase 2 stub)

- Transport: MQTT and HTTP JSON-RPC codecs; four objects: devices, commands, receipts, events.
- Commands carry action, args, approval requirement, timeout. Receipts carry result, evidence, time.
- Phase 1 ships only interfaces and a simulated-device fixture; **no real devices**.

## 6. Failures and unknown results

One rule: **unknown ≠ success**. When an adapter returns `unknown`, the core suspends the branch,
writes an event and produces a reconciliation card. No more than two retries; never recorded as done.
