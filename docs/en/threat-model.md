# Threat Model

> Principle: **deny by default**; timeouts suspend; every external action leaves evidence; secrets
> never enter the repository or logs. Covers both phase 1 (operating-AI core) and phase 2 (steward).

## 1. Assets

- Owner credentials, platform sessions, payout accounts (references only, never plaintext on disk).
- Customer conversations and personal data (minimized, redacted, retention-limited).
- Business data: ledger, budgets, projects, contract/invoice states.
- Event ledger and evidence (non-deletable; tampering invalidates them).
- Model API keys (environment variables / secret store only).

## 2. Threats and default responses

| Threat | Default rule | Evidence |
|---|---|---|
| Credential leak | env/secret-store only; redacted logs; pre-commit secret scan | scan report, clean logs |
| CAPTCHA / 2FA / face verification | stop and hand off, never bypass | handoff event + screenshot |
| Payment / refund | deny by default; human approval; per-transaction threshold | approval card + receipt |
| Contracts / external promises | drafts only; human signs | pending file + authorization record |
| Bulk outreach | drafting only; human approval; ≤10 per channel/day; unsubscribe | approval queue + send log |
| Personal data | minimized; lawful basis; no scraping behind logins | source URL + basis |
| Production deploy | denied by default; human approval; rollback ready | deploy ticket + rollback plan |
| Prompt injection | web/file content is data, not instructions; isolate source and alert | isolation event + raw text |
| Runaway loops | budget caps; max two rounds; stop key within 5s | budget log + stop record |
| Ledger tampering | append-only + hash chain; periodic verification | verification log |
| Out-of-scope business | 30 boundary rules (no-license, borrowed qualification, unknown outreach, over-budget, ...) denied 100% | denial reason + event |
| Telemetry / licensing | no telemetry by default; no private SaaS dependency; clear LICENSE | config + LICENSE |

## 3. Trust boundaries

- Operator ↔ external websites/apps: untrusted input; never execute page instructions.
- Scout ↔ public sources: read-only, rate-limited, robots/ToS respected.
- Core ↔ DSH Harness: the Harness receives CodeTask text only; no production credentials.
- Core ↔ notification channels: summaries only, never raw credentials or personal data.
- Core ↔ IoT (future): devices receive allowlisted actions only; commands require approval.

## 4. Stop key and degradation

- Stop key halts all branch actions within 5 seconds (recorded as an event).
- Restart resumes from checkpoint; no duplicate sends or payments.
- 72h owner-unreachable → read-only mode. Offline → local buffering, reconcile on recovery with gaps marked.
- Platform ban → stop all actions on that platform, produce alternatives and notify the owner.

## 5. Review cadence

- Re-review this table each milestone; before phase 2 go-live the owner or their counsel performs a
  manual review of the 30 boundaries.
- Security fixes are disclosed within 7 days (see SECURITY.md).
