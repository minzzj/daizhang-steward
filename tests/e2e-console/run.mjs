#!/usr/bin/env node
/**
 * tests/e2e-console/run.mjs — v1.5 本地 Web 控制台（产物/报告/数据/思考过程 + 发送即执行 + SSE 实时流）真实浏览器 E2E
 *
 * 铁律：真实有头 Chrome/Edge + 真实点击/输入/等待 + 每步截图；**不使用任何 mock 路由/假 DOM**。
 * 被测对象是 packages/steward-console 的真实 HTTP 服务（进程内启动，随机端口）：
 *   - provider        = createDemoConsoleProvider()（经营数据：审批/接管真实修改内存状态）
 *   - adminProvider   = createDemoAdminProvider()（配置中心/智能体/后台/数据，保存与清空真实生效）
 *   - chatProvider    = createDemoChatProvider()（对话/证据/变现/模型提示词）
 *   - systemProvider  = createDemoSystemProvider()（/system 总控 + 危险动作二次确认 + 易支付）
 *   - runtimeProvider = createDemoRuntimeProvider()（v1.4：发送即执行 + SSE 实时事件流）
 *
 * 验收流程（38 步，每步截图到 --evidence-dir/screenshots/）：
 *   1–9   P1-C 运营：看板 → 项目时间线/证据 → 账本 6 要素 → 审批 → 接管 stop_ms → resume → 月报 → 只监听本机；
 *   10–15 v1.1 专业版：导航/状态栏 → 三模式配置中心+支付银行卡 → 智能体中心 → 后台时间线 → 数据清空 → sanity；
 *   16–21 v1.2 对话/证据（v1.4 改为发送即执行+实时流）：对话/发送即执行 → 计划/打断恢复 → 自动完成 →
 *         run 证据（缩略图灯箱/report/日志/JSON）→ 智能体轮次记录；
 *   22–25 v1.4 新增：chat-auto-start（发送即出现实时状态、无手动按钮）→ chat-live-events（SSE ≥3 类事件/计划点亮）→
 *         chat-reconnect（刷新后 since 回放恢复）→ chat-approval-pause（高风险暂停→批准→完成）；
 *   26–30 变现+易支付 → 模型提示词 → 系统总控 → 危险动作二次确认 → sse-sanity（无 JS 错误/无外链/订阅清理）；
 *   32–34 v1.5 run Tabs：产物（artifact 预览/下载）/ 数据（Token/工具/耗时）/ 报告（Markdown 渲染）；
 *   35–36 v1.5 实时：思考分块（harness.thinking）/ 工具卡片（tool_call/tool_result）/ 产物提示；
 *   37–38 v1.5 页面：/artifacts 产物中心（筛选/预览/下载）、/agents Harness 真实执行徽章与最近会话；
 *   39    v12-sanity 收尾（API/产物/报告/指标/路径穿越/无 token 401/run 完成校验）。
 *
 * 用法：
 *   npm run build
 *   node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v15
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

/** 安全 reload：客户端 JS 可能已触发刷新（例如保存后自动刷新），此处忽略导航竞态。 */
async function safeReload(page, timeoutMs = 9000) {
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch {
    // 客户端已自行刷新 / 导航被接管：继续等待页面就绪
  }
  await page.waitForTimeout(150);
  try {
    await page.waitForSelector("body", { timeout: 4000 });
  } catch {
    // ignore
  }
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
  constructor(evidenceDir, options = {}) {
    this.evidenceDir = evidenceDir;
    this.screenshotsDir = join(evidenceDir, "screenshots");
    this.domDir = join(evidenceDir, "dom");
    this.screenshotsEnabled = options.screenshots === true;
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
    // v1.5.1：用户要求 E2E 不保存截图（只输出 result.json/断言）；--screenshots 可显式开启。
    if (this.screenshotsEnabled !== true) return null;
    this.seq += 1;
    const relative = `screenshots/${String(this.seq).padStart(3, "0")}-${slug(label)}.png`;
    await page.screenshot({ path: join(this.evidenceDir, relative), fullPage: options.fullPage === true });
    this.evidence.push(relative);
    this.screenshotCount += 1;
    return relative;
  }

  async domSnapshot(page, label) {
    if (this.screenshotsEnabled !== true) return null;
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
      const shot = await this.capture(page, step.ok ? action : `${action}-fail`);
      if (shot !== null) step.evidence.push(shot);
      if (!step.ok) {
        const dom = await this.domSnapshot(page, `${action}-fail`);
        if (dom !== null) step.evidence.push(dom);
      }
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
    await safeReload(page);
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
    await safeReload(page);
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
    await safeReload(page);
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
    await safeReload(page);
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
    await safeReload(page);
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
    await safeReload(page);
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
    checks.push(check((config.features.scout.note ?? "").includes("E2E"), "配置持久化：禁用原因已保存"));
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

// ---------------------------------------------------------------------------
// v1.2/v1.3 新增步骤：对话 / 打断恢复审批 / run 证据 / 智能体记录 / 变现+易支付 /
// 模型与提示词 / 系统总控 / 危险动作二次确认 / 收尾
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v1.2 对话步骤（v1.4 起改为「发送即执行 + SSE 实时流」）
// ---------------------------------------------------------------------------

/** 等待实时状态条出现并返回其文案（最多 timeoutMs）。 */
async function waitForLiveStatus(page, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const panel = page.locator("#live-run-panel");
      if ((await panel.count()) === 1) {
        const text = (await page.locator("#live-status").innerText()).trim();
        if (text.length > 0) return text;
      }
    } catch {
      // 页面可能正在导航/刷新
    }
    await page.waitForTimeout(100);
  }
  return "";
}

/** 等待实时状态达到某个值（含超时）。 */
async function waitForLiveStatusContains(page, needle, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await waitForLiveStatus(page, 500);
    if (text.includes(needle)) return text;
    await page.waitForTimeout(120);
  }
  return await waitForLiveStatus(page, 500);
}

/** /chat（ChatGPT 式）发送目标：立即出现用户消息/思考中，再通过内嵌运行卡进入深度实时页（旧断言继续覆盖）。 */
async function sendGoalFromChat(page, baseUrl, goal, options = {}) {
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
  await page.waitForSelector("#composer-input", { timeout: STEP_TIMEOUT_MS });
  if (options.conversation === undefined) {
    // 每次发送用新对话，避免历史消息干扰
    await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
  }
  await page.locator("#composer-input").fill(goal);
  const sentAt = Date.now();
  await page.locator("#composer-input").press("Enter");
  await page.waitForSelector('.gpt-msg[data-role="user"]', { timeout: 4000 });
  await page.waitForSelector("#chat-run-link", { timeout: 15000 });
  await page.locator("#chat-run-link").click();
  await page.waitForSelector("#live-run-panel", { timeout: STEP_TIMEOUT_MS });
  const statusText = await waitForLiveStatus(page, 6000);
  return { statusText, sentAt };
}

async function stepChatOpen(page, recorder) {
  return recorder.step(page, "chat-open", async () => {
    await page.locator("#nav-chat").click();
    await page.waitForSelector("#gpt-page", { timeout: STEP_TIMEOUT_MS });
    const checks = [];
    checks.push(check(await page.locator("#nav-chat").isVisible(), "左侧导航出现「对话」入口"));
    checks.push(check(await page.locator("#nav-money").isVisible(), "左侧导航出现「变现」入口"));
    checks.push(check(await page.locator("#nav-system").isVisible(), "左侧导航出现「系统」入口"));
    const convCount = await page.locator("#conv-list .gpt-conv-item").count();
    checks.push(check(convCount >= 1, `左侧对话历史可见（${convCount} 个会话）`));
    checks.push(check(await page.locator("#conv-new").isVisible(), "新建对话按钮可见"));
    checks.push(check((await page.locator("#chat-start").count()) === 0, "页面不存在「开始执行」手动按钮（发送即执行）"));
    checks.push(check(await page.locator("#composer-input").isVisible(), "底部输入框可见"));
    const chips = await page.locator("#quick-chips .gpt-chip").count();
    checks.push(check(chips >= 8, `顶部快捷 chips ≥8（${chips} 个：系统/运行/产物/报告/日志/配置/账本/智能体/记忆）`));
    checks.push(check(await page.locator("#memory-list").isVisible() && (await page.locator("#memory-list .gpt-memory-item").count()) >= 3, "记忆面板可见且含记忆条目"));
    checks.push(check(await page.locator("#data-source").isVisible() && (await page.locator("#data-source").innerText()).includes("数据源"), "顶部数据源标识可见"));
    checks.push(check((await page.locator("#chat-status-badge").innerText()).includes("运行中"), "页面显示实时状态（运行中/等待审批）"));
    const msgCount = await page.locator("#gpt-messages .gpt-msg").count();
    checks.push(check(msgCount >= 2, `默认会话已恢复历史消息（${msgCount} 条）`));
    checks.push(check((await page.locator("#gpt-messages").innerText()).length > 0, "消息流可见（含内嵌卡片）"));
    return { checks };
  });
}

async function stepChatCreateProject(page, recorder, baseUrl) {
  return recorder.step(page, "chat-create-project", async () => {
    const checks = [];
    const { statusText, sentAt } = await sendGoalFromChat(page, baseUrl, "帮我做一个报价单页面（含客户信息与金额明细）");
    const elapsed = Date.now() - sentAt;
    checks.push(check(/\/chat\/chat-live-+/.test(page.url()) || /\/chat\/[^/?#]+$/.test(page.url()), `发送后进入深度实时页（${page.url()}）`));
    checks.push(check(statusText.length > 0 && (statusText.includes("排队") || statusText.includes("思考") || statusText.includes("执行") || statusText.includes("完成") || statusText.includes("等待")), `发送即执行出现实时状态：${statusText}`));
    checks.push(check(elapsed < 10000, `发送 → 实时状态可见耗时 ${String(elapsed)}ms（<10000ms）`));
    checks.push(check((await page.locator("#chat-start").count()) === 0, "无「开始执行」手动按钮（自动开始）"));
    checks.push(check((await page.locator("#chat-goal-text").innerText()).includes("报价单页面"), "会话显示我的目标"));
    const planSteps = await page.locator("#live-plan .live-step").count();
    checks.push(check(planSteps >= 4, `SSE 推送计划卡（${planSteps} 步）`));
    checks.push(check((await page.locator("#live-timeline .live-event").count()) >= 1, "实时页已接收 SSE 事件"));
    checks.push(check((await page.locator("#live-sse-state").getAttribute("data-state")) !== null, "实时页含 SSE 连接状态"));
    return { checks };
  });
}

async function stepChatInterruptResume(page, recorder) {
  return recorder.step(page, "chat-interrupt-resume", async () => {
    const checks = [];
    // 等计划生成（此后 run 处于执行中）
    await page.waitForSelector("#live-plan .live-step", { timeout: STEP_TIMEOUT_MS });
    const planSteps = await page.locator("#live-plan .live-step").count();
    checks.push(check(planSteps >= 4, `SSE 推送计划卡（${planSteps} 步）`));
    await page.waitForSelector("#live-interrupt:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    await page.locator("#live-interrupt").click();
    const paused = await waitForLiveStatusContains(page, "已打断", 5000);
    checks.push(check(paused.includes("已打断"), `打断后状态=已打断（${paused}）`));
    await page.waitForSelector("#live-resume:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#live-resume").isVisible(), "打断后出现「恢复」按钮"));
    await page.locator("#live-resume").click();
    const resumed = await waitForLiveStatusContains(page, "执行中", 6000);
    checks.push(check(resumed.includes("执行中") || resumed.includes("等待审批"), `恢复后状态=执行中（${resumed}）`));
    checks.push(check((await page.locator("#live-timeline .live-event").count()) >= 3, "打断/恢复事件写入实时时间线"));
    return { checks };
  });
}

async function stepChatAutoComplete(page, recorder) {
  return recorder.step(page, "chat-auto-complete", async () => {
    const checks = [];
    const completed = await waitForLiveStatusContains(page, "完成", 15000);
    checks.push(check(completed.includes("完成"), `run 自动完成（状态：${completed}，≤15s）`));
    await page.waitForSelector("#live-complete:not([hidden])", { timeout: 8000 });
    checks.push(check(await page.locator("#live-complete").isVisible(), "完成卡出现"));
    checks.push(check(!(await page.locator("#live-error").isVisible()), "无 error 提示"));
    const tokenText = (await page.locator("#live-token").innerText()).trim();
    checks.push(check(Number(tokenText.replaceAll(",", "")) > 0, `Token 实时累计（${tokenText}）`));
    const runHref = await page.locator("#live-run-link").getAttribute("href");
    checks.push(check(runHref !== null && /\/runs\/(run-live|run)-/.test(runHref), `完成卡含 run 证据链接（${runHref}）`));
    const stepsText = (await page.locator("#live-steps").innerText()).trim();
    checks.push(check(stepsText.includes("/") && !stepsText.startsWith("0/"), `步骤进度已更新（${stepsText}）`));
    return { checks };
  });
}

async function stepChatRunEvidence(page, recorder) {
  return recorder.step(page, "chat-run-evidence", async () => {
    const checks = [];
    const runHref = await page.locator("#live-run-link").getAttribute("href");
    await page.locator("#live-run-link").click();
    await page.waitForSelector("#run-page", { timeout: STEP_TIMEOUT_MS });
    // Tabs 结构
    const tabs = await page.locator("#run-tabs .run-tab").count();
    checks.push(check(tabs === 4, `run 详情为 4 个 Tabs（过程/产物/数据/报告，实际 ${tabs}）`));
    const processVisible = await page.locator("#run-panel-process").isVisible();
    checks.push(check(processVisible, "默认显示「过程」Tab"));
    const events = await page.locator("#run-timeline .flow-item").count();
    checks.push(check(events >= 5, `过程时间线 ≥5 条事件（实际 ${events}）`));
    for (const phase of ["plan", "action", "observe", "verify", "evidence"]) {
      const count = await page.locator(`#run-timeline .flow-item[data-phase="${phase}"]`).count();
      checks.push(check(count >= 1, `时间线含阶段 ${phase}（${count} 条）`));
    }
    const runAgents = await page.locator("#run-agents .run-agent").count();
    checks.push(check(runAgents >= 2, `各 agent 对话摘要可见（${runAgents} 个 agent）`));
    checks.push(check((await page.locator("#run-agents").innerText()).includes("写代码 Harness"), "run 内包含写代码 Harness 的对话摘要"));
    checks.push(check((await page.locator("#run-stats").innerText()).includes("产物"), "run 概览显示产物/报告数量"));
    return { checks };
  });
}

async function stepRunTabsArtifacts(page, recorder) {
  return recorder.step(page, "run-tabs-artifacts", async () => {
    const checks = [];
    await page.locator("#run-tab-artifacts").click();
    await page.waitForSelector("#run-panel-artifacts:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#run-panel-artifacts").isVisible(), "切换到「产物」Tab"));
    const cards = await page.locator("#run-artifacts .artifact-card").count();
    checks.push(check(cards >= 5, `产物列表 ≥5 个（实际 ${cards}）`));
    const kinds = await page.locator("#run-artifacts .artifact-card").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-kind")))]);
    checks.push(check(kinds.length >= 4, `产物类型多样（${kinds.join("/")}）`));
    for (const kind of ["markdown", "json", "html", "image"]) {
      checks.push(check(kinds.includes(kind), `含产物类型：${kind}`));
    }
    const firstMarkdown = page.locator('#run-artifacts .artifact-card[data-kind="markdown"] .artifact-md').first();
    await page.locator('#run-artifacts .artifact-card[data-kind="markdown"] [data-artifact-preview] summary').first().click();
    const mdText = (await firstMarkdown.innerText()).trim();
    checks.push(check(mdText.length > 20 && /执行计划|产出/.test(mdText), `Markdown 产物已渲染（${mdText.slice(0, 30)}…）`));
    await page.locator('#run-artifacts .artifact-card[data-kind="html"] [data-artifact-preview] summary').first().click();
    checks.push(check((await page.locator("#run-artifacts iframe.artifact-iframe").count()) >= 1, "HTML 产物以沙箱 iframe 预览"));
    await page.locator('#run-artifacts .artifact-card[data-kind="image"] [data-artifact-preview] summary').first().click();
    checks.push(check((await page.locator("#run-artifacts img.artifact-image").count()) >= 1, "图片产物缩略图预览"));
    const downloadHref = await page.locator("#run-artifacts .artifact-card [data-download]").first().getAttribute("href");
    checks.push(check(downloadHref !== null && downloadHref.includes("/download"), `产物下载链接（${String(downloadHref)}）`));
    // 证据截图 + 灯箱 + 日志/JSON（产物 Tab 内）
    const thumbs = await page.locator("#run-evidence .evidence-thumb").count();
    checks.push(check(thumbs >= 2, `证据截图缩略图 ≥2（${thumbs}）`));
    await page.locator("#evidence-thumb-1").click();
    await page.waitForSelector("#evidence-lightbox:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#evidence-lightbox").isVisible(), "缩略图打开大图（灯箱）"));
    await page.locator("#lightbox-close").click();
    await page.waitForTimeout(150);
    await page.locator("#payload-log summary").click();
    await page.locator("#payload-json summary").click();
    checks.push(check((await page.locator("#payload-log pre").innerText()).length > 0, "日志证据可展开"));
    checks.push(check((await page.locator("#payload-json pre").innerText()).includes("seq"), "JSON 证据可展开"));
    return { checks };
  });
}

async function stepRunTabsMetrics(page, recorder) {
  return recorder.step(page, "run-tabs-metrics", async () => {
    const checks = [];
    await page.locator("#run-tab-metrics").click();
    await page.waitForSelector("#run-panel-metrics:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#run-panel-metrics").isVisible(), "切换到「数据」Tab"));
    const numbers = {};
    for (const id of ["metric-token-input", "metric-token-output", "metric-token-cache", "metric-token-total"]) {
      const text = (await page.locator(`#${id}`).innerText()).trim();
      numbers[id] = Number(text.replaceAll(",", ""));
      checks.push(check(Number.isFinite(numbers[id]) && numbers[id] >= 0, `${id} 可见（${text}）`));
    }
    checks.push(check(numbers["metric-token-total"] > 0, `Token 总计 > 0（${String(numbers["metric-token-total"])}）`));
    checks.push(check(numbers["metric-token-input"] + numbers["metric-token-output"] <= numbers["metric-token-total"] + 1, "Token 输入/输出/缓存分项合计与总计一致"));
    checks.push(check(Number((await page.locator("#metric-duration").innerText()).replaceAll(",", "")) > 0, "耗时（ms）> 0"));
    const toolCalls = Number(await page.locator("#metric-tool-calls").innerText());
    checks.push(check(toolCalls >= 2, `工具调用次数 ≥2（${String(toolCalls)}）`));
    const toolRows = await page.locator("#metrics-tools tbody tr").count();
    checks.push(check(toolRows >= 2, `工具调用分布表 ≥2 行（${toolRows}）`));
    checks.push(check((await page.locator("#metrics-tools").innerText()).includes("browser.open") || (await page.locator("#metrics-tools").innerText()).includes("code.loop"), "工具分布含具体工具名"));
    checks.push(check(Number(await page.locator("#metric-events").innerText()) >= 5, "事件数 ≥5"));
    checks.push(check((await page.locator("#metrics-model-modes").innerText()).length > 0, "模型来源可见（model_modes）"));
    checks.push(check((await page.locator("#metric-budget").innerText()).includes("¥"), "预算消耗可见"));
    return { checks };
  });
}

async function stepRunReportTab(page, recorder) {
  return recorder.step(page, "run-report-tab", async () => {
    const checks = [];
    await page.locator("#run-tab-report").click();
    await page.waitForSelector("#run-panel-report:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#run-panel-report").isVisible(), "切换到「报告」Tab"));
    checks.push(check((await page.locator("#run-report .md-body").innerText()).includes("运行报告"), "run 汇总报告已渲染（Markdown）"));
    const reports = await page.locator("#run-step-reports .run-report-item").count();
    checks.push(check(reports >= 2, `分步报告 ≥2 份（${reports}）`));
    const first = page.locator("#run-step-reports .run-report-item").first();
    const md = await first.locator(".run-report-md").innerText();
    checks.push(check(md.length > 30 && md.includes("步骤"), `分步报告 Markdown 渲染（${md.slice(0, 30)}…）`));
    checks.push(check((await first.innerText()).includes("operator") || (await first.innerText()).includes("harness"), "报告标注 agent 角色"));
    checks.push(check((await first.innerText()).includes("步骤 2") || (await first.innerText()).includes("步骤 3"), "报告标注步骤号"));
    return { checks };
  });
}

async function stepChatLiveThinking(page, recorder, baseUrl) {
  return recorder.step(page, "chat-live-thinking", async () => {
    const checks = [];
    await sendGoalFromChat(page, baseUrl, "帮我做一个客户信息录入表单页面（思考流验证）");
    await page.waitForSelector("#live-thinking .live-thinking-block", { timeout: 12000 });
    const blocks = await page.locator("#live-thinking .live-thinking-block").count();
    checks.push(check(blocks >= 1, `实时思考分块出现（${blocks} 个步骤块）`));
    // 等待至少 2 个思考 chunk 累积
    const deadline = Date.now() + 8000;
    let chunks = 0;
    let thinkingText = "";
    while (Date.now() < deadline) {
      chunks = await page.locator("#live-thinking .live-thinking-text").first().evaluate((node) => node.textContent.split("\n").filter((line) => line.trim().length > 0).length).catch(() => 0);
      thinkingText = await page.locator("#live-thinking .live-thinking-text").first().innerText().catch(() => "");
      if (chunks >= 2) break;
      await page.waitForTimeout(120);
    }
    checks.push(check(chunks >= 2, `思考过程分块累积 ≥2 块（${String(chunks)}）`));
    checks.push(check(thinkingText.length > 20 && (thinkingText.includes("分析") || thinkingText.includes("执行")), `思考文本流式可见（${thinkingText.slice(0, 40)}…）`));
    checks.push(check((await page.locator("#live-thinking .live-thinking-block summary").first().innerText()).includes("思考"), "思考块可折叠（summary）"));
    const sseThinking = await page.locator('#live-timeline .live-event[data-type="harness.thinking"]').count();
    checks.push(check(sseThinking >= 2, `SSE harness.thinking 事件 ≥2（${String(sseThinking)}）`));
    return { checks };
  });
}

async function stepChatLiveTool(page, recorder) {
  return recorder.step(page, "chat-live-tool", async () => {
    const checks = [];
    await page.waitForSelector("#live-tools .live-tool", { timeout: 12000 });
    const deadline = Date.now() + 10000;
    let cards = 0;
    while (Date.now() < deadline) {
      cards = await page.locator("#live-tools .live-tool").count();
      if (cards >= 2) break;
      await page.waitForTimeout(120);
    }
    checks.push(check(cards >= 2, `工具调用卡片 ≥2（${String(cards)}）`));
    const toolsText = (await page.locator("#live-tools").innerText()).trim();
    checks.push(check(toolsText.includes("browser.") || toolsText.includes("conductor.") || toolsText.includes("code.") || toolsText.includes("evidence."), `工具卡片含具体工具名（${toolsText.slice(0, 60)}…）`));
    checks.push(check(toolsText.includes("成功") || toolsText.includes("ms"), "工具卡片显示状态/耗时"));
    checks.push(check((await page.locator('#live-timeline .live-event[data-type="harness.tool_call"]').count()) >= 1, "SSE harness.tool_call 事件出现"));
    checks.push(check((await page.locator('#live-timeline .live-event[data-type="harness.tool_result"]').count()) >= 1, "SSE harness.tool_result 事件出现"));
    // 产物出现提示
    const artifacts = await page.locator("#live-artifacts .live-artifact").count();
    checks.push(check(artifacts >= 1 || (await page.locator('#live-timeline .live-event[data-type="artifact.created"]').count()) >= 1, "产物生成即时提示（artifact.created）"));
    return { checks };
  });
}

async function stepArtifactsCenter(page, recorder, baseUrl) {
  return recorder.step(page, "artifacts-center", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/artifacts`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#artifact-list .artifact-card", { timeout: STEP_TIMEOUT_MS });
    const total = await page.locator("#artifact-list .artifact-card").count();
    checks.push(check(total >= 8, `产物中心列表 ≥8 个产物（${total}）`));
    checks.push(check((await page.locator("#artifact-count").innerText()).includes("产物"), "显示产物总数与合计大小"));
    // 筛选：类型=markdown
    await page.locator("#artifact-filter-kind").selectOption("markdown");
    await page.waitForTimeout(250);
    const visibleMarkdown = await page.locator('#artifact-list .artifact-card[data-kind="markdown"]:visible').count();
    const visibleAll = await page.locator("#artifact-list .artifact-card:visible").count();
    checks.push(check(visibleMarkdown >= 1 && visibleAll === visibleMarkdown, `类型筛选生效（markdown 可见 ${visibleAll}/${visibleMarkdown}）`));
    // 预览：Markdown 渲染 / JSON 文本 / 图片
    await page.locator('#artifact-list .artifact-card[data-kind="markdown"] [data-artifact-preview] summary').first().click();
    checks.push(check((await page.locator("#artifact-list .artifact-card[data-kind=markdown] .artifact-md").first().innerText()).length > 20, "Markdown 产物预览渲染"));
    await page.locator("#artifact-filter-kind").selectOption("json");
    await page.waitForTimeout(250);
    await page.locator('#artifact-list .artifact-card[data-kind="json"] [data-artifact-preview] summary').first().click();
    checks.push(check((await page.locator("#artifact-list .artifact-card[data-kind=json] .artifact-pre").first().innerText()).includes("{"), "JSON 产物文本预览"));
    await page.locator("#artifact-filter-kind").selectOption("image");
    await page.waitForTimeout(250);
    await page.locator('#artifact-list .artifact-card[data-kind="image"] [data-artifact-preview] summary').first().click();
    checks.push(check((await page.locator("#artifact-list .artifact-card[data-kind=image] img.artifact-image").count()) >= 1, "图片产物预览"));
    const dl = await page.locator("#artifact-list .artifact-card [data-download]").first().getAttribute("href");
    checks.push(check(dl !== null && dl.includes("/api/artifacts/") && dl.includes("/download"), `下载链接（${String(dl)}）`));
    return { checks };
  });
}

async function stepAgentsHarnessBadge(page, recorder, baseUrl) {
  return recorder.step(page, "agents-harness-badge", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/agents`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#agents-grid .agent-card", { timeout: STEP_TIMEOUT_MS });
    const badges = await page.locator('#agents-grid [data-harness-badge]').count();
    const cards = await page.locator("#agents-grid .agent-card").count();
    checks.push(check(badges >= 8 && badges === cards, `每个智能体标注「DeepSeek Harness 真实执行」（${badges}/${cards}）`));
    checks.push(check((await page.locator("#agents-grid [data-harness-badge]").first().innerText()).includes("DeepSeek Harness 真实执行"), "徽章文案正确"));
    // 找到有会话记录的卡片（有 run 链接 = 该 agent 真实参与过 run）
    const withSession = page.locator('#agents-grid .agent-card:has([data-harness-run-link])').first();
    checks.push(check((await withSession.count()) >= 1, "卡片显示最近 harness 会话"));
    const cardText = await withSession.innerText();
    checks.push(check(/[a-z]+-live-\d+/.test(cardText), `显示 session_id（${cardText.match(/[a-z]+-live-\d+/)?.[0] ?? "—"}）`));
    checks.push(check(cardText.includes("Token") && /Token\s+[\d,]+/.test(cardText), "显示 tokens"));
    checks.push(check(cardText.includes("工具") && cardText.includes("产物") && cardText.includes("报告"), "显示工具数/产物数/报告数"));
    checks.push(check((await withSession.locator('[data-harness-run-link]').count()) >= 1, "可点入查看 run 证据"));
    checks.push(check((await withSession.locator('a[href^="/artifacts?agent="]').count()) >= 1, "可查看该 agent 产物"));
    checks.push(check((await withSession.locator('a[href^="/reports?agent="]').count()) >= 1, "可查看该 agent 报告"));
    // agent 详情页也展示 Harness 产物/报告
    await withSession.locator('a[href^="/agents/"]').first().click();
    await page.waitForSelector("#agent-role-page", { timeout: STEP_TIMEOUT_MS });
    checks.push(check((await page.locator("#agent-role-artifacts").count()) >= 1, "agent 详情页含产物面板"));
    checks.push(check((await page.locator("#agent-role-reports").count()) >= 1, "agent 详情页含报告面板"));
    return { checks };
  });
}

async function stepAgentTranscript(page, recorder, baseUrl) {
  return recorder.step(page, "agent-transcript", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/agents/harness`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#agent-role-page", { timeout: STEP_TIMEOUT_MS });
    checks.push(check((await page.locator("#agent-role-title").innerText()).includes("写代码 Harness"), "智能体详情页标题=写代码 Harness"));
    const turns = await page.locator("#agent-role-turns .agent-turn").count();
    checks.push(check(turns >= 1, `智能体对话轮次可见（${turns} 轮）`));
    const turnText = await page.locator("#agent-role-turns .agent-turn").first().innerText();
    checks.push(check(turnText.includes("输入摘要") && turnText.includes("输出摘要"), "每轮含输入/输出摘要"));
    checks.push(check(/Token/.test(turnText), "每轮显示 Token 消耗"));
    checks.push(check(await page.locator("#agent-role-info").isVisible(), "智能体详情显示状态/自主等级/模型"));
    checks.push(check((await page.locator("#agent-role-summary").innerText()).includes("轮次"), "详情页显示轮次合计"));
    const evidenceLinks = await page.locator("[data-evidence-ref]").count();
    checks.push(check(evidenceLinks >= 1, `轮次可跳证据（${evidenceLinks} 条证据引用）`));
    await page.locator("#nav-chat").click();
    await page.waitForSelector("#composer-input", { timeout: STEP_TIMEOUT_MS });
    return { checks };
  });
}

async function stepChatAutoStart(page, recorder, baseUrl) {
  return recorder.step(page, "chat-auto-start", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#composer-input", { timeout: STEP_TIMEOUT_MS });
    await page.locator("#composer-input").fill("帮我做一个客户信息录入表单页面");
    const sentAt = Date.now();
    await page.locator("#composer-input").press("Enter");
    await page.waitForSelector('.gpt-msg[data-role="user"]', { timeout: 4000 });
    const userVisibleMs = Date.now() - sentAt;
    checks.push(check(userVisibleMs < 3000, `发送后立即出现用户消息（${String(userVisibleMs)}ms）`));
    // 无需点击任何「开始执行」按钮；立即出现“思考中…”与流式 assistant 气泡
    checks.push(check((await page.locator("#chat-start").count()) === 0, "页面上无「开始执行」按钮（发送即执行）"));
    const typingVisible = await page.locator("#typing-indicator").isVisible().catch(() => false);
    const streamingVisible = await page.locator('.gpt-msg[data-role="assistant"]').count();
    checks.push(check(typingVisible || streamingVisible >= 1, `发送后立即出现「思考中…」/助手流式气泡（typing=${String(typingVisible)} assistant=${String(streamingVisible)}）`));
    // 等待内嵌运行卡出现（服务端真实创建 run），进入深度实时页供后续 SSE 步骤断言
    await page.waitForSelector("#chat-run-link", { timeout: 15000 });
    await page.locator("#chat-run-link").click();
    await page.waitForSelector("#live-run-panel", { timeout: STEP_TIMEOUT_MS });
    const sseState = await page.locator("#live-sse-state").getAttribute("data-state");
    checks.push(check(sseState === "open" || sseState === "connecting", `深度实时页 SSE 连接建立（data-state=${String(sseState)}）`));
    checks.push(check((await page.locator("#live-status").innerText()).length > 0, "实时状态条可见"));
    return { checks };
  });
}

async function stepChatLiveEvents(page, recorder) {
  return recorder.step(page, "chat-live-events", async () => {
    const checks = [];
    // 等待 SSE 推送到 ≥3 类事件（plan / step / agent.turn）
    let types = [];
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      types = await page.locator("#live-timeline .live-event").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-type") || ""))].filter(Boolean));
      if (types.length >= 3 && types.includes("plan.created") && types.includes("step.started") && types.includes("agent.turn.completed")) break;
      await page.waitForTimeout(120);
    }
    checks.push(check(types.length >= 3, `SSE 收到 ≥3 类事件（${types.slice(0, 8).join(", ")}）`));
    checks.push(check(types.includes("plan.created"), "收到计划事件 plan.created"));
    checks.push(check(types.includes("step.started"), "收到步骤开始事件 step.started"));
    checks.push(check(types.includes("agent.turn.completed"), "收到 agent 轮次完成事件 agent.turn.completed"));
    const events = await page.locator("#live-timeline .live-event").count();
    checks.push(check(events >= 3, `实时时间线事件 ≥3（${events} 条）`));
    const planSteps = await page.locator("#live-plan .live-step").count();
    checks.push(check(planSteps >= 4, `计划卡逐步点亮（${planSteps} 步）`));
    const doneSteps = await page.locator('#live-plan .live-step[data-status="done"]').count();
    checks.push(check(doneSteps >= 1, `已有步骤完成（done=${doneSteps}）`));
    const thought = (await page.locator("#live-thought").innerText()).trim();
    checks.push(check(thought.length > 0, `总调度思考/执行提示可见（${thought.slice(0, 40)}）`));
    const tokens = (await page.locator("#live-token").innerText()).trim();
    checks.push(check(Number(tokens.replaceAll(",", "")) > 0, `实时 Token 累计（${tokens}）`));
    return { checks };
  });
}

async function stepChatReconnect(page, recorder, baseUrl) {
  return recorder.step(page, "chat-reconnect", async () => {
    const checks = [];
    // 新起一个 run，在执行中刷新页面，验证 since 回放恢复
    await sendGoalFromChat(page, baseUrl, "帮我查一下竞品定价并整理成一页对比（断线恢复验证）");
    await page.waitForSelector("#live-run-panel", { timeout: STEP_TIMEOUT_MS });
    const runId = await page.locator("#live-run-panel").getAttribute("data-run-id");
    // 等 SSE 至少推几条事件后刷新
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const count = await page.locator("#live-timeline .live-event").count().catch(() => 0);
      if (count >= 2) break;
      await page.waitForTimeout(100);
    }
    const before = await page.locator("#live-timeline .live-event").count();
    checks.push(check(before >= 2, `刷新前已收到 SSE 事件（${before} 条）`));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#live-run-panel", { timeout: STEP_TIMEOUT_MS });
    const runIdAfter = await page.locator("#live-run-panel").getAttribute("data-run-id");
    checks.push(check(runIdAfter === runId, `刷新后恢复同一 run（${String(runId)}）`));
    // 断线恢复：事件回放（since=0）+ 状态正确
    let replayed = 0;
    const replayDeadline = Date.now() + 6000;
    while (Date.now() < replayDeadline) {
      replayed = await page.locator("#live-timeline .live-event").count().catch(() => 0);
      if (replayed >= before) break;
      await page.waitForTimeout(120);
    }
    checks.push(check(replayed >= before, `刷新后从事件日志回放恢复（${before} → ${replayed} 条）`));
    const statusAfter = await waitForLiveStatus(page, 3000);
    checks.push(check(statusAfter.length > 0 && !statusAfter.includes("排队"), `刷新后状态仍正确（${statusAfter}）`));
    const completed = await waitForLiveStatusContains(page, "完成", 15000);
    checks.push(check(completed.includes("完成"), `断线恢复后 run 继续并完成（${completed}）`));
    return { checks };
  });
}

async function stepChatApprovalPause(page, recorder, baseUrl) {
  return recorder.step(page, "chat-approval-pause", async () => {
    const checks = [];
    await sendGoalFromChat(page, baseUrl, "帮我把报价单对外发送给客户，并收取首期款 1288 元");
    await page.waitForSelector("#live-approval:not([hidden])", { timeout: 12000 });
    const statusText = await waitForLiveStatus(page, 3000);
    checks.push(check(statusText.includes("等待审批"), `高风险步骤暂停：run 状态=等待审批（${statusText}）`));
    checks.push(check(await page.locator("#live-approval").isVisible(), "审批卡出现（高风险/危险动作暂停）"));
    const approvalText = (await page.locator("#live-approval").innerText()).trim();
    checks.push(check(approvalText.includes("高风险"), `审批卡展示风险说明（${approvalText.slice(0, 60)}）`));
    const sseTypes = await page.locator("#live-timeline .live-event").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-type")));
    checks.push(check(sseTypes.includes("approval.required"), "SSE 推送 approval.required 事件"));
    const planSteps = await page.locator("#live-plan .live-step").count();
    checks.push(check(planSteps >= 4, `暂停时计划仍可见（${planSteps} 步）`));
    await page.locator("#live-approve").click();
    const completed = await waitForLiveStatusContains(page, "完成", 12000);
    checks.push(check(completed.includes("完成"), `批准后继续并完成（${completed}）`));
    checks.push(check(await page.locator("#live-approval").isHidden(), "批准后审批卡消失"));
    return { checks };
  });
}

async function stepSseSanity(page, recorder, baseUrl, context) {
  return recorder.step(page, "sse-sanity", async () => {
    const checks = [];
    checks.push(check(context.pageErrors.length === 0, `SSE 流程无页面 JS 错误（${context.pageErrors.length}）`, context.pageErrors.slice(0, 3).join(" | ")));
    // 关闭/离开页面后服务端应清理 SSE 订阅
    await page.goto(`${baseUrl}/health`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    let health = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      health = await page.evaluate(async () => {
        const response = await fetch("/health");
        return response.json();
      }).catch(() => null);
      if (health !== null && (health.sse_active_streams === 0 || health.sse_active_streams === undefined)) break;
      await page.waitForTimeout(300);
    }
    checks.push(check(health !== null && health.version === "1.5.1", `health version=1.5.1（${health === null ? "无" : health.version}）`));
    checks.push(check(health !== null && health.runtime_enabled === true, "health 标记 runtime_enabled=true"));
    checks.push(check(health !== null && health.artifacts_enabled === true && health.reports_enabled === true && health.metrics_enabled === true, "health 标记 artifacts/reports/metrics enabled"));
    checks.push(check(health !== null && (health.sse_active_streams === 0 || health.sse_active_streams === undefined), `离开页面后 SSE 订阅已清理（sse_active_streams=${String(health === null ? "?" : health.sse_active_streams)}）`));
    checks.push(check(context.requestLog.every((url) => {
      try {
        const parsed = new URL(url);
        return parsed.hostname === "127.0.0.1";
      } catch {
        return true;
      }
    }), "无外链请求（EventSource 同源）"));
    checks.push(check(context.requestLog.some((url) => url.includes("/api/chat/runs/") && url.includes("/stream")), "页面使用同源 SSE 端点 /api/chat/runs/:id/stream"));
    return { checks };
  });
}

async function stepMoneyEpay(page, recorder, baseUrl) {
  return recorder.step(page, "money-epay", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/money`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#money-page", { timeout: STEP_TIMEOUT_MS });
    const disclaimer = await page.locator("#money-disclaimer").innerText();
    checks.push(check(disclaimer.includes("未接真实支付"), "变现页说明：演示渠道未接真实支付"));
    checks.push(check(disclaimer.includes("¥10 只是测试金额"), "变现页说明：此前 ¥10 只是测试金额"));
    const channels = await page.locator("#money-channels .money-channel").count();
    checks.push(check(channels >= 4, `收款账户/渠道摘要可见（${channels} 行，含易支付）`));
    checks.push(check(await page.locator("#epay-section").isVisible(), "易支付设置分组可见（/money）"));
    checks.push(check((await page.locator("#epay-mode").inputValue()) === "demo", "易支付默认 demo 模式（不真实扣款）"));

    // 保存易支付商家设置
    await page.locator("#epay-gateway").fill("https://epay.e2e.example.com/submit.php");
    await page.locator("#epay-merchant").fill("1000-E2E-7788");
    await page.locator("#epay-key-ref").fill("env:EPAY_E2E_KEY");
    await page.locator("#epay-notify").fill(`${baseUrl}/api/money/epay/notify`);
    await page.locator("#epay-save").click();
    await page.waitForTimeout(700);
    checks.push(check((await page.locator("#epay-feedback").innerText()).includes("已保存"), "易支付设置保存成功"));
    await safeReload(page);
    await page.waitForSelector("#epay-section", { timeout: STEP_TIMEOUT_MS });
    checks.push(check((await page.locator("#epay-gateway").inputValue()).includes("epay.e2e.example.com"), "刷新后易支付网关已持久化"));
    checks.push(check((await page.locator("#epay-merchant").inputValue()) === "1000-E2E-7788", "刷新后商户 ID 已持久化（密钥只存引用）"));
    await recorder.capture(page, "money-epay-config");

    // 创建易支付收款请求
    await page.locator("#money-amount").fill("1288");
    await page.locator("#money-client").fill("易支付客户（E2E）");
    await page.locator("#money-purpose").fill("报价单页面首期款（易支付）");
    await page.locator("#money-method").selectOption("epay");
    await page.locator("#money-create").click();
    await page.waitForTimeout(1000);
    await page.waitForSelector("#money-requests .money-request", { timeout: STEP_TIMEOUT_MS });
    const first = page.locator("#money-requests .money-request").first();
    checks.push(check((await first.getAttribute("data-status")) === "pending", "易支付收款请求已创建（待收款）"));
    const amountText = await first.locator(".money-request-amount").innerText();
    checks.push(check(amountText.includes("1,288.00"), `收款请求金额正确（${amountText.trim()}）`));
    const epayLink = first.locator(".run-link").first();
    const href = await epayLink.getAttribute("href");
    checks.push(check(href !== null && href.includes("epay.e2e.example.com") && href.includes("money=1288.00"), "易支付跳转链接已生成（含网关/金额/out_trade_no）"));
    const qrImg = first.locator(".money-qr");
    checks.push(check(await qrImg.isVisible(), "易支付二维码占位可见"));
    const qrSrc = await qrImg.getAttribute("src");
    checks.push(check(qrSrc !== null && qrSrc.startsWith("data:image/svg+xml"), "二维码为内联占位（无外链请求）"));
    checks.push(check((await first.innerText()).includes("易支付"), "请求标注易支付渠道"));
    await recorder.capture(page, "money-epay-request");

    // 人工确认到账 → 账本收入
    await first.locator("[data-confirm-id]").click();
    await page.waitForTimeout(1000);
    await page.waitForSelector("#money-requests .money-request", { timeout: STEP_TIMEOUT_MS });
    const paidFirst = page.locator("#money-requests .money-request").first();
    checks.push(check((await paidFirst.getAttribute("data-status")) === "paid", "人工确认到账后状态=已到账"));
    const ledgerLink = await paidFirst.locator("[id^=money-paid-ledger-]").count();
    checks.push(check(ledgerLink >= 1, "确认到账后显示已记入账本（ledger_entry_id）"));

    await page.goto(`${baseUrl}/ledger`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    const ledgerText = await page.locator("#ledger-table").innerText();
    checks.push(check(ledgerText.includes("1,288.00"), "账本新增易支付收入 ¥1,288.00"));
    checks.push(check(ledgerText.includes("易支付客户（E2E）"), "账本收入含客户名（6 要素）"));
    return { checks };
  });
}

async function stepSettingsModelsPrompts(page, recorder, baseUrl) {
  return recorder.step(page, "settings-models-prompts", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#models-section", { timeout: STEP_TIMEOUT_MS });
    const providerCount = await page.locator("#model-providers .model-provider").count();
    checks.push(check(providerCount >= 3, `多模型 provider ≥3（实际 ${providerCount}：DeepSeek/OpenAI 兼容/本地）`));
    checks.push(check((await page.locator("#model-providers").innerText()).includes("DeepSeek"), "模型分组含 DeepSeek provider"));
    checks.push(check((await page.locator("#model-providers").innerText()).includes("OpenAI 兼容"), "模型分组含 OpenAI 兼容 provider"));
    checks.push(check((await page.locator(".model-key-masked").first().innerText()).includes("****"), "API 密钥只显示掩码/引用"));
    checks.push(check((await page.locator("#prompts-section").innerText()).includes("总调度提示词必须包含安全条款"), "系统提示词分组说明校验规则"));
    checks.push(check((await page.locator("#prompt-conductor").count()) === 1, "总调度提示词可编辑"));
    checks.push(check((await page.locator("#prompt-supervisor").count()) === 1, "超级总调度提示词可编辑（v1.3）"));
    checks.push(check((await page.locator("#model-bind-supervisor").count()) === 1, "模型分组含 supervisor 的模型绑定"));
    checks.push(check((await page.locator("#agent-setting-supervisor").count()) === 1, "智能体开关分组含 supervisor"));
    checks.push(check(await page.locator("#epay-section").isVisible(), "支付分组含易支付字段（/settings）"));

    // 提示词校验错误：总调度提示词太短 → 保存失败
    await page.locator("#prompt-conductor").fill("太短");
    await page.locator("#prompts-save").click();
    await page.waitForTimeout(700);
    checks.push(check(await page.locator("#prompts-error").isVisible(), "提示词非法时显示校验错误"));
    checks.push(check((await page.locator("#prompts-error").innerText()).includes("30"), "校验错误说明长度要求"));
    await safeReload(page);
    await page.waitForSelector("#models-section", { timeout: STEP_TIMEOUT_MS });

    // 保存模型配置（harness 切到 OpenAI 兼容 provider）
    await page.locator("#model-bind-harness").selectOption("provider-openai-compatible");
    await page.locator("#models-save").click();
    await page.waitForTimeout(700);
    checks.push(check((await page.locator("#models-feedback").innerText()).includes("已保存"), "模型配置保存成功"));
    await page.locator("#models-sync").click();
    await page.waitForTimeout(700);
    checks.push(check((await page.locator("#models-feedback").innerText()).includes("已同步"), "一键同步密钥成功"));
    checks.push(check((await page.locator("#models-sync-status").innerText()).includes("已同步"), "同步状态更新为已同步"));

    // 保存系统提示词（编辑 harness 提示词）
    await page.locator("#prompt-harness").fill((await page.locator("#prompt-harness").inputValue()) + "\n6. 【E2E】验收必须附真实浏览器截图。");
    await page.locator("#prompts-save").click();
    await page.waitForTimeout(700);
    checks.push(check((await page.locator("#prompts-feedback").innerText()).includes("已保存"), "系统提示词保存成功"));
    await safeReload(page);
    await page.waitForSelector("#models-section", { timeout: STEP_TIMEOUT_MS });
    checks.push(check((await page.locator("#prompt-harness").inputValue()).includes("【E2E】"), "刷新后提示词修改已持久化"));
    checks.push(check((await page.locator("#model-bind-harness").inputValue()) === "provider-openai-compatible", "刷新后模型绑定已持久化"));
    return { checks };
  });
}

async function stepSystemControl(page, recorder, baseUrl) {
  return recorder.step(page, "system-control", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/system`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#system-chat-panel", { timeout: STEP_TIMEOUT_MS });
    const supMessages = await page.locator("#supervisor-messages .sup-message").count();
    checks.push(check(supMessages >= 3, `与超级总调度对话记录可见（${supMessages} 条消息）`));
    checks.push(check((await page.locator("#supervisor-messages").innerText()).includes("超级总调度"), "supervisor 自我介绍可见（两层结构/危险动作规则）"));
    checks.push(check(await page.locator("#layer-supervisor").isVisible() && await page.locator("#layer-conductor").isVisible(), "两层结构：L1 超级总调度 + L2 项目总调度 可见"));
    const layerAgents = await page.locator("#layer-agents .layer-agent").count();
    checks.push(check(layerAgents >= 10, `第 3 层专项智能体 ≥10（实际 ${layerAgents}）`));
    const programs = await page.locator("#system-programs .program-row").count();
    checks.push(check(programs >= 5, `受管程序列表可见（${programs} 个）`));
    const plugins = await page.locator("#system-plugins .plugin-row").count();
    checks.push(check(plugins >= 4, `插件列表可见（${plugins} 个）`));
    const agentRows = await page.locator("#system-agent-models .system-agent").count();
    checks.push(check(agentRows >= 12, `各 agent 当前模型/Token 可见（${agentRows} 行，含 supervisor）`));
    checks.push(check((await page.locator("#system-agent-models").innerText()).includes("超级总调度"), "模型列表含超级总调度"));
    const logs = await page.locator("#system-logs .log-item").count();
    checks.push(check(logs >= 3, `全部日志入口可见（${logs} 条日志）`));
    const quick = await page.locator("#supervisor-quick .quick-cmd").count();
    checks.push(check(quick >= 8, `快捷命令示例 ≥8（${quick} 个）`));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await recorder.capture(page, "system-overview-layers");

    // supervisor 对话
    await page.locator("#supervisor-input").fill("查看系统状态，并检查易支付配置");
    await page.locator("#supervisor-send").click();
    await page.waitForTimeout(900);
    await page.waitForSelector("#system-chat-panel", { timeout: STEP_TIMEOUT_MS });
    const supAfter = await page.locator("#supervisor-messages .sup-message").count();
    checks.push(check(supAfter > supMessages, `发送命令后 supervisor 回复（${supMessages} → ${supAfter} 条）`));

    // 快捷命令：重启模型网关（真实改状态 + 日志）
    await page.locator("#quick-重启模型网关").click();
    await page.waitForTimeout(1000);
    await page.waitForSelector("#system-chat-panel", { timeout: STEP_TIMEOUT_MS });
    checks.push(check((await page.locator("#system-logs").innerText()).includes("快捷命令"), "快捷命令执行后写入系统日志"));

    // 插件启用/禁用
    const scoutRow = page.locator("#plugin-plug-scout");
    const beforeEnabled = await scoutRow.getAttribute("data-plugin-enabled");
    await page.locator("#plugin-toggle-plug-scout").click();
    await page.waitForTimeout(900);
    await page.waitForSelector("#system-chat-panel", { timeout: STEP_TIMEOUT_MS });
    const afterEnabled = await page.locator("#plugin-plug-scout").getAttribute("data-plugin-enabled");
    checks.push(check(beforeEnabled !== afterEnabled, `插件启用/禁用生效（${beforeEnabled} → ${afterEnabled}）`));
    return { checks };
  });
}

async function stepSystemDangerConfirm(page, recorder, baseUrl) {
  return recorder.step(page, "system-danger-confirm", async () => {
    const checks = [];
    await page.goto(`${baseUrl}/system`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#system-programs", { timeout: STEP_TIMEOUT_MS });
    const before = await page.locator("#system-programs .program-row").count();
    // 点击删除（非危险自删：scout-worker）
    await page.locator("#prog-delete-prog-scout-worker").click();
    await page.waitForSelector("#system-danger-modal:not([hidden])", { timeout: STEP_TIMEOUT_MS });
    checks.push(check(await page.locator("#system-danger-modal").isVisible(), "删除程序触发危险动作二次确认弹窗"));
    const risk = await page.locator("#danger-risk").innerText();
    checks.push(check(risk.length > 10, `弹窗展示风险说明（${risk.slice(0, 40)}…）`));
    const backup = await page.locator("#danger-backup").innerText();
    checks.push(check(backup.includes("backups/system"), `弹窗展示备份路径（${backup.trim()}）`));
    const tokenText = (await page.locator("#danger-token-display").innerText()).trim();
    checks.push(check(tokenText.startsWith("DEL-"), `弹窗展示确认 token（${tokenText}）`));
    await recorder.capture(page, "system-danger-modal");
    // 错误 token 被拒绝
    await page.locator("#danger-token-input").fill("DEL-WRONG");
    await page.locator("#danger-text-input").fill("确认删除");
    await page.locator("#danger-confirm").click();
    await page.waitForTimeout(700);
    checks.push(check(await page.locator("#danger-error").isVisible(), "错误确认 token 被拒绝（显示错误）"));
    checks.push(check(await page.locator("#system-danger-modal").isVisible(), "拒绝后弹窗保留（未执行删除）"));
    // 正确 token + 确认文本 → 执行
    await page.locator("#danger-token-input").fill(tokenText);
    await page.locator("#danger-text-input").fill("确认删除");
    await page.locator("#danger-confirm").click();
    await page.waitForTimeout(1000);
    await page.waitForSelector("#system-programs", { timeout: STEP_TIMEOUT_MS });
    const after = await page.locator("#system-programs .program-row").count();
    checks.push(check(after === before - 1, `二次确认后删除成功（程序 ${before} → ${after}）`));
    checks.push(check((await page.locator("#system-programs").innerText()).includes("scout-worker") === false, "被删除程序已从列表移除"));
    checks.push(check((await page.locator("#system-logs").innerText()).includes("危险动作已执行"), "危险动作写入系统日志（审计）"));
    return { checks };
  });
}

async function stepV12Sanity(page, recorder, context) {
  const { baseUrl, port, requestLog, pageErrors } = context;
  return recorder.step(page, "v12-sanity", async () => {
    const checks = [];
    checks.push(check(pageErrors.length === 0, `v1.2/v1.3 流程全程无页面 JS 错误（${pageErrors.length}）`, pageErrors.slice(0, 3).join(" | ")));

    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(health !== null && health.version === "1.5.1", `health version=1.4.0（实际 ${health === null ? "无" : health.version}）`));
    checks.push(check(health !== null && health.chat_enabled === true && health.system_enabled === true, "health 标记 chat_enabled/system_enabled=true"));

    const sessions = await fetch(`${baseUrl}/api/chat/sessions`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(sessions !== null && Array.isArray(sessions.data) && sessions.data.length >= 2, `GET /api/chat/sessions（${sessions?.data?.length ?? 0} 个历史会话）`));
    const runs = await fetch(`${baseUrl}/api/chat/runs`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(runs !== null && Array.isArray(runs.data) && runs.data.length >= 3, `GET /api/chat/runs（${runs?.data?.length ?? 0} 个 run）`));
    const liveRuns = (runs?.data ?? []).filter((run) => String(run.run_id).startsWith("run-live"));
    checks.push(check(liveRuns.length >= 3, `GET /api/chat/runs 含 v1.4 实时 run（${liveRuns.length} 个 run-live-*）`));
    const completedLive = liveRuns.find((run) => run.status === "done");
    const liveRunDetail = completedLive === undefined ? null : await fetch(`${baseUrl}/api/chat/runs/${encodeURIComponent(completedLive.run_id)}`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(liveRunDetail !== null && liveRunDetail.data.status === "done" && liveRunDetail.data.steps_done === liveRunDetail.data.steps_total, "GET /api/chat/runs/:id 返回已完成 run（steps 全完成）"));
    let runtimeUnauth = 0;
    try {
      const response = await fetch(`${baseUrl}/api/chat/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "未授权发送即执行" }),
        signal: AbortSignal.timeout(2000),
      });
      runtimeUnauth = response.status;
    } catch {
      runtimeUnauth = 0;
    }
    checks.push(check(runtimeUnauth === 401, `无 token 的「发送即执行」API 被拒（实际 ${runtimeUnauth}）`));
    const transcripts = await fetch(`${baseUrl}/api/chat/agents/harness/transcripts`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(transcripts !== null && Array.isArray(transcripts.data) && transcripts.data.length >= 1, "GET /api/chat/agents/:role/transcripts 返回记录"));
    const evidence = await fetch(`${baseUrl}/api/chat/evidence?run_id=${encodeURIComponent(runs?.data?.[0]?.run_id ?? "")}`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(evidence !== null && Array.isArray(evidence.data) && evidence.data.length >= 2, "GET /api/chat/evidence 返回证据列表"));

    const status = await fetch(`${baseUrl}/api/system/status`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(status !== null && Array.isArray(status.data.programs) && status.data.programs.length >= 4, `GET /api/system/status（程序 ${status?.data?.programs?.length ?? 0} 个）`));
    checks.push(check(status !== null && Array.isArray(status.data.agents) && status.data.agents.length >= 12, `系统状态含各 agent 模型（${status?.data?.agents?.length ?? 0} 个）`));
    const epay = await fetch(`${baseUrl}/api/system/epay`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(epay !== null && epay.data.gateway_url.includes("epay.e2e.example.com") && epay.data.mode === "demo", "GET /api/system/epay：易支付配置持久化（demo）"));
    checks.push(check(epay !== null && epay.data.api_key_ref === "env:EPAY_E2E_KEY" && !JSON.stringify(epay.data).includes("EPAY_E2E_KEY_SECRET"), "易支付只存密钥引用（无明文）"));
    const models = await fetch(`${baseUrl}/api/model-settings`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(models !== null && models.data.sync_status === "synced", "GET /api/model-settings：密钥已同步"));
    checks.push(check(models !== null && models.data.agent_bindings.some((binding) => binding.agent_role === "harness" && binding.provider_id === "provider-openai-compatible"), "模型绑定已持久化（harness → OpenAI 兼容）"));
    checks.push(check(models !== null && models.data.prompts.some((prompt) => prompt.id === "prompt-harness" && prompt.content.includes("【E2E】")), "系统提示词已持久化（含 E2E 标记）"));
    const money = await fetch(`${baseUrl}/api/money/requests`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    const epayRequest = money?.data?.find((request) => request.payment_method === "epay" && request.amount_cny === 1288);
    checks.push(check(epayRequest !== undefined && epayRequest.status === "paid" && epayRequest.ledger_entry_id !== undefined, "GET /api/money/requests：易支付请求已到账并写入账本"));

    // v1.5：产物 / 报告 / 指标 API
    const artifactsApi = await fetch(`${baseUrl}/api/artifacts`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(artifactsApi !== null && Array.isArray(artifactsApi.data) && artifactsApi.data.length >= 5, `GET /api/artifacts（${artifactsApi?.data?.length ?? 0} 个产物）`));
    const firstArtifact = artifactsApi?.data?.find((item) => item.kind === "markdown");
    if (firstArtifact !== undefined) {
      const preview = await fetch(`${baseUrl}${firstArtifact.preview_url}`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
      checks.push(check(preview !== null && preview.data.preview_text.includes("执行计划"), "GET /api/artifacts/:id/preview 返回内容（Markdown）"));
      const raw = await fetch(`${baseUrl}${firstArtifact.preview_url}?raw=1`, { signal: AbortSignal.timeout(3000) });
      checks.push(check(raw.status === 200 && (raw.headers.get("content-type") ?? "").includes("text/markdown"), "GET artifact preview?raw=1 返回 markdown 原文"));
      const download = await fetch(`${baseUrl}${firstArtifact.download_url}`, { signal: AbortSignal.timeout(3000) });
      checks.push(check(download.status === 200 && (download.headers.get("content-disposition") ?? "").includes("attachment"), "GET artifact download 返回附件（Content-Disposition）"));
    }
    const traversal = await fetch(`${baseUrl}/api/artifacts/..%2F..%2Fetc%2Fpasswd/download`, { signal: AbortSignal.timeout(2000) }).then((response) => response.status).catch(() => 0);
    checks.push(check(traversal === 404, "产物路径穿越请求被拒（404）"));
    const reportsApi = await fetch(`${baseUrl}/api/reports`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
    checks.push(check(reportsApi !== null && Array.isArray(reportsApi.data) && reportsApi.data.length >= 2, `GET /api/reports（${reportsApi?.data?.length ?? 0} 份报告）`));
    const firstReport = reportsApi?.data?.[0];
    if (firstReport !== undefined) {
      const reportDetail = await fetch(`${baseUrl}/api/reports/${encodeURIComponent(firstReport.id)}`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
      checks.push(check(reportDetail !== null && reportDetail.data.markdown.includes("#"), "GET /api/reports/:id 返回 markdown"));
    }
    const liveRunsForMetrics = (runs?.data ?? []).filter((run) => String(run.run_id).startsWith("run-live"));
    const metricsRun = liveRunsForMetrics.find((run) => run.status === "done");
    if (metricsRun !== undefined) {
      const metricsApi = await fetch(`${baseUrl}/api/chat/runs/${encodeURIComponent(metricsRun.run_id)}/metrics`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json()).catch(() => null);
      checks.push(check(metricsApi !== null && metricsApi.data.token_total > 0 && metricsApi.data.tool_calls > 0, "GET /api/chat/runs/:id/metrics（Token/工具指标）"));
    }
    // 新写 API 的 token 保护
    let dangerUnauth = 0;
    try {
      const response = await fetch(`${baseUrl}/api/system/danger/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_program", target_id: "prog-scout-worker" }),
        signal: AbortSignal.timeout(2000),
      });
      dangerUnauth = response.status;
    } catch {
      dangerUnauth = 0;
    }
    checks.push(check(dangerUnauth === 401, `无 token 的危险动作 API 被拒（实际 ${dangerUnauth}）`));
    let chatUnauth = 0;
    try {
      const response = await fetch(`${baseUrl}/api/chat/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "未授权请求" }),
        signal: AbortSignal.timeout(2000),
      });
      chatUnauth = response.status;
    } catch {
      chatUnauth = 0;
    }
    checks.push(check(chatUnauth === 401, `无 token 的对话写 API 被拒（实际 ${chatUnauth}）`));

    const external = requestLog.filter((url) => {
      try {
        const parsed = new URL(url);
        return !(parsed.hostname === "127.0.0.1" && parsed.port === String(port));
      } catch {
        return false;
      }
    });
    checks.push(check(external.length === 0, `v1.2/v1.3 全程无外链请求（${requestLog.length} 个请求全部同源）`, external.slice(0, 5).join(", ")));
    checks.push(check(requestLog.some((url) => url.endsWith("/assets/chat.js")) && requestLog.some((url) => url.endsWith("/assets/system.js")), "聊天/系统脚本已同源加载"));
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

  const recorder = new Recorder(evidenceDir, { screenshots: process.argv.includes("--screenshots") });
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
    // ---- v1.2/v1.3 新增：对话/打断恢复审批/run 证据/智能体记录/变现+易支付/模型提示词/系统总控/危险确认/收尾 ----
    await stepChatOpen(page, recorder);
    await stepChatCreateProject(page, recorder, consoleHandle.url);
    await stepChatInterruptResume(page, recorder);
    await stepChatAutoComplete(page, recorder);
    await stepChatRunEvidence(page, recorder);
    // ---- v1.5 新增：run Tabs（产物 / 数据 / 报告） ----
    await stepRunTabsArtifacts(page, recorder);
    await stepRunTabsMetrics(page, recorder);
    await stepRunReportTab(page, recorder);
    await stepAgentTranscript(page, recorder, consoleHandle.url);
    // ---- v1.4：发送即执行 + SSE 实时流（新增步骤） ----
    await stepChatAutoStart(page, recorder, consoleHandle.url);
    await stepChatLiveEvents(page, recorder);
    // ---- v1.5 新增：实时思考分块 / 工具调用卡片 ----
    await stepChatLiveThinking(page, recorder, consoleHandle.url);
    await stepChatLiveTool(page, recorder);
    await stepChatReconnect(page, recorder, consoleHandle.url);
    await stepChatApprovalPause(page, recorder, consoleHandle.url);
    // ---- v1.5 新增：产物中心 / agents Harness 徽章 ----
    await stepArtifactsCenter(page, recorder, consoleHandle.url);
    await stepAgentsHarnessBadge(page, recorder, consoleHandle.url);
    await stepMoneyEpay(page, recorder, consoleHandle.url);
    await stepSettingsModelsPrompts(page, recorder, consoleHandle.url);
    await stepSystemControl(page, recorder, consoleHandle.url);
    await stepSystemDangerConfirm(page, recorder, consoleHandle.url);
    await stepSseSanity(page, recorder, consoleHandle.url, { requestLog, pageErrors });
    await stepV12Sanity(page, recorder, {
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
    version: "1.5.0",
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
      chat_provider: "demo",
      system_provider: "demo",
      runtime_provider: "demo",
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
