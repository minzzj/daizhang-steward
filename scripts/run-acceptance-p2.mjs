// 阶段二 P2 验收 runner（故障演练 / B3 + B4）：
//   B3 断网：真实 localhost 平台断网 → 断网期间不产生新承诺、动作排队 → 恢复后 10 分钟内补记、账本不重复
//   B4 封禁：模拟平台封禁 → 停止动作 → 生成替代方案通知 → 恢复
// 用法：npm run acceptance:p2   （真实网络故障注入；短跑：断网 2 分钟 / 封禁 2 分钟）
// 完整 2 小时断网 + 15 分钟封禁的长跑见 scripts/run-long-drill.mjs
//
// 输出：docs/test-evidence/p2-acceptance-<stamp>.{md,json} + evidence-p2-<stamp>/（脱敏，只保留最新）

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");

for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-p2-/.test(name) || /^p2-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-p2-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const sanitize = makeSanitizer(ROOT);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

function run(label, command, args, { shell = false, timeoutMs = 900_000 } = {}) {
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
  console.log(output.trim().slice(0, 3000));
  return { label, exitCode: result.status ?? -1, durationMs: Date.now() - started, output };
}

function parseLastJson(output) {
  // CLI 可能先打印平台启动日志；取最后一个完整 JSON 对象
  const starts = [];
  let idx = -1;
  while ((idx = output.indexOf("{", idx + 1)) >= 0) starts.push(idx);
  for (let i = starts.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(output.slice(starts[i]));
    } catch {
      /* try earlier */
    }
  }
  return null;
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

// 1) build + 全量测试
results.build = run("build", "npm", ["run", "build"], { shell: true });
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

// 2) B3：真实断网 2 分钟（短跑）→ 不产生承诺 / 恢复幂等补记
results.netOutage = run("B3-net-outage", process.execPath, [
  CLI,
  "fault-drill",
  "--case",
  "net-outage",
  "--outage-minutes",
  "2",
  "--json",
], { timeoutMs: 15 * 60_000 });
const outage = parseLastJson(results.netOutage.output);
const outageDir = outage?.evidence_dir ?? outage?.state_dir ?? null;
const outageEvidence = copyEvidenceDir(outageDir, "B3-net-outage");

// 3) B4：真实平台封禁 2 分钟（短跑）→ 停止 + 替代方案通知 + 恢复
results.platformBan = run("B4-platform-ban", process.execPath, [
  CLI,
  "fault-drill",
  "--case",
  "platform-ban",
  "--ban-minutes",
  "2",
  "--json",
], { timeoutMs: 15 * 60_000 });
const ban = parseLastJson(results.platformBan.output);
const banDir = ban?.evidence_dir ?? ban?.state_dir ?? null;
const banEvidence = copyEvidenceDir(banDir, "B4-platform-ban");

const checks = {
  build: results.build.exitCode === 0,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  b3NoNewPromise: Boolean(outage?.blocked_promises > 0),
  b3QueuedActions: Boolean(outage?.queued_actions > 0),
  b3RecoveredWithin10Min: outage?.recovered_within_10min === true,
  b3LedgerNoDuplicates: outage?.duplicates_found === 0,
  b3DrillOk: outage?.ok === true,
  b4BanDetected: Boolean(ban?.ban_detected_within_ms >= 0 && ban?.stopped === true),
  b4AlternativePlan: Boolean(ban?.alternative_plan?.items?.length > 0),
  b4Notification: Boolean(ban?.notification_path),
  b4DrillOk: ban?.ok === true,
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  phase: "P2 fault drills",
  testSummary,
  b3: outage
    ? {
        outage_minutes: 2,
        blocked_promises: outage.blocked_promises,
        queued_actions: outage.queued_actions,
        replayed: outage.replayed,
        duplicates_found: outage.duplicates_found,
        recovered_within_10min: outage.recovered_within_10min,
        outage_ms: outage.outage_ms,
      }
    : null,
  b4: ban
    ? {
        ban_minutes: 2,
        ban_detected_within_ms: ban.ban_detected_within_ms,
        stopped: ban.stopped,
        actions_attempted_during_ban: ban.actions_attempted_during_ban,
        alternative_items: ban.alternative_plan?.items?.length ?? null,
        notification_path: ban.notification_path,
        recovered: ban.recovered,
      }
    : null,
  evidence: { netOutage: outageEvidence, platformBan: banEvidence, unitTestsLog: "unit-tests.log" },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    netOutage: { exitCode: results.netOutage.exitCode, durationMs: results.netOutage.durationMs },
    platformBan: { exitCode: results.platformBan.exitCode, durationMs: results.platformBan.durationMs },
  },
};
writeFileSync(join(OUT_DIR, `p2-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const line = (label, flag, detail) => `| ${label} | ${flag ? "✅" : "❌"} | ${detail} |`;
const md = [
  `# 阶段二 P2 验收结果 / Phase-2 P2 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}（故障演练）`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（真实 localhost HTTP 故障注入）`,
  `- 短跑规模：断网 2 分钟 / 封禁 2 分钟；**完整长跑（断网 120 分钟 + 封禁 15 分钟）见 docs/test-evidence/long-drill-***`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  line("build", checks.build, "tsc 通过"),
  line("单元+集成测试", checks.unitTests, `${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail`),
  line("B3 断网期间不产生新承诺", checks.b3NoNewPromise, `被拒绝承诺 ${outage?.blocked_promises ?? "?"} 次`),
  line("B3 动作进入 Outbox 排队", checks.b3QueuedActions, `排队 ${outage?.queued_actions ?? "?"} 条`),
  line("B3 恢复后 10 分钟内补记", checks.b3RecoveredWithin10Min, `outage=${outage?.outage_ms ?? "?"}ms；replayed=${outage?.replayed ?? "?"}`),
  line("B3 账本不重复（幂等）", checks.b3LedgerNoDuplicates, `duplicates_found=${outage?.duplicates_found ?? "?"}`),
  line("B3 演练整体", checks.b3DrillOk, "drill-net-outage.json"),
  line("B4 平台封禁检测并停止", checks.b4BanDetected, `检测 ${ban?.ban_detected_within_ms ?? "?"}ms；停止=${ban?.stopped ?? "?"}`),
  line("B4 替代方案生成", checks.b4AlternativePlan, `替代方案 ${ban?.alternative_plan?.items?.length ?? "?"} 条（渠道/原因/下一步/负责人）`),
  line("B4 通知留痕", checks.b4Notification, `${ban?.notification_path ?? "?"}`),
  line("B4 演练整体", checks.b4DrillOk, "drill-platform-ban.json"),
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-p2-${stamp}/\``,
  "- `B3-net-outage/`：drill 结果 JSON（outbox、probes、reconciler、通知）",
  "- `B4-platform-ban/`：drill 结果 JSON + alternative-plan + notification",
  "- `unit-tests.log`：完整测试套件日志",
  "",
  "> 本文件由 `npm run acceptance:p2` 自动生成；故障通过真实 localhost HTTP 平台注入（真实 ECONNREFUSED / 真实 403 ban），无 mock/stub；证据已脱敏。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `p2-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/p2-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
