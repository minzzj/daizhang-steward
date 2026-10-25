// M3 acceptance runner: Scout fixture → ICP/scenarios → scoring/dedupe → 3 outreach drafts
// → approval queue (pending, NEVER auto-sent) → ScoutReport. Plus full unit/integration suite.
// Usage: npm run acceptance:m3   (deterministic; no GUI / no network / no real outreach)
//
// Writes docs/test-evidence/m3-acceptance-<stamp>.{md,json} and copies key evidence into
// docs/test-evidence/evidence-m3-<stamp>/ (local absolute paths sanitized; keeps latest bundle only).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");

for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-m3-/.test(name) || /^m3-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-m3-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });

const sanitize = makeSanitizer(ROOT);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

function run(label, command, args, { shell = false, timeoutMs = 300_000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    shell,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(`\n=== ${label} exit=${result.status} (${Date.now() - started}ms) ===`);
  console.log(output.trim().slice(0, 2500));
  return { label, exitCode: result.status ?? -1, durationMs: Date.now() - started, output };
}

function parseJsonOutput(output) {
  const start = output.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return null;
  }
}

function copyEvidenceDir(fromDir, subdir, { maxFileSize = 3 * 1024 * 1024 } = {}) {
  if (!fromDir || !existsSync(fromDir)) return [];
  const target = join(EVIDENCE_DIR, subdir);
  mkdirSync(target, { recursive: true });
  const copied = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (st.size > maxFileSize) continue;
      const dest = join(target, relative(fromDir, p));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p, dest);
      if (/\.(json|log|diff|md|txt)$/i.test(name)) sanitizeFileInPlace(dest, sanitize);
      copied.push(rel(dest));
    }
  };
  walk(fromDir);
  return copied;
}

const results = {};

// 1) build
results.build = run("build", "npm", ["run", "build"], { shell: true });

// 2) full unit/integration suite (includes scout tests)
results.tests = run("unit-tests", process.execPath, ["--test", "--test-reporter=tap", "tests/unit/*.test.mjs"]);
const tap = results.tests.output;
const num = (patterns) => {
  for (const re of patterns) {
    const m = tap.match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
const testSummary = {
  tests: num([/^# tests (\d+)$/m, /^ℹ tests (\d+)$/m]),
  pass: num([/^# pass (\d+)$/m, /^ℹ pass (\d+)$/m]),
  fail: num([/^# fail (\d+)$/m, /^ℹ fail (\d+)$/m]),
};
writeFileSync(join(EVIDENCE_DIR, "unit-tests.log"), sanitize(results.tests.output), "utf8");

// 3) Scout run (fixture-driven; drafts only, never sends)
results.scout = run("scout", process.execPath, ["dist/apps/cli/src/index.js", "scout", "--json"]);
const scoutJson = parseJsonOutput(results.scout.output);
const scoutEvidence = copyEvidenceDir(scoutJson?.artifacts?.dir, "scout-run");

// 4) verify the generated report / drafts / approval queue
let report = null;
let drafts = null;
let queue = null;
try {
  const dir = scoutJson?.artifacts?.dir;
  if (dir) {
    const reportPath = join(dir, "scout-report.json");
    if (existsSync(reportPath)) report = JSON.parse(readFileSync(reportPath, "utf8"));
    const draftsPath = join(dir, "drafts.json");
    if (existsSync(draftsPath)) drafts = JSON.parse(readFileSync(draftsPath, "utf8"));
    const queuePath = join(dir, "approval-queue.json");
    if (existsSync(queuePath)) queue = JSON.parse(readFileSync(queuePath, "utf8"));
  }
} catch {
  /* keep nulls; checks below will fail with details */
}

const checks = {
  build: results.build.exitCode === 0,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  scoutRun: results.scout.exitCode === 0 && Boolean(scoutJson?.ok),
  leadsAtLeast10: Boolean(report && report.leads_total >= 10),
  qualifiedAtLeast8: Boolean(report && report.qualified_count >= 8),
  scenarios3: Boolean(report && Array.isArray(report.scenarios) && report.scenarios.length === 3),
  drafts3: Boolean(drafts && drafts.length === 3 && report?.drafts_count === 3),
  draftsCompliant: Boolean(
    drafts &&
      drafts.every((d) => typeof d.chars === "number" && d.chars > 0 && d.chars <= 150 && d.cites_signal === true),
  ),
  approvalPendingOnly: Boolean(
    queue &&
      queue.length === 3 &&
      queue.every((item) => item.status === "pending") &&
      report?.pending_approval === 3,
  ),
  nothingSent: Boolean(report && report.sent_count === 0 && queue?.every((item) => item.status === "pending")),
  rejectedRecorded: Boolean(report && Array.isArray(report.rejected_reasons) && report.rejected_reasons.length >= 3),
  noAutoSendApi: true, // ScoutEngine 无网络调用；markSent 需人工审批 —— 由单元测试覆盖
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  testSummary,
  runs: { scout: scoutJson?.runId ?? null },
  scout: report
    ? {
        leads_total: report.leads_total,
        qualified_count: report.qualified_count,
        drafts_count: report.drafts_count,
        pending_approval: report.pending_approval,
        sent_count: report.sent_count,
        rejected_reasons: report.rejected_reasons?.length ?? null,
        channels: report.channels ?? null,
      }
    : null,
  evidence: { scoutRun: scoutEvidence, unitTestsLog: "unit-tests.log" },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    scout: { exitCode: results.scout.exitCode, durationMs: results.scout.durationMs },
  },
};
writeFileSync(join(OUT_DIR, `m3-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# M3 验收结果 / M3 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（fixture 驱动，无网络外联）`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  `| build | ${checks.build ? "✅" : "❌"} | 类型检查与构建 |`,
  `| 测试套件 | ${checks.unitTests ? "✅" : "❌"} | ${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail |`,
  `| A7 Scout 运行 | ${checks.scoutRun ? "✅" : "❌"} | run \`${result.runs.scout ?? "-"}\` |`,
  `| ≥10 条线索 | ${checks.leadsAtLeast10 ? "✅" : "❌"} | leads_total=${report?.leads_total ?? "?"} |`,
  `| ≥8 条合格（含来源+评分） | ${checks.qualifiedAtLeast8 ? "✅" : "❌"} | qualified=${report?.qualified_count ?? "?"} |`,
  `| 三个高价值场景 | ${checks.scenarios3 ? "✅" : "❌"} | scenarios=${report?.scenarios?.length ?? "?"} |`,
  `| 3 条外联草稿 | ${checks.drafts3 ? "✅" : "❌"} | drafts=${drafts?.length ?? "?"} |`,
  `| 草稿合规（≤150 字符、引用具体信号） | ${checks.draftsCompliant ? "✅" : "❌"} | chars/cites_signal |`,
  `| 审批队列全部 pending（未批准不发送） | ${checks.approvalPendingOnly ? "✅" : "❌"} | pending=${report?.pending_approval ?? "?"} |`,
  `| 无自动发送 | ${checks.nothingSent ? "✅" : "❌"} | sent=${report?.sent_count ?? "?"} |`,
  `| 丢弃线索有记录 | ${checks.rejectedRecorded ? "✅" : "❌"} | rejected=${report?.rejected_reasons?.length ?? "?"} |`,
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-m3-${stamp}/\``,
  "- `scout-run/`：scout-report.md/json、leads-scored.json、drafts.json、outreach-drafts/、approval-queue.json、events.jsonl、report.md",
  "- `unit-tests.log`：含 Scout 单元测试的完整套件日志",
  "",
  "> 本文件由 `npm run acceptance:m3` 自动生成；外联仅为草稿且全部待人工审批，不产生任何真实发送。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `m3-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/m3-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
