#!/usr/bin/env node
// Scaffold self-check: verifies the repository foundation is complete and safe.
// Runs offline, no dependencies. Used by `pnpm check` and CI.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
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
  "packages/README.md",
  "apps/README.md",
  "examples/README.md",
  "tests/README.md",
  "scripts/check-secrets.mjs",
  "scripts/sync-delivery.ps1",
];

const REQUIRED_DIRS = [
  "docs/en",
  "docs/zh-CN",
  "prompts",
  "packages",
  "apps",
  "examples",
  "tests",
  "scripts",
  "runs",
];

const failures = [];
const warnings = [];

function ok(cond, msg) {
  if (!cond) failures.push(msg);
}

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

// 3) README language pairs (bilingual skeleton)
ok(
  existsSync(join(ROOT, "README.zh-CN.md")) && readFileSync(join(ROOT, "README.zh-CN.md"), "utf8").length > 1000,
  "README.zh-CN.md looks empty"
);
ok(
  existsSync(join(ROOT, "README.md")) && readFileSync(join(ROOT, "README.md"), "utf8").length > 1000,
  "README.md looks empty"
);

// 4) no obvious local absolute paths in public docs (allow HANDOFF/ASSUMPTIONS, which are allowed to mention build locations)
const PATH_PATTERNS = [/[A-Z]:\\Users\\/i, /[A-Z]:\\daizhang-build/i];
const PATH_ALLOWLIST = new Set(["HANDOFF.md", "ASSUMPTIONS.md", "README.md", "README.zh-CN.md"]);
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "runs", "dist", "coverage", "交付"].includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(md|json|ya?ml|mjs|js|ts|ps1)$/.test(entry.name)) {
      const rel = relative(ROOT, p).replaceAll("\\", "/");
      if (PATH_ALLOWLIST.has(rel)) continue;
      const text = readFileSync(p, "utf8");
      for (const pat of PATH_PATTERNS) {
        if (pat.test(text)) warnings.push(`possible local path in ${rel} (${pat})`);
      }
    }
  }
}
walk(join(ROOT, "docs"));

// 5) prompts must not be hard-coded yet: prompt files are intentionally absent at scaffold stage
ok(
  !existsSync(join(ROOT, "prompts/operator.md")),
  "prompts/operator.md exists too early: implement through M0 with tests, not in scaffold"
);

// report
console.log("== daizhang-steward scaffold check ==");
console.log(`checked files: ${REQUIRED_FILES.length}, dirs: ${REQUIRED_DIRS.length}`);
for (const w of warnings) console.log(`WARN  ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s). Fix before committing.`);
  process.exit(1);
}
console.log("OK: scaffold complete, license OK, no early implementation, no unexpected local paths.");
