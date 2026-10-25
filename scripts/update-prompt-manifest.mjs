// Regenerate prompts/manifest.json: sha256 for each role prompt file.
// Whitelist: only conductor/operator/scout/reviewer (README/CHANGELOG are not prompts).
// Usage: npm run prompts:manifest

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPTS_DIR = join(ROOT, "prompts");
const MANIFEST = join(PROMPTS_DIR, "manifest.json");

const ROLES = ["conductor", "operator", "scout", "reviewer"];
const DEFAULT_VERSION = Object.fromEntries(ROLES.map((r) => [r, `${r}@1.0.0`]));

let previous = {};
if (existsSync(MANIFEST)) {
  try {
    previous = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    previous = {};
  }
}
const prevEntries = new Map((previous.prompts ?? []).map((p) => [p.id, p]));

const prompts = ROLES.map((id) => {
  const file = `${id}.md`;
  const path = join(PROMPTS_DIR, file);
  if (!existsSync(path)) {
    console.error(`missing prompt: prompts/${file}`);
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    id,
    file,
    version: prevEntries.get(id)?.version ?? DEFAULT_VERSION[id],
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
