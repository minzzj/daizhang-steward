/**
 * 代掌 Steward · 浏览器适配器（Playwright 真实浏览器）
 *
 * 铁律（docs/zh-CN/adapters.md）：UI 验收必须使用真实 Chromium/Edge 有头模式，
 * 禁止 mock DOM / mock API 代替；适配器本身**不做任何风控绕过**（验证码一律停止交人）。
 *
 * 设计约定：
 * - 一个 `PlaywrightBrowser` 实例 = 一次 run：`launch()` 打开真实浏览器（默认有头），
 *   每个 run 使用独立 `userDataDir`（配置隔离），`close()` 后清理（自建目录）。
 * - 每个动作自动留证：截图 `evidenceDir/screenshots/<序号>-<name>.png`、
 *   DOM 快照 `evidenceDir/dom/<序号>-<name>.html`、控制台日志汇总写 `evidenceDir/console.log`，
 *   全部步骤汇总写 `evidenceDir/steps.json`。
 * - 失败分类：元素找不到 / 导航超时 / 权限拒绝 / 风控拦截 / 未知；
 *   普通失败以结构化步骤结果返回（`ok:false` + `failureKind`），
 *   命中风控关键词时**抛出** `RiskControlStopError`（停止并交人，不绕过）。
 * - 证据路径一律为绝对路径（与 steward-core 的 `ArtifactBus.rel()` 兼容）。
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext, ConsoleMessage, Page } from "playwright-core";
import { redactSecrets } from "../../steward-core/src/index.js";
import type { RiskLevel, ToolSpec } from "../../steward-core/src/index.js";

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

/** 真实浏览器通道：本机已安装的 Chrome / Edge；`chromium` 为 Playwright 自带（playwright-core 下通常不可用）。 */
export type BrowserChannel = "chrome" | "msedge" | "chromium";

/** 失败分类（与 docs/zh-CN/adapters.md 的失败边界一一对应）。 */
export type BrowserFailureKind =
  | "element-not-found"
  | "navigation-timeout"
  | "permission-denied"
  | "risk-control"
  | "unknown";

export interface BrowserViewport {
  width: number;
  height: number;
}

export interface BrowserLaunchOptions {
  /** 证据目录（必填）：截图、DOM、控制台日志、步骤汇总都写到这里。 */
  evidenceDir: string;
  /** 默认 `false`（有头）。产品验收（A2/A4/A5）必须为有头模式。 */
  headless?: boolean;
  /** 首选通道；缺省按 chrome → msedge 依次尝试。 */
  channel?: BrowserChannel;
  /** 自定义配置目录；缺省为每个 run 在系统临时目录下生成独立目录。 */
  userDataDir?: string;
  /** 默认 1440×900。 */
  viewport?: BrowserViewport;
  /** 单个动作默认超时，默认 10000ms。 */
  actionTimeoutMs?: number;
  /** 导航默认超时，默认 20000ms。 */
  navigationTimeoutMs?: number;
  /** 是否在每步后检测风控关键词，默认 true。 */
  riskControlDetection?: boolean;
}

export interface BrowserLaunchInfo {
  /** 实际使用的通道。 */
  channel: BrowserChannel;
  /** 启动时先失败、随后回退的通道。 */
  fallbacks: BrowserChannel[];
  headless: boolean;
  userDataDir: string;
  evidenceDir: string;
  browserVersion: string;
  startedAt: string;
}

/** 结构化步骤结果（字段只增不减）。 */
export interface BrowserStepResult {
  stepIndex: number;
  action: string;
  ok: boolean;
  evidence: string[];
  durationMs: number;
  selector?: string;
  error?: string;
  failureKind?: BrowserFailureKind;
  /** 读取类动作的结果值（如 `text()` 的文本、`isVisible()` 的 "true"/"false"）。 */
  value?: string;
  /** 导航类动作的 HTTP 状态码（拿不到时省略）。 */
  httpStatus?: number;
}

/** `recordStep()` 的输入，供适配器内部与上层工具共同使用。 */
export interface BrowserStepInput {
  action: string;
  ok: boolean;
  evidence?: readonly string[];
  selector?: string;
  error?: string;
  failureKind?: BrowserFailureKind;
  value?: string;
  httpStatus?: number;
  durationMs?: number;
}

export interface BrowserConsoleEntry {
  ts: string;
  /** console 消息类型（log/warning/error…）或 `pageerror`。 */
  type: string;
  text: string;
  pageUrl: string;
  /** `url:line:column`；拿不到时为空串。 */
  location: string;
}

export interface RiskControlStopInput {
  keywords: readonly string[];
  url?: string;
  evidence?: readonly string[];
}

// ---------------------------------------------------------------------------
// 默认值 / 工具函数 / 风控检测
// ---------------------------------------------------------------------------

export const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
export const DEFAULT_VIEWPORT: BrowserViewport = { width: 1440, height: 900 };

const DEFAULT_CHANNEL_ORDER: readonly BrowserChannel[] = ["chrome", "msedge"];

/**
 * 风控/验证码关键词（命中即停止并交人，不尝试绕过）。
 * 只收录强信号，避免把普通登录页的「身份验证」等常规文案误判为风控。
 */
export const RISK_CONTROL_KEYWORDS: readonly string[] = [
  "验证码",
  "安全验证",
  "安全校验",
  "人机验证",
  "滑块验证",
  "滑动验证",
  "图形验证",
  "二次验证",
  "双重验证",
  "请完成验证",
  "访问受限",
  "账号异常",
  "账号已被限制",
  "captcha",
  "recaptcha",
  "hcaptcha",
  "2fa",
  "two-factor",
  "two factor",
  "verification code",
  "verify you are human",
  "verify it's you",
  "robot check",
  "unusual activity",
];

/** 命中风控关键词时抛出：停止并交人，禁止绕过。 */
export class RiskControlStopError extends Error {
  readonly keywords: string[];
  readonly url: string;
  readonly evidence: string[];

  constructor(input: RiskControlStopInput) {
    const keywords = input.keywords.length > 0 ? input.keywords.join("、") : "（页面文本命中）";
    super(`检测到风控/验证码拦截（关键词：${keywords}）：停止并交人处理，不绕过。`);
    this.name = "RiskControlStopError";
    this.keywords = [...input.keywords];
    this.url = input.url ?? "";
    this.evidence = [...(input.evidence ?? [])];
  }
}

/** 返回文本命中的风控关键词（大小写不敏感，去重；未命中返回空数组）。 */
export function detectRiskControlKeywords(text: string, extraKeywords: readonly string[] = []): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const hits: string[] = [];
  for (const keyword of [...RISK_CONTROL_KEYWORDS, ...extraKeywords]) {
    const needle = keyword.toLowerCase();
    if (needle.length > 0 && haystack.includes(needle) && !hits.includes(keyword)) hits.push(keyword);
  }
  return hits;
}

/** 页面文本是否像风控/验证码页面（命中即应停止交人）。 */
export function isLikelyRiskControl(text: string): boolean {
  return detectRiskControlKeywords(text).length > 0;
}

/** 把任意异常格式化为单段可读文本（已脱敏）。 */
export function formatBrowserError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactSecrets(raw).trim().slice(0, 2000);
}

/**
 * 失败分类：元素找不到 / 导航超时 / 权限拒绝 / 风控拦截 / 未知。
 * 页面文本（可选）优先用于风控判定。
 */
export function classifyBrowserFailure(error: unknown, pageText = ""): BrowserFailureKind {
  const message = formatBrowserError(error).toLowerCase();
  if (detectRiskControlKeywords(message).length > 0 || isLikelyRiskControl(pageText)) {
    return "risk-control";
  }
  if (/(page\.goto|net::err_|navigation (?:timeout|failed)|navigation was interrupted|frame was detached)/.test(message)) {
    return "navigation-timeout";
  }
  if (
    /(waiting for (?:locator|selector|element)|no element|element (?:is not|was not)|strict mode violation|resolved to \d+ elements|locator\.(?:click|fill|waitfor|textcontent)|page\.(?:click|fill|waitfor))/.test(
      message,
    )
  ) {
    return "element-not-found";
  }
  if (/(permission|access is denied|not allowed|denied|eperm|eacces)/.test(message)) {
    return "permission-denied";
  }
  return "unknown";
}

function resolveChannelCandidates(requested: BrowserChannel | undefined): BrowserChannel[] {
  if (requested === undefined) return [...DEFAULT_CHANNEL_ORDER];
  return [requested, ...DEFAULT_CHANNEL_ORDER.filter((channel) => channel !== requested)];
}

function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned === "" ? "step" : cleaned).slice(0, 60);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

interface StepOutcome {
  value?: string;
  httpStatus?: number;
}

/** Playwright 真实浏览器适配器（有头默认、通道回退、每 run 独立配置目录、每步自动留证）。 */
export class PlaywrightBrowser {
  private readonly runId: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private launchInfo: BrowserLaunchInfo | null = null;
  private evidenceDirPath = "";
  private screenshotsDir = "";
  private domDir = "";
  private consoleLogPath = "";
  private stepsPath = "";
  private actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS;
  private navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS;
  private riskControlDetection = true;
  private profileOwned = false;
  private userDataDir = "";
  private evidenceSeq = 0;
  private readonly steps: BrowserStepResult[] = [];
  private readonly consoleEntries: BrowserConsoleEntry[] = [];
  private readonly pendingLogLines: string[] = [];

  constructor() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runId = `browser-${stamp}-${randomUUID().slice(0, 8)}`;
  }

  /** 本次 run 标识（用于独立 userDataDir 与证据元数据）。 */
  get id(): string {
    return this.runId;
  }

  /** 启动成功后的信息；未启动为 null。 */
  get info(): BrowserLaunchInfo | null {
    return this.launchInfo;
  }

  /** 已记录的步骤结果（只读视图）。 */
  get stepResults(): readonly BrowserStepResult[] {
    return this.steps;
  }

  /** 证据根目录；未启动为空串。 */
  get evidenceRoot(): string {
    return this.evidenceDirPath;
  }

  /** 当前页面 URL；未启动或页面已关闭为空串。 */
  currentUrl(): string {
    const page = this.page;
    return page === null ? "" : this.safeUrl(page);
  }

  /**
   * 启动真实浏览器。默认有头；`channel` 缺省按 chrome → msedge 依次尝试；
   * 每个 run 独立 userDataDir（调用方指定则用指定目录，不自动清理）。
   */
  async launch(options: BrowserLaunchOptions): Promise<BrowserLaunchInfo> {
    if (this.context !== null) {
      throw new Error("浏览器已启动：一个 PlaywrightBrowser 实例只对应一次 run，请先 close()");
    }
    if (typeof options.evidenceDir !== "string" || options.evidenceDir.trim() === "") {
      throw new Error("launch 必须提供 evidenceDir（证据目录）");
    }

    this.evidenceDirPath = resolve(options.evidenceDir);
    this.screenshotsDir = join(this.evidenceDirPath, "screenshots");
    this.domDir = join(this.evidenceDirPath, "dom");
    this.consoleLogPath = join(this.evidenceDirPath, "console.log");
    this.stepsPath = join(this.evidenceDirPath, "steps.json");
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    this.riskControlDetection = options.riskControlDetection ?? true;
    const headless = options.headless ?? false;

    await mkdir(this.screenshotsDir, { recursive: true });
    await mkdir(this.domDir, { recursive: true });

    const candidates = resolveChannelCandidates(options.channel);
    const attempts: string[] = [];
    const attemptedProfileDirs: string[] = [];

    for (const [index, channel] of candidates.entries()) {
      const ownedProfile = options.userDataDir === undefined;
      const userDataDir =
        options.userDataDir === undefined
          ? join(tmpdir(), "daizhang-steward-browser", `${this.runId}-${channel}`)
          : resolve(options.userDataDir);
      if (ownedProfile) attemptedProfileDirs.push(userDataDir);
      try {
        if (ownedProfile) await mkdir(userDataDir, { recursive: true });
        const context = await chromium.launchPersistentContext(userDataDir, {
          channel,
          headless,
          viewport: options.viewport ?? DEFAULT_VIEWPORT,
          args: ["--no-first-run", "--no-default-browser-check"],
        });
        this.context = context;
        this.profileOwned = ownedProfile;
        this.userDataDir = userDataDir;
        context.setDefaultTimeout(this.actionTimeoutMs);
        context.setDefaultNavigationTimeout(this.navigationTimeoutMs);

        const existing = context.pages();
        const first = existing[0] ?? (await context.newPage());
        this.page = first;
        this.attachPage(first);
        // 多标签：新开的标签自动成为当前操作页
        context.on("page", (newPage) => {
          this.attachPage(newPage);
          this.page = newPage;
        });

        const browserVersion = context.browser()?.version() ?? "unknown";
        this.launchInfo = {
          channel,
          fallbacks: candidates.slice(0, index),
          headless,
          userDataDir,
          evidenceDir: this.evidenceDirPath,
          browserVersion,
          startedAt: new Date().toISOString(),
        };
        this.pendingLogLines.push(
          `[launch] channel=${channel} browser=${browserVersion} headless=${headless} userDataDir=${userDataDir}`,
        );
        await this.flushConsoleLog();
        return this.launchInfo;
      } catch (error) {
        attempts.push(`${channel}: ${formatBrowserError(error)}`);
      }
    }

    for (const dir of attemptedProfileDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // 清理失败不影响错误上报
      }
    }
    throw new Error(
      `真实浏览器启动失败（已按顺序尝试 ${candidates.join(" → ")}）：${attempts.join(" | ")}。` +
        "请确认本机已安装 Chrome 或 Edge；产品验收必须真实浏览器。",
    );
  }

  /** 打开页面（真实导航）。 */
  async goto(url: string, timeoutMs?: number): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("goto", undefined, async () => {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs ?? this.navigationTimeoutMs,
      });
      const outcome: StepOutcome = { value: page.url() };
      if (response !== null) outcome.httpStatus = response.status();
      return outcome;
    });
  }

  /** 真实点击元素（取第一个匹配）。 */
  async click(selector: string, timeoutMs?: number): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("click", selector, async () => {
      await page.locator(selector).first().click({ timeout: timeoutMs ?? this.actionTimeoutMs });
      return {};
    });
  }

  /** 真实输入（值不写入日志，避免凭据泄漏）。 */
  async fill(selector: string, value: string, timeoutMs?: number): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("fill", selector, async () => {
      await page.locator(selector).first().fill(value, { timeout: timeoutMs ?? this.actionTimeoutMs });
      return {};
    });
  }

  /** 键盘按键（当前焦点，如 Enter / Tab）。 */
  async press(key: string): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("press", undefined, async () => {
      await page.keyboard.press(key);
      return {};
    });
  }

  /** 等待元素可见。 */
  async waitFor(selector: string, timeoutMs?: number): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("waitFor", selector, async () => {
      await page.locator(selector).first().waitFor({
        state: "visible",
        timeout: timeoutMs ?? this.actionTimeoutMs,
      });
      return {};
    });
  }

  /** 读取元素文本（attached 即可，不要求可见）。 */
  async text(selector: string): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("text", selector, async () => {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "attached", timeout: this.actionTimeoutMs });
      const value = (await locator.textContent()) ?? "";
      return { value: value.trim() };
    });
  }

  /** 轮询等待元素文本包含 `expected`（用于等待异步结果文案）。 */
  async waitForText(selector: string, expected: string, timeoutMs?: number): Promise<BrowserStepResult> {
    const page = this.requirePage();
    const timeout = timeoutMs ?? this.actionTimeoutMs;
    return this.executeStep("waitForText", selector, async () => {
      const locator = page.locator(selector).first();
      const deadline = Date.now() + timeout;
      let latest = "";
      while (Date.now() < deadline) {
        try {
          if ((await locator.count()) > 0) {
            latest = (await locator.textContent({ timeout: 1000 })) ?? "";
            if (latest.includes(expected)) return { value: latest.trim() };
          }
        } catch {
          // 元素暂不可读（导航中/重建中），继续轮询
        }
        await sleep(100);
      }
      throw new Error(
        `等待文本超时（${timeout}ms）：${selector} 未包含「${expected}」，当前文本「${latest.trim().slice(0, 200)}」`,
      );
    });
  }

  /** 元素当前是否可见（返回字符串 "true"/"false"）。 */
  async isVisible(selector: string): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("isVisible", selector, async () => ({
      value: String(await page.locator(selector).first().isVisible()),
    }));
  }

  /** 元素当前是否可用（返回字符串 "true"/"false"）。 */
  async isEnabled(selector: string): Promise<BrowserStepResult> {
    const page = this.requirePage();
    return this.executeStep("isEnabled", selector, async () => ({
      value: String(await page.locator(selector).first().isEnabled()),
    }));
  }

  /** 显式截图到 `evidenceDir/screenshots/<序号>-<name>.png`。 */
  async screenshot(name = "screenshot"): Promise<BrowserStepResult> {
    const startedAt = Date.now();
    const file = await this.writeScreenshot(name);
    const step = this.recordStep({
      action: "screenshot",
      ok: true,
      evidence: [file],
      durationMs: Date.now() - startedAt,
      value: name,
    });
    await this.flushConsoleLog();
    return step;
  }

  /** 显式保存 DOM 快照到 `evidenceDir/dom/<序号>-<name>.html`。 */
  async domSnapshot(name = "snapshot"): Promise<BrowserStepResult> {
    const startedAt = Date.now();
    const file = await this.writeDom(name);
    const step = this.recordStep({
      action: "domSnapshot",
      ok: true,
      evidence: [file],
      durationMs: Date.now() - startedAt,
      value: name,
    });
    await this.flushConsoleLog();
    return step;
  }

  /** 取回浏览器 console / pageerror 日志，并落盘 `console.log`。 */
  async collectConsole(): Promise<BrowserConsoleEntry[]> {
    await this.flushConsoleLog();
    return this.consoleEntries.map((entry) => ({ ...entry }));
  }

  /** 记录一条结构化步骤结果（返回同一对象；上层工具可复用来登记外部动作）。 */
  recordStep(input: BrowserStepInput): BrowserStepResult {
    const evidence = input.evidence === undefined ? [] : [...input.evidence];
    const step: BrowserStepResult = {
      stepIndex: this.steps.length + 1,
      action: input.action,
      ok: input.ok,
      evidence,
      durationMs: input.durationMs ?? 0,
    };
    if (input.selector !== undefined) step.selector = input.selector;
    if (input.error !== undefined) step.error = redactSecrets(input.error).slice(0, 2000);
    if (input.failureKind !== undefined) step.failureKind = input.failureKind;
    if (input.value !== undefined) step.value = input.value;
    if (input.httpStatus !== undefined) step.httpStatus = input.httpStatus;
    this.steps.push(step);
    const suffix = step.selector === undefined ? "" : ` ${step.selector}`;
    const failure = step.failureKind === undefined ? "" : ` failureKind=${step.failureKind}`;
    const errorText = step.error === undefined ? "" : ` error=${step.error.replaceAll("\n", " ").slice(0, 300)}`;
    this.pendingLogLines.push(
      `[step ${String(step.stepIndex).padStart(2, "0")}] ${step.action}${suffix} ok=${String(step.ok)}${failure}${errorText}`,
    );
    return step;
  }

  /** 关闭浏览器：先落盘证据（console.log / steps.json），再关闭上下文并清理自建配置目录。 */
  async close(): Promise<void> {
    const context = this.context;
    if (context === null) return;
    this.context = null;
    this.page = null;
    this.pendingLogLines.push(
      `[close] steps=${this.steps.length} screenshots=${this.countEvidence("screenshots")} dom=${this.countEvidence("dom")}`,
    );
    try {
      await this.flushConsoleLog();
      await this.writeStepsFile();
    } finally {
      try {
        await context.close();
      } catch {
        // 浏览器已崩溃/已关闭时忽略
      }
      if (this.profileOwned) {
        try {
          await rm(this.userDataDir, { recursive: true, force: true });
        } catch {
          // 清理失败不影响退出
        }
        this.profileOwned = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 内部实现
  // -------------------------------------------------------------------------

  private requirePage(): Page {
    if (this.page === null) {
      throw new Error("浏览器尚未启动：请先 await browser.launch({ evidenceDir })");
    }
    return this.page;
  }

  private attachPage(page: Page): void {
    page.setDefaultTimeout(this.actionTimeoutMs);
    page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
    page.on("console", (message: ConsoleMessage) => this.recordConsole(message, page));
    page.on("pageerror", (error: Error) => {
      const text = redactSecrets(error.message);
      this.consoleEntries.push({
        ts: new Date().toISOString(),
        type: "pageerror",
        text,
        pageUrl: this.safeUrl(page),
        location: "",
      });
      this.pendingLogLines.push(`[pageerror] ${text}`);
    });
    page.on("crash", () => {
      this.pendingLogLines.push(`[crash] 页面崩溃：${this.safeUrl(page)}`);
    });
  }

  private recordConsole(message: ConsoleMessage, page: Page): void {
    let location = "";
    try {
      const loc = message.location();
      location = `${loc.url}:${loc.lineNumber}:${loc.columnNumber}`;
    } catch {
      location = "";
    }
    const entry: BrowserConsoleEntry = {
      ts: new Date().toISOString(),
      type: message.type(),
      text: redactSecrets(message.text()),
      pageUrl: this.safeUrl(page),
      location,
    };
    this.consoleEntries.push(entry);
    this.pendingLogLines.push(`[console:${entry.type}] ${entry.text}`);
  }

  private safeUrl(page: Page): string {
    try {
      return page.url();
    } catch {
      return "";
    }
  }

  private async pageText(page: Page): Promise<string> {
    try {
      const text = await page.locator("body").innerText({ timeout: 2000 });
      return text.slice(0, 6000);
    } catch {
      return "";
    }
  }

  /**
   * 执行一个动作：成功/失败都自动留证（截图 + DOM），失败分类；
   * 命中风控关键词时记录步骤后抛 `RiskControlStopError`。
   */
  private async executeStep(
    action: string,
    selector: string | undefined,
    task: (page: Page) => Promise<StepOutcome>,
  ): Promise<BrowserStepResult> {
    const startedAt = Date.now();
    const page = this.requirePage();
    let outcome: StepOutcome = {};
    let failure: unknown = null;
    try {
      outcome = await task(page);
    } catch (error) {
      failure = error;
    }

    const evidence: string[] = [];
    let captureError: unknown = null;
    try {
      evidence.push(...(await this.captureEvidence(action, failure !== null)));
    } catch (error) {
      captureError = error;
    }

    const pageText = this.riskControlDetection ? await this.pageText(page) : "";
    if (failure === null && captureError !== null) failure = captureError;
    const failureText = failure === null ? "" : formatBrowserError(failure);
    const keywords = detectRiskControlKeywords(`${pageText}\n${failureText}`);

    if (failure !== null || keywords.length > 0) {
      const kind: BrowserFailureKind = keywords.length > 0 ? "risk-control" : classifyBrowserFailure(failure, pageText);
      const input: BrowserStepInput = {
        action,
        ok: false,
        evidence,
        failureKind: kind,
        durationMs: Date.now() - startedAt,
        error: failure === null ? `命中风控关键词：${keywords.join("、")}` : failureText,
      };
      if (selector !== undefined) input.selector = selector;
      const step = this.recordStep(input);
      await this.flushConsoleLog();
      if (kind === "risk-control") {
        await this.flushEvidenceFiles();
        throw new RiskControlStopError({ keywords, url: this.safeUrl(page), evidence });
      }
      return step;
    }

    const input: BrowserStepInput = {
      action,
      ok: true,
      evidence,
      durationMs: Date.now() - startedAt,
    };
    if (selector !== undefined) input.selector = selector;
    if (outcome.value !== undefined) input.value = outcome.value;
    if (outcome.httpStatus !== undefined) input.httpStatus = outcome.httpStatus;
    const step = this.recordStep(input);
    await this.flushConsoleLog();
    return step;
  }

  private async captureEvidence(label: string, failure: boolean): Promise<string[]> {
    const name = failure ? `${label}-error` : label;
    return [await this.writeScreenshot(name), await this.writeDom(name)];
  }

  private nextEvidenceName(name: string, extension: string): string {
    this.evidenceSeq += 1;
    return `${String(this.evidenceSeq).padStart(3, "0")}-${sanitizeName(name)}.${extension}`;
  }

  private async writeScreenshot(name: string): Promise<string> {
    const page = this.requirePage();
    const file = join(this.screenshotsDir, this.nextEvidenceName(name, "png"));
    await page.screenshot({ path: file, fullPage: false, timeout: this.actionTimeoutMs });
    return file;
  }

  private async writeDom(name: string): Promise<string> {
    const page = this.requirePage();
    const html = await page.content();
    const file = join(this.domDir, this.nextEvidenceName(name, "html"));
    await writeFile(file, html, "utf8");
    return file;
  }

  private async flushConsoleLog(): Promise<void> {
    if (this.pendingLogLines.length === 0 || this.consoleLogPath === "") return;
    const lines = this.pendingLogLines.splice(0, this.pendingLogLines.length);
    const body = lines.map((line) => `[${new Date().toISOString()}] ${line}`).join("\n") + "\n";
    try {
      await appendFile(this.consoleLogPath, body, "utf8");
    } catch {
      // 控制台汇总写失败不阻断动作：截图/DOM 是主证据
    }
  }

  private async writeStepsFile(): Promise<void> {
    if (this.stepsPath === "") return;
    const payload = {
      runId: this.runId,
      launch: this.launchInfo,
      steps: this.steps,
      console: this.consoleEntries,
    };
    await writeFile(this.stepsPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  /** 风控等需要“立刻停止”的场景：先确保 console.log 与 steps.json 落盘再抛错。 */
  private async flushEvidenceFiles(): Promise<void> {
    await this.flushConsoleLog();
    await this.writeStepsFile();
  }

  private countEvidence(kind: "screenshots" | "dom"): number {
    // 证据计数只用于日志摘要：按步骤证据路径后缀统计
    const suffix = kind === "screenshots" ? ".png" : ".html";
    return this.steps.reduce((total, step) => total + step.evidence.filter((file) => file.endsWith(suffix)).length, 0);
  }
}

// ---------------------------------------------------------------------------
// 与 steward-core ToolRegistry 的衔接（M1 Operator 分支注册用）
// ---------------------------------------------------------------------------

const BROWSER_TOOLS: ReadonlyArray<{ name: string; description: string; risk: RiskLevel }> = [
  { name: "browser.goto", description: "真实浏览器打开 URL（有头，默认 Chrome/Edge）", risk: "medium" },
  { name: "browser.click", description: "真实点击页面元素（第一个匹配）", risk: "medium" },
  { name: "browser.fill", description: "真实输入文本（不记录输入值）", risk: "medium" },
  { name: "browser.press", description: "真实键盘按键", risk: "medium" },
  { name: "browser.waitFor", description: "等待元素可见", risk: "low" },
  { name: "browser.text", description: "读取元素文本", risk: "low" },
  { name: "browser.waitForText", description: "等待元素文本包含指定内容", risk: "low" },
  { name: "browser.isVisible", description: "查询元素是否可见", risk: "low" },
  { name: "browser.isEnabled", description: "查询元素是否可用", risk: "low" },
  { name: "browser.screenshot", description: "截图留证", risk: "low" },
  { name: "browser.domSnapshot", description: "保存 DOM 快照留证", risk: "low" },
];

/** 浏览器工具规格：交给 `ToolRegistry.register()` 使用（handler 由 M1 Operator 装配）。 */
export function browserToolSpecs(): ToolSpec[] {
  return BROWSER_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    requiresApproval: false,
    evidence: true,
  }));
}
