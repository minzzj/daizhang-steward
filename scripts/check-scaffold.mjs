#!/usr/bin/env node
// Repository self-check: verifies structure, license and prompt integrity.
// Runs offline, no dependencies. Used by `npm run check` and CI.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  "LICENSE",
  "NOTICE",
  "COMMERCIAL.md",
  "README.md",
  "README.zh-CN.md",
  "ROADMAP.md",
  "ASSUMPTIONS.md",
  "HANDOFF.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.json",
  "Makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".github/workflows/ci.yml",
  "docs/README.md",
  "docs/zh-CN/architecture.md",
  "docs/en/architecture.md",
  "docs/zh-CN/contracts.md",
  "docs/en/contracts.md",
  "docs/zh-CN/threat-model.md",
  "docs/en/threat-model.md",
  "docs/zh-CN/adapters.md",
  "docs/en/adapters.md",
  "docs/zh-CN/runtime-prompts.md",
  "docs/en/runtime-prompts.md",
  "docs/zh-CN/delivery-checklist.md",
  "docs/en/delivery-checklist.md",
  "docs/test-evidence/README.md",
  "docs/images/README.md",
  "prompts/README.md",
  "prompts/manifest.json",
  "prompts/conductor.md",
  "prompts/operator.md",
  "prompts/scout.md",
  "prompts/reviewer.md",
  "packages/README.md",
  "apps/README.md",
  "examples/README.md",
  "tests/README.md",
  "scripts/check-secrets.mjs",
  "scripts/sync-delivery.ps1",
  "scripts/update-prompt-manifest.mjs",
  "scripts/run-evidence.mjs",
  "scripts/run-acceptance.mjs",
  "scripts/sanitize.mjs",
  "scripts/sanitize-evidence.mjs",
  "packages/steward-browser/src/index.ts",
  "packages/steward-desktop/src/index.ts",
  "packages/steward-desktop/scripts/desktop_sidecar.py",
  "packages/steward-core/src/stop-controller.ts",
  "packages/steward-core/src/checkpoint.ts",
  "packages/steward-core/src/isolation.ts",
  "tests/e2e-desktop/run.mjs",
  "tests/e2e-desktop/README.md",
  "tests/unit/m2-safety.test.mjs",
  "tests/unit/m2-runtime.test.mjs",
  "scripts/run-acceptance-m2.mjs",
  "scripts/run-acceptance-m3.mjs",
  "packages/steward-scout/src/index.ts",
  "packages/steward-scout/src/engine.ts",
  "packages/steward-scout/README.md",
  "tests/unit/scout.test.mjs",
  "examples/scout-fixtures/leads.json",
  "examples/scout-fixtures/README.zh-CN.md",
  "packages/steward-browser/README.md",
  "packages/steward-harness/src/patch.ts",
  "packages/steward-harness/src/loop.ts",
  "tests/e2e-browser/login-flow.mjs",
  "tests/e2e-browser/README.md",
  "tests/fixtures/always-ok.mjs",
  "tests/fixtures/always-fail.mjs",
  "examples/mock-harness/fix-login-timeout.patch",
  "examples/mock-harness/broken-login-timeout.patch",
];

const REQUIRED_DIRS = [
  "docs/en",
  "docs/zh-CN",
  "prompts",
  "packages/steward-core/src",
  "packages/steward-harness/src",
  "packages/steward-browser/src",
  "apps/cli/src",
  "examples",
  "examples/demo-web",
  "examples/demo-desktop",
  "tests/unit",
  "tests/e2e-browser",
  "tests/e2e-desktop",
  "packages/steward-scout/src",
  "examples/scout-fixtures",
  "examples/demo-business",
  "packages/steward-domain/src",
  "packages/steward-console/src",
  "tests/e2e-console",
  "packages/steward-desktop",
  "tests/fixtures",
  "scripts",
  "runs",
];

const failures = [];
const warnings = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1) required structure
for (const f of REQUIRED_FILES) ok(existsSync(join(ROOT, f)), `missing file: ${f}`);
for (const d of REQUIRED_DIRS) {
  ok(existsSync(join(ROOT, d)) && statSync(join(ROOT, d)).isDirectory(), `missing directory: ${d}`);
}

// 2) license sanity
if (existsSync(join(ROOT, "LICENSE"))) {
  const lic = readFileSync(join(ROOT, "LICENSE"), "utf8");
  ok(lic.includes("Attribution-NonCommercial-ShareAlike 4.0"), "LICENSE: CC BY-NC-SA 4.0 title not found");
  ok(lic.includes("NonCommercial"), "LICENSE: NonCommercial clause not found");
  ok(lic.length > 15000, "LICENSE: full legal code seems truncated");
}

// 3) README language pairs
for (const f of ["README.md", "README.zh-CN.md"]) {
  ok(existsSync(join(ROOT, f)) && readFileSync(join(ROOT, f), "utf8").length > 1000, `${f} looks empty`);
}

// 4) prompts: manifest sha256 must match files; no placeholders; safety clauses present
const PROMPTS = ["conductor", "operator", "scout", "reviewer"];
const SAFETY = ["不绕过", "默认拒绝", "没有证据", "两轮"];
try {
  const manifest = JSON.parse(readFileSync(join(ROOT, "prompts", "manifest.json"), "utf8"));
  ok(Array.isArray(manifest.prompts) && manifest.prompts.length === PROMPTS.length, "prompts/manifest.json 条目数与角色数不一致");
  for (const role of PROMPTS) {
    const entry = (manifest.prompts ?? []).find((p) => p.id === role);
    ok(Boolean(entry), `manifest 缺少角色：${role}`);
    if (!entry) continue;
    const file = join(ROOT, "prompts", entry.file);
    if (!existsSync(file)) {
      failures.push(`missing prompt file: prompts/${entry.file}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const sha = createHash("sha256").update(text).digest("hex");
    ok(sha === entry.sha256, `prompt sha256 不匹配（运行 npm run prompts:manifest）：${entry.file}`);
    for (const clause of SAFETY) ok(text.includes(clause), `prompt ${role} 缺少安全条款：${clause}`);
    ok(!/\{\{[a-z_]+\}\}/.test(text), `prompt ${role} 残留未渲染占位符`);
    ok(!/[A-Z]:\\\\Users\\\\/i.test(text), `prompt ${role} 含本机绝对路径`);
  }
} catch (error) {
  failures.push(`prompts/manifest.json 无法读取或解析：${error instanceof Error ? error.message : String(error)}`);
}

// 5) no obvious local absolute paths in public docs
const PATH_PATTERNS = [/[A-Z]:\\Users\\/i, /[A-Z]:\\daizhang-build/i];
const WALK_SKIP_DIRS = new Set(["node_modules", ".git", "runs", "dist", "coverage", "交付", ".steward", ".pnpm-store"]);
const PATH_ALLOWLIST = new Set(["HANDOFF.md", "ASSUMPTIONS.md", "README.md", "README.zh-CN.md"]);
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!WALK_SKIP_DIRS.has(entry.name)) walk(p);
      continue;
    }
    if (!/\.(md|json|ya?ml|mjs|js|ts|ps1)$/.test(entry.name)) continue;
    const rel = relative(ROOT, p).replaceAll("\\", "/");
    if (PATH_ALLOWLIST.has(rel)) continue;
    const text = readFileSync(p, "utf8");
    for (const pat of PATH_PATTERNS) {
      if (pat.test(text)) warnings.push(`possible local path in ${rel} (${pat})`);
    }
  }
}
walk(join(ROOT, "docs"));
walk(join(ROOT, "prompts"));

// report
console.log("== daizhang-steward repo check ==");
console.log(`checked files: ${REQUIRED_FILES.length}, dirs: ${REQUIRED_DIRS.length}`);
for (const w of warnings) console.log(`WARN  ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s). Fix before committing.`);
  process.exit(1);
}
console.log("OK: structure, license, prompts (sha256 + safety clauses) and local-path hygiene all pass.");
