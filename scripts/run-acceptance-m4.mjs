// M4 acceptance runner (phase-1 release): A10 dummy branch + A11 release readiness + full suite.
// Usage: npm run acceptance:m4   (deterministic; no GUI / no network / no real outreach)
//
// Writes docs/test-evidence/m4-acceptance-<stamp>.{md,json} + evidence-m4-<stamp>/
// (sanitized; keeps only the latest M4 bundle).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");

for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-m4-/.test(name) || /^m4-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-m4-${stamp}`);
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

// 2) full unit/integration suite (includes m4-release tests)
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

// 3) A10: dummy read-only branch (config + existing prompt only)
results.dummy = run("A10-dummy-branch", process.execPath, ["dist/apps/cli/src/index.js", "dummy-branch", "--json"]);
const dummyJson = parseJsonOutput(results.dummy.output);
const dummyEvidence = copyEvidenceDir(dummyJson?.artifacts?.dir, "A10-dummy-branch");

// 4) A11: release readiness checks (files, licenses, bilingual docs, telemetry, version)
const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const license = readIf(join(ROOT, "LICENSE")) ?? "";
const notice = readIf(join(ROOT, "NOTICE")) ?? "";
const commercial = readIf(join(ROOT, "COMMERCIAL.md")) ?? "";
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const cliSource = readFileSync(join(ROOT, "apps", "cli", "src", "index.ts"), "utf8");

const zhDocs = readdirSync(join(ROOT, "docs", "zh-CN")).filter((f) => f.endsWith(".md"));
const enDocs = readdirSync(join(ROOT, "docs", "en")).filter((f) => f.endsWith(".md"));
const missingEn = zhDocs.filter((f) => !enDocs.includes(f));
const enDocsDir = join(ROOT, "docs", "en");
const missingZh = enDocs.filter((f) => !existsSync(join(join(ROOT, "docs", "zh-CN"), f)));

const telemetryPattern = /telemetry|analytics|posthog|sentry|mixpanel|amplitude/i;
const telemetryHits = [];
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "runs"].includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(p);
    } else if (/\.(ts|mjs|js)$/.test(entry.name) && telemetryPattern.test(readFileSync(p, "utf8"))) {
      telemetryHits.push(rel(p));
    }
  }
};
for (const dir of ["packages", "apps"]) scan(join(ROOT, dir));

const gfi = readIf(join(ROOT, "docs", "good-first-issues.md")) ?? "";
const gfiCount = (gfi.match(/GFI-\d/g) ?? []).length;
const demoZh = readIf(join(ROOT, "docs", "demo-script.zh-CN.md"));
const demoEn = readIf(join(ROOT, "docs", "demo-script.md"));
const releaseNotes = readIf(join(ROOT, "docs", "RELEASE_NOTES_v0.5.0.md"));

const checks = {
  build: results.build.exitCode === 0,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  a10DummyBranch: results.dummy.exitCode === 0 && Boolean(dummyJson?.ok) && dummyJson?.role === "dummy",
  licenseCcByNcSa: license.includes("Attribution-NonCommercial-ShareAlike 4.0") && license.includes("NonCommercial"),
  thirdPartyNotice: /MIT/.test(notice) && /DeepSeek Harness/.test(notice),
  commercialNotice: /商用|Commercial/i.test(commercial),
  bilingualDocs: missingEn.length === 0 && missingZh.length === 0 && zhDocs.length >= 6,
  noTelemetry: telemetryHits.length === 0,
  versionConsistent: pkg.version === "0.5.0" && /const VERSION = "0\.5\.0"/.test(cliSource),
  releaseDocs: gfiCount >= 5 && Boolean(demoZh) && Boolean(demoEn) && Boolean(releaseNotes),
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  testSummary,
  version: pkg.version,
  coverage: {
    zhDocs: zhDocs.length,
    enDocs: enDocs.length,
    missingEn,
    goodFirstIssues: gfiCount,
    telemetryHits,
  },
  runs: { dummy: dummyJson?.runId ?? null },
  evidence: { dummyBranch: dummyEvidence, unitTestsLog: "unit-tests.log" },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    dummy: { exitCode: results.dummy.exitCode, durationMs: results.dummy.durationMs },
  },
};
writeFileSync(join(OUT_DIR, `m4-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# M4 验收结果 / M4 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 版本：v${pkg.version}（阶段一发布）`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  `| build | ${checks.build ? "✅" : "❌"} | 类型检查与构建 |`,
  `| 测试套件 | ${checks.unitTests ? "✅" : "❌"} | ${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail |`,
  `| A10 dummy 只读分支 | ${checks.a10DummyBranch ? "✅" : "❌"} | 仅配置+已有提示词，不改核心；run \`${result.runs.dummy ?? "-"}\` |`,
  `| A11 许可证 | ${checks.licenseCcByNcSa ? "✅" : "❌"} | CC BY-NC-SA 4.0 完整文本 + 非商用条款 |`,
  `| A11 第三方声明 | ${checks.thirdPartyNotice ? "✅" : "❌"} | NOTICE 含 DeepSeek Harness 等 MIT 组件 |`,
  `| A11 商用说明 | ${checks.commercialNotice ? "✅" : "❌"} | COMMERCIAL.md 说明商用授权 |`,
  `| A11 双语文档 | ${checks.bilingualDocs ? "✅" : "❌"} | zh-CN ${zhDocs.length} 篇 / en ${enDocs.length} 篇，缺失 ${missingEn.length + missingZh.length} |`,
  `| A11 无遥测 | ${checks.noTelemetry ? "✅" : "❌"} | 源码扫描命中 ${telemetryHits.length} |`,
  `| 版本一致 | ${checks.versionConsistent ? "✅" : "❌"} | package.json / CLI VERSION = ${pkg.version} |`,
  `| A11 发布文档 | ${checks.releaseDocs ? "✅" : "❌"} | good-first-issues ${gfiCount} 个 + 演示脚本双语 + v0.5.0 发布说明 |`,
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-m4-${stamp}/\``,
  "- `A10-dummy-branch/`：dummy 分支运行产物（prompt/report/events）",
  "- `unit-tests.log`：含 m4-release 测试的完整套件日志",
  "",
  "> 本文件由 `npm run acceptance:m4` 自动生成；阶段一 A1–A12 验收状态见 docs/*/delivery-checklist.md。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `m4-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/m4-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
