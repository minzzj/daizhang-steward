#!/usr/bin/env node
/**
 * 代掌 Steward · 真实浏览器 E2E：demo-web 登录 → 提交项目
 *
 * 用本机真实 Chrome / Edge（默认有头）跑 examples/demo-web：
 *   normal        ：/ 登录 → 提交项目 → 断言 #project-result 显示「已提交」（修复前也必须绿）
 *   login-timeout ：/login?timeout=1 复现预置缺陷（修复前必须红；修复后应转绿）
 *   all           ：依次跑上面两条（默认）
 *
 * 自管 demo-web 服务（127.0.0.1:4173）：启动 → /health 200 → 结束 taskkill 进程树 → 确认端口释放。
 * 硬规则（tests/README.md）：只做真实点击/输入/等待/截图；禁止请求拦截（route/mock）、假 DOM、预录视频；
 * 不得用接口调用代替 UI 验收。
 *
 * 输出：
 *   <evidenceDir>/result.json              总结果（case/ok/steps/evidence/durationMs + 期望对照）
 *   <evidenceDir>/<case>/result.json       单条用例结果
 *   <evidenceDir>/<case>/screenshots/*.png 每步截图（失败额外保存 DOM 快照到 dom/）
 *   <evidenceDir>/<case>/console.log       页面 console / pageerror / requestfailed
 *   <evidenceDir>/server.log               demo-web 服务端输出
 *
 * 用法：
 *   node tests/e2e-browser/login-flow.mjs --case all --evidence-dir C:\daizhang-build\staging\e2e-evidence
 *   node tests/e2e-browser/login-flow.mjs --case normal
 *   node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout   # 修复前验收：缺陷按预期复现则退出码 0
 *   node tests/e2e-browser/login-flow.mjs --case all --headless 1                 # 无头（本地开发/CI）
 *
 * 退出码：0 = 符合预期；1 = 失败或不符合预期；2 = 参数/环境错误。
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_PORT, errorText, sleep, startDemoServer } from "./lib/demo-server.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_WORKDIR = join(REPO_ROOT, "examples", "demo-web");

const CASE_NAMES = ["normal", "login-timeout"];
const CHANNEL_ORDER = ["chrome", "msedge"];
const VIEWPORT = { width: 1440, height: 900 };

const FIXED_ACCOUNT = "demo";
const FIXED_PASSWORD = "demo";
const PROJECT_NAME = "示例客户官网改版";
const PROJECT_NOTE = "由真实浏览器 E2E（tests/e2e-browser/login-flow.mjs）生成";

/** 页面侧 AbortController 在 3s 中止；服务端慢网 4s 才返回。等 4.5s 观察超时后的表现。 */
const LOGIN_TIMEOUT_WAIT_MS = 4500;
const LOGIN_TIMEOUT_EXPECTED_TEXT = "请求超时，请重试";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`用法：node tests/e2e-browser/login-flow.mjs [选项]

选项：
  --case normal|login-timeout|all  要跑的用例，默认 all
  --evidence-dir <目录>            证据目录（result.json / 截图 / 日志），默认 runs/e2e-browser-<时间戳>
  --workdir <demo-web 目录>        demo-web 所在目录，默认 examples/demo-web
  --port <端口>                    demo-web 端口，默认 ${DEFAULT_PORT}
  --headless 0|1                   0=有头（默认，产品验收必须），1=无头
  --channel chrome|msedge          指定浏览器通道；默认按 chrome → msedge 回退
  --expect-red <case>              声明某 case 预期为红（缺陷复现验收用，可重复）
  -h, --help                       显示本帮助

示例：
  node tests/e2e-browser/login-flow.mjs --case all --evidence-dir C:\\daizhang-build\\staging\\e2e-evidence
  node tests/e2e-browser/login-flow.mjs --case normal
  node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout

退出码：0=符合预期；1=失败/不符合预期；2=参数或环境错误。`);
}

function usageError(message) {
  console.error(`[e2e] 参数错误：${message}`);
  printUsage();
  process.exit(2);
}

function parsePort(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) usageError(`--port 不是合法端口：${raw}`);
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) usageError(`--port 超出范围（1-65535）：${raw}`);
  return port;
}

function parseArgs(argv) {
  // 支持 --key=value 与 --key value 两种写法
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
    case: "all",
    evidenceDir: null,
    workdir: null,
    port: DEFAULT_PORT,
    headless: false,
    channel: null,
    expectRed: [],
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = () => {
      index += 1;
      if (index >= args.length) usageError(`参数 ${arg} 缺少取值`);
      return args[index];
    };
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--case":
        options.case = nextValue();
        break;
      case "--evidence-dir":
        options.evidenceDir = nextValue();
        break;
      case "--workdir":
        options.workdir = nextValue();
        break;
      case "--port":
        options.port = parsePort(nextValue());
        break;
      case "--channel":
        options.channel = nextValue();
        break;
      case "--expect-red":
        options.expectRed.push(nextValue());
        break;
      case "--headless": {
        const peek = args[index + 1];
        if (peek === "0" || peek === "1") {
          options.headless = peek === "1";
          index += 1;
        } else {
          options.headless = true;
        }
        break;
      }
      default:
        usageError(`未知参数：${arg}`);
    }
  }

  if (![...CASE_NAMES, "all"].includes(options.case)) {
    usageError(`--case 只支持 normal / login-timeout / all，实际：${options.case}`);
  }
  if (options.channel !== null && !CHANNEL_ORDER.includes(options.channel)) {
    usageError(`--channel 只支持 chrome / msedge，实际：${options.channel}`);
  }
  for (const name of options.expectRed) {
    if (!CASE_NAMES.includes(name)) usageError(`--expect-red 只支持 ${CASE_NAMES.join(" / ")}，实际：${name}`);
    if (options.case !== "all" && options.case !== name) {
      usageError(`--expect-red ${name} 与 --case ${options.case} 不匹配`);
    }
  }
  return options;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

// ---------------------------------------------------------------------------
// 断言 / 步骤执行框架
// ---------------------------------------------------------------------------

/** 单条断言（失败也继续收集，便于一次看到全部问题）。 */
const check = (ok, message) => ({ ok: Boolean(ok), message });

/** 一条用例的步骤记录 + 证据收集器。 */
class CaseRun {
  constructor({ caseName, evidenceDir, baseUrl }) {
    this.caseName = caseName;
    this.dir = join(evidenceDir, caseName);
    this.baseUrl = baseUrl;
    this.steps = [];
    this.failures = [];
    this.evidence = [];
    this.seq = 0;
    this.startedAt = Date.now();
    this.page = null;
    this.context = null;
    this.consoleLines = [];
  }

  async prepare(browser) {
    await mkdir(join(this.dir, "screenshots"), { recursive: true });
    await mkdir(join(this.dir, "dom"), { recursive: true });
    this.context = await browser.newContext({ viewport: VIEWPORT, locale: "zh-CN" });
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      this.consoleLines.push(`[console:${message.type()}] ${message.text()}`);
    });
    this.page.on("pageerror", (error) => {
      this.consoleLines.push(`[pageerror] ${error?.message ?? error}`);
    });
    this.page.on("requestfailed", (request) => {
      this.consoleLines.push(`[requestfailed] ${request.method()} ${request.url()} → ${request.failure()?.errorText ?? "unknown"}`);
    });
  }

  nextEvidenceName(label, extension) {
    this.seq += 1;
    const safe =
      String(label)
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "step";
    return `${String(this.seq).padStart(3, "0")}-${safe}.${extension}`;
  }

  async screenshot(label) {
    const relative = join("screenshots", this.nextEvidenceName(label, "png")).replaceAll("\\", "/");
    await this.page.screenshot({ path: join(this.dir, relative), fullPage: false });
    this.evidence.push(relative);
    return relative;
  }

  async domSnapshot(label) {
    const relative = join("dom", this.nextEvidenceName(label, "html")).replaceAll("\\", "/");
    await writeFile(join(this.dir, relative), await this.page.content(), "utf8");
    this.evidence.push(relative);
    return relative;
  }

  /**
   * 执行一个步骤：body 返回 { checks }；成功/失败都自动截图（失败加存 DOM 快照）。
   * 单条断言失败不会中断后续断言，最终汇总到 failures。
   */
  async step(action, body) {
    const startedAt = Date.now();
    const step = { action, ok: true, evidence: [], durationMs: 0, checks: [] };
    let checks = [];
    try {
      const result = await body();
      checks = result?.checks ?? [];
    } catch (error) {
      step.ok = false;
      step.error = errorText(error);
      this.failures.push(`[${action}] ${step.error}`);
    }
    for (const item of checks) {
      step.checks.push({ ok: item.ok, message: item.message });
      if (!item.ok) {
        step.ok = false;
        this.failures.push(`[${action}] ${item.message}`);
      }
    }
    try {
      step.evidence.push(await this.screenshot(step.ok ? action : `${action}-fail`));
      if (!step.ok) step.evidence.push(await this.domSnapshot(`${action}-fail`));
    } catch (error) {
      step.ok = false;
      step.error = `保存失败现场出错：${errorText(error)}`;
      this.failures.push(`[${action}] ${step.error}`);
    }
    step.durationMs = Date.now() - startedAt;
    this.steps.push(step);
    console.log(`  ${step.ok ? "✓" : "✗"} ${action}（${step.durationMs}ms）`);
    for (const item of step.checks) {
      if (!item.ok) console.log(`      ✗ ${item.message}`);
    }
    if (step.error) console.log(`      ! ${step.error}`);
    return step;
  }

  result() {
    return {
      case: this.caseName,
      ok: this.failures.length === 0 && this.steps.every((step) => step.ok),
      steps: this.steps,
      evidence: [...this.evidence],
      durationMs: Date.now() - this.startedAt,
      failures: [...this.failures],
    };
  }

  async writeResult() {
    const result = this.result();
    await writeFile(join(this.dir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    return result;
  }

  async dispose() {
    try {
      if (this.consoleLines.length > 0) {
        await writeFile(join(this.dir, "console.log"), this.consoleLines.join("\n") + "\n", "utf8");
      }
    } catch {
      // 日志写失败不影响结果
    }
    try {
      await this.context?.close();
    } catch {
      // 浏览器已关闭
    }
  }
}

// ---------------------------------------------------------------------------
// 用例：normal（登录 → 提交项目，必须绿）
// ---------------------------------------------------------------------------

async function runNormalCase(run) {
  const page = run.page;
  const baseUrl = run.baseUrl;

  await run.step("open-login-page", async () => {
    const response = await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    return {
      checks: [
        check(response !== null && response.status() === 200, `首页应返回 HTTP 200，实际 ${response === null ? "无响应" : response.status()}`),
        check(await page.locator("#login-view").isVisible(), "#login-view 登录视图应可见"),
        check(await page.locator("#account").isVisible(), "#account 账号输入框应可见"),
        check(await page.locator("#submit").isEnabled(), "#submit 登录按钮应可用"),
      ],
    };
  });

  await run.step("fill-credentials", async () => {
    await page.locator("#account").fill(FIXED_ACCOUNT);
    await page.locator("#password").fill(FIXED_PASSWORD);
    return {
      checks: [
        check((await page.locator("#account").inputValue()) === FIXED_ACCOUNT, "#account 应回填演示账号"),
        check((await page.locator("#password").inputValue()) === FIXED_PASSWORD, "#password 应回填演示密码（值不写入日志）"),
      ],
    };
  });

  await run.step("click-login", async () => {
    await page.locator("#submit").click();
    return { checks: [] };
  });

  await run.step("wait-project-view", async () => {
    await page.locator("#project-view").waitFor({ state: "visible", timeout: 10_000 });
    return {
      checks: [
        check(await page.locator("#login-view").isHidden(), "登录成功后 #login-view 应隐藏"),
        check(await page.locator("#project-name").isVisible(), "#project-name 项目名称输入框应可见"),
        check((await page.locator("#project-result").count()) === 1, "#project-result 结果区域应存在"),
        check(await page.locator("#login-error").isHidden(), "正常登录后 #login-error 应保持 hidden"),
      ],
    };
  });

  await run.step("fill-project", async () => {
    await page.locator("#project-name").fill(PROJECT_NAME);
    await page.locator("#project-note").fill(PROJECT_NOTE);
    return {
      checks: [
        check((await page.locator("#project-name").inputValue()) === PROJECT_NAME, "#project-name 应回填项目名称"),
        check((await page.locator("#project-note").inputValue()) === PROJECT_NOTE, "#project-note 应回填备注"),
      ],
    };
  });

  await run.step("click-create", async () => {
    await page.locator("#create").click();
    return { checks: [] };
  });

  await run.step("assert-project-submitted", async () => {
    const resultLocator = page.locator("#project-result");
    await resultLocator.waitFor({ state: "visible", timeout: 10_000 });
    const text = ((await resultLocator.textContent()) ?? "").trim();
    return {
      checks: [
        check(text.includes("已提交"), `#project-result 文本应包含「已提交」，实际「${text}」`),
        check(text.includes(PROJECT_NAME), `#project-result 应回显项目名称「${PROJECT_NAME}」，实际「${text}」`),
        check(await page.locator("#project-error").isHidden(), "#project-error 不应显示（提交成功）"),
        check(await page.locator("#create").isEnabled(), "#create 提交成功后应恢复可用"),
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// 用例：login-timeout（复现预置缺陷；修复前必须红）
// ---------------------------------------------------------------------------

async function runLoginTimeoutCase(run) {
  const page = run.page;
  const baseUrl = run.baseUrl;

  await run.step("open-slow-login-page", async () => {
    const response = await page.goto(`${baseUrl}/login?timeout=1`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    return {
      checks: [
        check(response !== null && response.status() === 200, `/login?timeout=1 应返回 HTTP 200，实际 ${response === null ? "无响应" : response.status()}`),
        check(await page.locator("#slow-mode").isChecked(), "/login?timeout=1 应自动勾选 #slow-mode（页面进入慢网模式）"),
        check(((await page.locator("#submit").textContent()) ?? "").includes("登录"), "#submit 初始文案应为「登录」"),
      ],
    };
  });

  await run.step("fill-credentials", async () => {
    await page.locator("#account").fill(FIXED_ACCOUNT);
    await page.locator("#password").fill(FIXED_PASSWORD);
    return {
      checks: [
        check((await page.locator("#account").inputValue()) === FIXED_ACCOUNT, "#account 应回填演示账号"),
        check((await page.locator("#password").inputValue()) === FIXED_PASSWORD, "#password 应回填演示密码（值不写入日志）"),
      ],
    };
  });

  await run.step("click-login", async () => {
    await page.locator("#submit").click();
    return {
      checks: [
        check(await page.locator("#submit").isDisabled(), "#submit 点击后应进入禁用 loading 态"),
        check(((await page.locator("#submit").textContent()) ?? "").includes("登录中"), "#submit 加载文案应包含「登录中…」"),
        check(await page.locator("#login-error").isHidden(), "请求进行中 #login-error 应为 hidden"),
      ],
    };
  });

  await run.step("assert-timeout-recovery", async () => {
    // 页面侧 3s 主动中止（AbortController），服务端 4s 才返回 504；等 4.5s 观察超时后的表现。
    // 修复目标（examples/demo-web/README.zh-CN.md §7）：提示「请求超时，请重试」+ 按钮恢复可用 + 状态清空。
    await sleep(LOGIN_TIMEOUT_WAIT_MS);
    const submit = page.locator("#submit");
    const submitEnabled = await submit.isEnabled();
    const submitDisabled = await submit.isDisabled();
    const submitText = ((await submit.textContent()) ?? "").trim();
    const errorLocator = page.locator("#login-error");
    const errorVisible = await errorLocator.isVisible();
    const errorText = ((await errorLocator.textContent()) ?? "").trim();
    const statusText = ((await page.locator("#login-status").textContent()) ?? "").trim();
    return {
      checks: [
        check(submitEnabled, `#submit 超时后应恢复可用（disabled=false），实际 disabled=${submitDisabled}，文案「${submitText}」`),
        check(errorVisible, "#login-error 超时后应可见（必须给用户提示），实际仍 hidden"),
        check(
          errorText.includes(LOGIN_TIMEOUT_EXPECTED_TEXT),
          `#login-error 文本应包含「${LOGIN_TIMEOUT_EXPECTED_TEXT}」，实际「${errorText}」`,
        ),
        check(!submitText.includes("登录中"), `#submit 文案应恢复为「登录」，实际「${submitText}」`),
        check(statusText === "", `#login-status 应清空，实际「${statusText}」`),
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// 真实浏览器启动（chrome → msedge 回退）
// ---------------------------------------------------------------------------

async function launchRealBrowser({ headless, channel }) {
  const candidates = channel === null ? [...CHANNEL_ORDER] : [channel, ...CHANNEL_ORDER.filter((item) => item !== channel)];
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const browser = await chromium.launch({ channel: candidate, headless, timeout: 30_000 });
      return {
        browser,
        channel: candidate,
        version: browser.version(),
        fallbacks: attempts.map((attempt) => attempt.channel),
      };
    } catch (error) {
      attempts.push({ channel: candidate, error: errorText(error) });
    }
  }
  const detail = attempts.map((attempt) => `${attempt.channel}: ${attempt.error}`).join(" | ");
  throw new Error(
    `真实浏览器启动失败（已按顺序尝试 ${candidates.join(" → ")}）：${detail}。请确认本机已安装 Chrome 或 Edge。`,
  );
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/** 中断（Ctrl+C）时用于清理浏览器与 demo-web 服务，避免端口残留。 */
const cleanupTasks = [];
let interrupting = false;
process.on("SIGINT", () => {
  if (interrupting) return;
  interrupting = true;
  console.warn("\n[e2e] 收到 Ctrl+C，正在清理浏览器与 demo-web 服务…");
  const timeout = setTimeout(() => process.exit(130), 8000);
  timeout.unref();
  void Promise.allSettled(cleanupTasks.splice(0).map((task) => Promise.resolve().then(task))).then(() => process.exit(130));
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  const workdir = options.workdir === null ? DEFAULT_WORKDIR : resolve(options.workdir);
  const evidenceDir = options.evidenceDir === null
    ? join(REPO_ROOT, "runs", `e2e-browser-${stampNow()}`)
    : resolve(options.evidenceDir);
  const selectedCases = options.case === "all" ? [...CASE_NAMES] : [options.case];
  const expectRed = new Set(options.expectRed);

  try {
    await access(join(workdir, "server.mjs"));
  } catch {
    console.error(`[e2e] 环境错误：找不到 demo-web 服务脚本 ${join(workdir, "server.mjs")}\n请用 --workdir 指定 examples/demo-web 目录。`);
    return 2;
  }
  await mkdir(evidenceDir, { recursive: true });

  console.log("=".repeat(72));
  console.log("代掌 Steward · 真实浏览器 E2E（demo-web 登录 → 提交项目）");
  console.log(`模式    : ${options.case}${expectRed.size > 0 ? `（预期为红：${[...expectRed].join(", ")}）` : ""}`);
  console.log(`浏览器  : ${options.headless ? "无头 headless=1" : "有头（默认，产品验收必须）"}；通道 chrome → msedge`);
  console.log(`工作目录: ${workdir}`);
  console.log(`证据目录: ${evidenceDir}`);
  console.log("=".repeat(72));

  const suiteStartedAt = Date.now();
  const caseResults = [];
  let browserInfo = null;
  let serverHandle = null;
  let fatalError = null;

  try {
    serverHandle = await startDemoServer({ workdir, port: options.port, evidenceDir });
    cleanupTasks.push(() => serverHandle.stop());
    console.log(`\n[demo-web] 已启动：${serverHandle.baseUrl}/（pid ${serverHandle.pid}，/health 200）`);

    browserInfo = await launchRealBrowser({ headless: options.headless, channel: options.channel });
    cleanupTasks.push(() => browserInfo.browser.close());
    const fallbackText = browserInfo.fallbacks.length > 0 ? `，回退自：${browserInfo.fallbacks.join("、")}` : "";
    console.log(`[browser] ${browserInfo.channel} ${browserInfo.version} 已启动（${options.headless ? "headless" : "headed"}${fallbackText}）`);

    for (const caseName of selectedCases) {
      console.log(`\n--- case: ${caseName} ---`);
      const run = new CaseRun({ caseName, evidenceDir, baseUrl: serverHandle.baseUrl });
      await run.prepare(browserInfo.browser);
      try {
        if (caseName === "normal") await runNormalCase(run);
        else await runLoginTimeoutCase(run);
      } catch (error) {
        run.failures.push(`[case ${caseName}] 未捕获异常：${errorText(error)}`);
      } finally {
        const result = await run.writeResult();
        await run.dispose();
        caseResults.push(result);
        const verdict = result.ok ? "PASS（绿）" : "FAIL（红）";
        console.log(
          `--- case ${caseName}: ${verdict}，${result.steps.length} 步，${result.evidence.length} 个证据，${(result.durationMs / 1000).toFixed(1)}s ---`,
        );
        for (const failure of result.failures) console.log(`    ✗ ${failure}`);
      }
    }
  } catch (error) {
    fatalError = error;
    console.error(`\n[e2e] 运行失败：${errorText(error)}`);
  } finally {
    if (browserInfo !== null) {
      try {
        await browserInfo.browser.close();
      } catch {
        // 已关闭
      }
    }
    if (serverHandle !== null) {
      const stopped = await serverHandle.stop();
      const portState = stopped.released ? "端口已释放" : "端口仍被占用⚠";
      const endState = stopped.forced ? "已强制结束" : `退出码 ${stopped.exitCode}`;
      console.log(`\n[demo-web] 已停止（pid ${serverHandle.pid}，${portState}，${endState}）`);
    }
    cleanupTasks.length = 0;
  }

  // ---- 汇总 ----
  const durationMs = Date.now() - suiteStartedAt;
  const expectations = [];
  let overallOk = fatalError === null && caseResults.length === selectedCases.length;

  for (const caseName of selectedCases) {
    const result = caseResults.find((item) => item.case === caseName) ?? null;
    const shouldBeRed = expectRed.has(caseName);
    const expected = shouldBeRed ? "red" : "green";
    const actual = result === null ? "missing" : result.ok ? "green" : "red";
    const ok = fatalError === null && result !== null && actual === expected;
    if (!ok) overallOk = false;
    expectations.push({ case: caseName, expected, actual, ok });
  }

  const allSteps = [];
  const allEvidence = [];
  for (const result of caseResults) {
    for (const step of result.steps) allSteps.push({ case: result.case, ...step });
    for (const relative of result.evidence) allEvidence.push(`${result.case}/${relative}`);
  }

  const summary = {
    suite: "e2e-browser/login-flow",
    case: options.case,
    ok: overallOk,
    headless: options.headless,
    browser: browserInfo === null
      ? null
      : { channel: browserInfo.channel, version: browserInfo.version, fallbacks: browserInfo.fallbacks, headless: options.headless },
    server: { url: serverHandle === null ? null : serverHandle.baseUrl, port: options.port },
    expectations,
    cases: caseResults,
    steps: allSteps,
    evidence: allEvidence,
    durationMs,
    resultFile: join(evidenceDir, "result.json"),
  };
  if (fatalError !== null) summary.error = errorText(fatalError);

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log("\n" + "=".repeat(72));
  console.log("结果汇总");
  console.log(`  浏览器: ${browserInfo === null ? "未启动" : `${browserInfo.channel} ${browserInfo.version}（${options.headless ? "headless" : "headed"}）`}`);
  for (const item of expectations) {
    const expectedText = item.expected === "green" ? "绿" : "红";
    const actualText = item.actual === "green" ? "绿（通过）" : item.actual === "red" ? "红（失败）" : "缺失";
    console.log(`  ${item.ok ? "✓" : "✗"} case ${item.case}：期望 ${expectedText}，实际 ${actualText}`);
  }
  if (fatalError !== null) console.log(`  ✗ 致命错误：${errorText(fatalError)}`);
  console.log(`  证据  : ${evidenceDir}`);
  console.log(`  结果  : ${join(evidenceDir, "result.json")}`);
  console.log(`  耗时  : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  结论  : ${overallOk ? "符合预期 → 退出码 0" : "不符合预期 → 退出码 1"}`);
  if (!overallOk && expectRed.size === 0) {
    console.log(
      "\n  提示：login-timeout 是复现「登录超时无提示」预置缺陷的 red test，默认退出码 1 属预期；\n" +
        "        修复前验收缺陷复现可加 --expect-red login-timeout（缺陷按预期复现则退出码 0）；\n" +
        "        只验证正常流程用 --case normal（应为退出码 0）。",
    );
  }
  console.log("=".repeat(72) + "\n");
  return overallOk ? 0 : 1;
}

const exitCode = await main().catch((error) => {
  console.error(`[e2e] 未捕获异常：${errorText(error)}`);
  return 1;
});
process.exitCode = exitCode;
