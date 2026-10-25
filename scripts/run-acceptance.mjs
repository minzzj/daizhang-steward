// M1 acceptance runner: REAL browser (headed by default) + code loop + two-round escalation.
// Usage: npm run acceptance
// Requires: local desktop session (headed Chrome/Edge). CI runs only unit/integration tests.
//
// Writes docs/test-evidence/m1-acceptance-<stamp>.{md,json} and copies the key evidence
// (screenshots / patch / logs / results) into docs/test-evidence/evidence-m1-<stamp>/.
// Older acceptance bundles are removed first so the repository keeps only the latest bundle.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");
const EVIDENCE_DIR = join(OUT_DIR, `evidence-m1-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });

// keep only the latest acceptance bundle in the working tree (history stays in git)
for (const name of readdirSync(OUT_DIR)) {
  const old = /^(evidence-m1-|m1-acceptance-)/.test(name);
  if (old) rmSync(join(OUT_DIR, name), { recursive: true, force: true });
}

const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");
const sanitize = makeSanitizer(ROOT);

function runNode(args, timeoutMs = 600_000) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    exitCode: result.status ?? -1,
    durationMs: Date.now() - started,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runNpm(args, timeoutMs = 600_000) {
  const started = Date.now();
  const result = spawnSync("npm", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    exitCode: result.status ?? -1,
    durationMs: Date.now() - started,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
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

function copyEvidence(runDir, subdir) {
  if (!runDir || !existsSync(runDir)) return [];
  const target = join(EVIDENCE_DIR, subdir);
  mkdirSync(target, { recursive: true });
  const copied = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (/\.(png|json|diff|log|md)$/i.test(name) && st.size < 3 * 1024 * 1024) {
        const relPath = relative(runDir, p);
        const dest = join(target, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(p, dest);
        if (/\.(json|diff|log|md)$/i.test(name)) sanitizeFileInPlace(dest, sanitize);
        copied.push(rel(dest));
      }
    }
  };
  walk(runDir);
  return copied;
}

const results = {};

// 1) build
results.build = runNpm(["run", "build"]);
console.log(`\n=== build exit=${results.build.exitCode} (${results.build.durationMs}ms) ===`);

// 2) A2: real browser flow (headed)
results.browserFlow = runNode(["dist/apps/cli/src/index.js", "browser-flow", "--json"]);
const browserJson = parseJsonOutput(results.browserFlow.output);
console.log(`\n=== A2 browser-flow exit=${results.browserFlow.exitCode} ===\n${results.browserFlow.output.trim().slice(0, 3000)}`);

// 3) A4: code loop with the real fix patch + real browser acceptance
results.codeLoop = runNode(["dist/apps/cli/src/index.js", "code-loop", "--json"]);
const codeLoopJson = parseJsonOutput(results.codeLoop.output);
console.log(`\n=== A4 code-loop exit=${results.codeLoop.exitCode} ===\n${results.codeLoop.output.trim().slice(0, 3000)}`);

// 4) A5: two-round failure then escalation (broken patch)
results.codeLoopFail = runNode(["dist/apps/cli/src/index.js", "code-loop", "--fail", "--json"]);
const failJson = parseJsonOutput(results.codeLoopFail.output);
console.log(`\n=== A5 code-loop --fail exit=${results.codeLoopFail.exitCode} ===\n${results.codeLoopFail.output.trim().slice(0, 3000)}`);

// copy evidence directories
const copied = {
  browserFlow: copyEvidence(browserJson?.artifacts?.dir, "A2-browser-flow"),
  codeLoop: copyEvidence(codeLoopJson?.artifacts?.dir, "A4-code-loop"),
  codeLoopFail: copyEvidence(failJson?.artifacts?.dir, "A5-escalation"),
};

// A5 assertion: exit code 1 and code-loop-result.json escalated=true
let escalationOk = false;
try {
  const failResultPath = join(failJson?.artifacts?.dir ?? "", "code-loop-result.json");
  if (existsSync(failResultPath)) {
    const parsed = JSON.parse(readFileSync(failResultPath, "utf8"));
    escalationOk = parsed.escalated === true && parsed.ok === false && parsed.rounds?.length === 2;
  }
} catch {
  escalationOk = false;
}

const checks = {
  build: results.build.exitCode === 0,
  a2BrowserFlow: results.browserFlow.exitCode === 0 && Boolean(browserJson?.ok),
  a4CodeLoop: results.codeLoop.exitCode === 0 && Boolean(codeLoopJson?.ok),
  a5Escalation: results.codeLoopFail.exitCode === 1 && escalationOk,
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  runs: {
    browserFlow: browserJson?.runId ?? null,
    codeLoop: codeLoopJson?.runId ?? null,
    codeLoopFail: failJson?.runId ?? null,
  },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    browserFlow: { exitCode: results.browserFlow.exitCode, durationMs: results.browserFlow.durationMs },
    codeLoop: { exitCode: results.codeLoop.exitCode, durationMs: results.codeLoop.durationMs },
    codeLoopFail: { exitCode: results.codeLoopFail.exitCode, durationMs: results.codeLoopFail.durationMs },
  },
  evidence: copied,
};
writeFileSync(join(OUT_DIR, `m1-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# M1 验收结果 / M1 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（本机有头真实浏览器）`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  `| build | ${checks.build ? "✅" : "❌"} | 类型检查与构建 |`,
  `| A2 真实浏览器流程 | ${checks.a2BrowserFlow ? "✅" : "❌"} | 登录→提交→校验，逐步截图；run \`${result.runs.browserFlow ?? "-"}\` |`,
  `| A4 编码回路 | ${checks.a4CodeLoop ? "✅" : "❌"} | CodeTask→补丁→隔离 worktree→真实浏览器 login-timeout 由红转绿；run \`${result.runs.codeLoop ?? "-"}\` |`,
  `| A5 两轮升级 | ${checks.a5Escalation ? "✅" : "❌"} | 坏补丁连续两轮失败后停止升级，不无限重试；run \`${result.runs.codeLoopFail ?? "-"}\` |`,
  "",
  "## 证据（已从 runs/ 复制，runs/ 本身为 gitignored 运行产物）",
  "",
  `- 目录：\`docs/test-evidence/evidence-m1-${stamp}/\``,
  ...Object.entries(copied).flatMap(([k, files]) => [`  - ${k}: ${files.length} 个文件`]),
  "",
  "> 本文件由 `npm run acceptance` 自动生成（真实有头浏览器）；不得手改。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `m1-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/m1-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
