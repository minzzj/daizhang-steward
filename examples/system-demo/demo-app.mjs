import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "heartbeat");
mkdirSync(dir, { recursive: true });
let ticks = 0;
setInterval(() => {
  ticks += 1;
  writeFileSync(join(dir, "heartbeat.json"), JSON.stringify({ pid: process.pid, ticks, at: new Date().toISOString() }));
}, 1000);
