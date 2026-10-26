import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

test("A10：dummy 只读分支仅靠配置 + 已有提示词即可运行（不改核心）", () => {
  const run = spawnSync(process.execPath, [CLI, "dummy-branch", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
  assert.equal(json.ok, true);
  assert.match(json.branchId, /^br-dummy-/);
  assert.equal(json.role, "dummy");
  assert.deepEqual(json.tools, ["echo"]);
  assert.equal(json.promptRef, "reviewer@1.0.0");
  assert.ok(existsSync(json.reportPath), "dummy 分支应产出运行报告");
  const report = readFileSync(json.reportPath, "utf8");
  assert.ok(report.includes("A10") || report.includes("只读"));
});

test("A11：LICENSE / NOTICE / COMMERCIAL 齐全且许可证符合非商用共享要求", () => {
  const license = readIfExists(join(ROOT, "LICENSE"));
  assert.ok(license, "LICENSE 必须存在");
  assert.ok(license.includes("Attribution-NonCommercial-ShareAlike 4.0"), "LICENSE 必须为 CC BY-NC-SA 4.0");
  assert.ok(license.includes("NonCommercial"), "LICENSE 必须含非商用条款");
  assert.ok(license.length > 15_000, "LICENSE 应包含完整法律文本");

  const notice = readIfExists(join(ROOT, "NOTICE"));
  assert.ok(notice, "NOTICE 必须存在");
  assert.ok(/MIT/.test(notice), "NOTICE 应声明第三方 MIT 组件");
  assert.ok(/DeepSeek Harness/.test(notice));

  const commercial = readIfExists(join(ROOT, "COMMERCIAL.md"));
  assert.ok(commercial, "COMMERCIAL.md 必须存在");
  assert.ok(/商用|Commercial/i.test(commercial), "COMMERCIAL.md 应说明商用授权");
});

test("A11：中英双语文档配对齐全", () => {
  const zhDir = join(ROOT, "docs", "zh-CN");
  const enDir = join(ROOT, "docs", "en");
  const zhFiles = readdirSync(zhDir).filter((f) => f.endsWith(".md"));
  assert.ok(zhFiles.length >= 6, "中文文档至少 6 篇");
  for (const file of zhFiles) {
    assert.ok(existsSync(join(enDir, file)), `缺少英文配对：docs/en/${file}`);
  }
  assert.ok(existsSync(join(ROOT, "README.zh-CN.md")) && existsSync(join(ROOT, "README.md")), "README 双语必须存在");
});

test("A11：源码无遥测 / 第三方分析 SDK", () => {
  // 只拦真实遥测/分析 SDK 依赖与上报调用；允许配置项 `telemetry: false`（强制关闭，无上报）。
  const sdkPattern = /(?:from\s+["']|require\(\s*["'])[^"']*(?:posthog|sentry|mixpanel|amplitude|segment|google-analytics|gtag)[^"']*["']/i;
  const beaconPattern = /navigator\.sendBeacon|fetch\(\s*["'][^"']*(?:analytics|telemetry|track(?:ing)?)[^"']*["']/i;
  const isTelemetry = (text) => sdkPattern.test(text) || beaconPattern.test(text);
  const offenders = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "runs") continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(p);
      } else if (/\.(ts|mjs|js)$/.test(entry.name)) {
        const text = readFileSync(p, "utf8");
        if (isTelemetry(text)) offenders.push(p.replaceAll("\\", "/").replace(ROOT.replaceAll("\\", "/") + "/", ""));
      }
    }
  };
  for (const dir of ["packages", "apps"]) scan(join(ROOT, dir));
  assert.deepEqual(offenders, [], `发现遥测/分析引用：${offenders.join(", ")}`);
});

test("A11：发布文档齐全（good-first-issues / demo-script / v0.5.0 release notes）", (t) => {
  const gfi = readIfExists(join(ROOT, "docs", "good-first-issues.md"));
  const demoZh = readIfExists(join(ROOT, "docs", "demo-script.zh-CN.md"));
  const demoEn = readIfExists(join(ROOT, "docs", "demo-script.md"));
  const notes = readIfExists(join(ROOT, "docs", "RELEASE_NOTES_v0.5.0.md"));
  if (!gfi || !demoZh || !demoEn || !notes) {
    t.skip("发布文档由 M4 文档任务生成；缺失时跳过（CI 在合并后应全部存在）");
    return;
  }
  const gfiCount = (gfi.match(/GFI-\d/g) ?? []).length;
  assert.ok(gfiCount >= 5, `good-first-issue 至少 5 个，实际 ${gfiCount}`);
  assert.ok(demoZh.includes("steward") && demoEn.includes("steward"), "演示脚本应基于真实 CLI 命令");
  assert.ok(notes.includes("0.5.0") && /CC BY-NC-SA 4\.0/.test(notes), "发布说明应含版本与许可证");
});

test("版本一致性：package.json 与 CLI VERSION 保持一致", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const cli = readFileSync(join(ROOT, "apps", "cli", "src", "index.ts"), "utf8");
  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(cli, new RegExp(`const VERSION = "${escaped}"`));
  assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), "版本号应为语义化 x.y.z");
});
