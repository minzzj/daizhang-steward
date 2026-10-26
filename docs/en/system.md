# System Controller / Supervisor (v1.3)

## What it can do

The supervisor (L1, highest privilege) takes user system-level commands:

- list / start / stop / restart / **remove (managed scope only, backup to recycle first)** managed programs;
- enable / disable / **remove (with backup)** managed plugins;
- read all logs and audit records;
- **switch any agent's model** and **edit any role's system prompt** (config-audited, key references only);
- **delegate a project to the project conductor** (creates a conductor child session, returns session_id);
- dangerous actions require **double confirmation**: risk + recycle backup path + confirmation token; user must type "确认删除" (confirm delete) and supply the one-time, 120s-TTL token.

## Managed scope & safety

Only apps in `system_policy.managed_apps` and direct subdirectories of `plugins_dir`; out-of-scope/path traversal/system-critical paths are rejected (`OutOfScopeError`); deletions back up to `.steward/system/recycle/<stamp>/` with `backup_path` in audit and can be restored; stopping processes uses recorded pid only (no wildcard kills); every action is appended to a sanitized audit JSONL.

## Console /system

Two-tier view (L1 supervisor → L2 conductor → L3 specialists), program/plugin status, per-agent model & token, log entry, supervisor chat with natural-language quick commands, dangerous-action confirmation dialog (risk / backup path / token / exact text), epay settings.

## CLI

```bash
steward system --action info --json
steward system --action plan --op app.start --target demo-app --json
steward system --action exec --op app.start --target demo-app --json
steward system --action exec --op plugin.remove --target demo-plugin --json   # prompts for --yes (double confirmation, backup first)
steward system --action audit --limit 20
steward supervisor --goal "check system, disable demo-plugin, then delegate a project" --json
```

## Evidence (v1.3)

Real program start (pid + heartbeat) → read logs → stop; real plugin disable (writes plugin.json); dangerous `removePlugin` paused for confirmation → approved → backed up to recycle and removed, audit contains `backup_path`. Evidence: `docs/test-evidence/evidence-v13-real/`.
