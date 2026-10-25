// Run the M0 acceptance evidence bundle:
//   1) build
//   2) unit + integration tests (node --test tests/unit)
//   3) `steward demo` empty-loop run
//   4) write docs/test-evidence/测试结果-<stamp>.{md,json}
// Usage: npm run evidence

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");
mkdirSync(OUT_DIR, { recursive: true });

function run(label, command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    shell: process.platform === "win32",
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(`\n=== ${label} (exit ${result.status}) ${durationMs}ms ===`);
  console.log(output.trim().slice(0, 4000));
  return { label, exitCode: result.status ?? -1, durationMs, output };
}

const build = run("build", "npm", ["run", "build"]);
const tests = run("unit-tests", "node", ["--test", "tests/unit/*.test.mjs"]);
const demo = run("steward-demo", "node", ["dist/apps/cli/src/index.js", "demo", "--json"]);

// parse TAP-ish summary from node --test output
const tap = tests.output;
const num = (re) => {
  const m = tap.match(re);
  return m ? Number(m[1]) : null;
};
const summary = {
  tests: num(/^# tests (\d+)$/m),
  pass: num(/^# pass (\d+)$/m),
  fail: num(/^# fail (\d+)$/m),
  skipped: num(/^# skipped (\d+)$/m),
};

let demoJson = null;
try {
  const start = demo.output.indexOf("{");
  if (start >= 0) demoJson = JSON.parse(demo.output.slice(start));
} catch {
  demoJson = null;
}

const ok = build.exitCode === 0 && tests.exitCode === 0 && demo.exitCode === 0;
const runIds = readdirSync(join(ROOT, "runs")).filter((n) => n.startsWith("run-")).sort().reverse();
const artifacts = runIds.slice(0, 1).map((runId) => {
  const dir = join(ROOT, "runs", runId);
  const files = [];
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      files.push({ name: f, size: statSync(p).isFile() ? statSync(p).size : 0 });
    }
  } catch {
    /* ignore */
  }
  return { runId, dir: `runs/${runId}`, files };
});

const result = {
  stamp,
  ok,
  env: { node: process.version, platform: process.platform, arch: process.arch },
  steps: { build, tests: { ...tests, output: undefined }, demo: { ...demo, output: undefined } },
  summary,
  demo: demoJson ? { ok: demoJson.ok, runId: demoJson.runId, reportPath: demoJson.reportPath } : null,
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
  demoJson ? `- run-id: \`${demoJson.runId}\`\n- report: \`${demoJson.reportPath}\`\n- steps: ${demoJson.steps?.length ?? "?"}` : "- 未能解析 demo JSON 输出",
  "",
  "## 证据文件",
  "",
  ...(artifacts[0]?.files ?? []).map((f) => `- \`runs/${artifacts[0].runId}/${f.name}\` (${f.size} B)`),
  "",
  "> 本文件由 `npm run evidence` 自动生成；数字必须与 JSON 结果一致。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `test-result-${stamp}.md`), md, "utf8");

console.log(`\nevidence written: docs/test-evidence/test-result-${stamp}.{md,json}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
