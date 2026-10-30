/**
 * 系统总控动作层单元测试（v1.3-A 基线 + v1.4-D 扩展）。
 *
 * v1.3-A 基线（27 条，保持不变）：
 * - listApps / listPlugins / systemInfo；
 * - plan 风险分级与二次确认令牌下发；
 * - 清单外 app / 插件 / 路径穿越 / 系统关键路径 拒绝（OutOfScopeError）；
 * - high 动作无 token 拒绝；有效 token 执行；token 一次性/过期/错配拒绝；
 * - app.start 真实启动 node 短进程并 app.stop 真停（Windows）或注入 mock；
 * - plugin.enable/disable 真实写 plugin.json；plugin.remove 备份+删除+回执；
 * - app.remove 备份+删除+回执 backup_path；restoreBackup 恢复；
 * - 审计 JSONL 追加/跨实例持久化/不含密钥明文；策略拒绝也留痕；
 * - ProcessOps 注入 mock（restart 调用顺序 stop→start）。
 *
 * v1.4-D 扩展（19 条）：
 * - 受管工作区文件：file.list(workspace) / file.read / file.write / file.mkdir /
 *   file.copy / file.move / file.remove（备份+回执 backup_path+restoreBackup）；
 * - 路径穿越/绝对路径/软链接逃逸拒绝；file.write 256KB 上限；file.read 目录/超大文件拒绝；
 * - app.open：清单外拒绝、清单内 mock ProcessOps 验证调用、URL 白名单 + 命令注入防护；
 * - service.status 只读进程快照（mock + Windows 真实）；task.create/list/remove
 *   （scheduler.json 持久化、interval/cron/重名校验）；
 * - program.install/uninstall（安装源白名单、programs/<id>、installed.json 持久化、
 *   卸载备份+删除+审计+restoreBackup）；
 * - medium 风险与 auto_approve_medium 语义；审计脱敏（文件内容只记大小/hash）。
 *
 * 全部在系统临时目录（mkdtemp）内操作，不写仓库 runs/，不触碰任何系统关键路径。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTION_RISK,
  CONFIRMATION_TTL_MS,
  ConfirmationRequiredError,
  JsonlAuditTrail,
  OutOfScopeError,
  SYSTEM_AUDIT_FILE,
  SystemActionError,
  SystemController,
  WindowsProcessOps,
  isProcessAlive,
  isRecyclePath,
  isSystemCriticalPath,
  redactAuditText,
  restoreBackup,
} from "../../dist/packages/steward-system/src/index.js";

const WINDOWS = process.platform === "win32";
const NODE_CMD = process.execPath;
const LONG_SLEEP_ARGS = ["-e", "setTimeout(() => {}, 60000)"];

// ---------------------------------------------------------------------------
// 工作区 / 工具
// ---------------------------------------------------------------------------

async function makeWorkspace(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "steward-system-"));
  const stateDir = join(root, ".state");
  const pluginsDir = join(root, "plugins");
  const appDir = join(root, "programs", "demo-app");
  const removableDir = join(root, "programs", "removable-app");
  await mkdir(pluginsDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, "main.js"), "// demo app entry\n", "utf8");
  await mkdir(removableDir, { recursive: true });
  await writeFile(join(removableDir, "payload.txt"), "SHOULD_BE_BACKED_UP\n", "utf8");

  for (const [id, enabled] of [
    ["plugin-a", true],
    ["plugin-b", false],
  ]) {
    const dir = join(pluginsDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "plugin.json"),
      JSON.stringify({ id, name: `插件 ${id}`, version: "1.0.0", enabled }, null, 2) + "\n",
      "utf8",
    );
    await writeFile(join(dir, "index.js"), `// ${id} entry\n`, "utf8");
  }
  // 非目录/非法名条目应被忽略
  await writeFile(join(pluginsDir, "README.txt"), "not a plugin\n", "utf8");
  await mkdir(join(pluginsDir, ".hidden"), { recursive: true });

  const apps = [
    {
      id: "demo-app",
      name: "演示程序",
      command: NODE_CMD,
      args: LONG_SLEEP_ARGS,
      cwd: appDir,
      path: appDir,
      kind: "program",
      allow_start: true,
      allow_stop: true,
      allow_remove: true,
      note: "测试用短生命 node 进程",
    },
    {
      id: "protected-app",
      name: "受限程序",
      command: NODE_CMD,
      args: LONG_SLEEP_ARGS,
      cwd: appDir,
      kind: "program",
      allow_start: false,
      allow_stop: false,
      allow_remove: false,
    },
    {
      id: "removable-app",
      name: "可删程序",
      command: NODE_CMD,
      args: LONG_SLEEP_ARGS,
      cwd: removableDir,
      path: removableDir,
      kind: "program",
      allow_start: true,
      allow_stop: true,
      allow_remove: true,
    },
    ...(options.extraApps ?? []),
  ];

  const clock = { value: new Date("2026-10-26T12:00:00.000Z") };
  const now = () => new Date(clock.value.getTime());
  const makeController = (extra = {}) =>
    new SystemController({ root, state_dir: stateDir, apps, plugins_dir: pluginsDir, now, ...extra });

  return {
    root,
    stateDir,
    pluginsDir,
    appDir,
    removableDir,
    apps,
    clock,
    now,
    makeController,
    controller: makeController(),
  };
}

/** 强制清理测试启动的进程（避免测试失败后残留）。 */
function forceKill(pid) {
  if (typeof pid !== "number" || pid <= 0) return;
  try {
    process.kill(pid);
  } catch {
    // 已退出
  }
  if (WINDOWS) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
  }
}

/** 等待条件成立（默认 5s）。 */
async function waitFor(predicate, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, intervalMs);
    });
  }
  return Boolean(await predicate());
}

function auditFileOf(ws) {
  return join(ws.stateDir, SYSTEM_AUDIT_FILE);
}

function readAuditLines(ws) {
  const file = auditFileOf(ws);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** 注入的 mock ProcessOps：记录调用，不真实起进程。 */
function createMockOps() {
  const calls = [];
  let nextPid = 40_000;
  return {
    calls,
    async start(app) {
      calls.push(["start", app.id]);
      nextPid += 1;
      return { pid: nextPid, started_at: "2026-10-26T12:00:00.000Z" };
    },
    async stop(app, pid) {
      calls.push(["stop", app.id, pid ?? null]);
      return true;
    },
    async list() {
      return [{ pid: 1, name: "mock" }];
    },
    async remove(app) {
      calls.push(["remove", app.id]);
      return join(tmpdir(), "steward-system-mock-recycle", app.id);
    },
  };
}

// ---------------------------------------------------------------------------
// 1) 只读观察
// ---------------------------------------------------------------------------

test("listApps：返回受管应用清单副本（外部修改不影响控制器）", async () => {
  const ws = await makeWorkspace();
  const apps = ws.controller.listApps();
  assert.equal(apps.length, 3);
  assert.deepEqual(
    apps.map((app) => app.id),
    ["demo-app", "protected-app", "removable-app"],
  );
  apps[0].name = "被外部篡改";
  apps.push({ id: "hacked" });
  assert.equal(ws.controller.listApps()[0].name, "演示程序");
  assert.equal(ws.controller.listApps().length, 3);
});

test("listPlugins：扫描 plugins_dir 直接子目录 + plugin.json 字段，忽略非法条目", async () => {
  const ws = await makeWorkspace();
  const plugins = ws.controller.listPlugins();
  assert.equal(plugins.length, 2);
  assert.deepEqual(
    plugins.map((plugin) => plugin.id),
    ["plugin-a", "plugin-b"],
  );
  const pluginA = plugins.find((plugin) => plugin.id === "plugin-a");
  assert.equal(pluginA.enabled, true);
  assert.equal(pluginA.version, "1.0.0");
  assert.equal(pluginA.name, "插件 plugin-a");
  const pluginB = plugins.find((plugin) => plugin.id === "plugin-b");
  assert.equal(pluginB.enabled, false);
  // 非目录 README.txt / 隐藏目录 .hidden 被忽略
  assert.equal(plugins.some((plugin) => plugin.id === "README.txt"), false);
  assert.equal(plugins.some((plugin) => plugin.id === ".hidden"), false);
});

test("systemInfo：返回平台/受管数量/状态目录等摘要，不含用户名明文", async () => {
  const ws = await makeWorkspace();
  const info = ws.controller.systemInfo();
  assert.equal(info.platform, process.platform);
  assert.equal(info.managed_apps, 3);
  assert.equal(info.managed_plugins, 2);
  assert.equal(info.state_dir.replaceAll("\\", "/"), join(ws.stateDir).replaceAll("\\", "/"));
  assert.ok(info.cpu_count >= 1);
  assert.ok(info.total_memory_bytes > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(info, "username"), false);
});

// ---------------------------------------------------------------------------
// 2) plan：风险分级 + 二次确认令牌
// ---------------------------------------------------------------------------

test("plan：风险分级 readonly/low/high/destructive 与是否需要确认", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;

  const readonlyPlan = controller.plan({ id: "r-readonly", action: "system.info" });
  assert.equal(readonlyPlan.risk, "readonly");
  assert.equal(readonlyPlan.allowed, true);
  assert.equal(readonlyPlan.requires_confirmation, false);
  assert.equal(readonlyPlan.confirmation_token, undefined);

  const lowPlan = controller.plan({ id: "r-low", action: "app.start", target: "demo-app" });
  assert.equal(lowPlan.risk, "low");
  assert.equal(lowPlan.allowed, true);
  assert.equal(lowPlan.requires_confirmation, false);

  const highPlan = controller.plan({ id: "r-high", action: "app.restart", target: "demo-app" });
  assert.equal(highPlan.risk, "high");
  assert.equal(highPlan.allowed, true);
  assert.equal(highPlan.requires_confirmation, true);
  assert.equal(typeof highPlan.confirmation_token, "string");

  const destructivePlan = controller.plan({ id: "r-destructive", action: "app.remove", target: "demo-app" });
  assert.equal(destructivePlan.risk, "destructive");
  assert.equal(destructivePlan.allowed, true);
  assert.equal(destructivePlan.requires_confirmation, true);
  assert.equal(typeof destructivePlan.confirmation_token, "string");

  // 契约风险表
  assert.equal(ACTION_RISK["app.remove"], "destructive");
  assert.equal(ACTION_RISK["plugin.remove"], "destructive");
  assert.equal(ACTION_RISK["app.restart"], "high");
  assert.equal(ACTION_RISK["app.start"], "low");
  assert.equal(ACTION_RISK["system.info"], "readonly");
});

test("lastConfirmation / listPendingConfirmations：token 120s TTL 可展示给 UI", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  assert.equal(controller.lastConfirmation(), null);
  const plan = controller.plan({ id: "req-confirm-ui", action: "app.remove", target: "removable-app" });
  const last = controller.lastConfirmation();
  assert.notEqual(last, null);
  assert.equal(last.token, plan.confirmation_token);
  assert.equal(last.request_id, "req-confirm-ui");
  assert.equal(last.action, "app.remove");
  const ttl = new Date(last.expires_at).getTime() - new Date(last.issued_at).getTime();
  assert.equal(ttl, CONFIRMATION_TTL_MS);
  assert.equal(controller.listPendingConfirmations().length, 1);
});

// ---------------------------------------------------------------------------
// 3) 受管范围拒绝
// ---------------------------------------------------------------------------

test("受管范围：清单外 app → plan.allowed=false，execute 抛 OutOfScopeError 并审计", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const plan = controller.plan({ id: "req-scope-app", action: "app.start", target: "notepad" });
  assert.equal(plan.allowed, false);
  assert.equal(plan.requires_confirmation, false);
  assert.match(plan.summary, /不在受管应用清单/);

  await assert.rejects(
    () => controller.execute({ id: "req-scope-app", action: "app.start", target: "notepad" }),
    (error) => error instanceof OutOfScopeError && /不在受管/.test(error.message),
  );
  const last = controller.auditTrail(1)[0];
  assert.equal(last.ok, false);
  assert.equal(last.executed, false);
  assert.match(last.summary, /策略拒绝/);
});

test("受管范围：清单外插件 / 路径穿越 / file.list 绝对路径越界均拒绝", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;

  const outsidePlugin = controller.plan({ id: "req-p-out", action: "plugin.enable", target: "../evil" });
  assert.equal(outsidePlugin.allowed, false);

  const notExistPlugin = controller.plan({ id: "req-p-missing", action: "plugin.disable", target: "plugin-zzz" });
  assert.equal(notExistPlugin.allowed, false);
  assert.match(notExistPlugin.summary, /不可操作/);

  const traversal = controller.plan({
    id: "req-file-traversal",
    action: "file.list",
    target: "demo-app",
    params: { path: "../.." },
  });
  assert.equal(traversal.allowed, false);

  const absolute = controller.plan({
    id: "req-file-absolute",
    action: "file.list",
    target: "demo-app",
    params: { path: "C:\\Windows\\System32" },
  });
  assert.equal(absolute.allowed, false);

  // 系统关键路径判定（不实际删除）；Windows 专属断言仅在 Windows 上执行（CI 同时跑 ubuntu）
  if (process.platform === "win32") {
    assert.equal(isSystemCriticalPath(join(process.env.SystemRoot ?? "C:\\WINDOWS", "System32")), true);
    assert.equal(isSystemCriticalPath("C:\\"), true);
  }
  assert.equal(isSystemCriticalPath(join(ws.appDir, "main.js")), false);

  await assert.rejects(
    () =>
      controller.execute({
        id: "req-file-traversal",
        action: "file.list",
        target: "demo-app",
        params: { path: "../.." },
      }),
    (error) => error instanceof OutOfScopeError,
  );
});

test("受管范围：allow_start/allow_stop/allow_remove=false 的动作被拒绝", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const start = controller.plan({ id: "req-denied-start", action: "app.start", target: "protected-app" });
  assert.equal(start.allowed, false);
  assert.match(start.summary, /allow_start=false/);

  const stop = controller.plan({ id: "req-denied-stop", action: "app.stop", target: "protected-app" });
  assert.equal(stop.allowed, false);

  const remove = controller.plan({ id: "req-denied-remove", action: "app.remove", target: "protected-app" });
  assert.equal(remove.allowed, false);
  assert.match(remove.summary, /allow_remove=false/);
});

test("受管范围：app.path 在受管 root 外 / 位于状态目录内 → 删除被拒绝", async () => {
  const ws = await makeWorkspace();
  const outsideDir = await mkdtemp(join(tmpdir(), "steward-system-outside-"));
  await writeFile(join(outsideDir, "x.txt"), "outside\n", "utf8");
  const stateInsideDir = join(ws.stateDir, "inside-state");
  await mkdir(stateInsideDir, { recursive: true });

  const controller = new SystemController({
    root: ws.root,
    state_dir: ws.stateDir,
    plugins_dir: ws.pluginsDir,
    now: ws.now,
    apps: [
      ...ws.apps,
      {
        id: "outside-app",
        name: "越界程序",
        command: NODE_CMD,
        path: outsideDir,
        kind: "program",
        allow_start: true,
        allow_stop: true,
        allow_remove: true,
      },
      {
        id: "state-app",
        name: "状态目录程序",
        command: NODE_CMD,
        path: stateInsideDir,
        kind: "program",
        allow_start: true,
        allow_stop: true,
        allow_remove: true,
      },
    ],
  });
  const outsidePlan = controller.plan({ id: "req-outside", action: "app.remove", target: "outside-app" });
  assert.equal(outsidePlan.allowed, false);
  assert.match(outsidePlan.summary, /不在受管根目录内/);

  const statePlan = controller.plan({ id: "req-state", action: "app.remove", target: "state-app" });
  assert.equal(statePlan.allowed, false);
  assert.match(statePlan.summary, /状态目录/);
});

// ---------------------------------------------------------------------------
// 4) 二次确认令牌：缺失 / 一次性 / 过期 / 错配
// ---------------------------------------------------------------------------

test("high 动作无 token 拒绝（ConfirmationRequiredError）并写审计", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  await assert.rejects(
    () => controller.execute({ id: "req-no-token", action: "app.restart", target: "demo-app" }),
    (error) =>
      error instanceof ConfirmationRequiredError && /确认|confirmation_token/.test(error.message),
  );
  const last = controller.auditTrail(1)[0];
  assert.equal(last.ok, false);
  assert.equal(last.executed, false);
  assert.match(last.summary, /二次确认/);
});

test("token 一次性：同一 token 第二次执行被拒绝", async () => {
  const ws = await makeWorkspace();
  const controller = ws.makeController({ processOps: createMockOps() });
  const request = { id: "req-once", action: "app.restart", target: "demo-app" };
  const plan = controller.plan(request);
  const token = plan.confirmation_token;
  assert.equal(typeof token, "string");
  // 第一次执行：mock ops，避免真实起进程
  const first = await controller.execute({ ...request, confirmation_token: token });
  assert.equal(first.ok, true);
  await assert.rejects(
    () => controller.execute({ ...request, confirmation_token: token }),
    (error) => error instanceof ConfirmationRequiredError,
  );
});

test("token 过期（TTL 120s）后执行被拒绝", async () => {
  const ws = await makeWorkspace();
  const controller = ws.makeController({ processOps: createMockOps() });
  const request = { id: "req-expire", action: "app.restart", target: "demo-app" };
  const plan = controller.plan(request);
  ws.clock.value = new Date(ws.clock.value.getTime() + 121_000);
  await assert.rejects(
    () => controller.execute({ ...request, confirmation_token: plan.confirmation_token }),
    (error) => error instanceof ConfirmationRequiredError && /过期/.test(error.message),
  );
  assert.equal(controller.listPendingConfirmations().length, 0);
});

test("token 绑定 request_id+action+target：错配一律拒绝", async () => {
  const ws = await makeWorkspace();
  const controller = ws.makeController({ processOps: createMockOps() });

  const request = { id: "req-bind-a", action: "app.restart", target: "demo-app" };
  const plan = controller.plan(request);

  // 1) request_id 错配
  await assert.rejects(
    () =>
      controller.execute({
        id: "req-bind-b",
        action: "app.restart",
        target: "demo-app",
        confirmation_token: plan.confirmation_token,
      }),
    (error) => error instanceof ConfirmationRequiredError && /不匹配/.test(error.message),
  );

  // 2) action 错配（两个动作都需要二次确认：restart 的 token 拿去执行 remove）
  const restartPlan = controller.plan({ id: "req-bind-action", action: "app.restart", target: "demo-app" });
  await assert.rejects(
    () =>
      controller.execute({
        id: "req-bind-action",
        action: "app.remove",
        target: "removable-app",
        confirmation_token: restartPlan.confirmation_token,
      }),
    (error) => error instanceof ConfirmationRequiredError && /不匹配/.test(error.message),
  );

  // 3) target 错配
  const removePlan = controller.plan({ id: "req-bind-remove", action: "app.remove", target: "removable-app" });
  await assert.rejects(
    () =>
      controller.execute({
        id: "req-bind-remove",
        action: "app.remove",
        target: "demo-app",
        confirmation_token: removePlan.confirmation_token,
      }),
    (error) => error instanceof ConfirmationRequiredError && /目标不匹配|不匹配/.test(error.message),
  );
});

// ---------------------------------------------------------------------------
// 5) 真实进程动作（Windows；非 Windows 跳过）
// ---------------------------------------------------------------------------

test("app.start 真实启动 node 短进程，app.stop 真实停止（Windows 真实执行）", { skip: !WINDOWS }, async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  let pid = null;
  try {
    const started = await controller.execute({ id: "req-real-start", action: "app.start", target: "demo-app" });
    assert.equal(started.ok, true);
    assert.equal(started.executed, true);
    pid = started.output.pid;
    assert.equal(typeof pid, "number");
    assert.equal(isProcessAlive(pid), true);

    const stopped = await controller.execute({ id: "req-real-stop", action: "app.stop", target: "demo-app" });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.output.stopped, true);
    const gone = await waitFor(() => !isProcessAlive(pid));
    assert.equal(gone, true);
    pid = null;

    const info = controller.systemInfo();
    assert.equal(info.platform, process.platform);
    assert.equal(existsSync(ws.appDir), true);
  } finally {
    if (pid !== null) forceKill(pid);
  }
});

test("app.restart：有效 token 真实重启（旧 pid 退出、新 pid 存活）", { skip: !WINDOWS }, async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  let pid = null;
  try {
    const started = await controller.execute({ id: "req-restart-start", action: "app.start", target: "demo-app" });
    assert.equal(started.ok, true);
    const oldPid = started.output.pid;
    pid = oldPid;

    const plan = controller.plan({ id: "req-restart", action: "app.restart", target: "demo-app" });
    assert.equal(plan.requires_confirmation, true);
    const restarted = await controller.execute({
      id: "req-restart",
      action: "app.restart",
      target: "demo-app",
      confirmation_token: plan.confirmation_token,
      requested_by: "unit-test",
      reason: "验证真实重启",
    });
    assert.equal(restarted.ok, true);
    assert.equal(restarted.executed, true);
    const newPid = restarted.output.pid;
    assert.equal(typeof newPid, "number");
    assert.notEqual(newPid, oldPid);
    assert.equal(await waitFor(() => !isProcessAlive(oldPid)), true);
    assert.equal(isProcessAlive(newPid), true);
    pid = newPid;
    const audit = controller.auditTrail(5);
    assert.ok(audit.some((entry) => entry.action === "app.restart" && entry.ok === true));
  } finally {
    if (pid !== null) forceKill(pid);
  }
});

test("注入 ProcessOps mock：restart 真实调用顺序为 stop → start（无需真实进程）", async () => {
  const ws = await makeWorkspace();
  const mockOps = createMockOps();
  const controller = ws.makeController({ processOps: mockOps });
  const plan = controller.plan({ id: "req-mock-restart", action: "app.restart", target: "demo-app" });
  const receipt = await controller.execute({
    id: "req-mock-restart",
    action: "app.restart",
    target: "demo-app",
    confirmation_token: plan.confirmation_token,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.executed, true);
  assert.deepEqual(
    mockOps.calls.map((call) => call[0]),
    ["stop", "start"],
  );
  assert.equal(typeof receipt.output.pid, "number");
});

// ---------------------------------------------------------------------------
// 6) 插件管理
// ---------------------------------------------------------------------------

test("plugin.enable/disable：真实写 plugin.json 的 enabled（保留 id/name/version）", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const enable = await controller.execute({ id: "req-p-enable", action: "plugin.disable", target: "plugin-a" });
  assert.equal(enable.ok, true);
  assert.equal(enable.output.enabled, false);
  const manifestPath = join(ws.pluginsDir, "plugin-a", "plugin.json");
  const afterDisable = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(afterDisable.enabled, false);
  assert.equal(afterDisable.id, "plugin-a");
  assert.equal(afterDisable.version, "1.0.0");

  const enableAgain = await controller.execute({ id: "req-p-dis", action: "plugin.enable", target: "plugin-a" });
  assert.equal(enableAgain.ok, true);
  assert.equal(enableAgain.output.enabled, true);
  const afterEnable = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(afterEnable.enabled, true);

  const plan = controller.plan({ id: "req-p-plan", action: "plugin.enable", target: "plugin-b" });
  assert.equal(plan.risk, "low");
  assert.equal(plan.requires_confirmation, false);
});

test("plugin.remove：先备份到回收站再删除，回执含 backup_path（+ restoreBackup 恢复）", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const pluginDir = join(ws.pluginsDir, "plugin-b");
  assert.equal(existsSync(pluginDir), true);

  const plan = controller.plan({ id: "req-p-remove", action: "plugin.remove", target: "plugin-b" });
  assert.equal(plan.risk, "destructive");
  const receipt = await controller.execute({
    id: "req-p-remove",
    action: "plugin.remove",
    target: "plugin-b",
    confirmation_token: plan.confirmation_token,
    requested_by: "unit-test",
    reason: "删除测试插件（会先备份）",
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.executed, true);
  assert.equal(typeof receipt.backup_path, "string");
  assert.equal(isRecyclePath(ws.stateDir, receipt.backup_path), true);
  assert.equal(existsSync(receipt.backup_path), true);
  assert.equal(existsSync(pluginDir), false);
  // 备份里应包含 manifest 内容
  const backupManifest = JSON.parse(await readFile(join(receipt.backup_path, "plugin.json"), "utf8"));
  assert.equal(backupManifest.id, "plugin-b");
  // 审计含 backup_path
  const audit = controller.auditTrail(1)[0];
  assert.equal(audit.action, "plugin.remove");
  assert.equal(audit.ok, true);
  assert.equal(audit.backup_path.replaceAll("\\", "/"), receipt.backup_path.replaceAll("\\", "/"));

  // restoreBackup 恢复
  const restoreTarget = join(ws.root, "restored-plugin-b");
  const restored = await restoreBackup(receipt.backup_path, restoreTarget);
  assert.equal(restored.restored, true);
  assert.equal(existsSync(join(restoreTarget, "plugin.json")), true);
});

// ---------------------------------------------------------------------------
// 7) 受管应用删除 + 备份 + 审计
// ---------------------------------------------------------------------------

test("app.remove：仅 allow_remove=true；备份→删除；真实回执 backup_path 与审计落盘", { skip: !WINDOWS }, async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const targetDir = ws.removableDir;
  const plan = controller.plan({ id: "req-app-remove", action: "app.remove", target: "removable-app" });
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "destructive");
  assert.equal(plan.requires_confirmation, true);

  const receipt = await controller.execute({
    id: "req-app-remove",
    action: "app.remove",
    target: "removable-app",
    confirmation_token: plan.confirmation_token,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.executed, true);
  assert.equal(typeof receipt.backup_path, "string");
  assert.equal(existsSync(receipt.backup_path), true);
  const backupPayload = await readFile(join(receipt.backup_path, "payload.txt"), "utf8");
  assert.match(backupPayload, /SHOULD_BE_BACKED_UP/);
  assert.equal(existsSync(targetDir), false);

  const lines = readAuditLines(ws);
  const last = lines[lines.length - 1];
  assert.equal(last.action, "app.remove");
  assert.equal(last.ok, true);
  assert.equal(last.executed, true);
  assert.equal(typeof last.backup_path, "string");
  assert.equal(last.backup_path.endsWith("payload.txt"), false); // 记录的是备份目录而不是文件
});

// ---------------------------------------------------------------------------
// 8) file.list / system.info / 非法请求
// ---------------------------------------------------------------------------

test("file.list：只读列出受管应用目录（可下钻子目录，越界拒绝）", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  await mkdir(join(ws.appDir, "assets"), { recursive: true });
  await writeFile(join(ws.appDir, "assets", "logo.txt"), "logo\n", "utf8");

  const receipt = await controller.execute({ id: "req-file-list", action: "file.list", target: "demo-app" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.executed, true);
  const names = receipt.output.entries.map((entry) => entry.name);
  assert.ok(names.includes("main.js"));
  assert.ok(names.includes("assets"));
  const assetsEntry = receipt.output.entries.find((entry) => entry.name === "assets");
  assert.equal(assetsEntry.type, "dir");

  const nested = await controller.execute({
    id: "req-file-list-nested",
    action: "file.list",
    target: "demo-app",
    params: { path: "assets" },
  });
  assert.equal(nested.ok, true);
  assert.deepEqual(
    nested.output.entries.map((entry) => entry.name),
    ["logo.txt"],
  );

  const missingTarget = controller.plan({ id: "req-file-no-target", action: "file.list" });
  assert.equal(missingTarget.allowed, false);
});

test("非法请求：未知动作 / 缺少 id 抛 SystemActionError", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  assert.throws(
    () => controller.plan({ id: "req-bad-action", action: "system.nuke" }),
    (error) => error instanceof SystemActionError && /未知动作/.test(error.message),
  );
  assert.throws(
    () => controller.plan({ action: "system.info" }),
    (error) => error instanceof SystemActionError && /id/.test(error.message),
  );
  await assert.rejects(
    () => controller.execute({ id: "req-bad-action", action: "system.nuke" }),
    (error) => error instanceof SystemActionError,
  );
});

test("审计：JSONL 追加、跨实例持久化、拒绝也留痕、不含密钥明文", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  await controller.execute({ id: "req-audit-1", action: "app.list" });
  await controller.execute({
    id: "req-audit-2",
    action: "system.info",
    reason: "用户排查 token=abcd1234secret 相关配置",
    params: { api_key: "placeholder".repeat(3) },
    requested_by: "user-1",
  });
  const entries = controller.auditTrail(10);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.action),
    ["app.list", "system.info"],
  );
  // 跨实例持久化
  const secondController = ws.makeController();
  const replayed = secondController.auditTrail(10);
  assert.equal(replayed.length, 2);
  assert.equal(replayed[1].requested_by, "user-1");
  // 不含密钥明文
  const raw = readFileSync(auditFileOf(ws), "utf8");
  assert.equal(raw.includes("SECRET1234567890"), false);
  assert.equal(raw.includes("abcd1234secret"), false);
  assert.equal(raw.includes("[REDACTED]"), true);
  // JSONL 追加（行数 = 条目数）
  assert.equal(readAuditLines(ws).length, 2);
  // 直接测试脱敏函数
  assert.equal(redactAuditText("password=SuperSecret123 api_key:sk-abcdefgh12345").includes("SuperSecret123"), false);
});

test("JsonlAuditTrail：追加式只读存储，损坏行跳过", async () => {
  const ws = await makeWorkspace();
  const file = join(ws.stateDir, "custom-audit.jsonl");
  const trail = new JsonlAuditTrail(file);
  trail.append({
    audit_id: "a-1",
    at: "2026-10-26T12:00:00.000Z",
    request_id: "r-1",
    action: "system.info",
    target: null,
    risk: "readonly",
    ok: true,
    executed: true,
    summary: "ok",
    platform: process.platform,
  });
  const { appendFileSync } = await import("node:fs");
  appendFileSync(file, "{ 这不是合法 JSON\n", "utf8");
  trail.append({
    audit_id: "a-2",
    at: "2026-10-26T12:00:01.000Z",
    request_id: "r-2",
    action: "app.list",
    target: null,
    risk: "readonly",
    ok: true,
    executed: true,
    summary: "ok2",
    platform: process.platform,
  });
  const entries = trail.tail(10);
  assert.deepEqual(
    entries.map((entry) => entry.audit_id),
    ["a-1", "a-2"],
  );
  assert.equal(trail.count(), 2);
});

// ---------------------------------------------------------------------------
// 9) 真实执行器补充
// ---------------------------------------------------------------------------

test("WindowsProcessOps：list() 真实枚举进程；remove 无路径时抛 SystemActionError", { skip: !WINDOWS }, async () => {
  const ws = await makeWorkspace();
  const ops = new WindowsProcessOps({ root: ws.root, stateDir: ws.stateDir, pluginsDir: ws.pluginsDir });
  const processes = await ops.list();
  assert.ok(Array.isArray(processes));
  assert.ok(processes.length > 0);
  assert.ok(processes.every((item) => typeof item.pid === "number" && typeof item.name === "string"));
  const externalApp = {
    id: "no-path-app",
    name: "无路径程序",
    command: "node",
    kind: "console",
    allow_start: true,
    allow_stop: true,
    allow_remove: true,
  };
  await assert.rejects(
    async () => ops.remove(externalApp),
    (error) => error instanceof SystemActionError && /path/.test(error.message),
  );
});

test("控制器恢复备份：restoreBackup 只允许恢复本控制器回收站内的备份", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const outsideBackup = join(tmpdir(), "steward-system-not-a-backup", "x.txt");
  await mkdir(join(tmpdir(), "steward-system-not-a-backup"), { recursive: true });
  await writeFile(outsideBackup, "x\n", "utf8");
  await assert.rejects(
    async () => controller.restoreBackup(outsideBackup, join(ws.root, "restore-outside")),
    (error) => error instanceof SystemActionError && /回收站/.test(error.message),
  );
});

test("插件目录越界：plugins_dir 下的符号/相对目标不能操作其它目录", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  // 插件 id 含 .. 或绝对路径 → resolvePluginDir 拒绝，plan.allowed=false
  for (const badTarget of ["../plugins", "../../etc", "C:\\Windows\\System32", "..", "a/b"]) {
    const plan = controller.plan({ id: `req-bad-${badTarget}`, action: "plugin.disable", target: badTarget });
    assert.equal(plan.allowed, false, `目标 ${badTarget} 应被拒绝`);
  }
  // file.list 目标在受管清单外
  const plan = controller.plan({ id: "req-file-out", action: "file.list", target: "C:\\Windows" });
  assert.equal(plan.allowed, false);
});

// ---------------------------------------------------------------------------
// 10) 清理：确保插件目录列表一致（无残留副作用）
// ---------------------------------------------------------------------------

test("测试环境自检：受管目录不落在系统关键路径，且无跨测试泄漏", async () => {
  const ws = await makeWorkspace();
  assert.equal(isSystemCriticalPath(ws.root), false);
  assert.equal(readdirSync(ws.pluginsDir).includes("plugin-a"), true);
  // 两个独立工作区互不影响
  const ws2 = await makeWorkspace();
  assert.notEqual(ws.root, ws2.root);
  assert.equal(ws2.controller.listPlugins().length, 2);
});

// ---------------------------------------------------------------------------
// 11) v1.4-D 扩展：受管工作区文件 / 打开应用 / 服务状态 / 定时任务 / 安装卸载
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { symlink } from "node:fs/promises";

/** 计算 sha256（断言 file.write/read 输出与审计摘要用）。 */
function sha256Of(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 准备受管工作区与安装源目录（控制器默认：<root>/workspace、<root>/install-sources）。 */
async function makeManagedDirs(ws) {
  const workspaceDir = join(ws.root, "workspace");
  const installSourcesDir = join(ws.root, "install-sources");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(installSourcesDir, { recursive: true });
  return { workspaceDir, installSourcesDir };
}

/** plan →（medium/high/destructive 需要时带 token）→ execute。 */
async function executeConfirmed(controller, request) {
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true, `请求应被允许：${plan.summary}`);
  const withToken = plan.requires_confirmation ? { ...request, confirmation_token: plan.confirmation_token } : request;
  return controller.execute(withToken);
}

/** 写入一个受管安装源目录（app.json + payload.txt）。 */
async function writeInstallSource(installSourcesDir, sourceId, manifest = {}) {
  const dir = join(installSourcesDir, sourceId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "app.json"),
    JSON.stringify(
      { id: sourceId, name: `安装源 ${sourceId}`, command: process.execPath, args: LONG_SLEEP_ARGS, ...manifest },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(join(dir, "payload.txt"), "installed-payload\n", "utf8");
  return dir;
}

test("v1.4-D file.list(workspace)：只读列出受管工作区（名称/类型/大小）", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  await mkdir(join(workspaceDir, "docs"), { recursive: true });
  await writeFile(join(workspaceDir, "a.txt"), "hello", "utf8");

  const plan = ws.controller.plan({ id: "req-ws-list", action: "file.list", target: "workspace" });
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "readonly");
  assert.equal(plan.requires_confirmation, false);

  const receipt = await ws.controller.execute({ id: "req-ws-list", action: "file.list", target: "workspace" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.risk, "readonly");
  const names = receipt.output.entries.map((entry) => entry.name);
  assert.deepEqual(names, ["a.txt", "docs"]);
  const fileEntry = receipt.output.entries.find((entry) => entry.name === "a.txt");
  assert.equal(fileEntry.type, "file");
  assert.equal(fileEntry.size, 5);
  const dirEntry = receipt.output.entries.find((entry) => entry.name === "docs");
  assert.equal(dirEntry.type, "dir");

  const nested = await ws.controller.execute({
    id: "req-ws-list-2",
    action: "file.list",
    target: "workspace",
    params: { path: "docs" },
  });
  assert.equal(nested.ok, true);
  assert.deepEqual(nested.output.entries, []);
});

test("v1.4-D file.write/file.read：medium 默认需确认；读回内容一致且审计只记大小/hash", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  const controller = ws.controller;
  const content = "你好，v1.4-D：受管工作区文件";
  const writeRequest = { id: "req-write-1", action: "file.write", params: { path: "notes/hello.txt", content } };
  const plan = controller.plan(writeRequest);
  assert.equal(plan.risk, "medium");
  assert.equal(plan.allowed, true);
  assert.equal(plan.requires_confirmation, true);
  assert.equal(typeof plan.confirmation_token, "string");
  await assert.rejects(() => controller.execute(writeRequest), (error) => error instanceof ConfirmationRequiredError);

  const written = await controller.execute({ ...writeRequest, confirmation_token: plan.confirmation_token });
  assert.equal(written.ok, true);
  assert.equal(written.executed, true);
  assert.equal(written.output.size, Buffer.byteLength(content, "utf8"));
  assert.equal(written.output.sha256, sha256Of(content));
  assert.equal(written.output.overwritten, false);
  assert.equal(await readFile(join(workspaceDir, "notes", "hello.txt"), "utf8"), content);

  const readRequest = { id: "req-read-1", action: "file.read", params: { path: "notes/hello.txt" } };
  const readPlan = controller.plan(readRequest);
  assert.equal(readPlan.risk, "readonly");
  assert.equal(readPlan.requires_confirmation, false);
  const read = await controller.execute(readRequest);
  assert.equal(read.ok, true);
  assert.equal(read.output.content, content);
  assert.equal(read.output.size, Buffer.byteLength(content, "utf8"));
  assert.equal(read.output.sha256, sha256Of(content));

  const rawAudit = readFileSync(auditFileOf(ws), "utf8");
  assert.equal(rawAudit.includes(content), false);
  assert.match(rawAudit, /sha256=/);
});

test("v1.4-D file.write：256KB 上限与非法 content 拒绝", async () => {
  const ws = await makeWorkspace();
  await makeManagedDirs(ws);
  const controller = ws.controller;
  const tooLarge = "x".repeat(256 * 1024 + 1);
  const plan = controller.plan({ id: "req-write-large", action: "file.write", params: { path: "big.txt", content: tooLarge } });
  assert.equal(plan.allowed, false);
  assert.match(plan.summary, /过大/);
  const notString = controller.plan({ id: "req-write-nonstr", action: "file.write", params: { path: "x.txt", content: 123 } });
  assert.equal(notString.allowed, false);
  const exactLimit = controller.plan({ id: "req-write-limit", action: "file.write", params: { path: "ok.txt", content: "x".repeat(256 * 1024) } });
  assert.equal(exactLimit.allowed, true);
});

test("v1.4-D 文件路径安全：.. 穿越 / 绝对路径 / 盘符路径拒绝", async () => {
  const ws = await makeWorkspace();
  await makeManagedDirs(ws);
  const controller = ws.controller;
  const badPaths = ["../evil.txt", "a/../../evil.txt", "C:/Windows/evil.txt", "D:/tmp/evil.txt"];
  for (const [index, path] of badPaths.entries()) {
    const plan = controller.plan({ id: `req-bad-path-${index}`, action: "file.write", params: { path, content: "x" } });
    assert.equal(plan.allowed, false, `路径 ${path} 应被拒绝：${plan.summary}`);
  }
  const readBad = controller.plan({ id: "req-bad-read", action: "file.read", params: { path: "../../etc/passwd" } });
  assert.equal(readBad.allowed, false);
  const removeBad = controller.plan({ id: "req-bad-remove", action: "file.remove", params: { path: ".." } });
  assert.equal(removeBad.allowed, false);
  const copyBad = controller.plan({ id: "req-bad-copy", action: "file.copy", params: { source: "a.txt", destination: "../out.txt" } });
  assert.equal(copyBad.allowed, false);
});

test("v1.4-D 软链接逃逸：工作区内软链接不允许用于文件动作", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  const outsideFile = join(ws.root, "outside-secret.txt");
  await writeFile(outsideFile, "outside\n", "utf8");
  const linkPath = join(workspaceDir, "link.txt");
  let symlinkOk = true;
  try {
    await symlink(outsideFile, linkPath, "file");
  } catch {
    symlinkOk = false;
  }
  if (!symlinkOk) {
    // 某些 Windows 环境（未启用开发者模式/无符号链接权限）无法创建软链接：跳过逃逸断言
    assert.ok(true, "当前环境无法创建符号链接，跳过软链接逃逸断言");
    return;
  }
  const writePlan = ws.controller.plan({ id: "req-symlink-write", action: "file.write", params: { path: "link.txt", content: "pwn" } });
  assert.equal(writePlan.allowed, false);
  const readPlan = ws.controller.plan({ id: "req-symlink-read", action: "file.read", params: { path: "link.txt" } });
  assert.equal(readPlan.allowed, false);
  const removePlan = ws.controller.plan({ id: "req-symlink-remove", action: "file.remove", params: { path: "link.txt" } });
  assert.equal(removePlan.allowed, false);
});

test("v1.4-D file.mkdir/file.copy/file.move：目录/复制/移动（覆盖前备份）", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  const controller = ws.controller;

  const mkdirReceipt = await executeConfirmed(controller, {
    id: "req-mkdir",
    action: "file.mkdir",
    params: { path: "projects/demo" },
  });
  assert.equal(mkdirReceipt.ok, true);
  assert.equal(existsSync(join(workspaceDir, "projects", "demo")), true);

  await writeFile(join(workspaceDir, "a.txt"), "A", "utf8");
  const copyReceipt = await executeConfirmed(controller, {
    id: "req-copy",
    action: "file.copy",
    params: { source: "a.txt", destination: "b.txt" },
  });
  assert.equal(copyReceipt.ok, true);
  assert.equal(await readFile(join(workspaceDir, "b.txt"), "utf8"), "A");

  await writeFile(join(workspaceDir, "dest.txt"), "OLD", "utf8");
  const moveReceipt = await executeConfirmed(controller, {
    id: "req-move",
    action: "file.move",
    params: { source: "a.txt", destination: "dest.txt", overwrite: true },
  });
  assert.equal(moveReceipt.ok, true);
  assert.equal(moveReceipt.output.overwritten, true);
  assert.equal(typeof moveReceipt.backup_path, "string");
  assert.equal(isRecyclePath(ws.stateDir, moveReceipt.backup_path), true);
  // 文件级备份的 backup_path 指向被备份的文件本身
  assert.equal(await readFile(moveReceipt.backup_path, "utf8"), "OLD");
  assert.equal(await readFile(join(workspaceDir, "dest.txt"), "utf8"), "A");
  assert.equal(existsSync(join(workspaceDir, "a.txt")), false);

  const denied = controller.plan({ id: "req-copy-denied", action: "file.copy", params: { source: "b.txt", destination: "dest.txt" } });
  assert.equal(denied.allowed, false);
  const outside = controller.plan({ id: "req-copy-outside", action: "file.copy", params: { source: "b.txt", destination: "../evil.txt" } });
  assert.equal(outside.allowed, false);
});

test("v1.4-D file.remove：destructive 必须 token；备份→删除→restoreBackup 恢复；根目录不可删", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  const controller = ws.controller;
  await mkdir(join(workspaceDir, "trash"), { recursive: true });
  await writeFile(join(workspaceDir, "trash", "a.txt"), "trash-a", "utf8");
  await writeFile(join(workspaceDir, "trash", "b.txt"), "trash-b", "utf8");

  const request = { id: "req-remove-dir", action: "file.remove", params: { path: "trash" } };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "destructive");
  assert.equal(plan.requires_confirmation, true);
  await assert.rejects(() => controller.execute(request), (error) => error instanceof ConfirmationRequiredError);

  const removed = await controller.execute({ ...request, confirmation_token: plan.confirmation_token });
  assert.equal(removed.ok, true);
  assert.equal(typeof removed.backup_path, "string");
  assert.equal(isRecyclePath(ws.stateDir, removed.backup_path), true);
  assert.equal(existsSync(join(workspaceDir, "trash")), false);
  assert.equal(await readFile(join(removed.backup_path, "a.txt"), "utf8"), "trash-a");

  const restoreTarget = join(ws.root, "restored-trash");
  const restored = await restoreBackup(removed.backup_path, restoreTarget);
  assert.equal(restored.restored, true);
  assert.equal(await readFile(join(restoreTarget, "b.txt"), "utf8"), "trash-b");

  const rootPlan = controller.plan({ id: "req-remove-root", action: "file.remove", params: { path: "" } });
  assert.equal(rootPlan.allowed, false);

  const audit = controller.auditTrail(1)[0];
  assert.equal(audit.action, "file.remove");
  assert.equal(audit.ok, true);
  assert.equal(typeof audit.backup_path, "string");
});

test("v1.4-D file.read：目录与超大文件拒绝", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  await mkdir(join(workspaceDir, "adir"), { recursive: true });
  await writeFile(join(workspaceDir, "big.bin"), "x".repeat(1024 * 1024 + 1), "utf8");
  const dirPlan = ws.controller.plan({ id: "req-read-dir", action: "file.read", params: { path: "adir" } });
  assert.equal(dirPlan.allowed, false);
  const bigPlan = ws.controller.plan({ id: "req-read-big", action: "file.read", params: { path: "big.bin" } });
  assert.equal(bigPlan.allowed, false);
});

test("v1.4-D file.write 覆盖已有文件：回执 overwritten=true", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);
  await writeFile(join(workspaceDir, "over.txt"), "old", "utf8");
  const controller = ws.controller;
  const receipt = await executeConfirmed(controller, {
    id: "req-overwrite",
    action: "file.write",
    params: { path: "over.txt", content: "new-content" },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.output.overwritten, true);
  assert.equal(await readFile(join(workspaceDir, "over.txt"), "utf8"), "new-content");
});

test("v1.4-D app.open：清单外拒绝；清单内 mock ProcessOps 验证 start；未配置 URL 白名单拒绝", async () => {
  const ws = await makeWorkspace();
  const mockOps = createMockOps();
  const controller = ws.makeController({ processOps: mockOps });

  const outside = controller.plan({ id: "req-open-out", action: "app.open", target: "notepad" });
  assert.equal(outside.allowed, false);
  const injection = controller.plan({ id: "req-open-inject", action: "app.open", target: "demo-app & calc" });
  assert.equal(injection.allowed, false);

  const request = { id: "req-open-app", action: "app.open", target: "demo-app" };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "medium");
  assert.equal(plan.requires_confirmation, true);
  const opened = await controller.execute({ ...request, confirmation_token: plan.confirmation_token });
  assert.equal(opened.ok, true);
  assert.equal(opened.output.mode, "managed-app");
  assert.equal(typeof opened.output.pid, "number");
  assert.deepEqual(
    mockOps.calls.filter((call) => call[0] === "start"),
    [["start", "demo-app"]],
  );

  const urlPlan = controller.plan({ id: "req-open-url", action: "app.open", params: { target_url: "https://example.com/page" } });
  assert.equal(urlPlan.allowed, false);
  assert.match(urlPlan.summary, /allowed_urls|URL/);
});

test("v1.4-D app.open URL 白名单：注入 urlOpener 打开；非 http/域名外/内嵌凭据拒绝", async () => {
  const ws = await makeWorkspace();
  const opened = [];
  const controller = ws.makeController({
    allowed_urls: ["example.com"],
    urlOpener: async (url) => {
      opened.push(url);
      return { pid: 4567 };
    },
  });
  const request = {
    id: "req-open-url-ok",
    action: "app.open",
    params: { target_url: "https://app.example.com/page?token=SECRET_TOKEN_VALUE" },
  };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "medium");
  const receipt = await controller.execute({ ...request, confirmation_token: plan.confirmation_token });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.output.mode, "url");
  assert.equal(receipt.output.pid, 4567);
  assert.equal(opened.length, 1);
  assert.equal(opened[0], "https://app.example.com/page?token=SECRET_TOKEN_VALUE");

  const audit = controller.auditTrail(1)[0];
  assert.equal(audit.action, "app.open");
  assert.match(audit.summary, /app\.example\.com\/page/);
  assert.equal(audit.summary.includes("SECRET_TOKEN_VALUE"), false);

  const badUrls = [
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "http://evil.example.org/x",
    "https://user:pass@example.com/",
    "https://example.com.evil.org/",
  ];
  for (const [index, targetUrl] of badUrls.entries()) {
    const badPlan = controller.plan({ id: `req-open-url-bad-${index}`, action: "app.open", params: { target_url: targetUrl } });
    assert.equal(badPlan.allowed, false, `URL ${targetUrl} 应被拒绝：${badPlan.summary}`);
  }
});

test("v1.4-D service.status：只读进程快照（mock ProcessOps，无需确认）", async () => {
  const ws = await makeWorkspace();
  const mockOps = createMockOps();
  const controller = ws.makeController({ processOps: mockOps });
  const plan = controller.plan({ id: "req-service", action: "service.status" });
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "readonly");
  assert.equal(plan.requires_confirmation, false);
  const receipt = await controller.execute({ id: "req-service", action: "service.status" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.executed, true);
  assert.equal(receipt.output.count, 1);
  assert.deepEqual(receipt.output.processes, [{ pid: 1, name: "mock" }]);
  assert.equal(typeof receipt.output.at, "string");
});

test("v1.4-D service.status 真实进程快照（Windows 真实枚举）", { skip: !WINDOWS }, async () => {
  const ws = await makeWorkspace();
  const receipt = await ws.controller.execute({ id: "req-real-service", action: "service.status" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.risk, "readonly");
  assert.ok(receipt.output.count > 0);
  assert.ok(receipt.output.processes.every((item) => typeof item.pid === "number" && typeof item.name === "string"));
  const audit = ws.controller.auditTrail(1)[0];
  assert.equal(audit.action, "service.status");
});

test("v1.4-D task.create/list/remove：scheduler.json 持久化 + interval/cron/重名校验", async () => {
  const ws = await makeWorkspace();
  const controller = ws.controller;
  const schedulerPath = join(ws.stateDir, "scheduler.json");

  const request = {
    id: "req-task-1",
    action: "task.create",
    params: { name: "每日日报", interval_seconds: 300, goal: "生成并汇总日报" },
  };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "medium");
  assert.equal(plan.requires_confirmation, true);
  await assert.rejects(() => controller.execute(request), (error) => error instanceof ConfirmationRequiredError);

  const created = await controller.execute({
    ...request,
    confirmation_token: plan.confirmation_token,
    requested_by: "unit-test",
  });
  assert.equal(created.ok, true);
  assert.equal(created.output.task.name, "每日日报");
  assert.equal(created.output.task.interval_seconds, 300);
  assert.match(created.output.task.id, /^task-/);
  // 审计脱敏不应误伤普通 id（task-xxxx 不是 API Key）
  const taskAudit = controller.auditTrail(1)[0];
  assert.equal(taskAudit.action, "task.create");
  assert.match(taskAudit.summary, /id=task-/);
  assert.equal(taskAudit.summary.includes("[REDACTED_API_KEY]"), false);
  assert.equal(existsSync(schedulerPath), true);
  const persisted = JSON.parse(readFileSync(schedulerPath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.tasks.length, 1);

  const listed = await controller.execute({ id: "req-task-list", action: "task.list" });
  assert.equal(listed.ok, true);
  assert.equal(listed.output.tasks.length, 1);
  assert.equal(listed.output.tasks[0].name, "每日日报");

  assert.equal(
    controller.plan({ id: "req-task-dup", action: "task.create", params: { name: "每日日报", interval_seconds: 600, goal: "x" } }).allowed,
    false,
  );
  assert.equal(
    controller.plan({ id: "req-task-min", action: "task.create", params: { name: "太短", interval_seconds: 30, goal: "x" } }).allowed,
    false,
  );
  assert.equal(
    controller.plan({ id: "req-task-max", action: "task.create", params: { name: "太长", interval_seconds: 90000, goal: "x" } }).allowed,
    false,
  );
  assert.equal(
    controller.plan({ id: "req-task-cron-bad", action: "task.create", params: { name: "坏 cron", cron: "bad cron", goal: "x" } }).allowed,
    false,
  );
  assert.equal(
    controller.plan({
      id: "req-task-both",
      action: "task.create",
      params: { name: "冲突", interval_seconds: 300, cron: "0 * * * *", goal: "x" },
    }).allowed,
    false,
  );

  const cronTask = await executeConfirmed(controller, {
    id: "req-task-2",
    action: "task.create",
    params: { name: "每小时巡检", cron: "0 * * * *", goal: "巡检", enabled: false },
  });
  assert.equal(cronTask.ok, true);
  assert.equal(cronTask.output.task.cron, "0 * * * *");
  assert.equal(cronTask.output.task.enabled, false);

  const otherController = ws.makeController();
  assert.equal(otherController.listTasks().length, 2);

  const removeRequest = { id: "req-task-remove", action: "task.remove", target: "每日日报" };
  const removePlan = otherController.plan(removeRequest);
  assert.equal(removePlan.allowed, true);
  assert.equal(removePlan.requires_confirmation, true);
  const removed = await otherController.execute({ ...removeRequest, confirmation_token: removePlan.confirmation_token });
  assert.equal(removed.ok, true);
  assert.equal(removed.output.removed, true);
  assert.equal(otherController.listTasks().length, 1);
  assert.equal(otherController.plan({ id: "req-task-remove-missing", action: "task.remove", target: "不存在" }).allowed, false);
});

test("v1.4-D program.install：仅 install_sources_dir；复制到 programs/<id> 并写入 installed.json/受管清单", async () => {
  const ws = await makeWorkspace();
  const { installSourcesDir } = await makeManagedDirs(ws);
  await writeInstallSource(installSourcesDir, "sample-app");
  const controller = ws.controller;

  const request = { id: "req-install-1", action: "program.install", params: { source_id: "sample-app" } };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "medium");
  assert.equal(plan.requires_confirmation, true);
  await assert.rejects(() => controller.execute(request), (error) => error instanceof ConfirmationRequiredError);

  const installed = await controller.execute({ ...request, confirmation_token: plan.confirmation_token });
  assert.equal(installed.ok, true);
  const programDir = join(ws.root, "programs", "sample-app");
  assert.equal(installed.output.path, programDir.replaceAll("\\", "/"));
  assert.equal(existsSync(join(programDir, "app.json")), true);
  assert.equal(existsSync(join(programDir, "payload.txt")), true);

  const app = controller.listApps().find((item) => item.id === "sample-app");
  assert.notEqual(app, undefined);
  assert.equal(app.installed_from, "sample-app");

  const installedFile = JSON.parse(readFileSync(join(ws.stateDir, "installed.json"), "utf8"));
  assert.equal(installedFile.version, 1);
  assert.equal(installedFile.programs.length, 1);
  assert.equal(installedFile.programs[0].id, "sample-app");

  const audit = controller.auditTrail(1)[0];
  assert.equal(audit.action, "program.install");
  assert.equal(audit.ok, true);

  const otherController = ws.makeController();
  assert.equal(otherController.listApps().some((item) => item.id === "sample-app"), true);
  const startPlan = otherController.plan({ id: "req-installed-start", action: "app.start", target: "sample-app" });
  assert.equal(startPlan.allowed, true);

  assert.equal(
    controller.plan({ id: "req-install-dup", action: "program.install", params: { source_id: "sample-app" } }).allowed,
    false,
  );
});

test("v1.4-D program.install：安装源白名单外/路径穿越/不存在来源拒绝", async () => {
  const ws = await makeWorkspace();
  const { installSourcesDir } = await makeManagedDirs(ws);
  await writeInstallSource(installSourcesDir, "good-app");
  await writeFile(
    join(ws.root, "evil-manifest.json"),
    JSON.stringify({ id: "evil-app", name: "evil", command: "node" }),
    "utf8",
  );
  const controller = ws.controller;
  const badSources = ["../evil", "..", "C:/Windows", "a/b", "missing-app"];
  for (const [index, sourceId] of badSources.entries()) {
    const plan = controller.plan({ id: `req-install-bad-${index}`, action: "program.install", params: { source_id: sourceId } });
    assert.equal(plan.allowed, false, `安装源 ${sourceId} 应被拒绝：${plan.summary}`);
  }
  const viaTarget = controller.plan({ id: "req-install-target", action: "program.install", target: "good-app" });
  assert.equal(viaTarget.allowed, true);
});

test("v1.4-D program.uninstall：destructive 备份+删除+从受管清单/installed.json 移除", async () => {
  const ws = await makeWorkspace();
  const { installSourcesDir } = await makeManagedDirs(ws);
  await writeInstallSource(installSourcesDir, "sample-app");
  const controller = ws.controller;
  await executeConfirmed(controller, {
    id: "req-install-for-uninstall",
    action: "program.install",
    params: { source_id: "sample-app" },
  });
  const programDir = join(ws.root, "programs", "sample-app");
  assert.equal(existsSync(programDir), true);

  const request = { id: "req-uninstall-1", action: "program.uninstall", target: "sample-app" };
  const plan = controller.plan(request);
  assert.equal(plan.allowed, true);
  assert.equal(plan.risk, "destructive");
  await assert.rejects(() => controller.execute(request), (error) => error instanceof ConfirmationRequiredError);

  const removed = await controller.execute({ ...request, confirmation_token: plan.confirmation_token });
  assert.equal(removed.ok, true);
  assert.equal(typeof removed.backup_path, "string");
  assert.equal(isRecyclePath(ws.stateDir, removed.backup_path), true);
  assert.equal(existsSync(join(removed.backup_path, "payload.txt")), true);
  assert.equal(existsSync(programDir), false);
  assert.equal(controller.listApps().some((item) => item.id === "sample-app"), false);

  const installedFile = JSON.parse(readFileSync(join(ws.stateDir, "installed.json"), "utf8"));
  assert.equal(installedFile.programs.length, 0);

  const audit = controller.auditTrail(1)[0];
  assert.equal(audit.action, "program.uninstall");
  assert.equal(audit.ok, true);
  assert.equal(typeof audit.backup_path, "string");

  const otherController = ws.makeController();
  assert.equal(otherController.listApps().some((item) => item.id === "sample-app"), false);

  const restoreTarget = join(ws.root, "restored-program");
  const restored = await restoreBackup(removed.backup_path, restoreTarget);
  assert.equal(restored.restored, true);
  assert.equal(existsSync(join(restoreTarget, "payload.txt")), true);

  assert.equal(
    controller.plan({ id: "req-uninstall-not-installed", action: "program.uninstall", target: "demo-app" }).allowed,
    false,
  );
});

test("v1.4-D 风险分级与 medium 语义：auto_approve_medium 可免令牌执行，destructive 仍必须确认", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir } = await makeManagedDirs(ws);

  assert.equal(ACTION_RISK["file.read"], "readonly");
  assert.equal(ACTION_RISK["file.list"], "readonly");
  assert.equal(ACTION_RISK["service.status"], "readonly");
  assert.equal(ACTION_RISK["task.list"], "readonly");
  assert.equal(ACTION_RISK["file.write"], "medium");
  assert.equal(ACTION_RISK["file.mkdir"], "medium");
  assert.equal(ACTION_RISK["file.copy"], "medium");
  assert.equal(ACTION_RISK["file.move"], "medium");
  assert.equal(ACTION_RISK["app.open"], "medium");
  assert.equal(ACTION_RISK["task.create"], "medium");
  assert.equal(ACTION_RISK["task.remove"], "medium");
  assert.equal(ACTION_RISK["program.install"], "medium");
  assert.equal(ACTION_RISK["file.remove"], "destructive");
  assert.equal(ACTION_RISK["program.uninstall"], "destructive");

  const strict = ws.makeController();
  const strictPlan = strict.plan({ id: "req-medium-strict", action: "file.write", params: { path: "m.txt", content: "medium" } });
  assert.equal(strictPlan.requires_confirmation, true);

  const auto = ws.makeController({ auto_approve_medium: true });
  const autoPlan = auto.plan({ id: "req-medium-auto", action: "file.write", params: { path: "auto.txt", content: "auto-mode" } });
  assert.equal(autoPlan.allowed, true);
  assert.equal(autoPlan.requires_confirmation, false);
  const executed = await auto.execute({ id: "req-medium-auto", action: "file.write", params: { path: "auto.txt", content: "auto-mode" } });
  assert.equal(executed.ok, true);
  assert.equal(await readFile(join(workspaceDir, "auto.txt"), "utf8"), "auto-mode");

  const destructivePlan = auto.plan({ id: "req-auto-remove", action: "file.remove", params: { path: "auto.txt" } });
  assert.equal(destructivePlan.requires_confirmation, true);
  await assert.rejects(
    () => auto.execute({ id: "req-auto-remove", action: "file.remove", params: { path: "auto.txt" } }),
    (error) => error instanceof ConfirmationRequiredError,
  );
});

test("v1.4-D 审计脱敏：文件内容不落审计（只记大小/hash），新动作均留痕", async () => {
  const ws = await makeWorkspace();
  const { workspaceDir, installSourcesDir } = await makeManagedDirs(ws);
  await writeInstallSource(installSourcesDir, "audit-app");
  const controller = ws.makeController({ processOps: createMockOps() });
  const secretContent = "TOPSECRET_CONTENT_1234567890";
  await executeConfirmed(controller, {
    id: "req-audit-write",
    action: "file.write",
    params: { path: "secret.txt", content: secretContent },
  });
  await controller.execute({ id: "req-audit-service", action: "service.status" });
  await executeConfirmed(controller, {
    id: "req-audit-task",
    action: "task.create",
    params: { name: "审计任务", interval_seconds: 120, goal: "审计" },
  });
  await executeConfirmed(controller, {
    id: "req-audit-install",
    action: "program.install",
    params: { source_id: "audit-app" },
  });

  const raw = readFileSync(auditFileOf(ws), "utf8");
  assert.equal(raw.includes(secretContent), false);
  assert.equal(existsSync(join(workspaceDir, "secret.txt")), true);

  const entries = controller.auditTrail(20);
  const actions = new Set(entries.map((entry) => entry.action));
  for (const action of ["file.write", "service.status", "task.create", "program.install"]) {
    assert.equal(actions.has(action), true, `审计应包含动作 ${action}`);
  }
  const writeEntry = entries.find((entry) => entry.action === "file.write");
  assert.match(writeEntry.summary, /字节/);
  assert.match(writeEntry.summary, /sha256=/);
  assert.equal(writeEntry.summary.includes(secretContent), false);
});
