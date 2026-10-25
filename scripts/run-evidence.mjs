// Run the M0 acceptance evidence bundle:
//   1) build
//   2) unit + integration tests (node --test, TAP reporter for stable parsing)
//   3) `steward demo` empty-loop run
//   4) write docs/test-evidence/test-result-<stamp>.{md,json}
// Usage: npm run evidence
//
// Notes:
// - All paths written into the evidence bundle are repository-relative (no local absolute paths).
// - Automatic evidence files must never be hand-edited.
// - Evidence lists the run directory returned by `steward demo` (not an arbitrary runs/ entry).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");
mkdirSync(OUT_DIR, { recursive: true });

const rel = (p) => (p && p.startsWith(ROOT) ? relative(ROOT, p).replaceAll("\\", "/") : p);

function run(label, command, args, useShell = false) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    shell: useShell,
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(`\n=== ${label} (exit ${result.status}) ${durationMs}ms ===`);
  console.log(output.trim().slice(0, 4000));
  return { label, exitCode: result.status ?? -1, durationMs, output };
}

const build = run("build", "npm", ["run", "build"], true);
const tests = run("unit-tests", "node", ["--test", "--test-reporter=tap", "tests/unit/*.test.mjs"]);
const demo = run("steward-demo", "node", ["dist/apps/cli/src/index.js", "demo", "--json"]);

// parse TAP summary (fallback: `ℹ tests N` spec-style lines)
const tap = tests.output;
const num = (patterns) => {
  for (const re of patterns) {
    const m = tap.match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
const summary = {
  tests: num([/^# tests (\d+)$/m, /^ℹ tests (\d+)$/m]),
  pass: num([/^# pass (\d+)$/m, /^ℹ pass (\d+)$/m]),
  fail: num([/^# fail (\d+)$/m, /^ℹ fail (\d+)$/m]),
  skipped: num([/^# skipped (\d+)$/m, /^ℹ skipped (\d+)$/m]),
};

let demoJson = null;
try {
  const start = demo.output.indexOf("{");
  if (start >= 0) demoJson = JSON.parse(demo.output.slice(start));
} catch {
  demoJson = null;
}

const ok = build.exitCode === 0 && tests.exitCode === 0 && demo.exitCode === 0 && summary.fail === 0;

// Prefer the run directory that `steward demo` reported; never guess from directory names.
const runIds = existsSync(join(ROOT, "runs"))
  ? readdirSync(join(ROOT, "runs")).filter((n) => n.startsWith("run-"))
  : [];
const chosenRunId = demoJson?.runId && runIds.includes(demoJson.runId) ? demoJson.runId : runIds.sort().reverse()[0];
const artifacts = chosenRunId
  ? (() => {
      const dir = join(ROOT, "runs", chosenRunId);
      const files = [];
      try {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          const isFile = statSync(p).isFile();
          files.push({ name: f, size: isFile ? statSync(p).size : 0 });
        }
      } catch {
        /* ignore */
      }
      return [{ runId: chosenRunId, dir: `runs/${chosenRunId}`, files }];
    })()
  : [];

const result = {
  stamp,
  ok,
  env: { node: process.version, platform: process.platform, arch: process.arch },
  steps: {
    build: { exitCode: build.exitCode, durationMs: build.durationMs },
    tests: { exitCode: tests.exitCode, durationMs: tests.durationMs },
    demo: { exitCode: demo.exitCode, durationMs: demo.durationMs },
  },
  summary,
  demo: demoJson
    ? { ok: demoJson.ok, runId: demoJson.runId, reportPath: rel(demoJson.reportPath), steps: demoJson.steps?.length ?? null }
    : null,
  artifacts,
};
writeFileSync(join(OUT_DIR, `test-result-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# 测试结果 / Test Result — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}`,
  "",
  "## 步骤",
  "",
  "| 步骤 | 退出码 | 耗时 |",
  "|---|---|---|",
  `| build | ${build.exitCode} | ${build.durationMs}ms |`,
  `| unit-tests | ${tests.exitCode} | ${tests.durationMs}ms |`,
  `| steward-demo | ${demo.exitCode} | ${demo.durationMs}ms |`,
  "",
  "## 单元测试汇总",
  "",
  `- tests: ${summary.tests ?? "?"}`,
  `- pass: ${summary.pass ?? "?"}`,
  `- fail: ${summary.fail ?? "?"}`,
  `- skipped: ${summary.skipped ?? "?"}`,
  "",
  "## 演示回路（MockHarness，无付费 API）",
  "",
  demoJson
    ? `- run-id: \`${demoJson.runId}\`\n- report: \`${rel(demoJson.reportPath)}\`\n- steps: ${demoJson.steps?.length ?? "?"}`
    : "- 未能解析 demo JSON 输出",
  "",
  "## 证据文件",
  "",
  ...((artifacts[0]?.files ?? []).map((f) => `- \`runs/${artifacts[0].runId}/${f.name}\` (${f.size} B)`)),
  "",
  "> 本文件由 `npm run evidence` 自动生成；数字必须与 JSON 结果一致，不得手改。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `test-result-${stamp}.md`), md, "utf8");

console.log(`\nevidence written: docs/test-evidence/test-result-${stamp}.{md,json}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
