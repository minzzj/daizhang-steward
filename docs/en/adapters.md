# Adapters

> Adapters are **replaceable implementations**: the same interface can have a real and a mock
> implementation; CI and demos default to mock/local fixtures. Every adapter declares capability,
> risk level, approval requirement, evidence type and failure boundaries
> (timeout / unavailable / unknown result).

## 1. Browser adapter (phase 1, Playwright)

- Capabilities: open/navigate, click, type, select, scroll, screenshot, DOM snapshot, console logs,
  downloads, uploads, tabs, headed/headless, network/timeout config, profile isolation.
- Evidence: per-step screenshot + page URL + DOM snapshot path + console log file.
- Failure classes (5): element-not-found / navigation timeout / permission denied / risk-control
  block / unknown; a risk-control keyword throws `RiskControlStopError` → **stop and hand off**,
  unknown → suspend and reconcile.
- Hard rule: **UI acceptance runs real headed Chromium/Edge**; no mock DOM or API substitutes.
- **Implementation status: implemented in M1** as `packages/steward-browser` (borrows `dsh-browser`
  MIT patterns and extends them): headed by default, `chrome → msedge` fallback, per-run
  `userDataDir`, per-step screenshot / DOM / console evidence; adapter-smoke **28/28 PASS**.
  Downloads / uploads / tabs / scrolling and similar capabilities are added in later iterations.
- Evidence layout (as measured in M1): `runs/<run-id>/e2e/<case>/` with `screenshots/`,
  `result.json`, `console.log` and `server.log`; `npm run acceptance` copies the key evidence to
  `docs/test-evidence/evidence-m1-<stamp>/` (A2 / A4 / A5 groups).

## 2. Desktop adapter (Windows-first)

- Capabilities: list windows, focus window, screenshot, click, double-click, type text (Unicode),
  key press, read window title / foreground state, credential/security-prompt detection. **All of the
  above are implemented in M2**; right-click, drag, scrolling and the UIA accessibility tree remain
  contract items for later iterations.
- Allowlist: only allowlisted processes/window titles; everything else denied by default
  (`DesktopAllowlistError`, `failureKind: allowlist-denied`), with a second foreground-window check
  right before mouse/keyboard injection.
- Evidence: per-step window screenshot + target window title + timestamp; `steps.json` records every
  step's evidence paths and structured data.
- Safety: detecting a password/credential or security-prompt window (password, UAC, CAPTCHA, face
  verification keywords) stops the branch and hands off immediately; no credential autofill, read or
  memorisation. **Known boundary: Windows cannot reliably identify a "password input field" in an
  arbitrary window** — the guarantee is "stop on credential/security windows", not "detect every
  password field".
- Failure classes: window missing (`window-not-found`) / focus lost (`focus-lost`) / timeout
  (`timeout`) / allowlist denied (`allowlist-denied`) / unknown result (`unknown` — always suspend and
  reconcile, never guess).
- **Implementation status: implemented in M2** as `packages/steward-desktop` (Windows: Python ctypes
  sidecar + `SendInput` real mouse/keyboard + `BitBlt` screenshots + Per-Monitor V2 DPI awareness;
  zero third-party dependencies). Details in
  [`packages/steward-desktop/README.md`](../../packages/steward-desktop/README.md).
- Evidence layout (as measured in M2): `runs/<run-id>/e2e-desktop/` with `screenshots/`,
  `result.json`, `steps.json` and `sidecar.log`; `npm run acceptance:m2` copies the key evidence to
  `docs/test-evidence/evidence-m2-<stamp>/` (A3 real-desktop group).
- Platform: real-desktop acceptance runs on Windows only at this stage; Linux/macOS paths are
  documented in the package README (section 10, X11/macOS Accessibility) — same contract, different
  implementation layer.

## 3. Model / Harness adapters

| Implementation | Purpose | Dependency | Status |
|---|---|---|---|
| `MockHarness` | CI, offline demos, failure injection | none | ✅ M0 done |
| Scripted patches (`examples/mock-harness/*.patch`) | M1 real fix patch / failure injection | git | ✅ M1 done |
| `DshHeadlessHarness` | real coding loop producing patches | `@deepseek-ai/dsh` (pinned) | planned (not implemented) |
| `DeepSeekApiHarness` | direct API fallback for integration tests | env-var key | planned (not implemented) |

The Harness receives CodeTask text only and returns CodeResult; it never touches production
credentials or performs deployments.

M2 adds no new Harness implementation: `DshHeadlessHarness` / `DeepSeekApiHarness` remain planned
(recommended from M3+); real-browser and real-desktop acceptance do not depend on a paid API. The
core now ships three safety modules (`stop-controller` / `checkpoint` / `isolation`) reusable by any
adapter or branch.

M1 code loop: `packages/steward-harness/src/patch.ts` applies a `unified_diff` in an **isolated git
worktree** (never touching the main workspace); `loop.ts` (`runCodeLoop`) runs the real-browser
acceptance per round, at most two rounds, then writes `escalated=true` and exits 1 (no infinite
retry); the CLI `code-loop` command exposes it, and `--fail` uses a broken patch to verify escalation.

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
