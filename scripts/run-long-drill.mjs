// 阶段二 P2 长跑故障演练（真实时长）：
//   B3：真实断网 120 分钟（2 小时）→ 断网期间不产生新承诺、动作排队 → 恢复后补记、账本不重复
//   B4：平台封禁 15 分钟 → 停止动作 + 替代方案通知 → 恢复
// 用法（后台长跑，约 2 小时 20 分钟）：npm run drill:long
// 输出：docs/test-evidence/long-drill-<stamp>.{md,json} + evidence-long-drill-<stamp>/（脱敏）

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");
const EVIDENCE_DIR = join(OUT_DIR, `evidence-long-drill-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const sanitize = makeSanitizer(ROOT);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

const OUTAGE_MINUTES = 120;
const BAN_MINUTES = 15;

function run(label, args, timeoutMs) {
  const started = Date.now();
  console.log(`\n=== ${label} 开始（${new Date().toISOString()}）===`);
  const result = spawnSync(process.execPath, [CLI, "fault-drill", ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const durationMs = Date.now() - started;
  console.log(`=== ${label} 结束 exit=${result.status} 耗时=${Math.round(durationMs / 1000)}s ===`);
  writeFileSync(join(EVIDENCE_DIR, `${label}.log`), sanitize(output), "utf8");
  let json = null;
  const starts = [];
  let idx = -1;
  while ((idx = output.indexOf("{", idx + 1)) >= 0) starts.push(idx);
  for (let i = starts.length - 1; i >= 0; i--) {
    try {
      json = JSON.parse(output.slice(starts[i]));
      break;
    } catch {
      /* try earlier */
    }
  }
  return { exitCode: result.status ?? -1, durationMs, json, output };
}

function copyEvidenceDir(fromDir, subdir) {
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
      if (st.size > 3 * 1024 * 1024) continue;
      const dest = join(target, relative(fromDir, p));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p, dest);
      if (/\.(json|log|md|txt)$/i.test(name)) sanitizeFileInPlace(dest, sanitize);
      copied.push(rel(dest));
    }
  };
  walk(fromDir);
  return copied;
}

// 1) B3：真实断网 120 分钟
const outage = run("B3-net-outage-120min", ["--case", "net-outage", "--outage-minutes", String(OUTAGE_MINUTES)], (OUTAGE_MINUTES + 20) * 60_000);
const outageEvidence = copyEvidenceDir(outage.json?.evidence_dir ?? outage.json?.state_dir, "B3-net-outage-120min");

// 2) B4：平台封禁 15 分钟
const ban = run("B4-platform-ban-15min", ["--case", "platform-ban", "--ban-minutes", String(BAN_MINUTES)], (BAN_MINUTES + 20) * 60_000);
const banEvidence = copyEvidenceDir(ban.json?.evidence_dir ?? ban.json?.state_dir, "B4-platform-ban-15min");

const checks = {
  b3LongOutage: outage.exitCode === 0 && outage.json?.ok === true,
  b3NoNewPromise: Boolean(outage.json?.blocked_promises > 0),
  b3RecoveredWithin10Min: outage.json?.recovered_within_10min === true,
  b3NoDuplicates: outage.json?.duplicates_found === 0,
  b4LongBan: ban.exitCode === 0 && ban.json?.ok === true,
  b4Stopped: ban.json?.stopped === true,
  b4AlternativePlan: Boolean(ban.json?.alternative_plan?.items?.length > 0),
  b4Notification: Boolean(ban.json?.notification_path),
};
const ok = Object.values(checks).every(Boolean);
const result = {
  stamp,
  ok,
  checks,
  scale: { outage_minutes: OUTAGE_MINUTES, ban_minutes: BAN_MINUTES },
  b3: outage.json,
  b4: ban.json,
  durations: {
    netOutageSeconds: Math.round(outage.durationMs / 1000),
    platformBanSeconds: Math.round(ban.durationMs / 1000),
  },
  evidence: { netOutage: outageEvidence, platformBan: banEvidence },
};
writeFileSync(join(OUT_DIR, `long-drill-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const line = (label, flag, detail) => `| ${label} | ${flag ? "✅" : "❌"} | ${detail} |`;
const md = [
  `# 阶段二 P2 长跑故障演练 / Long-Run Fault Drills — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}`,
  `- 规模：真实断网 **${OUTAGE_MINUTES} 分钟（2 小时）**；真实平台封禁 **${BAN_MINUTES} 分钟**`,
  `- 实际耗时：断网演练 ${Math.round(outage.durationMs / 1000)}s；封禁演练 ${Math.round(ban.durationMs / 1000)}s`,
  `- 环境：Node ${process.version} / ${process.platform}（真实 localhost HTTP 故障注入，非 mock）`,
  "",
  "## B3 断网 2 小时",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  line("断网期间不产生新承诺", checks.b3NoNewPromise, `被拒绝承诺 ${outage.json?.blocked_promises ?? "?"} 次`),
  line("动作进入 Outbox 排队", Boolean(outage.json?.queued_actions > 0), `排队 ${outage.json?.queued_actions ?? "?"} 条`),
  line("恢复后 10 分钟内补记", checks.b3RecoveredWithin10Min, `recovered_within_10min=${outage.json?.recovered_within_10min ?? "?"}`),
  line("账本不重复", checks.b3NoDuplicates, `duplicates_found=${outage.json?.duplicates_found ?? "?"}`),
  "",
  "## B4 平台封禁 15 分钟",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  line("封禁检测并停止", checks.b4Stopped, `检测 ${ban.json?.ban_detected_within_ms ?? "?"}ms；stopped=${ban.json?.stopped ?? "?"}`),
  line("替代方案", checks.b4AlternativePlan, `items=${ban.json?.alternative_plan?.items?.length ?? "?"}`),
  line("通知留痕", checks.b4Notification, `${ban.json?.notification_path ?? "?"}`),
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-long-drill-${stamp}/\``,
  "- drill JSON、outbox、notifications、probes 时间线",
  "",
  "> 本文件由 `npm run drill:long` 自动生成（真实时长）；证据已脱敏。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `long-drill-${stamp}.md`), md, "utf8");

console.log(`\nlong drill evidence: docs/test-evidence/long-drill-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
