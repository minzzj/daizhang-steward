// One-off: sanitize an existing evidence bundle directory in place.
// Usage: node scripts/sanitize-evidence.mjs <bundle-dir>

import { readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node scripts/sanitize-evidence.mjs <bundle-dir>");
  process.exit(2);
}
const sanitize = makeSanitizer(ROOT);
let count = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(json|log|diff|md)$/i.test(name)) {
      sanitizeFileInPlace(p, sanitize);
      count++;
    }
  }
};
walk(target);
console.log(`sanitized text files: ${count} in ${target}`);
