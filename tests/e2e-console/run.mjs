#!/usr/bin/env node
/**
 * tests/e2e-console/run.mjs — v1.1 本地 Web 控制台（专业版）真实浏览器 E2E
 *
 * 铁律：真实有头 Chrome/Edge + 真实点击/输入/等待 + 每步截图；**不使用任何 mock 路由/假 DOM**。
 * 被测对象是 packages/steward-console 的真实 HTTP 服务（进程内启动，随机端口）：
 *   - provider      = createDemoConsoleProvider()（经营数据：审批/接管真实修改内存状态）
 *   - adminProvider = createDemoAdminProvider()（配置中心/智能体/后台/数据，保存与清空真实生效）
 *
 * 验收流程（每步截图到 --evidence-dir/screenshots/）：
 *   原有 9 步（P1-C）：看板 → 项目时间线/证据 → 账本 6 要素 → 审批批准/驳回 → 接管（measured_stop_ms）
 *                      → resume → 月报 → 只监听本机；
 *   v1.1 新增 6 步：专业版导航/状态栏 → 配置中心（三模式 + 支付银行卡 + 切个人模式 + 禁用 scout 持久化）
 *                      → 智能体中心（≥8 个 + 企业专属不适用 + 展开详情）→ 后台全流程时间线（≥5 事件 + 过滤 + 证据）
 *                      → 数据管理（统计 + 二次确认清空 + 空档案 + 重置演示）→ 收尾 sanity（无 JS 错误/无外链/配置持久）。
 *
 * 用法：
 *   npm run build
 *   node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v11
 *   node tests/e2e-console/run.mjs --headless 1 --port 4180
 *
 * 退出码：0 全部通过 / 1 验收失败 / 2 用法或环境错误（缺构建产物等）。
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_CONSOLE_DIST = join(REPO_ROOT, "dist", "packages", "steward-console", "src", "index.js");
const DEFAULT_EVIDENCE_DIR = join(REPO_ROOT, "runs", `e2e-console-${timestampSlug()}`);

const CHANNEL_ORDER = ["chrome", "msedge"];
const VIEWPORT = { width: 1440, height: 950 };

/** B6：接管键 ≤10 秒。 */
const STOP_LIMIT_MS = 10_000;
const STEP_TIMEOUT_MS = 15_000;
const PACK_FIELDS = ["open_orders", "pending_threads", "payables", "credentials", "risks"];
const PACK_LABELS = {
  open_orders: "开放订单",
  pending_threads: "待处理对话",
  payables: "应付款",
  credentials: "凭据引用",
  risks: "风险",
};
const LEDGER_FACT_FIELDS = [
  ["facts-amount", "金额"],
  ["facts-payee", "收付方"],
  ["facts-basis", "依据"],
  ["facts-approver", "审批人"],
  ["facts-receipt", "回执"],
  ["facts-project", "所属项目"],
];

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function slug(text) {
  return (
    String(text)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "step"
  );
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 单条断言。skipped=true 表示因环境限制跳过（计为通过但单独标记）。 */
function check(ok, message, detail) {
  const item = { ok: Boolean(ok), message };
  if (detail !== undefined) item.detail = String(detail);
  return item;
}

function skipped(message) {
  return { ok: true, skipped: true, message };
}

/** 等待某元素文本包含 needle（跨页面导航时自动重试，避免 strict 的 context destroyed）。 */
async function waitForTextContains(page, selector, needle, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await page.locator(selector).first().innerText({ timeout: 1200 });
      if (text.includes(needle)) return text;
    } catch {
      // 页面正在导航/重载，重试
    }
    await page.waitForTimeout(150);
  }
  try {
    return await page.locator(selector).first().innerText({ timeout: 1500 });
  } catch {
    return "";
  }
}

/** 等待页面重载完成（导航后可能触发 reload）。 */
async function settleReload(page, timeoutMs = 8000) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  } catch {
    // 忽略超时，由后续断言兜底
  }
  await page.waitForTimeout(300);
}

async function countVisible(page, selector) {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`用法：node tests/e2e-console/run.mjs [选项]

选项：
  --evidence-dir <目录>   证据目录（result.json / screenshots/ / console-server.log），默认 runs/e2e-console-<时间戳>
  --headless 0|1          0=有头（默认，产品验收必须），1=无头
  --port <端口>           控制台监听端口，默认 0（随机，避免冲突）
  --console-dist <路径>   控制台构建产物入口，默认 dist/packages/steward-console/src/index.js
  -h, --help              显示本帮助

前置：先 npm run build。

示例：
  node tests/e2e-console/run.mjs --evidence-dir C:\\daizhang-build\\staging\\e2e-console
  node tests/e2e-console/run.mjs --headless 1`);
}

function usageError(message) {
  console.error(`[e2e-console] 参数错误：${message}`);
  printUsage();
  process.exit(2);
}

function parseArgs(argv) {
  const args = [];
  for (const raw of argv) {
    if (raw.startsWith("--") && raw.includes("=")) {
      const eq = raw.indexOf("=");
      args.push(raw.slice(0, eq), raw.slice(eq + 1));
    } else {
      args.push(raw);
    }
  }
  const options = {
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    headless: false,
    port: 0,
    consoleDist: DEFAULT_CONSOLE_DIST,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = () => {
      index += 1;
      if (index >= args.length) usageError(`参数 ${arg} 缺少取值`);
      return args[index];
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(nextValue());
    else if (arg === "--console-dist") options.consoleDist = resolve(nextValue());
    else if (arg === "--port") {
      const value = Number.parseInt(nextValue(), 10);
      if (!Number.isInteger(value) || value < 0 || value > 65535) usageError("--port 不合法（0-65535）");
      options.port = value;
    } else if (arg === "--headless") {
      const peek = args[index + 1];
      if (peek === "0" || peek === "1") {
        options.headless = peek === "1";
        index += 1;
      } else {
        options.headless = true;
      }
    } else {
      usageError(`未知参数：${arg}`);
    }
  }
  options.evidenceDir = resolve(options.evidenceDir);
  return options;
}

// ---------------------------------------------------------------------------
// 浏览器启动（chrome → msedge 回退）
// ---------------------------------------------------------------------------

async function launchRealBrowser({ headless }) {
  const attempts = [];
  for (const channel of CHANNEL_ORDER) {
    try {
      const browser = await chromium.launch({ channel, headless, timeout: 30_000 });
      return { browser, channel, version: browser.version(), fallbacks: attempts.slice() };
    } catch (error) {
      attempts.push({ channel, error: errorText(error) });
    }
  }
  const detail = attempts.map((attempt) => `${attempt.channel}: ${attempt.error}`).join(" | ");
  throw new Error(`真实浏览器启动失败（已尝试 ${CHANNEL_ORDER.join(" → ")}）：${detail}。请确认本机已安装 Chrome 或 Edge。`);
}

// ---------------------------------------------------------------------------
// 证据记录器
// ---------------------------------------------------------------------------

class Recorder {
  constructor(evidenceDir) {
    this.evidenceDir = evidenceDir;
    this.screenshotsDir = join(evidenceDir, "screenshots");
    this.domDir = join(evidenceDir, "dom");
    this.steps = [];
    this.checks = [];
    this.failures = [];
    this.evidence = [];
    this.screenshotCount = 0;
    this.seq = 0;
    this.startedAt = Date.now();
  }

  get ok() {
    return this.failures.length === 0 && this.steps.every((step) => step.ok);
  }

  async prepare() {
    await mkdir(this.screenshotsDir, { recursive: true });
    await mkdir(this.domDir, { recursive: true });
  }

  async capture(page, label, options = {}) {
    this.seq += 1;
    const relative = `screenshots/${String(this.seq).padStart(3, "0")}-${slug(label)}.png`;
    await page.screenshot({ path: join(this.evidenceDir, relative), fullPage: options.fullPage === true });
    this.evidence.push(relative);
    this.screenshotCount += 1;
    return relative;
  }

  async domSnapshot(page, label) {
    this.seq += 1;
    const relative = `dom/${String(this.seq).padStart(3, "0")}-${slug(label)}.html`;
    await writeFile(join(this.evidenceDir, relative), await page.content(), "utf8");
    this.evidence.push(relative);
    return relative;
  }

  recordCheck(step, item) {
    step.checks.push(item);
    this.checks.push({ step: step.action, ...item });
    if (!item.ok && item.skipped !== true) {
      step.ok = false;
      this.failures.push(`[${step.action}] ${item.message}`);
    }
  }

  recordStandaloneCheck(item) {
    this.checks.push({ step: "post-run", ...item });
    if (!item.ok && item.skipped !== true) this.failures.push(`[post-run] ${item.message}`);
  }

  async step(page, action, body) {
    const startedAt = Date.now();
    const step = { action, ok: true, durationMs: 0, evidence: [], checks: [] };
    try {
      const result = await body();
      const checks = result?.checks ?? [];
      for (const item of checks) this.recordCheck(step, item);
    } catch (error) {
      step.ok = false;
      step.error = errorText(error);
      this.failures.push(`[${action}] ${step.error}`);
    }
    try {
      step.evidence.push(await this.capture(page, step.ok ? action : `${action}-fail`));
      if (!step.ok) step.evidence.push(await this.domSnapshot(page, `${action}-fail`));
    } catch (error) {
      step.ok = false;
      step.error = `截图/现场保存失败：${errorText(error)}`;
      this.failures.push(`[${action}] ${step.error}`);
    }
    step.durationMs = Date.now() - startedAt;
    this.steps.push(step);
    const icon = step.ok ? "✓" : "✗";
    console.log(`  ${icon} ${action}（${step.durationMs}ms）`);
    for (const item of step.checks) {
      if (!item.ok) console.log(`      ✗ ${item.message}${item.detail === undefined ? "" : ` — ${item.detail}`}`);
    }
    if (step.error) console.log(`      ! ${step.error}`);
    return step;
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

async function stepDashboardLoad(page, recorder, baseUrl) {
  return recorder.step(page, "dashboard-load", async () => {
    const response = await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    const checks = [
      check(response !== null && response.status() === 200, `看板应返回 HTTP 200，实际 ${response === null ? "无响应" : response.status()}`),
      check((await page.locator("#local-mode-badge").innerText()).includes("127.0.0.1"), "全局显示「只监听 127.0.0.1」"),
      check((await page.locator("#local-mode-badge").innerText()).includes("本地"), "全局显示「本地模式」"),
    ];
    const monthText = await page.locator("#budget-month").innerText();
    const projectBudgetText = await page.locator("#budget-project").innerText();
    const txnText = await page.locator("#budget-txn").innerText();
    checks.push(check(monthText.includes("月度预算") && monthText.includes("¥"), "预算条：月度预算可见", monthText.replaceAll("\n", " ")));
    checks.push(check(projectBudgetText.includes("项目预算") && projectBudgetText.includes("¥"), "预算条：项目预算可见", projectBudgetText.replaceAll("\n", " ")));
    checks.push(check(txnText.includes("单笔上限") && txnText.includes("¥"), "预算条：单笔上限可见", txnText.replaceAll("\n", " ")));
    checks.push(check((await page.locator("#budget-month").isVisible()) && (await page.locator("#budget-txn").isVisible()), "预算条元素可见"));

    const projectCards = await page.locator("#project-cards .project-card").count();
    checks.push(check(projectCards >= 3, `项目卡 ≥3（实际 ${projectCards}）`));
    const firstCardText = await page.locator("#project-cards .project-card").first().innerText();
    checks.push(check(firstCardText.includes("客户：") && firstCardText.includes("%"), "项目卡含客户与进度"));

    const taskTotalText = await page.locator("#task-total").innerText();
    const taskTotalMatch = /(\d+)/.exec(taskTotalText);
    const taskRows = await page.locator("#task-board .task-row").count();
    checks.push(check(taskRows > 0, `任务列表非空（实际 ${taskRows} 条）`));
    checks.push(
      check(
        taskTotalMatch !== null && Number.parseInt(taskTotalMatch[1], 10) === taskRows,
        `任务数文案与任务行一致（文案「${taskTotalText}」，列表 ${taskRows} 条）`,
      ),
    );
    const groupedRoles = await page.locator("#task-board .task-group[data-agent-role]").count();
    checks.push(check(groupedRoles >= 2, `任务按代理分组（实际 ${groupedRoles} 组）`));

    const agentRows = await page.locator("#agent-status .agent-row").count();
    checks.push(check(agentRows >= 4, `代理状态行 ≥4（实际 ${agentRows}）`));
    const l0 = await page.locator("#summary-l0").innerText();
    checks.push(check(l0.trim().length > 0, "L0 摘要可见", l0.trim()));
    return { checks };
  });
}

async function stepProjectTimeline(page, recorder) {
  return recorder.step(page, "project-timeline", async () => {
    // 真实点击项目卡里的链接（不是直接 goto）
    await page.locator("#project-cards a[data-project-link]").first().click();
    await page.waitForURL("**/project/**", { timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#project-timeline .timeline-item", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const title = (await page.locator("#project-title").innerText()).trim();
    checks.push(check(title.length > 0, `项目标题非空（${title}）`));
    const timelineCount = await page.locator("#project-timeline .timeline-item").count();
    checks.push(check(timelineCount >= 5, `项目时间线 ≥5 条（实际 ${timelineCount}）`));
    const evidenceLinks = page.locator("#project-timeline [data-evidence-ref]");
    const evidenceCount = await evidenceLinks.count();
    checks.push(check(evidenceCount >= 1, `时间线含证据入口（实际 ${evidenceCount} 个）`));

    await evidenceLinks.first().click();
    await page.waitForSelector("#evidence-detail[data-evidence-ready=\"true\"]", { timeout: STEP_TIMEOUT_MS });
    const path = (await page.locator("#evidence-path").innerText()).trim();
    const kind = (await page.locator("#evidence-type").innerText()).trim();
    const confidence = (await page.locator("#evidence-confidence").innerText()).trim();
    checks.push(check(path !== "" && path !== "—", `证据路径可见（${path}）`));
    checks.push(check(kind !== "" && kind !== "—", `证据类型可见（${kind}）`));
    checks.push(check(confidence !== "" && confidence !== "—", `证据置信度可见（${confidence}）`));
    checks.push(check(confidence.toLowerCase().includes("certain") || confidence.toLowerCase().includes("probable"), "置信度取值合理"));
    return { checks };
  });
}

async function stepLedgerFacts(page, recorder) {
  return recorder.step(page, "ledger-facts", async () => {
    await page.locator("#nav-ledger").click();
    await page.waitForSelector("#ledger-table tbody tr[data-entry-id]", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const rowCount = await page.locator("#ledger-table tbody tr[data-entry-id]").count();
    checks.push(check(rowCount >= 4, `账本 ≥4 笔（实际 ${rowCount}）`));

    await page.locator("#ledger-table tbody tr[data-entry-id]").first().click();
    await page.waitForSelector("#ledger-drawer[data-facts-ready=\"true\"]", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#ledger-drawer").isVisible(), "账本详情抽屉已打开"));
    for (const [id, label] of LEDGER_FACT_FIELDS) {
      const text = (await page.locator(`#${id}`).innerText()).trim();
      checks.push(check(text !== "" && text !== "—", `6 要素：${label} 有值`, text));
    }
    return { checks };
  });
}

async function stepApprovalsDecide(page, recorder) {
  return recorder.step(page, "approvals-decide", async () => {
    await page.locator("#nav-approvals").click();
    await page.waitForSelector("#approval-cards .approval-card", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const pending = page.locator("#approval-cards .approval-card[data-approval-status=\"pending\"]");
    const pendingCount = await pending.count();
    checks.push(check(pendingCount >= 2, `待批准审批卡 ≥2（实际 ${pendingCount}）`));

    const firstCard = pending.first();
    const approveId = await firstCard.getAttribute("data-approval-id");
    const approveCardText = await firstCard.innerText();
    checks.push(check(approveCardText.includes("金额") && approveCardText.includes("证据："), "审批卡含金额与证据"));
    const countdownText = (await firstCard.locator("[data-countdown]").innerText()).trim();
    checks.push(check(countdownText.includes("剩余") || countdownText.includes("已过期"), "审批卡含到期倒计时", countdownText));

    await firstCard.locator("button[data-decision=\"approve\"]").click();
    await page.waitForSelector(
      `.approval-card[data-approval-id="${approveId}"][data-approval-status="approved"]`,
      { timeout: STEP_TIMEOUT_MS },
    );
    const approveBadge = (await page.locator(`.approval-card[data-approval-id="${approveId}"] [data-status]`).innerText()).trim();
    checks.push(check(approveBadge.includes("已批准"), `批准后状态即时更新（${approveId} → ${approveBadge}）`));

    const secondId = await page.locator("#approval-cards .approval-card[data-approval-status=\"pending\"]").first().getAttribute("data-approval-id");
    await page.locator(`.approval-card[data-approval-id="${secondId}"] button[data-decision="reject"]`).click();
    await page.waitForSelector(
      `.approval-card[data-approval-id="${secondId}"][data-approval-status="rejected"]`,
      { timeout: STEP_TIMEOUT_MS },
    );
    const rejectBadge = (await page.locator(`.approval-card[data-approval-id="${secondId}"] [data-status]`).innerText()).trim();
    checks.push(check(rejectBadge.includes("已驳回"), `驳回后状态即时更新（${secondId} → ${rejectBadge}）`));

    // 刷新后状态仍存在 → 证明是服务端状态而不是仅前端 DOM
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#approval-cards .approval-card", { timeout: STEP_TIMEOUT_MS });
    const approvedAfterReload = await page.locator(`.approval-card[data-approval-id="${approveId}"][data-approval-status="approved"]`).count();
    const rejectedAfterReload = await page.locator(`.approval-card[data-approval-id="${secondId}"][data-approval-status="rejected"]`).count();
    checks.push(check(approvedAfterReload === 1, "刷新后 approved 状态仍在（服务端状态）"));
    checks.push(check(rejectedAfterReload === 1, "刷新后 rejected 状态仍在（服务端状态）"));
    return { checks };
  });
}

async function stepTakeoverStop(page, recorder) {
  let measuredStopMs = null;
  const step = await recorder.step(page, "takeover-stop", async () => {
    await page.locator("#nav-takeover").click();
    await page.waitForSelector("#takeover-trigger", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    checks.push(check(await page.locator("#takeover-state[data-halted=\"false\"]").count() === 1, "初始状态 halted=false"));
    checks.push(check(await page.locator("#takeover-trigger").isVisible(), "接管大按钮可见"));

    const startedAt = Date.now();
    await page.locator("#takeover-trigger").click();
    await page.waitForSelector("#takeover-state[data-halted=\"true\"]", { timeout: STOP_LIMIT_MS });
    measuredStopMs = Date.now() - startedAt;
    checks.push(check(measuredStopMs <= STOP_LIMIT_MS, `接管停止实测 ${measuredStopMs}ms ≤ ${STOP_LIMIT_MS}ms`));
    checks.push(check(measuredStopMs >= 0, `measured_stop_ms 有效（${measuredStopMs}）`));

    for (const field of PACK_FIELDS) {
      const items = page.locator(`#pack-${field} li`);
      const count = await items.count();
      const firstText = count > 0 ? (await items.first().innerText()).trim() : "";
      checks.push(
        check(count >= 1 && firstText.length > 0 && firstText !== "（空）", `接管包：${PACK_LABELS[field]} 有内容（${count} 条）`),
      );
    }
    const coverage = (await page.locator("#pack-coverage").innerText()).trim();
    checks.push(check(coverage.length > 0, `接管包覆盖度可见（${coverage}）`));
    const timerText = (await page.locator("#takeover-timer").innerText()).trim();
    checks.push(check(timerText.includes("已停止"), `接管计时可见（${timerText}）`));
    const measuredText = (await page.locator("#takeover-measured").innerText()).trim();
    checks.push(check(measuredText.includes("实测停止耗时") && measuredText.includes("ms"), `页面显示实测停止耗时（${measuredText}）`));
    const haltedBanner = await page.locator("#halt-banner").count();
    checks.push(check(haltedBanner === 1, "halted 后全局显示接管横幅"));
    return { checks };
  });
  return { step, measuredStopMs };
}

async function stepTakeoverResume(page, recorder) {
  return recorder.step(page, "takeover-resume", async () => {
    await page.locator("#takeover-resume").click();
    await page.waitForSelector("#takeover-state[data-halted=\"false\"]", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    checks.push(check(await page.locator("#takeover-idle").isVisible(), "resume 后恢复空闲态（halted=false）"));
    checks.push(check((await page.locator("#halt-banner").count()) === 0, "resume 后全局接管横幅消失"));
    const resumedNote = (await page.locator("#takeover-resumed-note").innerText()).trim();
    checks.push(check(resumedNote.includes("恢复运行"), `显示恢复时间（${resumedNote}）`));
    return { checks };
  });
}

async function stepMonthlyReport(page, recorder) {
  return recorder.step(page, "monthly-report", async () => {
    await page.locator("#nav-report").click();
    await page.waitForSelector("#report-income", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const moneyPattern = /¥[\d,]+\.\d{2}/;
    for (const [id, label] of [
      ["report-income", "收入"],
      ["report-cost", "成本"],
      ["report-margin", "毛利"],
      ["report-budget-left", "预算余量"],
    ]) {
      const text = (await page.locator(`#${id}`).innerText()).trim();
      checks.push(check(moneyPattern.test(text), `月报：${label} 可见（${text}）`));
    }
    const compliance = await page.locator("#compliance-events li").count();
    const proposals = await page.locator("#next-proposals li").count();
    checks.push(check(compliance >= 2, `合规事件 ≥2 条（实际 ${compliance}）`));
    checks.push(check(proposals >= 2, `下月提案 ≥2 条（实际 ${proposals}）`));
    const asOf = (await page.locator("#report-as-of").innerText()).trim();
    const coverage = (await page.locator("#report-coverage").innerText()).trim();
    checks.push(check(asOf.length > 0 && asOf !== "—", `as_of 可见（${asOf}）`));
    checks.push(check(coverage.length > 0, `coverage 可见（${coverage}）`));
    return { checks };
  });
}

async function stepLocalOnly(page, recorder, context) {
  const { baseUrl, host, port, requestLog, pageErrors, consoleHandle } = context;
  return recorder.step(page, "local-only", async () => {
    const checks = [];
    const bodyText = await page.locator("body").innerText();
    checks.push(check(bodyText.includes("127.0.0.1"), "页面文本含 127.0.0.1"));
    checks.push(check(bodyText.includes("本地"), "页面文本含「本地」"));

    const bound = consoleHandle.server.address();
    const boundAddress = typeof bound === "object" && bound !== null ? bound.address : "";
    checks.push(check(boundAddress === "127.0.0.1", `服务端只绑定 127.0.0.1（实际 ${boundAddress}）`));
    checks.push(check(host === "127.0.0.1", `控制台 host=127.0.0.1（实际 ${host}）`));

    // 局域网地址访问不可用：控制台只监听回环，外部地址应连接失败
    const lanIp = findLanIpv4();
    if (lanIp === null) {
      checks.push(skipped("未发现局域网 IPv4，跳过「外部地址不可达」断言（绑定地址已断言 127.0.0.1）"));
    } else {
      let externalReachable = false;
      try {
        const response = await fetch(`http://${lanIp}:${port}/health`, { signal: AbortSignal.timeout(1500) });
        externalReachable = response.ok;
      } catch {
        externalReachable = false;
      }
      checks.push(check(!externalReachable, `局域网地址 ${lanIp}:${port} 不可访问（只监听回环）`));
    }

    // 写操作 token：无 token 被拒（401），读接口无需 token
    let unauthorizedStatus = 0;
    try {
      const response = await fetch(`${baseUrl}/api/takeover/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by: "e2e-no-token" }),
        signal: AbortSignal.timeout(2000),
      });
      unauthorizedStatus = response.status;
    } catch {
      unauthorizedStatus = 0;
    }
    checks.push(check(unauthorizedStatus === 401, `无 X-Steward-Token 写操作被拒（实际 ${unauthorizedStatus}）`));
    const readStatus = await fetch(`${baseUrl}/api/overview`, { signal: AbortSignal.timeout(2000) }).then((response) => response.status).catch(() => 0);
    checks.push(check(readStatus === 200, `读接口无需 token（/api/overview → ${readStatus}）`));

    // 无外链：本次浏览产生的所有 HTTP 请求都必须指向 127.0.0.1:<port>
    const external = requestLog.filter((url) => {
      try {
        const parsed = new URL(url);
        return !(parsed.hostname === "127.0.0.1" && parsed.port === String(port));
      } catch {
        return false;
      }
    });
    checks.push(check(external.length === 0, `无外链请求（${requestLog.length} 个请求全部同源 127.0.0.1）`, external.slice(0, 5).join(", ")));
    const assetUrls = requestLog.filter((url) => url.includes("/assets/"));
    checks.push(check(assetUrls.length >= 2, `同源静态资源已加载（${assetUrls.length} 个 /assets/ 请求）`));

    checks.push(check(pageErrors.length === 0, `无页面 JS 错误（实际 ${pageErrors.length}）`, pageErrors.slice(0, 3).join(" | ")));
    return { checks };
  });
}

// ---------------------------------------------------------------------------
// v1.1 新增步骤：专业版导航 / 配置中心 / 智能体中心 / 后台 / 数据管理 / 收尾
// ---------------------------------------------------------------------------

async function stepProNav(page, recorder) {
  return recorder.step(page, "pro-nav-status", async () => {
    const checks = [];
    checks.push(check(await page.locator("#sidebar").isVisible(), "左侧固定导航可见"));
    for (const [id, label] of [
      ["nav-agents", "智能体"],
      ["nav-backend", "后台"],
      ["nav-settings", "配置"],
      ["nav-data", "数据"],
    ]) {
      const nav = page.locator(`#${id}`);
      const count = await nav.count();
      checks.push(check(count === 1 && (await nav.isVisible()), `导航出现新入口「${label}」（#${id}）`));
    }
    checks.push(check(await page.locator("#topbar").isVisible(), "顶部状态栏可见"));
    const modeText = (await page.locator("#status-mode").innerText()).trim();
    checks.push(check(modeText.includes("体验模式"), `顶部状态栏：运行模式徽章=体验模式（实际「${modeText}」）`));
    const budgetText = (await page.locator("#status-budget").innerText()).trim();
    checks.push(check(budgetText.includes("¥"), `顶部状态栏：预算余量可见（${budgetText}）`));
    const tokenText = (await page.locator("#status-token").innerText()).trim();
    checks.push(check(tokenText.length > 0 && tokenText !== "—", `顶部状态栏：Token 余量可见（${tokenText}）`));
    const haltedText = (await page.locator("#status-halted").innerText()).trim();
    checks.push(check(haltedText.includes("运行中"), `顶部状态栏：接管状态=运行中（实际「${haltedText}」）`));
    const lastEvent = (await page.locator("#status-last-event").innerText()).trim();
    checks.push(check(lastEvent.length > 0, `顶部状态栏：最近事件时间可见（${lastEvent}）`));
    return { checks };
  });
}

async function stepSettings(page, recorder) {
  return recorder.step(page, "settings-config", async () => {
    await page.locator("#nav-settings").click();
    await page.waitForSelector("#mode-cards", { timeout: STEP_TIMEOUT_MS });
    const checks = [];

    for (const mode of ["demo", "personal", "enterprise"]) {
      checks.push(check((await page.locator(`#mode-card-${mode}`).count()) === 1, `配置中心三模式卡片：${mode}`));
    }
    checks.push(check(await page.locator("#payment-section").isVisible(), "「支付与银行卡」分组可见（用户明确要求）"));
    checks.push(check(await page.locator("#pay-personal").isVisible(), "个人渠道分组（微信/支付宝/个人银行卡）可见"));
    for (const kind of ["wechat_pay", "alipay", "personal_bank_card"]) {
      checks.push(check((await page.locator(`#pay-channel-${kind}`).count()) === 1, `支付渠道行可见：${kind}`));
    }
    checks.push(check((await page.locator("#payment-section").innerText()).includes("AI 不代签"), "支付分组含「AI 不代签」说明"));
    checks.push(check(await page.locator("#payout-account").isVisible(), "收款账户（个人卡/微信/支付宝掩码）可见"));
    const demoTokenLimit = await page.locator("#token-limit").inputValue();
    checks.push(check(demoTokenLimit === "10000000", `体验模式 Token 上限=10,000,000（实际 ${demoTokenLimit}）`));
    const featureRows = await page.locator(".feature-row[data-feature]").count();
    checks.push(check(featureRows >= 14, `功能开关逐项可配置（${featureRows} 项）`));

    // 切到个人模式并保存
    await page.locator("#mode-card-personal").click();
    await page.locator("#settings-save").click();
    await page.waitForTimeout(900);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleReload(page);
    await page.waitForSelector("#mode-cards", { timeout: STEP_TIMEOUT_MS });
    const personalModeText = (await page.locator("#status-mode").innerText()).trim();
    checks.push(check(personalModeText.includes("个人模式"), `切换后顶部状态=个人模式（实际「${personalModeText}」）`));
    checks.push(check((await page.locator("#mode-card-personal.selected").count()) === 1, "个人模式卡片为选中态"));
    checks.push(check((await page.locator("#pay-personal").getAttribute("data-applicable")) === "true", "个人渠道分组标记为适用"));
    for (const kind of ["wechat_pay", "alipay", "personal_bank_card"]) {
      checks.push(check(await page.locator(`#pay-${kind}-enabled`).isChecked(), `个人模式渠道已启用：${kind}`));
      const modeText = (await page.locator(`#pay-${kind}-mode`).innerText()).trim();
      checks.push(check(modeText.includes("人工审批"), `渠道 ${kind} 仅人工审批（${modeText}）`));
      const account = (await page.locator(`#pay-${kind}-account`).innerText()).trim();
      checks.push(check(account.length > 0 && account !== "—", `渠道 ${kind} 显示掩码账户（${account}）`));
    }
    checks.push(check((await page.locator("#payout-account").innerText()).includes("个人账户"), "收款账户：个人账户类型可见"));
    const personalTokenLimit = await page.locator("#token-limit").inputValue();
    checks.push(check(personalTokenLimit === "2000000", `个人模式 Token 上限=2,000,000（实际 ${personalTokenLimit}）`));

    // 逐项禁用 scout 并保存
    const scoutToggle = page.locator("#feature-scout-enabled");
    checks.push(check(await scoutToggle.isChecked(), "scout 功能默认启用"));
    if (await scoutToggle.isChecked()) await scoutToggle.click();
    await page.locator("#feature-scout-note").fill("E2E：临时禁用 scout（验证功能可逐项禁用）");
    await page.locator("#settings-save").click();
    await page.waitForTimeout(800);
    const feedback = (await page.locator("#settings-feedback").innerText()).trim();
    checks.push(check(feedback.includes("已保存"), `保存 scout 禁用成功（${feedback}）`));
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleReload(page);
    await page.waitForSelector("#feature-scout-enabled", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(!(await page.locator("#feature-scout-enabled").isChecked()), "刷新后 scout 仍为禁用（配置持久化）"));
    const scoutBadge = (await page.locator("#feature-row-scout .feature-badge").innerText()).trim();
    checks.push(check(scoutBadge.includes("已禁用"), `scout 功能行显示已禁用（${scoutBadge}）`));

    // 0 元极限模式提示
    await page.locator("#budget-zero").check();
    checks.push(check(await page.locator("#zero-budget-hint").isVisible(), "勾选「0 元极限模式」后提示可见"));
    const zeroHint = (await page.locator("#zero-budget-hint").innerText()).trim();
    checks.push(check(zeroHint.includes("只允许免费本地动作"), `0 元提示文案可读（${zeroHint}）`));
    await page.locator("#budget-zero").uncheck();

    // 保存校验错误提示：单步 Token 上限 > 总上限 → 保存失败并显示可读错误
    await page.locator("#token-per-action").fill("999999999");
    await page.locator("#settings-save").click();
    await page.waitForTimeout(900);
    const errorsVisible = await page.locator("#settings-errors").isVisible();
    checks.push(check(errorsVisible, "非法配置保存时显示校验错误（不静默失败）"));
    if (errorsVisible) {
      const errorText = (await page.locator("#settings-errors").innerText()).trim();
      checks.push(check(errorText.includes("单步"), `校验错误文案可读（${errorText.slice(0, 80)}）`));
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleReload(page);
    await page.waitForSelector("#token-per-action", { timeout: STEP_TIMEOUT_MS });
    return { checks };
  });
}

async function stepAgentsCenter(page, recorder) {
  return recorder.step(page, "agents-center", async () => {
    await page.locator("#nav-agents").click();
    await page.waitForSelector("#agents-grid .agent-card", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const agentCount = await page.locator("#agents-grid .agent-card").count();
    checks.push(check(agentCount >= 8, `智能体 ≥8 个（实际 ${agentCount}）`));
    for (const role of ["conductor", "operator", "harness", "reviewer", "backend", "scout"]) {
      checks.push(check((await page.locator(`#agent-${role}`).count()) === 1, `含智能体：${role}`));
    }
    const harnessText = await page.locator("#agent-harness").innerText();
    checks.push(check(harnessText.includes("写代码"), "harness 显示为「写代码 Harness」"));
    const backendText = await page.locator("#agent-backend").innerText();
    checks.push(check(backendText.includes("后台"), "backend 显示为「后台值守」"));
    const enterpriseAgentText = await page.locator("#agent-enterprise_admin").innerText();
    checks.push(check(enterpriseAgentText.includes("该模式不适用"), "企业专属智能体在个人模式显示「该模式不适用」"));
    checks.push(check((await page.locator("#agent-conductor").innerText()).includes("今日动作"), "卡片含今日动作数"));
    checks.push(check((await page.locator("#agent-conductor").innerText()).includes("Token"), "卡片含 Token 消耗"));
    const logCount = await page.locator("#agent-operator .agent-logs li").count();
    checks.push(check(logCount >= 1 && logCount <= 3, `卡片最近日志 1–3 条（实际 ${logCount}）`));

    await page.locator("#agent-harness [data-agent-expand]").click();
    await page.waitForSelector("#agent-detail-harness:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#agent-detail-harness").isVisible(), "点击智能体可展开详情"));
    const detailText = await page.locator("#agent-detail-harness").innerText();
    checks.push(check(detailText.includes("Token 限额"), "详情含 Token 限额"));
    checks.push(check(detailText.includes("工具"), "详情含工具清单"));
    return { checks };
  });
}

async function stepBackendFlow(page, recorder) {
  return recorder.step(page, "backend-flow", async () => {
    await page.locator("#nav-backend").click();
    await page.waitForSelector("#flow-timeline .flow-run", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const runCount = await page.locator("#flow-timeline .flow-run").count();
    const itemCount = await page.locator("#flow-timeline .flow-item").count();
    checks.push(check(runCount >= 2, `后台按 run 分组（${runCount} 个 run）`));
    checks.push(check(itemCount >= 5, `全流程时间线 ≥5 条事件（实际 ${itemCount}）`));
    for (const phase of ["plan", "action", "observe", "verify", "evidence"]) {
      const count = await page.locator(`#flow-timeline .flow-item[data-phase="${phase}"]`).count();
      checks.push(check(count >= 1, `时间线含阶段「${phase}」（${count} 条）`));
    }
    const queueCount = await page.locator("#queue-panel .queue-item").count();
    checks.push(check(queueCount >= 1, `运行队列可见（${queueCount} 项）`));
    checks.push(check((await page.locator("#consume-panel").innerText()).includes("已用"), "Token/预算消耗可见"));
    checks.push(check((await page.locator("#anomaly").innerText()).length > 0, "异常/接管记录可见"));

    // 事件流过滤：action
    await page.locator("#flow-filter").selectOption("action");
    await page.waitForTimeout(250);
    const actionVisible = await page.locator('#flow-timeline .flow-item[data-phase="action"]').count();
    const allVisible = await page.locator("#flow-timeline .flow-item:visible").count();
    checks.push(check(actionVisible >= 1 && allVisible === actionVisible, `事件流过滤生效（action 可见 ${allVisible} / ${actionVisible}）`));
    await page.locator("#flow-filter").selectOption("all");
    await page.waitForTimeout(200);

    // 展开证据引用
    const evidenceButton = page.locator("#flow-timeline [data-evidence-ref]").first();
    checks.push(check((await evidenceButton.count()) === 1, "流程事件含证据引用入口"));
    if ((await evidenceButton.count()) === 1) {
      await evidenceButton.click();
      await page.waitForSelector('#evidence-detail[data-evidence-ready="true"]', { timeout: STEP_TIMEOUT_MS });
      const path = (await page.locator("#evidence-path").innerText()).trim();
      const kind = (await page.locator("#evidence-type").innerText()).trim();
      checks.push(check(path.length > 0 && path !== "—", `展开证据路径可见（${path}）`));
      checks.push(check(kind.length > 0 && kind !== "—", `展开证据类型可见（${kind}）`));
    }
    return { checks };
  });
}

async function stepDataManage(page, recorder) {
  return recorder.step(page, "data-manage", async () => {
    await page.locator("#nav-data").click();
    await page.waitForSelector("#data-stats", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    const runsBefore = Number.parseInt((await page.locator("#data-runs").innerText()).trim(), 10);
    const evidenceBefore = Number.parseInt((await page.locator("#data-evidence-files").innerText()).trim(), 10);
    checks.push(check(Number.isFinite(runsBefore) && runsBefore > 0, `数据统计：运行记录 ${String(runsBefore)}`));
    checks.push(check(Number.isFinite(evidenceBefore) && evidenceBefore > 0, `数据统计：证据文件 ${String(evidenceBefore)}`));
    const updatedText = (await page.locator("#data-config-updated").innerText()).trim();
    checks.push(check(updatedText.length > 0 && updatedText !== "—", `数据统计：配置更新时间可见（${updatedText}）`));

    // 二次确认：先打开确认框，取消不执行
    await page.locator("#data-clear").click();
    await page.waitForSelector("#data-confirm-modal:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#data-confirm-modal").isVisible(), "清空数据需二次确认（确认框弹出）"));
    checks.push(check((await page.locator("#data-confirm-title").innerText()).includes("确认清空"), "确认框标题说明清空"));
    await page.locator("#data-confirm-cancel").click();
    await page.waitForTimeout(200);
    checks.push(check(await page.locator("#data-confirm-modal").isHidden(), "取消后不执行清空"));
    const runsAfterCancel = Number.parseInt((await page.locator("#data-runs").innerText()).trim(), 10);
    checks.push(check(runsAfterCancel === runsBefore, "取消后数据未变化"));

    // 再次打开并确认清空
    await page.locator("#data-clear").click();
    await page.waitForSelector("#data-confirm-modal:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    await page.locator("#data-confirm-yes").click();
    await page.waitForTimeout(900);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleReload(page);
    await page.waitForSelector("#data-stats", { timeout: STEP_TIMEOUT_MS });
    const runsAfter = Number.parseInt((await page.locator("#data-runs").innerText()).trim(), 10);
    const evidenceAfter = Number.parseInt((await page.locator("#data-evidence-files").innerText()).trim(), 10);
    checks.push(check(runsAfter === 0, `确认清空后运行记录归零（实际 ${String(runsAfter)}）`));
    checks.push(check(evidenceAfter === 0, `确认清空后证据文件归零（实际 ${String(evidenceAfter)}）`));
    checks.push(check((await page.locator("#data-empty").count()) === 1, "清空后显示「空档案」引导"));
    checks.push(check((await page.locator("#data-empty").innerText()).includes("空档案"), "空档案文案可读"));

    // 重置为演示数据（恢复可测试状态）
    await page.locator("#data-reset-demo-empty").click();
    await page.waitForTimeout(900);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleReload(page);
    await page.waitForSelector("#data-stats", { timeout: STEP_TIMEOUT_MS });
    const runsRestored = Number.parseInt((await page.locator("#data-runs").innerText()).trim(), 10);
    checks.push(check(runsRestored > 0, `重置为演示数据后记录恢复（${String(runsRestored)}）`));
    checks.push(check((await page.locator("#data-empty").count()) === 0, "重置后空档案引导消失"));
    return { checks };
  });
}

async function stepProSanity(page, recorder, context) {
  const { baseUrl, port, requestLog, pageErrors } = context;
  return recorder.step(page, "pro-sanity", async () => {
    const checks = [];
    checks.push(check(pageErrors.length === 0, `全程无页面 JS 错误（实际 ${pageErrors.length}）`, pageErrors.slice(0, 3).join(" | ")));

    const configResponse = await fetch(`${baseUrl}/api/config`, { signal: AbortSignal.timeout(3000) });
    const configPayload = await configResponse.json();
    checks.push(check(configResponse.status === 200 && configPayload.ok === true, `GET /api/config 200（实际 ${configResponse.status}）`));
    const config = configPayload.data;
    checks.push(check(config.profile.mode === "personal", `配置持久化：运行模式=personal（实际 ${config.profile.mode}）`));
    checks.push(check(config.features.scout.enabled === false, "配置持久化：scout 功能=禁用"));
    checks.push(check(config.features.scout.note.includes("E2E"), "配置持久化：禁用原因已保存"));
    checks.push(check(config.payments.payout_account.type === "personal", "配置持久化：收款账户=个人类型"));
    checks.push(check(config.payments.ai_may_sign === false, "支付配置：AI 不代签（固定 false）"));

    const agentsResponse = await fetch(`${baseUrl}/api/agents`, { signal: AbortSignal.timeout(3000) });
    const agentsPayload = await agentsResponse.json();
    checks.push(check(agentsResponse.status === 200 && Array.isArray(agentsPayload.data) && agentsPayload.data.length >= 8, `GET /api/agents 返回 ${agentsPayload.data?.length ?? 0} 个智能体`));

    const statsResponse = await fetch(`${baseUrl}/api/data/stats`, { signal: AbortSignal.timeout(3000) });
    const statsPayload = await statsResponse.json();
    checks.push(check(statsResponse.status === 200 && statsPayload.data.cleared === false, "GET /api/data/stats：数据已重置为演示态"));

    const flowResponse = await fetch(`${baseUrl}/api/flow`, { signal: AbortSignal.timeout(3000) });
    const flowPayload = await flowResponse.json();
    const flowItems = Array.isArray(flowPayload.data) ? flowPayload.data.reduce((sum, run) => sum + run.events.length, 0) : 0;
    checks.push(check(flowItems >= 5, `GET /api/flow 返回 ${flowItems} 条事件`));

    // 无外链请求：所有网络请求均为同源 127.0.0.1:<port>
    const external = requestLog.filter((url) => {
      try {
        const parsed = new URL(url);
        return !(parsed.hostname === "127.0.0.1" && parsed.port === String(port));
      } catch {
        return false;
      }
    });
    checks.push(check(external.length === 0, `全程无外链请求（${requestLog.length} 个请求全部同源）`, external.slice(0, 5).join(", ")));
    checks.push(check(requestLog.some((url) => url.endsWith("/assets/pro.css")), "专业版样式已同源加载（pro.css）"));
    checks.push(check(requestLog.some((url) => url.endsWith("/assets/admin.js")), "专业版脚本已同源加载（admin.js）"));

    // 管理写 API 的 token 保护：无 token 必须 401（不修改数据）
    let unauthStatus = 0;
    try {
      const response = await fetch(`${baseUrl}/api/data/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(2000),
      });
      unauthStatus = response.status;
    } catch {
      unauthStatus = 0;
    }
    checks.push(check(unauthStatus === 401, `无 X-Steward-Token 的管理写操作被拒（实际 ${unauthStatus}）`));
    const statsAfterUnauth = await fetch(`${baseUrl}/api/data/stats`, { signal: AbortSignal.timeout(2000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(statsAfterUnauth !== null && statsAfterUnauth.data.cleared === false, "未授权请求未修改数据（仍为演示态）"));
    return { checks };
  });
}

function findLanIpv4() {
  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    if (addresses === undefined) continue;
    for (const address of addresses) {
      if (address.family === "IPv4" && address.internal === false && !address.address.startsWith("169.254.")) {
        return address.address;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  if (!existsSync(options.consoleDist)) {
    console.error(
      `[e2e-console] 环境错误：找不到控制台构建产物 ${options.consoleDist}\n请先在仓库根目录运行：npm run build`,
    );
    return 2;
  }

  const evidenceDir = options.evidenceDir;
  await mkdir(evidenceDir, { recursive: true });
  // 每次运行前清理本脚本自己的截图/DOM 目录，避免新旧证据混合
  await rm(join(evidenceDir, "screenshots"), { recursive: true, force: true });
  await rm(join(evidenceDir, "dom"), { recursive: true, force: true });

  const consolePackage = await import(pathToFileURL(options.consoleDist).href);
  const { createConsoleServer, createDemoConsoleProvider, createDemoAdminProvider } = consolePackage;

  const recorder = new Recorder(evidenceDir);
  await recorder.prepare();

  const serverLog = [];
  const pageConsoleLog = [];
  const pageErrors = [];
  const requestLog = [];
  let measuredStopMs = null;
  let consoleBootMs = null;
  let firstPageLoadMs = null;
  let fatalError = null;
  let browserInfo = null;
  let browser = null;
  let consoleHandle = null;
  let baseUrl = "";

  console.log("=".repeat(72));
  console.log("代掌 Steward · 本地 Web 控制台（v1.1 专业版）真实浏览器 E2E");
  console.log(`构建产物: ${options.consoleDist}`);
  console.log(`浏览器  : ${options.headless ? "无头 headless=1" : "有头（默认，产品验收必须）"}；通道 chrome → msedge`);
  console.log(`数据提供: provider=demo · adminProvider=demo（配置中心/智能体/后台/数据）`);
  console.log(`证据目录: ${evidenceDir}`);
  console.log("=".repeat(72));

  const suiteStartedAt = Date.now();
  try {
    const bootStart = Date.now();
    consoleHandle = await createConsoleServer({
      provider: createDemoConsoleProvider(),
      adminProvider: createDemoAdminProvider(),
      port: options.port,
      log: (line) => serverLog.push(line),
    });
    consoleBootMs = Date.now() - bootStart;
    baseUrl = consoleHandle.url;
    console.log(
      `\n[console] 已启动 ${baseUrl}（host=${consoleHandle.host} port=${consoleHandle.port} boot=${String(consoleBootMs)}ms，写操作需 X-Steward-Token，页面已注入）`,
    );

    browserInfo = await launchRealBrowser({ headless: options.headless });
    browser = browserInfo.browser;
    console.log(`[browser] ${browserInfo.channel} ${browserInfo.version} 已启动（${options.headless ? "headless" : "headed"}）`);

    const context = await browser.newContext({ viewport: VIEWPORT, locale: "zh-CN" });
    const page = await context.newPage();
    page.on("console", (message) => pageConsoleLog.push(`[console:${message.type()}] ${message.text()}`));
    page.on("pageerror", (error) => {
      pageErrors.push(error?.message ?? String(error));
      pageConsoleLog.push(`[pageerror] ${error?.message ?? error}`);
    });
    page.on("request", (request) => requestLog.push(request.url()));

    const firstLoadStart = Date.now();
    await recorder.step(page, "open-console", async () => {
      const response = await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      return {
        checks: [
          check(response !== null && response.status() === 200, `控制台首页 HTTP 200（实际 ${response === null ? "无响应" : response.status()}）`),
          check((await page.title()).includes("本地控制台"), "页面标题含「本地控制台」"),
          check(await page.locator("#sidebar").isVisible(), "专业版左侧导航已渲染"),
          check(await page.locator("#status-mode").isVisible(), "顶部状态栏已渲染"),
        ],
      };
    });
    firstPageLoadMs = Date.now() - firstLoadStart;
    await stepDashboardLoad(page, recorder, baseUrl);
    await stepProjectTimeline(page, recorder);
    await stepLedgerFacts(page, recorder);
    await stepApprovalsDecide(page, recorder);
    const takeoverResult = await stepTakeoverStop(page, recorder);
    measuredStopMs = takeoverResult.measuredStopMs;
    await stepTakeoverResume(page, recorder);
    await stepMonthlyReport(page, recorder);
    await stepLocalOnly(page, recorder, {
      baseUrl,
      host: consoleHandle.host,
      port: consoleHandle.port,
      requestLog,
      pageErrors,
      consoleHandle,
    });
    // ---- v1.1 新增：专业版导航 / 配置中心 / 智能体中心 / 后台 / 数据管理 / 收尾 ----
    await stepProNav(page, recorder);
    await stepSettings(page, recorder);
    await stepAgentsCenter(page, recorder);
    await stepBackendFlow(page, recorder);
    await stepDataManage(page, recorder);
    await stepProSanity(page, recorder, {
      baseUrl,
      port: consoleHandle.port,
      requestLog,
      pageErrors,
    });
  } catch (error) {
    fatalError = errorText(error);
    console.error(`\n[e2e-console] 运行失败：${fatalError}`);
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch {
        // 已关闭
      }
    }
    if (consoleHandle !== null) {
      try {
        await consoleHandle.close();
      } catch (error) {
        console.error(`[e2e-console] 关闭控制台失败：${errorText(error)}`);
      }
      // 端口释放检查（避免残留）
      let released = false;
      try {
        await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      } catch {
        released = true;
      }
      recorder.recordStandaloneCheck(check(released, "close() 后控制台端口已释放（无残留）"));
      console.log(`\n[console] 已关闭（端口${released ? "已释放" : "仍被占用⚠"}）`);
    }
    await writeFile(join(evidenceDir, "console-server.log"), serverLog.join("\n") + "\n", "utf8");
    await writeFile(join(evidenceDir, "console.log"), pageConsoleLog.join("\n") + "\n", "utf8");
  }

  const durationMs = Date.now() - suiteStartedAt;
  const result = {
    suite: "e2e-console",
    version: "1.1.0",
    ok: fatalError === null && recorder.ok,
    as_of: new Date().toISOString(),
    headless: options.headless,
    browser: browserInfo === null
      ? null
      : { channel: browserInfo.channel, version: browserInfo.version, fallbacks: browserInfo.fallbacks.map((item) => item.channel), headless: options.headless },
    console: {
      url: baseUrl,
      host: consoleHandle === null ? null : consoleHandle.host,
      port: consoleHandle === null ? null : consoleHandle.port,
      provider: "demo",
      admin_provider: "demo",
      console_boot_ms: consoleBootMs,
      first_page_load_ms: firstPageLoadMs,
    },
    stop_limit_ms: STOP_LIMIT_MS,
    measured_stop_ms: measuredStopMs,
    steps: recorder.steps,
    checks: recorder.checks,
    failures: recorder.failures,
    evidence: recorder.evidence,
    screenshot_count: recorder.screenshotCount,
    durationMs,
    ...(fatalError === null ? {} : { error: fatalError }),
  };
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");

  const passedChecks = recorder.checks.filter((item) => item.ok || item.skipped === true).length;
  const skippedChecks = recorder.checks.filter((item) => item.skipped === true).length;
  console.log("\n" + "=".repeat(72));
  console.log("结果汇总");
  console.log(`  浏览器: ${browserInfo === null ? "未启动" : `${browserInfo.channel} ${browserInfo.version}（${options.headless ? "headless" : "headed"}）`}`);
  console.log(`  控制台: ${baseUrl}（provider=demo + adminProvider=demo，仅监听 ${consoleHandle === null ? "?" : consoleHandle.host}）`);
  console.log(`  启动  : console_boot_ms=${consoleBootMs === null ? "未测" : String(consoleBootMs)} · first_page_load_ms=${firstPageLoadMs === null ? "未测" : String(firstPageLoadMs)}`);
  console.log(`  步骤  : ${recorder.steps.filter((step) => step.ok).length}/${recorder.steps.length} 通过；截图 ${recorder.screenshotCount} 张；证据 ${recorder.evidence.length} 个`);
  console.log(`  检查  : ${passedChecks}/${recorder.checks.length} 通过${skippedChecks > 0 ? `（跳过 ${skippedChecks}）` : ""}`);
  console.log(`  停止键: measured_stop_ms=${measuredStopMs === null ? "未测" : String(measuredStopMs)}（上限 ${STOP_LIMIT_MS}ms）`);
  if (fatalError !== null) console.log(`  ✗ 致命错误：${fatalError}`);
  for (const failure of recorder.failures) console.log(`  ✗ ${failure}`);
  console.log(`  证据  : ${evidenceDir}`);
  console.log(`  结果  : ${join(evidenceDir, "result.json")}`);
  console.log(`  耗时  : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  结论  : ${result.ok ? "全部通过 → 退出码 0" : "未通过 → 退出码 1"}`);
  console.log("=".repeat(72) + "\n");
  return result.ok ? 0 : 1;
}

const exitCode = await main().catch((error) => {
  console.error(`[e2e-console] 未捕获异常：${errorText(error)}`);
  return 1;
});
process.exitCode = exitCode;
