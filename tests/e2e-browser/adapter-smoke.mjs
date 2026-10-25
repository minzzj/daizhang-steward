#!/usr/bin/env node
/**
 * 代掌 Steward · 浏览器适配器冒烟测试（真实浏览器）
 *
 * 验证 `packages/steward-browser`（Playwright 真实浏览器适配器）能真的跑通：
 *   1) 纯函数自检：风控关键词 / 失败分类 / ToolRegistry 工具规格
 *   2) 真实浏览器（有头默认，chrome → msedge 回退）跑 demo-web 正常流程：
 *      打开 → 输入 → 登录 → 提交项目 → 断言结果，并检查每步自动证据、steps.json
 *   3) 浏览器 console 日志捕获：走一遍预置缺陷路径（页面会 console.warn），
 *      验证 collectConsole() / console.log 真的记录到浏览器日志
 *
 * 前置：先构建 `npm run build`（读取 dist/packages/steward-browser/src/index.js）。
 * 本文件不属于 login-flow 验收套件；它证明适配器 A 任务真实可用。
 *
 * 用法：
 *   node tests/e2e-browser/adapter-smoke.mjs --evidence-dir C:\daizhang-build\staging\adapter-evidence
 *   node tests/e2e-browser/adapter-smoke.mjs --headless 1
 * 退出码：0=通过；1=失败；2=参数/环境错误。
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, errorText, sleep, startDemoServer } from "./lib/demo-server.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_WORKDIR = join(REPO_ROOT, "examples", "demo-web");
const ADAPTER_DIST = join(REPO_ROOT, "dist", "packages", "steward-browser", "src", "index.js");

const PROJECT_NAME = "适配器冒烟项目";
const PROJECT_NOTE = "由 tests/e2e-browser/adapter-smoke.mjs 通过 PlaywrightBrowser 生成";

function usageError(message) {
  console.error(`[adapter-smoke] 参数错误：${message}`);
  console.error("用法：node tests/e2e-browser/adapter-smoke.mjs [--evidence-dir <目录>] [--workdir <demo-web 目录>] [--port <端口>] [--headless 0|1]");
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    evidenceDir: join(REPO_ROOT, "runs", `adapter-smoke-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)}`),
    workdir: DEFAULT_WORKDIR,
    port: DEFAULT_PORT,
    headless: false,
    adapterDist: ADAPTER_DIST,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) usageError(`参数 ${arg} 缺少取值`);
      return argv[index];
    };
    if (arg === "--evidence-dir") options.evidenceDir = resolve(nextValue());
    else if (arg === "--workdir") options.workdir = resolve(nextValue());
    else if (arg === "--port") options.port = Number.parseInt(nextValue(), 10);
    else if (arg === "--adapter-dist") options.adapterDist = resolve(nextValue());
    else if (arg === "--headless") {
      const peek = argv[index + 1];
      if (peek === "0" || peek === "1") {
        options.headless = peek === "1";
        index += 1;
      } else {
        options.headless = true;
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：node tests/e2e-browser/adapter-smoke.mjs [--evidence-dir <目录>] [--workdir <demo-web 目录>] [--port <端口>] [--headless 0|1] [--adapter-dist <构建产物 index.js>]");
      process.exit(0);
    } else {
      usageError(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) usageError("--port 不合法");
  return options;
}

const checks = [];
const addCheck = (ok, message) => {
  checks.push({ ok: Boolean(ok), message });
  console.log(`  ${ok ? "✓" : "✗"} ${message}`);
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  if (!existsSync(options.adapterDist)) {
    console.error(`[adapter-smoke] 环境错误：找不到构建产物 ${options.adapterDist}\n请先在仓库根目录运行：npm run build`);
    return 2;
  }
  const adapter = await import(pathToFileURL(options.adapterDist).href);
  const { PlaywrightBrowser, RiskControlStopError, isLikelyRiskControl, classifyBrowserFailure, browserToolSpecs } = adapter;

  await mkdir(options.evidenceDir, { recursive: true });
  console.log("=".repeat(72));
  console.log("代掌 Steward · 浏览器适配器冒烟测试（真实浏览器）");
  console.log(`适配器  : ${options.adapterDist}`);
  console.log(`工作目录: ${options.workdir}`);
  console.log(`证据目录: ${options.evidenceDir}`);
  console.log("=".repeat(72));

  // ---- 1) 纯函数自检（不依赖浏览器） ----
  console.log("\n[1/3] 纯函数自检（风控 / 失败分类 / 工具规格）");
  addCheck(typeof RiskControlStopError === "function", "导出 RiskControlStopError 类");
  addCheck(isLikelyRiskControl("请输入验证码"), "isLikelyRiskControl 识别「验证码」");
  addCheck(isLikelyRiskControl("Please complete the CAPTCHA"), "isLikelyRiskControl 识别 captcha（大小写不敏感）");
  addCheck(isLikelyRiskControl("请完成安全验证后继续"), "isLikelyRiskControl 识别「安全验证」");
  addCheck(!isLikelyRiskControl("欢迎登录代掌演示站，账号密码可任意填写"), "普通登录文案不应误判为风控");
  addCheck(classifyBrowserFailure(new Error("page.goto: Timeout 20000ms exceeded")) === "navigation-timeout", "失败分类：导航超时");
  addCheck(
    classifyBrowserFailure(new Error("locator.click: Timeout 10000ms exceeded.\nwaiting for locator('#submit')")) === "element-not-found",
    "失败分类：元素找不到",
  );
  addCheck(classifyBrowserFailure(new Error("Permission denied")) === "permission-denied", "失败分类：权限拒绝");
  addCheck(classifyBrowserFailure(new Error("boom")) === "unknown", "失败分类：未知");
  const specs = browserToolSpecs();
  addCheck(Array.isArray(specs) && specs.length >= 8, `browserToolSpecs() 返回 ${specs.length} 条 ToolSpec`);
  addCheck(specs.every((spec) => spec.evidence === true && typeof spec.risk === "string"), "所有浏览器工具都声明证据与风险级别");

  // ---- 2) 真实浏览器：demo-web 正常流程 ----
  console.log("\n[2/3] 真实浏览器冒烟（demo-web 登录 → 提交项目）");
  const server = await startDemoServer({ workdir: options.workdir, port: options.port, evidenceDir: options.evidenceDir });
  console.log(`  [demo-web] ${server.baseUrl}/（pid ${server.pid}，/health 200）`);
  let browser = null;
  const steps = [];
  try {
    browser = new PlaywrightBrowser();
    const info = await browser.launch({ evidenceDir: options.evidenceDir, headless: options.headless });
    console.log(
      `  [adapter] channel=${info.channel} version=${info.browserVersion} headless=${info.headless}\n` +
        `  [adapter] userDataDir=${info.userDataDir} evidenceDir=${info.evidenceDir}`,
    );
    addCheck(info.channel === "chrome" || info.channel === "msedge", `真实浏览器通道为 chrome/msedge（实际 ${info.channel}）`);
    addCheck(options.headless ? info.headless === true : info.headless === false, `headless=${options.headless} 生效`);
    addCheck(info.userDataDir.length > 0 && info.evidenceDir === options.evidenceDir, "每次 launch 独立 userDataDir，证据目录正确");

    const runAction = async (label, fn) => {
      const step = await fn();
      steps.push(step);
      const evidenceCount = Array.isArray(step.evidence) ? step.evidence.length : 0;
      console.log(`  ${step.ok ? "✓" : "✗"} ${label}（step#${step.stepIndex}，证据 ${evidenceCount} 个）${step.ok ? "" : ` → ${step.failureKind}: ${step.error}`}`);
      if (!step.ok) throw new Error(`适配器步骤失败：${label} → ${step.failureKind}: ${step.error}`);
      return step;
    };

    await runAction("goto /", () => browser.goto(`${server.baseUrl}/`));
    await runAction("fill #account", () => browser.fill("#account", "demo"));
    await runAction("fill #password", () => browser.fill("#password", "demo"));
    await runAction("isEnabled #submit", () => browser.isEnabled("#submit"));
    await runAction("click #submit", () => browser.click("#submit"));
    await runAction("waitFor #project-view", () => browser.waitFor("#project-view"));
    await runAction("isVisible #project-view", () => browser.isVisible("#project-view"));
    await runAction("fill #project-name", () => browser.fill("#project-name", PROJECT_NAME));
    await runAction("fill #project-note", () => browser.fill("#project-note", PROJECT_NOTE));
    await runAction("click #create", () => browser.click("#create"));
    const resultStep = await runAction("waitForText #project-result", () => browser.waitForText("#project-result", "已提交"));
    await runAction("screenshot final-state", () => browser.screenshot("final-state"));
    await runAction("domSnapshot final-state", () => browser.domSnapshot("final-state"));
    const textStep = await runAction("text #project-result", () => browser.text("#project-result"));

    addCheck(resultStep.ok, "waitForText 等到「已提交」");
    addCheck(typeof textStep.value === "string" && textStep.value.includes("已提交"), `text() 返回结果文本含「已提交」（实际「${textStep.value}」）`);
    addCheck(textStep.value.includes(PROJECT_NAME), `text() 回显项目名称「${PROJECT_NAME}」`);

    // ---- 3) 浏览器 console 日志捕获：走一遍预置缺陷路径（页面会 console.warn + AbortError） ----
    console.log("\n[3/3] 真实浏览器 console 日志捕获（走预置缺陷路径，产生真实 console.warn）");
    await runAction("goto /login?timeout=1", () => browser.goto(`${server.baseUrl}/login?timeout=1`));
    await runAction("fill #account (slow)", () => browser.fill("#account", "demo"));
    await runAction("fill #password (slow)", () => browser.fill("#password", "demo"));
    await runAction("click #submit (slow)", () => browser.click("#submit"));
    await sleep(4500);
    const consoleEntries = await browser.collectConsole();
    addCheck(Array.isArray(consoleEntries), `collectConsole() 返回 ${consoleEntries.length} 条浏览器日志`);
    addCheck(consoleEntries.some((entry) => entry.text.includes("已知缺陷")), "捕获到页面 console.warn 的「已知缺陷」日志（真实浏览器 console）");
    addCheck(consoleEntries.some((entry) => entry.type === "pageerror" || entry.type === "warning" || entry.type === "error" || entry.type === "log"), "console 日志带类型字段");
    await runAction("screenshot slow-login-state", () => browser.screenshot("slow-login-state"));
    const profileDir = info.userDataDir;
    await browser.close();
    browser = null;
    addCheck(!existsSync(profileDir), "close() 已清理本次 run 的独立 userDataDir（配置隔离）");

    // ---- 证据完整性 ----
    const screenshotFiles = await readdir(join(options.evidenceDir, "screenshots"));
    const domFiles = await readdir(join(options.evidenceDir, "dom"));
    addCheck(screenshotFiles.some((file) => file.endsWith(".png")), `每步自动截图落盘（${screenshotFiles.length} 张）`);
    addCheck(domFiles.some((file) => file.endsWith(".html")), `每步自动 DOM 快照落盘（${domFiles.length} 份）`);
    const consoleLog = await readFile(join(options.evidenceDir, "console.log"), "utf8");
    addCheck(consoleLog.includes("[launch]"), "console.log 含 [launch] 启动记录");
    addCheck(consoleLog.includes("[step"), "console.log 含每步记录");
    addCheck(consoleLog.includes("[close]"), "console.log 含 [close] 收尾记录");
    const stepsFile = JSON.parse(await readFile(join(options.evidenceDir, "steps.json"), "utf8"));
    addCheck(Array.isArray(stepsFile.steps) && stepsFile.steps.length === steps.length, `steps.json 汇总 ${stepsFile.steps.length} 条结构化步骤`);
    const explicitEvidenceActions = new Set(["screenshot", "domSnapshot"]);
    addCheck(
      steps.filter((step) => !explicitEvidenceActions.has(step.action)).every((step) => step.evidence.length >= 2),
      "动作步骤自动留证：截图 + DOM 两份（显式 screenshot/domSnapshot 除外）",
    );
    const failedChecks = checks.filter((item) => !item.ok);
    console.log(`\n[adapter-smoke] ${failedChecks.length === 0 ? "PASS" : "FAIL"}：${checks.length - failedChecks.length}/${checks.length} 项通过`);
    return failedChecks.length === 0 ? 0 : 1;
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch {
        // 已关闭
      }
    }
    const stopped = await server.stop();
    console.log(`  [demo-web] 已停止（${stopped.released ? "端口已释放" : "端口仍被占用⚠"}${stopped.forced ? "，已强制结束" : ""}）`);
    const durationMs = Date.now() - startedAt;
    const summary = {
      suite: "e2e-browser/adapter-smoke",
      ok: checks.every((item) => item.ok),
      steps,
      checks,
      durationMs,
      evidenceDir: options.evidenceDir,
    };
    await writeFile(join(options.evidenceDir, "adapter-smoke-result.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.log(`  证据: ${options.evidenceDir}`);
    console.log(`  耗时: ${(durationMs / 1000).toFixed(1)}s\n`);
  }
}

const exitCode = await main().catch((error) => {
  console.error(`[adapter-smoke] 运行失败：${errorText(error)}`);
  return 1;
});
process.exitCode = exitCode;
