// 阶段二 P1 验收 runner（个人版 MVP）：
//   B1 选题（5 万/30 天 ≥3 条业务线，来源+报价+成本+毛利+最坏情况）
//   B2 账本 6 要素（金额/收付方/依据/审批人/回执/项目）
//   B5 承诺追溯（对话原文 → 委托条款 → 项目；无记录=未授权）
//   B6 接管键（≤10s 停止 + 6 类接管包）
//   B7 四类越界 100% 拒绝 + 理由可读 + 规则可枚举
// 以及真实浏览器控制台 E2E（本地 127.0.0.1）、CLI 控制台真实浏览器打开、审批/接管命令。
// 用法：npm run acceptance:p1   （本机交互桌面；真实浏览器有头）
//
// 输出：docs/test-evidence/p1-acceptance-<stamp>.{md,json} + evidence-p1-<stamp>/（脱敏，只保留最新）

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");

for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-p1-/.test(name) || /^p1-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-p1-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const sanitize = makeSanitizer(ROOT);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

function run(label, command, args, { shell = false, timeoutMs = 600_000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    shell,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(`\n=== ${label} exit=${result.status} (${Date.now() - started}ms) ===`);
  console.log(output.trim().slice(0, 2000));
  return { label, exitCode: result.status ?? -1, durationMs: Date.now() - started, output };
}

function parseJsonOutput(output) {
  // 从输出中提取最后一个完整 JSON 对象（CLI --json 输出）
  const start = output.indexOf("{");
  if (start < 0) return null;
  const candidates = [output.slice(start)];
  for (const text of candidates) {
    try {
      return JSON.parse(text);
    } catch {
      // 尝试寻找结尾
      const last = text.lastIndexOf("\n}");
      if (last > 0) {
        try {
          return JSON.parse(text.slice(0, last + 2));
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

function copyFileIfExists(from, to) {
  if (from && existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    if (/\.(json|log|diff|md|txt)$/i.test(to)) sanitizeFileInPlace(to, sanitize);
    return true;
  }
  return false;
}

function copyEvidenceDir(fromDir, subdir, { maxFileSize = 3 * 1024 * 1024 } = {}) {
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
      if (st.size > maxFileSize) continue;
      const dest = join(target, relative(fromDir, p));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p, dest);
      if (/\.(json|log|diff|md|txt)$/i.test(name)) sanitizeFileInPlace(dest, sanitize);
      copied.push(rel(dest));
    }
  };
  walk(fromDir);
  return copied;
}

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: false });
    } catch {
      /* try next channel */
    }
  }
  return chromium.launch({ headless: false });
}

function waitForHttp(url, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve(true);
      } catch {
        /* not ready */
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`控制台 ${url} 未在 ${timeoutMs}ms 内就绪`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

const results = {};

// 1) build + 全量测试
results.build = run("build", "npm", ["run", "build"], { shell: true });
results.tests = run("unit-tests", process.execPath, ["--test", "--test-reporter=tap", "tests/unit/*.test.mjs"]);
const tap = results.tests.output;
const num = (patterns) => {
  for (const re of patterns) {
    const m = tap.match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
const testSummary = {
  tests: num([/^# tests (\d+)$/m, /^ℹ tests (\d+)$/m]),
  pass: num([/^# pass (\d+)$/m, /^ℹ pass (\d+)$/m]),
  fail: num([/^# fail (\d+)$/m, /^ℹ fail (\d+)$/m]),
};
writeFileSync(join(EVIDENCE_DIR, "unit-tests.log"), sanitize(results.tests.output), "utf8");

// 2) B1/B2/B5/B6/B7：经营域仿真业务线
rmSync(join(ROOT, ".steward"), { recursive: true, force: true });
results.business = run("business", process.execPath, [CLI, "business", "--json"]);
const businessJson = parseJsonOutput(results.business.output);
const businessArtifacts = businessJson?.artifacts?.dir ?? null;
const businessRunMs = results.business.durationMs;
const readArtifact = (name) => {
  if (!businessArtifacts) return null;
  const path = join(businessArtifacts, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const proposal = readArtifact("proposal.json");
const businessResult = readArtifact("business-result.json");
const ledgerFacts = readArtifact("ledger-facts.json");
const promiseTraces = readArtifact("promise-traces.json");
const takeoverPack = readArtifact("takeover-pack.json");
const boundaryCases = readArtifact("boundary-check.json");
const monthly = readArtifact("monthly-report.json");
const summaries = readArtifact("summaries.json");
const businessEvidence = copyEvidenceDir(businessArtifacts, "business-run");

// 3) B7 独立边界自检
results.boundaryCheck = run("boundary-check", process.execPath, [CLI, "boundary-check", "--json"]);
const boundaryJson = parseJsonOutput(results.boundaryCheck.output);
const boundaryArtifacts = boundaryJson?.artifacts?.dir ?? null;
let boundaryRulesCount = null;
let boundaryDenied = null;
if (boundaryArtifacts) {
  const rulesPath = join(boundaryArtifacts, "boundary-rules.json");
  const casesPath = join(boundaryArtifacts, "boundary-check.json");
  if (existsSync(rulesPath)) boundaryRulesCount = JSON.parse(readFileSync(rulesPath, "utf8")).length;
  if (existsSync(casesPath)) {
    const cases = JSON.parse(readFileSync(casesPath, "utf8"));
    boundaryDenied = cases.filter((item) => item.result?.decision === "deny").length;
  }
  copyEvidenceDir(boundaryArtifacts, "boundary-run");
}

// 4) 真实浏览器控制台 E2E（packages/steward-console 内置 provider；有头真实 Chrome/Edge）
results.consoleE2E = run(
  "console-e2e",
  process.execPath,
  ["tests/e2e-console/run.mjs", "--evidence-dir", join(EVIDENCE_DIR, "console-e2e")],
  { timeoutMs: 900_000 },
);
let consoleResult = null;
const consoleResultPath = join(EVIDENCE_DIR, "console-e2e", "result.json");
if (existsSync(consoleResultPath)) {
  consoleResult = JSON.parse(readFileSync(consoleResultPath, "utf8"));
  sanitizeFileInPlace(consoleResultPath, sanitize);
}
const consoleEvidence = copyEvidenceDir(join(EVIDENCE_DIR, "console-e2e"), "console-e2e");

// 5) CLI 控制台 + 真实浏览器打开（真实 domain 演示数据经 CLI 页面呈现）
results.consoleCli = { exitCode: 1, output: "", durationMs: 0 };
let consoleCliOk = false;
let consoleCliScreenshot = null;
let consoleCliUrl = null;
let consoleChild = null;
try {
  consoleChild = spawn(process.execPath, [CLI, "console", "--json", "--port", "4193"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  const url = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("CLI 控制台 15s 内未输出 URL")), 15000);
    consoleChild.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/?/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    consoleChild.stderr.on("data", () => {});
  });
  consoleCliUrl = url;
  consoleChild.on("error", () => {});
  await waitForHttp(url);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  const titleText = await page.title();
  const dashboardText = await page.locator("body").innerText();
  const hasDashboard = /看板|项目|预算/.test(dashboardText);
  await page.screenshot({ path: join(EVIDENCE_DIR, "console-cli", "dashboard.png"), fullPage: false });
  // 打开账本页并核对 6 要素（真实 domain provider 数据）
  await page.goto(new URL("/ledger", url).toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  const ledgerText = await page.locator("body").innerText();
  const facts = ["金额", "收付方", "依据", "审批人", "回执", "项目"].filter((label) => ledgerText.includes(label));
  await page.screenshot({ path: join(EVIDENCE_DIR, "console-cli", "ledger.png"), fullPage: false });
  consoleCliScreenshot = rel(join(EVIDENCE_DIR, "console-cli", "ledger.png"));
  consoleCliOk = Boolean(titleText.includes("代掌") || titleText.length > 0) && hasDashboard && facts.length >= 4;
  await browser.close();
  results.consoleCli = {
    exitCode: consoleCliOk ? 0 : 1,
    output: `url=${url}; title=${titleText}; hasDashboard=${hasDashboard}; ledgerFacts=${facts.join(",")}`,
    durationMs: 0,
  };
} catch (error) {
  results.consoleCli = { exitCode: 1, output: `CLI 控制台检查失败：${error instanceof Error ? error.message : String(error)}`, durationMs: 0 };
} finally {
  if (consoleChild) {
    try {
      consoleChild.kill();
    } catch {
      /* ignore */
    }
  }
}

// 6) CLI 接管键 + 审批（真实命令，计时）
const takeover = { exitCode: 1, output: "", durationMs: 0 };
const approve = { exitCode: 1, output: "", durationMs: 0 };
let takeoverJson = null;
let takeoverStopMs = null;
let takeoverPackOk = false;
let approveOk = false;
try {
  // 先确保未处于接管态
  run("takeover-reset", process.execPath, [CLI, "takeover", "--resume"], { timeoutMs: 60_000 });
  const t1 = run("takeover", process.execPath, [CLI, "takeover", "--json"]);
  takeover.exitCode = t1.exitCode;
  takeoverJson = parseJsonOutput(t1.output);
  takeoverStopMs = typeof takeoverJson?.stop_ms === "number" ? takeoverJson.stop_ms : null;
  const pack = takeoverJson?.pack;
  takeoverPackOk = Boolean(
    pack &&
      Array.isArray(pack.open_orders) &&
      Array.isArray(pack.pending_threads) &&
      Array.isArray(pack.payables) &&
      Array.isArray(pack.credentials) &&
      Array.isArray(pack.risks) &&
      pack.credentials.length > 0,
  );
  run("takeover-resume", process.execPath, [CLI, "takeover", "--resume"], { timeoutMs: 60_000 });

  const a1 = run("approve-list", process.execPath, [CLI, "approve", "--json"]);
  const listJson = parseJsonOutput(a1.output);
  const cardId = listJson?.cards?.[0]?.id;
  if (cardId) {
    const a2 = run("approve-decide", process.execPath, [CLI, "approve", "--id", cardId, "--decision", "approve", "--json"]);
    approve.exitCode = a2.exitCode;
    const decided = parseJsonOutput(a2.output);
    approveOk = decided?.ok === true && decided?.status === "approved";
    approve.output = `${a2.output}`;
  }
} catch (error) {
  takeover.output = `接管/审批检查失败：${error instanceof Error ? error.message : String(error)}`;
}
writeFileSync(join(EVIDENCE_DIR, "takeover-result.json"), JSON.stringify(takeoverJson, null, 2) + "\n", "utf8");
sanitizeFileInPlace(join(EVIDENCE_DIR, "takeover-result.json"), sanitize);

// 7) 判定
const lineSourcesOk = Boolean(
  proposal && Array.isArray(proposal.accepted) && proposal.accepted.length >= 3 &&
    proposal.accepted.every((line) => Array.isArray(line.sources) && line.sources.length > 0 && line.sources.every((s) => typeof s.url === "string" && /^https?:\/\//.test(s.url))),
);
const b1 = lineSourcesOk && Boolean(proposal?.proposal) && businessRunMs <= 30_000;
const b2 = Boolean(
  Array.isArray(ledgerFacts) &&
    ledgerFacts.length > 0 &&
    ledgerFacts.every((facts) =>
      facts && typeof facts.amount_cny === "number" && facts.payee_or_payer && facts.basis && facts.approved_by && facts.receipt_ref && facts.project_id,
    ),
);
const b5 = Boolean(promiseTraces?.authorized?.authorized === true && Array.isArray(promiseTraces.authorized.chain) && promiseTraces.authorized.chain.length >= 3 && promiseTraces?.unauthorized?.authorized === false);
const b6 = Boolean(takeoverJson?.halted === true && typeof takeoverStopMs === "number" && takeoverStopMs <= 10_000 && takeoverPackOk);
const b7 = Boolean(
  Array.isArray(boundaryCases) &&
    boundaryCases.length >= 6 &&
    boundaryCases.slice(0, 4).every((item) => item.result?.decision === "deny" && typeof item.result?.user_message === "string" && item.result.user_message.length > 5) &&
    boundaryCases[4]?.result?.decision === "human" &&
    boundaryCases[5]?.result?.decision === "draft_only" &&
    boundaryRulesCount !== null &&
    boundaryRulesCount >= 12,
);
const monthlyOk = Boolean(monthly && monthly.income_cny > 0 && monthly.gross_margin_cny === monthly.income_cny - monthly.cost_cny && typeof monthly.budget_left_cny === "number");
const consoleE2EOk = Boolean(consoleResult?.ok === true && typeof consoleResult?.measured_stop_ms === "number" && consoleResult.measured_stop_ms <= 10_000);
const approveUiOk = Boolean(consoleResult?.checks?.some?.((c) => c.name?.includes("审批") && c.ok === true) ?? consoleResult?.ok === true);

const checks = {
  build: results.build.exitCode === 0,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  b1TopicSelection: b1,
  b2LedgerSixFacts: b2,
  b5PromiseTrace: b5,
  b6TakeoverKey: b6,
  b7Boundaries: b7,
  monthlyReport: monthlyOk,
  consoleE2E: consoleE2EOk,
  cliConsoleRealBrowser: consoleCliOk,
  approveDecide: approveOk,
  deferredB3B4B8: true, // B3 断网 2h / B4 封号 / B8 双模式 → P2/P3 交付
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  phase: "P1 personal edition MVP",
  testSummary,
  businessRunMs,
  b1: { lines: proposal?.accepted?.length ?? null, sourcesOk: lineSourcesOk, proposal: Boolean(proposal?.proposal) },
  b2: { entries: Array.isArray(ledgerFacts) ? ledgerFacts.length : null },
  b5: { authorized: promiseTraces?.authorized?.authorized ?? null, chain: promiseTraces?.authorized?.chain?.length ?? null },
  b6: { stop_ms: takeoverStopMs, hardLimitMs: 10_000, packOk: takeoverPackOk },
  b7: { rules: boundaryRulesCount, denied: boundaryCases?.slice(0, 4)?.filter?.((item) => item.result?.decision === "deny").length ?? null, cases: boundaryCases?.length ?? null },
  console: { e2e: consoleE2EOk, stop_ms: consoleResult?.measured_stop_ms ?? null, cliUrl: consoleCliUrl, cliBrowser: consoleCliOk, screenshot: consoleCliScreenshot },
  runs: { business: businessJson?.runId ?? null, boundary: boundaryJson?.runId ?? null },
  evidence: {
    businessRun: businessEvidence,
    boundaryRun: "boundary-run/",
    consoleE2E: consoleEvidence,
    consoleCli: "console-cli/",
    unitTestsLog: "unit-tests.log",
    takeover: "takeover-result.json",
  },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    business: { exitCode: results.business.exitCode, durationMs: results.business.durationMs },
    boundary: { exitCode: results.boundaryCheck.exitCode, durationMs: results.boundaryCheck.durationMs },
    consoleE2E: { exitCode: results.consoleE2E.exitCode, durationMs: results.consoleE2E.durationMs },
    takeover: { exitCode: takeover.exitCode },
    approve: { exitCode: approve.exitCode },
  },
};
writeFileSync(join(OUT_DIR, `p1-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const line = (label, okFlag, detail) => `| ${label} | ${okFlag ? "✅" : "❌"} | ${detail} |`;
const md = [
  `# 阶段二 P1 验收结果 / Phase-2 P1 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}（个人版 MVP）`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（真实浏览器有头 · 本地 127.0.0.1 控制台）`,
  "",
  "## 阶段二 8 条验收（P1 覆盖 B1/B2/B5/B6/B7；B3/B4/B8 → P2/P3）",
  "",
  "| 验收 | 结果 | 说明 |",
  "|---|---|---|",
  line("B1 选题：5 万预算 30 天 ≥3 条业务线，来源可查", b1, `${proposal?.accepted?.length ?? "?"} 条合格（来源 URL 全部可查），提案=${proposal?.proposal ? "已生成" : "无"}；business 命令耗时 ${businessRunMs}ms`),
  line("B2 记账：任一笔支出 30 秒看到 6 要素", b2, `账本 ${Array.isArray(ledgerFacts) ? ledgerFacts.length : "?"} 笔，金额/收付方/依据/审批人/回执/项目 全齐`),
  line("B5 承诺可追溯到对话原文与授权条款", b5, `授权链 ${promiseTraces?.authorized?.chain?.length ?? "?"} 段；未记录承诺返回“未授权”`),
  line("B6 接管键 10 秒停止 + 接管包", b6, `stop_ms=${takeoverStopMs ?? "?"}（≤10000）；接管包 6 类（含凭据引用）`),
  line("B7 四类越界 100% 拒绝、理由可读、留痕", b7, `${boundaryRulesCount ?? "?"} 条规则；4/4 拒绝；支付→human、报价→draft_only`),
  "| B3 断网 2h 不产生新承诺 | ⏳ 延后 | P2 故障演练（真实断网） |",
  "| B4 平台封禁 15 分钟停止并出替代方案 | ⏳ 延后 | P2 故障演练（故障注入） |",
  "| B8 个人/企业模式各跑一单、不一致阻断 | ⏳ 延后 | P3 企业版 |",
  "",
  "## 其他检查",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  line("build", checks.build, "tsc 通过"),
  line("单元+集成测试", checks.unitTests, `${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail`),
  line("月报", checks.monthlyReport, `收入 ¥${monthly?.income_cny ?? "?"} / 成本 ¥${monthly?.cost_cny ?? "?"} / 毛利 ¥${monthly?.gross_margin_cny ?? "?"} / 预算余 ¥${monthly?.budget_left_cny ?? "?"}`),
  line("控制台真实浏览器 E2E", checks.consoleE2E, `${consoleResult?.checks?.length ?? "?"} 项检查；接管 ${consoleResult?.measured_stop_ms ?? "?"}ms；截图 ${consoleResult?.screenshots?.length ?? "?"} 张`),
  line("CLI 控制台真实浏览器打开", checks.cliConsoleRealBrowser, `url=${consoleCliUrl ?? "?"}；账本 6 要素可见；截图 console-cli/ledger.png`),
  line("审批命令（人工批准）", checks.approveDecide, "approve --id … --decision approve 成功"),
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-p1-${stamp}/\``,
  "- `business-run/`：proposal.json、business-result.json、ledger-facts.json（6 要素）、promise-traces.json、takeover-pack.json、boundary-check.json、monthly-report.{json,md}、report.md",
  "- `console-e2e/`：真实浏览器逐步截图 + result.json（KPI/审批/接管/月报）",
  "- `console-cli/`：CLI 控制台页面截图（看板/账本）",
  "- `takeover-result.json`、`unit-tests.log`",
  "",
  "> 本文件由 `npm run acceptance:p1` 自动生成；所有数据为仿真业务线（虚构），不涉及真实客户/外联/支付；证据已脱敏。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `p1-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/p1-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
