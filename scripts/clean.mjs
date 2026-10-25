// Remove build output (dist) for a clean rebuild.

import { rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["dist", "coverage", "test-results", ".steward"];
let removed = 0;
for (const t of targets) {
  const p = join(ROOT, t);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed++;
    console.log(`removed ${t}`);
  }
}
console.log(`clean: ${removed} target(s) removed.`);
