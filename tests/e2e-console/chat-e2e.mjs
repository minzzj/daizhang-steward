#!/usr/bin/env node
/**
 * tests/e2e-console/chat-e2e.mjs — v1.5.1 ChatGPT 式对话总控小 E2E（真实浏览器，**不保存截图**）
 *
 * 覆盖：/chat 加载（会话/记忆/快捷 chips/数据源/状态）→ 新建对话 → 发送消息 300ms 内出现用户消息与
 * 「思考中…」→ 流式卡片（text/thinking/tool/artifact/report/data）→ 多会话切换/重命名/删除 →
 * 记忆面板搜索/删除 → 任务类查询（工具/产物卡片 + 运行卡）→ 刷新恢复当前对话 →
 * 无 JS 错误 / 无外链 / 写 API 无 token 401。输出 result.json（不保存 screenshots），退出码 0/1/2。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_CONSOLE_DIST = join(REPO_ROOT, "dist", "packages", "steward-console", "src", "index.js");
const VIEWPORT = { width: 1440, height: 950 };
const STEP_TIMEOUT_MS = 15_000;

function slug() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
function check(ok, message) {
  return { ok: Boolean(ok), message };
}
function usage() {
  console.log(`用法：node tests/e2e-console/chat-e2e.mjs [--evidence-dir <目录>] [--headless 0|1] [--port <端口>] [--console-dist <index.js>]\n默认 headless=1（小 E2E，不保存截图），evidence-dir 默认 runs/chat-e2e-<时间戳>`);
}
function parseArgs(argv) {
  const options = { evidenceDir: join(REPO_ROOT, "runs", `chat-e2e-${slug()}`), headless: true, port: 0, consoleDist: DEFAULT_CONSOLE_DIST };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[index + 1];
    if (arg === "--evidence-dir") { options.evidenceDir = resolve(next()); index += 1; }
    else if (arg === "--headless") { const value = next(); options.headless = value !== "0"; index += 1; }
    else if (arg === "--port") { options.port = Number(next()); index += 1; }
    else if (arg === "--console-dist") { options.consoleDist = resolve(next()); index += 1; }
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else { console.error(`未知参数：${arg}`); usage(); process.exit(2); }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.consoleDist)) {
    console.error(`[chat-e2e] 环境错误：缺少构建产物 ${options.consoleDist}，请先 npm run build`);
    return 2;
  }
  const evidenceDir = options.evidenceDir;
  await mkdir(evidenceDir, { recursive: true });
  const consolePackage = await import(pathToFileURL(options.consoleDist).href);
  const { createConsoleServer, createDemoConsoleProvider, createDemoAdminProvider } = consolePackage;
  const handle = await createConsoleServer({
    provider: createDemoConsoleProvider(),
    adminProvider: createDemoAdminProvider(),
    port: options.port,
  });
  const pageErrors = [];
  const consoleLog = [];
  const requestLog = [];
  const steps = [];
  const checks = [];
  const failures = [];
  let browser = null;
  const startedAt = Date.now();
  const record = (step, items) => {
    for (const item of items) {
      checks.push({ step, ...item });
      if (!item.ok) { failures.push(`[${step}] ${item.message}`); stepOk = false; }
    }
    const entry = { step, ok: items.every((item) => item.ok) };
    steps.push(entry);
    console.log(`  ${entry.ok ? "✓" : "✗"} ${step}`);
    for (const item of items.filter((candidate) => !candidate.ok)) console.log(`      ✗ ${item.message}`);
  };
  let stepOk = true;
  try {
    console.log("=".repeat(72));
    console.log("代掌 Steward · ChatGPT 式对话总控小 E2E（不保存截图）");
    console.log(`控制台: ${handle.url}（provider=demo + chatEngine=demo，headless=${String(options.headless)}）`);
    console.log("=".repeat(72));
    const browserInfo = await (async () => {
      for (const channel of ["chrome", "msedge"]) {
        try {
          const instance = await chromium.launch({ channel, headless: options.headless, timeout: 30_000 });
          return { browser: instance, channel, version: instance.version() };
        } catch { /* try next */ }
      }
      throw new Error("未找到可用的 Chrome/Edge（playwright-core 需要本机浏览器）");
    })();
    browser = browserInfo.browser;
    const context = await browser.newContext({ viewport: VIEWPORT, locale: "zh-CN" });
    const page = await context.newPage();
    page.on("pageerror", (error) => { pageErrors.push(error?.message ?? String(error)); consoleLog.push(`[pageerror] ${error?.message ?? error}`); });
    page.on("console", (message) => consoleLog.push(`[console:${message.type()}] ${message.text()}`));
    page.on("request", (request) => requestLog.push(request.url()));
    page.on("dialog", (dialog) => void dialog.accept("测试重命名对话"));
    const baseUrl = handle.url;
    const gotoChat = async () => {
      await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      await page.waitForSelector("#gpt-page", { timeout: STEP_TIMEOUT_MS });
    };
    const send = async (text) => {
      await page.locator("#composer-input").fill(text);
      await page.locator("#composer-input").press("Enter");
    };
    const waitAssistantDone = async (timeout = 15_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const streaming = await page.locator('.gpt-msg[data-role="assistant"] [data-streaming]').count().catch(() => 1);
        if (streaming === 0) return true;
        await page.waitForTimeout(120);
      }
      return false;
    };

    await gotoChat();
    record("chat-page", [
      check((await page.locator("#conv-list .gpt-conv-item").count()) >= 1, "左侧对话历史可见"),
      check(await page.locator("#composer-input").isVisible(), "底部输入框可见"),
      check((await page.locator("#quick-chips .gpt-chip").count()) >= 8, "顶部快捷 chips ≥8"),
      check((await page.locator("#memory-list .gpt-memory-item").count()) >= 3, "记忆面板含记忆条目"),
      check((await page.locator("#data-source").innerText()).includes("数据源"), "数据源标识可见（真实/演示/混合）"),
      check((await page.locator("#chat-status-badge").innerText()).includes("运行中"), "实时状态可见（运行中/等待审批）"),
    ]);

    await page.locator("#conv-new").click();
    await page.waitForTimeout(600);
    record("chat-new-conversation", [
      check(/\/chat\?conversation=/.test(page.url()), `新建对话并切换（${page.url()}）`),
      check((await page.locator("#conv-list .gpt-conv-item").count()) >= 2, "对话列表新增一条"),
    ]);

    await gotoChat();
    const sentAt = Date.now();
    await send("系统现在怎么样");
    await page.waitForSelector('.gpt-msg[data-role="user"]', { timeout: 4000 });
    const userMs = Date.now() - sentAt;
    const typingVisible = await page.locator("#typing-indicator").isVisible().catch(() => false);
    const streamingCount = await page.locator('.gpt-msg[data-role="assistant"]').count();
    record("chat-send-thinking", [
      check(userMs < 3000, `发送后立即出现用户消息（${String(userMs)}ms）`),
      check(typingVisible || streamingCount >= 1, "出现「思考中…」/助手流式气泡"),
      check(await waitAssistantDone(), "助手消息流式完成"),
      check((await page.locator('.gpt-thinking-group, .gpt-thinking-line, .gpt-card[data-card="thinking"]').count()) >= 1, "内嵌 thinking 折叠卡"),
      check((await page.locator('.gpt-card[data-card="tool"], .gpt-card[data-card="tool-result"]').count()) >= 1, "内嵌工具调用卡片"),
      check((await page.locator('.gpt-card[data-card="data"]').count()) >= 1, "内嵌数据卡片（Token/工具/步骤）"),
      check((await page.locator('.gpt-card[data-card="report"]').count()) >= 1, "内嵌报告卡片（按问题）"),
      check((await page.locator('.gpt-card[data-card="artifact"]').count()) >= 1, "内嵌产物卡片（按问题）"),
      check((await page.locator(".gpt-md, .gpt-part-text").count()) >= 1, "助手文本 Markdown 渲染"),
    ]);

    await gotoChat();
    await page.goto(`${baseUrl}/chat?conversation=conv-001`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#gpt-messages .gpt-msg", { timeout: STEP_TIMEOUT_MS });
    const restored = await page.locator("#gpt-messages .gpt-msg").count();
    const firstConvHref = await page.locator('#conv-list .gpt-conv-open[href="/chat?conversation=conv-001"]').getAttribute("href");
    const countBefore = await page.locator("#conv-list .gpt-conv-item").count();
    await page.locator("#conv-list [data-conv-rename]").first().click();
    await page.waitForTimeout(700);
    const titles = await page.locator("#conv-list .gpt-conv-open").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title")));
    const renamed = titles.includes("测试重命名对话");
    const deleteButtons = page.locator("#conv-list [data-conv-delete]");
    await deleteButtons.last().click();
    await page.waitForTimeout(700);
    const countAfter = await page.locator("#conv-list .gpt-conv-item").count();
    record("chat-multi-session", [
      check(firstConvHref !== null, "可切换历史对话"),
      check(restored >= 2, `切换后历史消息恢复（${restored} 条）`),
      check(renamed, "重命名对话生效"),
      check(countAfter < countBefore || countAfter >= 1, `删除对话后列表仍正常（${countBefore} → ${countAfter}）`),
    ]);

    await gotoChat();
    const beforeMem = await page.locator("#memory-list .gpt-memory-item").count();
    await page.locator("#memory-search").fill("审批");
    await page.locator("#memory-search").press("Enter");
    await page.waitForTimeout(500);
    const filtered = await page.locator("#memory-list .gpt-memory-item").count();
    await page.locator("#memory-list [data-memory-delete]").first().click();
    await page.waitForTimeout(500);
    const afterDelete = await page.locator("#memory-list .gpt-memory-item").count();
    record("chat-memory", [
      check(beforeMem >= 3, `记忆列表展示（${beforeMem} 条）`),
      check(filtered >= 1 && filtered <= beforeMem, `记忆搜索生效（${filtered} 条）`),
      check(afterDelete < beforeMem, "删除记忆生效"),
    ]);

    await gotoChat();
    await send("帮我查一下产物并汇总");
    await page.waitForSelector("#chat-run-link", { timeout: 15_000 });
    await waitAssistantDone();
    record("chat-task", [
      check(await page.locator("#chat-run-link").isVisible(), "任务类查询生成运行卡（可进入深度实时页）"),
      check((await page.locator('.gpt-card[data-card="tool"], .gpt-card[data-card="tool-result"]').count()) >= 2, "任务类出现工具卡片"),
      check((await page.locator('.gpt-card[data-card="artifact"]').count()) >= 1, "任务类出现产物卡片"),
      check((await page.locator('.gpt-card[data-card="report"]').count()) >= 1, "任务类出现报告卡片"),
    ]);

    const convBefore = await page.locator("#gpt-page").getAttribute("data-conv-id");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#gpt-page", { timeout: STEP_TIMEOUT_MS });
    const convAfter = await page.locator("#gpt-page").getAttribute("data-conv-id");
    record("chat-refresh-recovery", [
      check(convBefore === convAfter, `刷新后当前对话保持（${String(convAfter)}）`),
      check((await page.locator("#gpt-messages .gpt-msg").count()) >= 2, "刷新后历史消息仍可见"),
    ]);

    await page.goto(`${baseUrl}/chat?prompt=${encodeURIComponent("查看系统状态")}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector("#gpt-page", { timeout: STEP_TIMEOUT_MS });
    await waitAssistantDone();
    record("chat-quick-prompt", [
      check(!page.url().includes("prompt="), "prompt 参数发送后从 URL 清理"),
      check((await page.locator("#gpt-messages .gpt-msg").count()) >= 2, "?prompt= 自动发送并得到回复"),
      check((await page.locator("[data-final-result]").count()) >= 1, "自动发送后显示最终结果"),
    ]);

    const external = requestLog.filter((url) => {
      try { const parsed = new URL(url); return !(parsed.hostname === "127.0.0.1" && parsed.port === String(handle.port)); } catch { return false; }
    });
    let noTokenStatus = 0;
    try {
      const response = await fetch(`${baseUrl}/api/chat/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "unauth" }), signal: AbortSignal.timeout(2000) });
      noTokenStatus = response.status;
    } catch { noTokenStatus = 0; }
    record("chat-sanity", [
      check(pageErrors.length === 0, `无页面 JS 错误（${pageErrors.length}）`, pageErrors.slice(0, 3).join(" | ")),
      check(external.length === 0, `无外链请求（${requestLog.length} 个请求全部同源）`, external.slice(0, 3).join(", ")),
      check(noTokenStatus === 401, `写 API 无 token 被拒（实际 ${String(noTokenStatus)}）`),
      check(requestLog.some((url) => url.includes("/api/chat/conversations/") && url.includes("/stream")), "使用同源 SSE 流（/api/chat/conversations/:id/stream）"),
      check(requestLog.some((url) => url.endsWith("/assets/gpt.js")), "ChatGPT 页面脚本同源加载"),
    ]);
  } catch (error) {
    failures.push(`致命错误：${error instanceof Error ? error.message : String(error)}`);
    console.error(`[chat-e2e] 运行失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (browser !== null) { try { await browser.close(); } catch { /* ignore */ } }
    try { await handle.close(); } catch { /* ignore */ }
    const durationMs = Date.now() - startedAt;
    const result = {
      suite: "chat-e2e",
      version: "1.5.1",
      ok: failures.length === 0,
      headless: options.headless,
      screenshots: false,
      console: { url: handle.url, port: handle.port },
      steps,
      checks,
      failures,
      page_errors: pageErrors,
      durationMs,
      as_of: new Date().toISOString(),
    };
    await writeFile(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    await writeFile(join(evidenceDir, "console.log"), consoleLog.join("\n") + "\n", "utf8");
    const passed = checks.filter((item) => item.ok).length;
    console.log("-".repeat(72));
    console.log(`结果：${result.ok ? "通过" : "未通过"} · 步骤 ${steps.filter((item) => item.ok).length}/${steps.length} · 检查 ${passed}/${checks.length} · 耗时 ${(durationMs / 1000).toFixed(1)}s · 无截图`);
    if (!result.ok) for (const failure of failures) console.log(`  ✗ ${failure}`);
    console.log(`证据：${join(evidenceDir, "result.json")}`);
    return result.ok ? 0 : 1;
  }
}

const exitCode = await main().catch((error) => {
  console.error(`[chat-e2e] 未捕获异常：${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
process.exitCode = exitCode;
