#!/usr/bin/env node
/**
 * tests/e2e-desktop/run.mjs — A3 真实 Windows 桌面验收（真实窗口 + 真实键鼠 + 每步截图）
 *
 * 铁律：本脚本**不使用任何 mock**：启动真实的 `examples/demo-desktop/main.py`（Python
 * tkinter 真窗口），用 `packages/steward-desktop` 适配器通过 Windows 系统调用（EnumWindows /
 * SetForegroundWindow / BitBlt / SendInput）完成真实操作，并用 `--out` 指定的真实 JSON 文件
 * 做内容断言。没有截图的「成功」视为失败。
 *
 * 验收流程（每步都有截图证据）：
 *   1) 启动适配器 → 等待桌面空闲（GetLastInputInfo，避免与真人键鼠互相打断）；
 *   2) 打开：spawn demo-desktop，等待标题「代掌演示表单」的真实窗口出现（最长 20s）+ 截图；
 *   3) 填表：真实鼠标点击「客户名称」→ 真实键盘输入 → TAB → 输入项目名称 → 截图；
 *   4) 保存：真实鼠标点击「保存」→ 等待 JSON 落盘 → 读 JSON 校验 customer/project/saved_at；
 *   5) 校验失败：真实鼠标点击「清空」→ 点击「保存」→ 断言 JSON **未被覆盖**（客户名称为空）+ 截图；
 *   6) 部分校验：只填客户名称点击「校验」→ 断言仍不写文件（项目名称为空）+ 截图；
 *   7) 凭据保护：断言当前无凭据/安全提示窗口（凭据输入一律交人）；
 *   8) 关闭：WM_CLOSE 真实关窗 → 等待进程退出；超时用 taskkill 兜底并断言无残留。
 *
 * 真实桌面是共享资源：脚本带「焦点被抢 / 内容被真人输入污染」的有限次重试，
 * 但**任何情况下都不会把键鼠事件注入非白名单窗口**（白名单守卫命中即停止/重试）。
 *
 * 用法：
 *   npm run build
 *   node tests/e2e-desktop/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-desktop
 *   node tests/e2e-desktop/run.mjs --evidence-dir runs\e2e-desktop --timeout 120000
 *
 * 退出码：0 全部通过 / 1 验收失败 / 2 用法或环境错误（缺构建产物、缺 Python 等）。
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const ADAPTER_PATH = join(REPO_ROOT, "dist", "packages", "steward-desktop", "src", "index.js");
const DEFAULT_WORKDIR = join(REPO_ROOT, "examples", "demo-desktop");
const DEFAULT_EVIDENCE_DIR = join(REPO_ROOT, "runs", `e2e-desktop-${timestampSlug()}`);
const DEMO_SCRIPT = "main.py";
const WINDOW_TITLE = "代掌演示表单";

const CUSTOMER = "示例客户";
const PROJECT = "官网改版";
const PARTIAL_CUSTOMER = "仅客户";
const DEFAULT_TIMEOUT_MS = 120_000;
const WINDOW_WAIT_MS = 20_000;
const SAVE_WAIT_MS = 5_000;
const FILL_MAX_ATTEMPTS = 4;
const VALIDATION_MAX_ATTEMPTS = 3;

/**
 * demo-desktop 的固定逻辑布局（由真实截图逐像素实测得到，见
 * packages/steward-desktop/README.md「已知限制：坐标依赖」）。坐标为 640×470 客户区内的
 * 逻辑像素中心点；脚本按实际 `clientRect.width / 640` 换算成物理像素，因此
 * 高 DPI 缩放（125%/150%）下同样可用。
 */
const LAYOUT = {
  clientWidth: 640,
  clientHeight: 470,
  customerEntry: { x: 300, y: 117 },
  projectEntry: { x: 300, y: 158 },
  saveButton: { x: 61, y: 369 },
  validateButton: { x: 159, y: 369 },
  clearButton: { x: 257, y: 369 },
};

const INTERACTIVE_ACTIONS = new Set(["focusWindow", "click", "doubleClick", "typeText", "pressKey"]);

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function timestampSlug() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function log(message) {
  console.log(`[e2e-desktop] ${message}`);
}

function formatError(error) {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

function failEnvironment(message) {
  console.error(`[e2e-desktop] 环境错误：${message}`);
  process.exit(2);
}

function printHelp() {
  console.log(`真实 Windows 桌面 E2E（A3 验收）— 真实窗口 + 真实键鼠 + 每步截图

用法：
  npm run build
  node tests/e2e-desktop/run.mjs [选项]

选项：
  --evidence-dir <目录>   证据目录（result.json / screenshots/ / steps.json / app.log），
                          默认 runs/e2e-desktop-<时间戳>
  --out <JSON 路径>       demo 保存的 JSON 路径，默认 <evidence-dir>/project.json
  --workdir <目录>        demo-desktop 所在目录，默认 examples/demo-desktop
  --timeout <毫秒>        整个 E2E 的总超时，默认 ${DEFAULT_TIMEOUT_MS}
  --python <命令>         Python 解释器，默认环境变量 STEWARD_PYTHON 或 python
  --headed                真实桌面模式（默认，桌面验收必须；保留该参数便于显式声明）
  --keep-app              调试用：失败后不清理 demo 进程（会残留进程，禁止用于验收）
  -h, --help              显示本帮助

说明：
  - 只支持 Windows 真实桌面会话（有交互桌面、未锁屏）；不支持 --headless。
  - 真实桌面是共享资源：脚本先等待桌面空闲，焦点被抢/输入被污染时有限次重试，
    但绝不把键鼠事件注入非白名单窗口。
  - 退出码 0 = 全部通过，1 = 验收失败，2 = 用法/环境错误。
`);
}

function parseArgs(argv) {
  const args = {
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    out: null,
    workdir: DEFAULT_WORKDIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    python: process.env.STEWARD_PYTHON ?? "python",
    keepApp: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "-h" || raw === "--help") {
      args.help = true;
      continue;
    }
    if (raw === "--headed") continue;
    if (raw === "--keep-app") {
      args.keepApp = true;
      continue;
    }
    if (raw === "--headless") {
      throw new Error("桌面 E2E 必须使用真实桌面会话，不支持 --headless");
    }
    const eq = raw.indexOf("=");
    const name = eq >= 0 ? raw.slice(2, eq) : raw.startsWith("--") ? raw.slice(2) : "";
    const inlineValue = eq >= 0 ? raw.slice(eq + 1) : undefined;
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${raw} 缺少参数值`);
      return value;
    };
    switch (name) {
      case "evidence-dir":
        args.evidenceDir = takeValue();
        break;
      case "out":
        args.out = takeValue();
        break;
      case "workdir":
        args.workdir = takeValue();
        break;
      case "python":
        args.python = takeValue();
        break;
      case "timeout": {
        const value = takeValue();
        if (!/^\d+$/.test(value)) throw new Error(`--timeout 需要正整数毫秒，收到：${value}`);
        args.timeoutMs = Number(value);
        break;
      }
      default:
        throw new Error(`未知参数：${raw}`);
    }
  }
  args.evidenceDir = resolve(args.evidenceDir);
  args.out = args.out === null ? join(args.evidenceDir, "project.json") : resolve(args.out);
  args.workdir = resolve(args.workdir);
  return args;
}

function isProcessAlive(pid) {
  if (pid === undefined || pid === null) return false;
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return output.includes(String(pid));
}

function taskkillTree(pid) {
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(path)) return true;
    await sleep(100);
  }
  return pathExists(path);
}

function isFocusInterference(error) {
  const text = formatError(error);
  return (
    (error instanceof Error && error.name === "DesktopAllowlistError") ||
    text.includes("focus-lost") ||
    text.includes("失去前台焦点")
  );
}

// ---------------------------------------------------------------------------
// demo 应用进程封装（真实 spawn / 真实退出）
// ---------------------------------------------------------------------------

function createAppHandle({ python, workdir, outPath, logPath }) {
  const child = spawn(python, ["-u", DEMO_SCRIPT, "--out", outPath], {
    cwd: workdir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  const logChunks = [];
  let spawnError = null;
  let exited = false;
  let exitInfo = null;
  const exitPromise = new Promise((resolvePromise) => {
    child.once("exit", (code, signal) => {
      exited = true;
      exitInfo = { code, signal, at: new Date().toISOString() };
      resolvePromise(exitInfo);
    });
    child.once("error", (error) => {
      spawnError = error;
      exited = true;
      resolvePromise({ code: null, signal: null, spawnError: error.message });
    });
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    logChunks.push(`[stdout] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    logChunks.push(`[stderr] ${chunk}`);
  });
  return {
    get pid() {
      return child.pid;
    },
    get spawnError() {
      return spawnError;
    },
    get exitInfo() {
      return exitInfo;
    },
    alive: () => !exited,
    waitExit: async (timeoutMs) => {
      if (exited) return true;
      await Promise.race([exitPromise, sleep(timeoutMs)]);
      return exited;
    },
    flushLog: async () => {
      if (logChunks.length === 0) return;
      try {
        await writeFile(logPath, logChunks.join(""), "utf8");
      } catch {
        // 日志落盘失败不改变验收结论
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 结果记录
// ---------------------------------------------------------------------------

function createRecorder() {
  return {
    checks: [],
    steps: [],
    failures: [],
    error: null,
    recordCheck(name, ok, detail) {
      const entry = { name, ok: Boolean(ok), detail: detail === undefined ? "" : String(detail) };
      this.checks.push(entry);
      if (!entry.ok) this.failures.push(name);
      log(`${entry.ok ? "OK  " : "FAIL"} ${name}${detail === undefined || detail === "" ? "" : ` — ${detail}`}`);
      return entry.ok;
    },
    recordStep(name, detail) {
      const entry = { name, detail: detail === undefined ? "" : String(detail), at: new Date().toISOString() };
      this.steps.push(entry);
      log(`STEP ${name}${entry.detail === "" ? "" : ` — ${entry.detail}`}`);
    },
  };
}

// ---------------------------------------------------------------------------
// 共享真实桌面的健壮性辅助
// ---------------------------------------------------------------------------

/**
 * 等待桌面空闲（真人最近一次键鼠输入距今 ≥ minIdleMs）。
 * 只在开始注入键鼠前使用，降低与真人操作互相打断的概率；超时则记录并继续。
 */
async function waitForDesktopIdle(desktop, recorder, options = {}) {
  const minIdleMs = options.minIdleMs ?? 700;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const started = Date.now();
  let idle = 0;
  try {
    while (Date.now() - started < timeoutMs) {
      idle = await desktop.getIdleMs();
      if (idle >= minIdleMs) {
        recorder.recordStep("等待桌面空闲", `真人最近输入已过 ${idle}ms（阈值 ${minIdleMs}ms）`);
        return true;
      }
      await sleep(150);
    }
  } catch {
    return false;
  }
  recorder.recordStep("等待桌面空闲超时", `最近空闲仅 ${idle}ms；继续执行（真实桌面可能有真人并发操作，脚本会做焦点/内容重试）`);
  return false;
}

/** 真实聚焦 demo 窗口并确认它确实是前台窗口（最多 3 次尝试）。 */
async function focusDemoWindow(desktop, recorder, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const step = await desktop.focusWindow(WINDOW_TITLE);
    if (step.ok && (await desktop.isWindowFocused(WINDOW_TITLE))) {
      if (attempt > 1) recorder.recordStep(`重新聚焦 demo 窗口成功（${label}）`, `第 ${attempt} 次尝试`);
      return true;
    }
    await sleep(150);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function run() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[e2e-desktop] 参数错误：${formatError(error).split("\n")[0]}`);
    console.error("[e2e-desktop] 用 --help 查看用法");
    return 2;
  }
  if (args.help) {
    printHelp();
    return 0;
  }

  // ---- 环境自检 -----------------------------------------------------------
  if (!existsSync(ADAPTER_PATH)) {
    failEnvironment(
      `缺少桌面适配器构建产物：${ADAPTER_PATH}\n  请先在仓库根目录执行 npm run build（TypeScript 编译）。`,
    );
  }
  if (!existsSync(join(args.workdir, DEMO_SCRIPT))) {
    failEnvironment(`找不到 demo-desktop 程序：${join(args.workdir, DEMO_SCRIPT)}（用 --workdir 指定目录）`);
  }
  const { WindowsDesktop, DesktopAllowlistError } = await import(pathToFileURL(ADAPTER_PATH).href);

  if (!existsSync(args.evidenceDir)) await mkdir(args.evidenceDir, { recursive: true });
  // 每次运行前清理本脚本自己的截图目录，避免新旧证据混合（只删 evidence-dir 内我们自己的子目录）
  await rm(join(args.evidenceDir, "screenshots"), { recursive: true, force: true });
  await rm(args.out, { force: true });
  const logPath = join(args.evidenceDir, "app.log");

  const recorder = createRecorder();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const deadline = startedMs + args.timeoutMs;
  const remainingMs = () => Math.max(0, deadline - Date.now());

  const result = {
    case: "desktop-form-a3",
    ok: false,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    evidenceDir: args.evidenceDir,
    jsonPath: args.out,
    window: null,
    layout: null,
    checks: recorder.checks,
    steps: recorder.steps,
    adapterSteps: [],
    screenshots: [],
    app: { pid: null, exit: null, spawnError: null, logPath },
    adapter: { start: null, close: null },
    interference: { fillAttempts: 0, validationAttempts: 0, retried: false },
    cleanup: { sidecarClosed: false, appExitCode: null, appResidue: null },
    failures: recorder.failures,
    error: null,
  };

  log(`证据目录：${args.evidenceDir}`);
  log(`demo 程序：${join(args.workdir, DEMO_SCRIPT)}（Python：${args.python}）`);
  log(`JSON 输出：${args.out}`);

  /** @type {import("../../dist/packages/steward-desktop/src/index.js").WindowsDesktop | null} */
  let desktop = null;
  /** @type {ReturnType<typeof createAppHandle> | null} */
  let app = null;

  try {
    // ---- 0) 启动真实桌面适配器（不聚焦任何窗口） -------------------------
    desktop = new WindowsDesktop({
      evidenceDir: args.evidenceDir,
      allowedWindows: [WINDOW_TITLE],
      pythonCommand: args.python,
      typingIntervalMs: 10,
    });
    const startInfo = await desktop.start();
    result.adapter.start = startInfo;
    recorder.recordStep(
      "启动真实桌面适配器",
      `sidecar=${startInfo.sidecarVersion} python=${startInfo.pythonVersion} dpi=${startInfo.dpiAwareness} ` +
        `screen=${startInfo.screen.width}x${startInfo.screen.height} allowed=${startInfo.allowedWindows.join("、")}`,
    );
    recorder.recordCheck("桌面侧车启动（真实 Win32 能力就绪）", startInfo.sidecarPid > 0, `sidecarPid=${startInfo.sidecarPid}`);

    // ---- 1) 等待桌面空闲，再开始抢焦点/注入键鼠 --------------------------
    await waitForDesktopIdle(desktop, recorder, {
      minIdleMs: 800,
      timeoutMs: Math.min(10_000, Math.max(1_000, remainingMs())),
    });

    // ---- 2) 打开：spawn demo → 等待真实窗口出现 --------------------------
    app = createAppHandle({ python: args.python, workdir: args.workdir, outPath: args.out, logPath });
    result.app.pid = app.pid ?? null;
    recorder.recordStep("spawn demo-desktop", `python -u ${DEMO_SCRIPT} --out ${args.out}（pid=${app.pid ?? "?"}）`);
    recorder.recordCheck("demo 进程启动成功", app.spawnError === null && app.pid !== undefined, app.spawnError ?? `pid=${app.pid}`);

    const waitMs = Math.min(WINDOW_WAIT_MS, remainingMs());
    if (waitMs <= 0) throw new Error(`E2E 总超时（${args.timeoutMs}ms）已耗尽`);
    const window = await desktop.waitForWindow(WINDOW_TITLE, { timeoutMs: waitMs });
    result.window = {
      hwnd: window.hwnd,
      title: window.title,
      pid: window.pid,
      processName: window.processName,
      className: window.className,
      rect: window.rect,
      extendedFrame: window.extendedFrame,
      clientRect: window.clientRect,
      clientOrigin: window.clientOrigin,
      dpi: window.dpi,
      minimized: window.minimized,
      visible: window.visible,
      foreground: window.foreground,
    };
    recorder.recordStep("打开：真实窗口已出现", `title=${window.title} hwnd=${window.hwnd} pid=${window.pid} class=${window.className}`);
    recorder.recordCheck("窗口标题为「代掌演示表单」", window.title === WINDOW_TITLE, window.title);
    recorder.recordCheck(
      "窗口属于本次 spawn 的 demo Python 进程（真实子进程）",
      window.pid === app.pid,
      `windowPid=${window.pid} appPid=${app.pid ?? "?"}`,
    );
    recorder.recordCheck("窗口可见且未最小化", window.visible === true && window.minimized === false, `visible=${window.visible} minimized=${window.minimized}`);
    recorder.recordCheck("窗口客户区尺寸有效", window.clientRect.width > 0 && window.clientRect.height > 0, JSON.stringify(window.clientRect));

    // ---- 3) 聚焦 + 打开截图 ---------------------------------------------
    // 等 DWM 窗口淡入动画结束（约 200ms），确保「打开」截图是稳定画面而非半透明过渡帧
    await sleep(500);
    const focused = await focusDemoWindow(desktop, recorder, "打开");
    recorder.recordCheck("真实聚焦窗口成功（SetForegroundWindow）", focused, focused ? "" : "3 次聚焦尝试均失败");
    await sleep(250);
    const openedShot = await desktop.screenshot("opened");
    recorder.recordCheck("「打开」步骤截图已产出", openedShot.ok && existsSync(openedShot.evidence[0] ?? ""), openedShot.evidence[0] ?? openedShot.error);

    // ---- 4) 坐标换算 -----------------------------------------------------
    const live = await desktop.getWindow(WINDOW_TITLE);
    const scale = live.clientRect.width / LAYOUT.clientWidth;
    const toScreen = (point) => ({
      x: Math.round(live.clientOrigin.x + point.x * scale),
      y: Math.round(live.clientOrigin.y + point.y * scale),
    });
    const points = {
      customerEntry: toScreen(LAYOUT.customerEntry),
      projectEntry: toScreen(LAYOUT.projectEntry),
      saveButton: toScreen(LAYOUT.saveButton),
      validateButton: toScreen(LAYOUT.validateButton),
      clearButton: toScreen(LAYOUT.clearButton),
    };
    result.layout = {
      scale,
      clientWidth: LAYOUT.clientWidth,
      clientHeight: LAYOUT.clientHeight,
      clientOrigin: live.clientOrigin,
      clientRect: live.clientRect,
      points,
    };
    recorder.recordStep(
      "按 clientOrigin 换算物理坐标",
      `client=${live.clientRect.width}x${live.clientRect.height} scale=${scale.toFixed(3)} ` +
        `origin=(${live.clientOrigin.x},${live.clientOrigin.y})`,
    );

    // ---- 5) 填表 + 保存（真实键鼠；外部干扰时有限次重试）----------------
    /** 一次填表+保存尝试；返回成功结果，失败返回 null（步骤/截图已留证）。 */
    const attemptFillAndSave = async (attempt) => {
      await waitForDesktopIdle(desktop, recorder, {
        minIdleMs: 600,
        timeoutMs: Math.min(4_000, Math.max(500, remainingMs())),
      });
      if (!(await focusDemoWindow(desktop, recorder, `填表尝试${attempt}`))) {
        recorder.recordStep(`填表尝试 ${attempt} 失败`, "聚焦 demo 窗口失败");
        return null;
      }
      // 先点「清空」重置表单（真实鼠标），避免上一轮残留内容
      await desktop.click(points.clearButton.x, points.clearButton.y);
      await sleep(120);
      const customerClick = await desktop.click(points.customerEntry.x, points.customerEntry.y);
      const typeCustomer = await desktop.typeText(CUSTOMER);
      const tabStep = await desktop.pressKey("TAB");
      const typeProject = await desktop.typeText(PROJECT);
      const filledShot = await desktop.screenshot("filled");
      const actionsOk =
        customerClick.ok &&
        customerClick.data?.windowAtPoint?.hwnd === window.hwnd &&
        typeCustomer.ok &&
        tabStep.ok &&
        typeProject.ok &&
        filledShot.ok;
      if (!actionsOk) {
        recorder.recordStep(
          `填表尝试 ${attempt} 失败`,
          `click=${customerClick.ok} typeCustomer=${typeCustomer.ok} tab=${tabStep.ok} typeProject=${typeProject.ok} shot=${filledShot.ok}`,
        );
        return null;
      }
      if (await pathExists(args.out)) await rm(args.out, { force: true });
      const saveClick = await desktop.click(points.saveButton.x, points.saveButton.y);
      const saved = await waitForFile(args.out, Math.min(SAVE_WAIT_MS, Math.max(500, remainingMs())));
      if (!saved) {
        recorder.recordStep(`填表尝试 ${attempt} 失败`, "点击「保存」后未生成 JSON");
        return null;
      }
      const recordText = await readFile(args.out, "utf8");
      let record = null;
      try {
        record = JSON.parse(recordText);
      } catch {
        record = null;
      }
      if (record !== null && record.customer === CUSTOMER && record.project === PROJECT) {
        const savedMtime = (await stat(args.out)).mtimeMs;
        recorder.recordStep(`真实键鼠填表并保存成功（第 ${attempt} 次尝试）`, JSON.stringify(record));
        return {
          attempt,
          customerClick,
          typeCustomer,
          tabStep,
          typeProject,
          filledShot,
          saveClick,
          recordText,
          record,
          savedMtime,
        };
      }
      recorder.recordStep(
        `填表尝试 ${attempt} 内容被外部输入污染，重试`,
        `customer=${JSON.stringify(record?.customer)} project=${JSON.stringify(record?.project)}`,
      );
      await desktop.screenshot(`fill-mismatch-${attempt}`);
      await sleep(400);
      return null;
    };

    let fillResult = null;
    for (let attempt = 1; attempt <= FILL_MAX_ATTEMPTS && fillResult === null; attempt += 1) {
      result.interference.fillAttempts = attempt;
      try {
        fillResult = await attemptFillAndSave(attempt);
      } catch (error) {
        if (isFocusInterference(error)) {
          recorder.recordStep(`填表尝试 ${attempt} 被外部窗口抢占焦点，重试`, formatError(error).split("\n")[0]);
          await sleep(400);
          continue;
        }
        throw error;
      }
    }
    if (fillResult === null) {
      recorder.recordCheck("真实键鼠填表并保存成功", false, `${FILL_MAX_ATTEMPTS} 次尝试均失败/被外部输入干扰`);
      throw new Error("真实键鼠填表并保存失败");
    }
    result.interference.retried = fillResult.attempt > 1;
    recorder.recordCheck("真实鼠标点击「客户名称」输入框（点击点落在 demo 窗口内）", true, `点击屏幕坐标 (${points.customerEntry.x},${points.customerEntry.y})`);
    recorder.recordCheck("真实键盘输入客户名称（SendInput Unicode）", fillResult.typeCustomer.ok, `长度=${fillResult.typeCustomer.data?.length}`);
    recorder.recordCheck("真实键盘 TAB 切换焦点", fillResult.tabStep.ok, "");
    recorder.recordCheck("真实键盘输入项目名称（中文 Unicode）", fillResult.typeProject.ok, `长度=${fillResult.typeProject.data?.length}`);
    recorder.recordCheck("「填表」步骤截图已产出", fillResult.filledShot.ok, fillResult.filledShot.evidence[0] ?? "");
    recorder.recordCheck("真实鼠标点击「保存」按钮", fillResult.saveClick.ok, `点击屏幕坐标 (${points.saveButton.x},${points.saveButton.y})`);
    recorder.recordCheck("保存后生成真实 JSON 文件", true, args.out);
    recorder.recordCheck(
      "JSON.customer 与真实键盘输入一致",
      fillResult.record.customer === CUSTOMER,
      `期望 ${JSON.stringify(CUSTOMER)}，实际 ${JSON.stringify(fillResult.record.customer)}`,
    );
    recorder.recordCheck(
      "JSON.project 与真实键盘输入一致",
      fillResult.record.project === PROJECT,
      `期望 ${JSON.stringify(PROJECT)}，实际 ${JSON.stringify(fillResult.record.project)}`,
    );
    recorder.recordCheck(
      "JSON.saved_at 为带时区偏移的 ISO 8601",
      typeof fillResult.record.saved_at === "string" && /T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(fillResult.record.saved_at),
      String(fillResult.record.saved_at),
    );
    const savedShot = await desktop.screenshot("saved");
    recorder.recordCheck("「保存成功」步骤截图已产出", savedShot.ok && existsSync(savedShot.evidence[0] ?? ""), savedShot.evidence[0] ?? savedShot.error);

    // ---- 6) 校验失败场景：清空 → 保存 → JSON 不得被覆盖（外部干扰时重试）--
    const expectedText = fillResult.recordText;
    const expectedMtime = fillResult.savedMtime;
    const attemptValidationFailure = async (attempt) => {
      if (!(await focusDemoWindow(desktop, recorder, `校验失败尝试${attempt}`))) return null;
      const clearClick = await desktop.click(points.clearButton.x, points.clearButton.y);
      await sleep(300);
      const saveClick = await desktop.click(points.saveButton.x, points.saveButton.y);
      await sleep(1_000);
      const unchanged = (await readFile(args.out, "utf8")) === expectedText && (await stat(args.out)).mtimeMs === expectedMtime;
      if (unchanged && clearClick.ok && saveClick.ok) {
        recorder.recordStep(`校验失败场景验证成功（第 ${attempt} 次尝试）`, "清空后点击保存：JSON 未被覆盖");
        return { attempt, clearClick, saveClick };
      }
      recorder.recordStep(`校验失败场景尝试 ${attempt} 被外部输入干扰，重试`, `unchanged=${unchanged}`);
      return null;
    };
    let validationResult = null;
    for (let attempt = 1; attempt <= VALIDATION_MAX_ATTEMPTS && validationResult === null; attempt += 1) {
      result.interference.validationAttempts = attempt;
      try {
        validationResult = await attemptValidationFailure(attempt);
      } catch (error) {
        if (isFocusInterference(error)) {
          recorder.recordStep(`校验失败场景尝试 ${attempt} 被外部窗口抢占焦点，重试`, formatError(error).split("\n")[0]);
          await sleep(400);
          continue;
        }
        throw error;
      }
    }
    if (validationResult !== null) {
      const failedShot = await desktop.screenshot("validation-failed");
      recorder.recordCheck("真实鼠标点击「清空」按钮", validationResult.clearClick.ok, "");
      recorder.recordCheck("真实鼠标点击「保存」按钮（空表单）", validationResult.saveClick.ok, "");
      recorder.recordCheck("校验失败（客户名称为空）时 JSON 未被覆盖", true, `内容一致=true mtime一致=true`);
      recorder.recordCheck("「校验失败」步骤截图已产出", failedShot.ok && existsSync(failedShot.evidence[0] ?? ""), failedShot.evidence[0] ?? "");
    } else {
      recorder.recordCheck("校验失败（客户名称为空）时 JSON 未被覆盖", false, `${VALIDATION_MAX_ATTEMPTS} 次尝试均被外部输入干扰`);
      recorder.recordCheck("「校验失败」步骤截图已产出", false, "场景未通过");
    }

    // ---- 7) 部分校验场景：只填客户名称点「校验」→ 仍不写文件 -------------
    const attemptPartialValidate = async (attempt) => {
      if (!(await focusDemoWindow(desktop, recorder, `部分校验尝试${attempt}`))) return null;
      await desktop.click(points.customerEntry.x, points.customerEntry.y);
      const typePartial = await desktop.typeText(PARTIAL_CUSTOMER);
      const validateClick = await desktop.click(points.validateButton.x, points.validateButton.y);
      await sleep(600);
      const unchanged = (await readFile(args.out, "utf8")) === expectedText && (await stat(args.out)).mtimeMs === expectedMtime;
      if (unchanged && typePartial.ok && validateClick.ok) {
        recorder.recordStep(`部分校验场景验证成功（第 ${attempt} 次尝试）`, "仅填客户名称点击校验：JSON 未被覆盖");
        return { typePartial, validateClick };
      }
      recorder.recordStep(`部分校验场景尝试 ${attempt} 未通过，重试`, `unchanged=${unchanged}`);
      return null;
    };
    let partialResult = null;
    for (let attempt = 1; attempt <= VALIDATION_MAX_ATTEMPTS && partialResult === null; attempt += 1) {
      try {
        partialResult = await attemptPartialValidate(attempt);
      } catch (error) {
        if (isFocusInterference(error)) {
          recorder.recordStep(`部分校验场景尝试 ${attempt} 被外部窗口抢占焦点，重试`, formatError(error).split("\n")[0]);
          await sleep(400);
          continue;
        }
        throw error;
      }
    }
    const partialShot = await desktop.screenshot("validate-partial");
    recorder.recordCheck("真实鼠标点击「客户名称」（校验分支）", partialResult !== null, "");
    recorder.recordCheck("真实键盘输入部分客户名称", partialResult?.typePartial.ok === true, partialResult === null ? "场景未通过" : `长度=${partialResult.typePartial.data?.length}`);
    recorder.recordCheck("真实鼠标点击「校验」按钮", partialResult?.validateClick.ok === true, "");
    recorder.recordCheck(
      "「校验」不写文件（项目名称为空时 JSON 未被覆盖）",
      partialResult !== null,
      partialResult === null ? `${VALIDATION_MAX_ATTEMPTS} 次尝试均被外部输入干扰` : "内容一致=true",
    );
    recorder.recordCheck("「部分校验」步骤截图已产出", partialShot.ok && existsSync(partialShot.evidence[0] ?? ""), partialShot.evidence[0] ?? "");

    // ---- 8) 凭据保护 + 进程存活 -----------------------------------------
    const credentialMatches = await desktop.scanCredentialPrompts();
    recorder.recordCheck(
      "未检测到凭据/安全提示窗口（凭据输入一律交人）",
      credentialMatches.length === 0,
      credentialMatches.length === 0 ? "" : JSON.stringify(credentialMatches),
    );
    recorder.recordCheck("demo 进程在真实操作全程保持存活（未崩溃）", app.alive(), `pid=${app.pid ?? "?"}`);

    // ---- 9) 真实关窗 + 进程退出（不残留） --------------------------------
    const closeStep = await desktop.closeWindow(WINDOW_TITLE);
    recorder.recordCheck(
      "WM_CLOSE 真实关闭窗口",
      closeStep.ok && closeStep.data?.closed === true,
      closeStep.ok ? `closed=${String(closeStep.data?.closed)}` : closeStep.error,
    );
    const exitedGracefully = await app.waitExit(Math.min(8000, Math.max(1000, remainingMs())));
    recorder.recordCheck("demo 进程随窗口关闭正常退出", exitedGracefully, `exitInfo=${JSON.stringify(app.exitInfo)}`);
    result.app.exit = app.exitInfo;

    // ---- 10) 证据完整性 --------------------------------------------------
    result.adapterSteps = desktop.steps;
    const interactiveSteps = result.adapterSteps.filter((step) => INTERACTIVE_ACTIONS.has(step.action));
    const stepsWithoutEvidence = interactiveSteps.filter((step) => step.evidence.length === 0);
    recorder.recordCheck(
      "每个真实交互步骤都有截图证据（无截图视为失败）",
      interactiveSteps.length > 0 && stepsWithoutEvidence.length === 0,
      `交互步骤=${interactiveSteps.length} 缺证据=${stepsWithoutEvidence.length}`,
    );
    const advertisedScreenshots = new Set();
    for (const step of result.adapterSteps) {
      for (const file of step.evidence) {
        if (file.endsWith(".png")) advertisedScreenshots.add(file);
      }
    }
    result.screenshots = [...advertisedScreenshots];
    const missingFiles = result.screenshots.filter((file) => !existsSync(file));
    recorder.recordCheck(
      "截图证据文件全部真实存在",
      result.screenshots.length >= 8 && missingFiles.length === 0,
      `截图=${result.screenshots.length} 缺失=${missingFiles.length}`,
    );
  } catch (error) {
    recorder.error = formatError(error);
    log(`流程异常：${recorder.error}`);
  } finally {
    // ---- 清理：先关适配器侧车，再确保 demo 进程不残留 -------------------
    if (desktop !== null) {
      try {
        result.adapter.close = await desktop.close();
        result.adapterSteps = desktop.steps;
        for (const step of result.adapterSteps) {
          for (const file of step.evidence) {
            if (file.endsWith(".png") && !result.screenshots.includes(file)) result.screenshots.push(file);
          }
        }
        recorder.recordCheck("桌面侧车正常关闭", result.adapter.close.closed === true, `sidecarExitCode=${String(result.adapter.close.sidecarExitCode)}`);
      } catch (error) {
        log(`关闭桌面适配器异常：${formatError(error)}`);
      }
    }
    if (app !== null) {
      if (args.keepApp) {
        recorder.recordStep("--keep-app：跳过 demo 进程清理（调试模式，不作为验收）", `pid=${app.pid ?? "?"}`);
        result.cleanup.appResidue = isProcessAlive(app.pid);
      } else {
        if (app.alive()) {
          recorder.recordStep("demo 进程未退出，taskkill 兜底清理", `pid=${app.pid ?? "?"}`);
          const killed = taskkillTree(app.pid);
          await sleep(400);
          result.cleanup.taskkill = killed;
        }
        result.cleanup.appResidue = isProcessAlive(app.pid);
        recorder.recordCheck("结束清理后无残留 demo 进程", result.cleanup.appResidue === false, `residue=${result.cleanup.appResidue}`);
      }
      result.cleanup.appExitCode = app.exitInfo?.code ?? null;
      result.app.exit = app.exitInfo;
      await app.flushLog();
    }

    result.cleanup.sidecarClosed = result.adapter.close === null ? false : result.adapter.close.closed;
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedMs;
    result.ok = recorder.failures.length === 0 && recorder.error === null;
    result.failures = recorder.failures;
    result.error = recorder.error;
    // 汇总证据文件清单（绝对路径）
    result.evidenceFiles = [args.evidenceDir, args.out, logPath, join(args.evidenceDir, "steps.json"), join(args.evidenceDir, "sidecar.log")].filter((file) => existsSync(file));

    const resultPath = join(args.evidenceDir, "result.json");
    await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");

    log("");
    log("—————— 验收汇总 ——————");
    for (const check of result.checks) {
      log(`${check.ok ? "✅" : "❌"} ${check.name}${check.detail === "" ? "" : ` — ${check.detail}`}`);
    }
    log(`检查项：${result.checks.filter((item) => item.ok).length}/${result.checks.length} 通过；截图证据：${result.screenshots.length} 张`);
    if (result.interference.retried) {
      log(`说明：真实桌面存在并发操作，填表经过 ${result.interference.fillAttempts} 次尝试后通过（已留证）。`);
    }
    log(`结果文件：${resultPath}`);
    log(`演示 JSON：${args.out}`);
    if (result.ok) {
      log(`真实桌面 E2E 通过 ✅（${(result.durationMs / 1000).toFixed(1)}s）`);
    } else {
      log(`真实桌面 E2E 失败 ❌（${(result.durationMs / 1000).toFixed(1)}s）；失败项：${recorder.failures.join("、") || "无"}${result.error === null ? "" : `；异常：${result.error.split("\n")[0]}`}`);
    }
  }

  return result.ok ? 0 : 1;
}

process.exitCode = await run();
