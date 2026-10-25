#!/usr/bin/env node
// Secret scan: fails if a credential-looking string is found in tracked files.
// Offline, no dependencies. Run before every commit and in CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "runs", "dist", "coverage", ".pnpm-store", "交付", "video-build"]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm", ".wav", ".zip", ".docx", ".pdf", ".ico"]);

const PATTERNS = [
  { name: "DeepSeek-style API key", re: /sk-[A-Za-z0-9]{20,}/ },
  { name: "OpenAI-style API key", re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub PAT (classic)", re: /ghp_[A-Za-z0-9]{30,}/ },
  { name: "GitHub PAT (fine-grained)", re: /github_pat_[A-Za-z0-9_]{30,}/ },
  { name: "GitHub OAuth", re: /gho_[A-Za-z0-9]{30,}/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Generic bearer assignment", re: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'][^"'\s]{16,}["']/i },
];

const hits = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(p);
      continue;
    }
    if (SKIP_EXT.has(p.slice(p.lastIndexOf(".")).toLowerCase())) continue;
    let text;
    try {
      if (statSync(p).size > 2 * 1024 * 1024) continue;
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of PATTERNS) {
        if (re.test(lines[i])) {
          const preview = lines[i].slice(0, 120).replace(/[A-Za-z0-9_-]{12,}/g, (m) => m.slice(0, 4) + "***");
          hits.push(`${relative(ROOT, p)}:${i + 1}  [${name}]  ${preview}`);
        }
      }
    }
  }
}

walk(ROOT);

console.log("== secret scan ==");
if (hits.length) {
  for (const h of hits) console.error(`HIT  ${h}`);
  console.error(`\n${hits.length} potential secret(s) found. Do not commit. Rotate if already leaked.`);
  process.exit(1);
}
console.log("OK: no credential-looking strings found in tracked files.");
