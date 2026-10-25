// M2 acceptance runner: REAL Windows desktop (A3) + stop-key/checkpoint/isolation (A8/A9).
// Usage: npm run acceptance:m2   (local interactive Windows session required)
//
// Writes docs/test-evidence/m2-acceptance-<stamp>.{md,json} and copies key evidence into
// docs/test-evidence/evidence-m2-<stamp>/ (all local absolute paths sanitized before copying).
// Keeps only the latest M2 acceptance bundle in the working tree.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");
// keep only the latest M2 acceptance bundle in the working tree (history stays in git) — clean BEFORE creating
for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-m2-/.test(name) || /^m2-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-m2-${stamp}`);
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
const buildOk = results.build.exitCode === 0;

// 2) unit + integration suite (A8/A9 runtime tests + all regressions)
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

// 3) A3: real Windows desktop flow (real mouse/keyboard)
results.desktopFlow = run("A3-desktop-flow", process.execPath, ["dist/apps/cli/src/index.js", "desktop-flow", "--json"]);
const desktopJson = parseJsonOutput(results.desktopFlow.output);
const desktopEvidence = copyEvidenceDir(desktopJson?.artifacts?.dir, "A3-desktop-flow");

// 4) A8/A9: deterministic safety checks (stop ≤5s / checkpoint / isolation)
results.safetyCheck = run("A8-A9-safety-check", process.execPath, ["dist/apps/cli/src/index.js", "safety-check", "--json"]);
const safetyJson = parseJsonOutput(results.safetyCheck.output);
const safetyResultPath = safetyJson?.resultPath;
if (safetyResultPath && existsSync(safetyResultPath)) {
  const target = join(EVIDENCE_DIR, "A8-A9-safety-check", "safety-check-result.json");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(safetyResultPath, target);
  sanitizeFileInPlace(target, sanitize);
}

// 5) A8 resume: runtime integration test subset (checkpoint resume / preemption / isolation)
results.resumeTests = run("A8-resume-tests", process.execPath, [
  "--test",
  "--test-reporter=tap",
  "tests/unit/m2-runtime.test.mjs",
]);
writeFileSync(join(EVIDENCE_DIR, "m2-runtime-tests.log"), sanitize(results.resumeTests.output), "utf8");

const checks = {
  build: buildOk,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  a3DesktopFlow: results.desktopFlow.exitCode === 0 && Boolean(desktopJson?.ok),
  a8StopAndCheckpoint: results.safetyCheck.exitCode === 0 && Boolean(safetyJson?.ok),
  a8ResumeRuntimeTests: results.resumeTests.exitCode === 0,
  a9Isolation: Boolean(safetyJson?.checks?.credentials?.ok) && Boolean(safetyJson?.checks?.isolation?.ok),
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  testSummary,
  runs: {
    desktopFlow: desktopJson?.runId ?? null,
    safetyCheck: safetyJson?.resultPath ? rel(safetyResultPath) : null,
  },
  evidence: {
    desktopFlow: desktopEvidence,
    safetyCheck: safetyJson?.resultPath ? "A8-A9-safety-check/safety-check-result.json" : null,
    unitTestsLog: "unit-tests.log",
    resumeTestsLog: "m2-runtime-tests.log",
  },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    desktopFlow: { exitCode: results.desktopFlow.exitCode, durationMs: results.desktopFlow.durationMs },
    safetyCheck: { exitCode: results.safetyCheck.exitCode, durationMs: results.safetyCheck.durationMs },
    resumeTests: { exitCode: results.resumeTests.exitCode, durationMs: results.resumeTests.durationMs },
  },
};
writeFileSync(join(OUT_DIR, `m2-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# M2 验收结果 / M2 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（本机真实桌面会话）`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  `| build | ${checks.build ? "✅" : "❌"} | 类型检查与构建 |`,
  `| 测试套件 | ${checks.unitTests ? "✅" : "❌"} | ${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail |`,
  `| A3 真实桌面流程 | ${checks.a3DesktopFlow ? "✅" : "❌"} | 真实 Windows 窗口 + 真实键鼠：打开→填表→保存→校验→截图；run \`${result.runs.desktopFlow ?? "-"}\` |`,
  `| A8 停止键 + 检查点 | ${checks.a8StopAndCheckpoint ? "✅" : "❌"} | 停止 ≤5s、检查点 save/load/completed；结果 \`A8-A9-safety-check/safety-check-result.json\` |`,
  `| A8 重启恢复（runtime） | ${checks.a8ResumeRuntimeTests ? "✅" : "❌"} | checkpoint resume 跳过已完成步骤、不重复执行（m2-runtime-tests.log） |`,
  `| A9 分支隔离 | ${checks.a9Isolation ? "✅" : "❌"} | 跨分支凭据不可读、同一 profile 不能并发占用、白名单外工具拒绝 |`,
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-m2-${stamp}/\``,
  `- 桌面流程截图与结果：\`A3-desktop-flow/\``,
  `- 安全自检结果：\`A8-A9-safety-check/safety-check-result.json\``,
  `- 测试日志：\`unit-tests.log\`、\`m2-runtime-tests.log\``,
  "",
  "> 本文件由 `npm run acceptance:m2` 自动生成（真实桌面）；证据已脱敏，不得手改。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `m2-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/m2-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
