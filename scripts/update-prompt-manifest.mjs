// Regenerate prompts/manifest.json: sha256 for each prompt file, keep versions.
// Usage: pnpm prompts:manifest

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPTS_DIR = join(ROOT, "prompts");
const MANIFEST = join(PROMPTS_DIR, "manifest.json");

const DEFAULT_VERSION = {
  conductor: "conductor@1.0.0",
  operator: "operator@1.0.0",
  scout: "scout@1.0.0",
  reviewer: "reviewer@1.0.0",
};

let previous = {};
if (existsSync(MANIFEST)) {
  try {
    previous = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    previous = {};
  }
}
const prevEntries = new Map((previous.prompts ?? []).map((p) => [p.id, p]));

const files = readdirSync(PROMPTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

const prompts = files.map((file) => {
  const id = file.replace(/\.md$/, "");
  const text = readFileSync(join(PROMPTS_DIR, file), "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    id,
    file,
    version: prevEntries.get(id)?.version ?? DEFAULT_VERSION[id] ?? `${id}@1.0.0`,
    sha256,
  };
});

const manifest = {
  version: previous.version ?? "1.0.0",
  updated: new Date().toISOString().slice(0, 10),
  prompts,
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`manifest updated: ${prompts.length} prompt(s) -> prompts/manifest.json`);
for (const p of prompts) console.log(`  ${p.id.padEnd(10)} ${p.version}  ${p.sha256.slice(0, 12)}…`);
