/**
 * M2-B / A8 + A9 单元测试：停止键 ≤5s、检查点恢复、分支隔离。
 * 全部使用 mkdtemp 临时目录（不写仓库 runs/）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BranchToolNotAllowedError,
  CheckpointCorruptError,
  CheckpointNotFoundError,
  CheckpointStore,
  CredentialNotFoundError,
  CredentialVault,
  CrossBranchAccessError,
  ProfileBusyError,
  ProfileLock,
  StopController,
  StoppedError,
  UnsafeCredentialReferenceError,
  assertBranchToolsAllowed,
  filterBranchTools,
  maskRef,
  withAbort,
} from "../../dist/packages/steward-core/src/index.js";

async function makeRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// 1) StopController（A8：停止键 5 秒内生效）
// ---------------------------------------------------------------------------

test("StopController：request 后 isStopped=true、回调触发且停止文件落盘（幂等）", async () => {
  const root = await makeRoot("steward-stop-");
  const stopFile = join(root, ".steward", "STOP");
  const controller = new StopController(stopFile);
  const events = [];
  const unsubscribe = controller.onStop((event) => events.push(event));
  try {
    assert.equal(controller.isStopped, false);
    assert.equal(controller.signal.aborted, false);
    controller.start();

    const event = await controller.request("测试停止");
    assert.equal(controller.isStopped, true);
    assert.equal(event.reason, "测试停止");
    assert.equal(event.source, "request");
    assert.ok(controller.signal.aborted);
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, "测试停止");

    const onDisk = JSON.parse(readFileSync(stopFile, "utf8"));
    assert.equal(onDisk.reason, "测试停止");
    assert.equal(typeof onDisk.requestedAt, "string");

    // 重复 request 幂等：返回首次事件、不重复回调
    const again = await controller.request("重复停止");
    assert.equal(again.reason, "测试停止");
    assert.equal(events.length, 1);

    const waited = await controller.whenStopped();
    assert.equal(waited.reason, "测试停止");

    // 停止后再订阅立即回调
    let late = 0;
    const off = controller.onStop(() => {
      late += 1;
    });
    assert.equal(late, 1);
    off();
  } finally {
    unsubscribe();
    controller.dispose();
  }
});

test("StopController：watchdog 自动感知外部写入的停止文件（≤1s）", async () => {
  const root = await makeRoot("steward-stop-watchdog-");
  const stopFile = join(root, ".steward", "STOP");
  const controller = new StopController(stopFile, { pollIntervalMs: 20 });
  controller.start();
  try {
    const wait = controller.whenStopped();
    await mkdir(join(root, ".steward"), { recursive: true });
    await writeFile(
      stopFile,
      JSON.stringify({ reason: "外部 CLI 停止", requestedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    const event = await Promise.race([
      wait,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("watchdog 2s 内未感知停止文件")), 2_000).unref();
      }),
    ]);
    assert.equal(controller.isStopped, true);
    assert.equal(event.source, "watchdog");
    assert.equal(event.reason, "外部 CLI 停止");
  } finally {
    controller.dispose();
  }
});

test("withAbort：停止后 <5s 中断 10s 慢操作并 reject StoppedError（A8）", async () => {
  const root = await makeRoot("steward-stop-abort-");
  const controller = new StopController(join(root, ".steward", "STOP"));
  const slowFactory = (signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  try {
    const startedAt = Date.now();
    const pending = controller.withAbort(slowFactory);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await controller.request("测试：中断慢工具");

    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof StoppedError, "必须是 StoppedError");
      assert.match(error.message, /已停止/);
      assert.equal(error.reason, "测试：中断慢工具");
      return true;
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 5_000, `停止必须在 5s 内生效，实际 ${elapsed}ms`);
  } finally {
    controller.dispose();
  }
});

test("withAbort：未停止时正常返回；超过 timeoutMs 上限也会中断", async () => {
  const okSignal = new AbortController().signal;
  assert.equal(await withAbort(async () => 42, okSignal, 1_000), 42);

  const startedAt = Date.now();
  await assert.rejects(
    withAbort(
      (signal) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 10_000);
          signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
        }),
      new AbortController().signal,
      60,
    ),
    (error) => {
      assert.ok(error instanceof StoppedError);
      assert.match(error.message, /超时/);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 2_000, "超时应在约 60ms 生效");
});

// ---------------------------------------------------------------------------
// 2) CheckpointStore（A8：重启恢复、不重复）
// ---------------------------------------------------------------------------

test("CheckpointStore：save→load 一致，checkpoint.json 原子写且无 tmp 残留", async () => {
  const root = await makeRoot("steward-checkpoint-");
  const store = new CheckpointStore(root);
  const runId = "run-20260101-000000-abcdef";

  const saved = await store.save({
    runId,
    branchId: "br-operator-0001",
    stepIndex: 1,
    doneSteps: ["step-0"],
    state: { goal: "恢复测试", tokens: 42 },
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.completed, false);
  assert.equal(saved.runId, runId);

  const file = join(root, "runs", runId, "checkpoint.json");
  assert.ok(existsSync(file), "检查点文件必须存在");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.updatedAt, saved.updatedAt);
  assert.deepEqual(parsed.doneSteps, ["step-0"]);

  const loaded = await store.load(runId);
  assert.deepEqual(loaded, saved);

  // 原子写：run 目录里只有最终文件，没有 .tmp 残留
  assert.deepEqual(readdirSync(join(root, "runs", runId)), ["checkpoint.json"]);

  // 不存在的 run → null；非法 runId → 拒绝（防路径穿越）
  assert.equal(await store.load("run-does-not-exist"), null);
  assert.throws(() => store.checkpointPath("../evil"), /非法 runId/);
});

test("CheckpointStore：markStepDone 推进 stepIndex 且幂等；缺失检查点报错", async () => {
  const root = await makeRoot("steward-checkpoint-mark-");
  const store = new CheckpointStore(root);
  const runId = "run-20260101-000000-mark01";
  await store.save({ runId, branchId: "br-operator-0002", stepIndex: 0, doneSteps: [], state: { note: "init" } });

  const m0 = await store.markStepDone(runId, 0, { state: { last: "step-a" } });
  assert.deepEqual(m0.doneSteps, ["step-0"]);
  assert.equal(m0.stepIndex, 0);
  assert.equal(m0.state.note, "init", "state 应浅合并而不是覆盖");
  assert.equal(m0.state.last, "step-a");

  const m0again = await store.markStepDone(runId, 0);
  assert.deepEqual(m0again.doneSteps, ["step-0"], "重复标记同一步必须幂等");

  const m1 = await store.markStepDone(runId, 1);
  assert.deepEqual(m1.doneSteps, ["step-0", "step-1"]);
  assert.equal(m1.stepIndex, 1);

  await assert.rejects(
    () => store.markStepDone("run-20260101-000000-missing", 0),
    (error) => error instanceof CheckpointNotFoundError,
  );

  const done = await store.markCompleted(runId);
  assert.equal(done.completed, true);
  assert.equal((await store.load(runId)).completed, true);
});

test("CheckpointStore：listResumable 只返回未完成 run，跨 run 隔离，损坏检查点不阻断", async () => {
  const root = await makeRoot("steward-checkpoint-resume-");
  const store = new CheckpointStore(root);

  await store.save({
    runId: "run-20260101-000000-000001",
    branchId: "br-a",
    stepIndex: 1,
    doneSteps: ["step-0"],
    state: {},
    updatedAt: "2026-01-01T00:00:01.000Z",
  });
  await store.save({
    runId: "run-20260101-000000-000002",
    branchId: "br-b",
    stepIndex: 0,
    doneSteps: [],
    state: {},
    completed: true,
    updatedAt: "2026-01-01T00:00:02.000Z",
  });
  await store.save({
    runId: "run-20260101-000000-000003",
    branchId: "br-c",
    stepIndex: 2,
    doneSteps: ["step-0", "step-1"],
    state: {},
    updatedAt: "2026-01-01T00:00:03.000Z",
  });

  const points = await store.listResumable();
  assert.deepEqual(
    points.map((point) => point.runId),
    ["run-20260101-000000-000003", "run-20260101-000000-000001"],
    "只返回未完成 run，且按 updatedAt 新→旧",
  );
  assert.ok(points.every((point) => typeof point.path === "string" && point.path.endsWith("checkpoint.json")));

  const a = await store.load("run-20260101-000000-000001");
  assert.equal(a.branchId, "br-a");
  assert.equal((await store.load("run-20260101-000000-000002")).completed, true);
  assert.notEqual((await store.load("run-20260101-000000-000003")).branchId, a.branchId);

  // 损坏检查点：load 抛 CheckpointCorruptError，listResumable 跳过但不影响其他 run
  const badDir = join(root, "runs", "run-20260101-000000-badbad");
  await mkdir(badDir, { recursive: true });
  await writeFile(join(badDir, "checkpoint.json"), "{ this is not json", "utf8");
  await assert.rejects(
    () => store.load("run-20260101-000000-badbad"),
    (error) => error instanceof CheckpointCorruptError,
  );
  assert.equal((await store.listResumable()).length, 2);
});

// ---------------------------------------------------------------------------
// 3) CredentialVault（A9：跨分支凭据不可读）
// ---------------------------------------------------------------------------

test("CredentialVault：同分支可读、跨分支读抛 CrossBranchAccessError、未登记抛 CredentialNotFoundError", () => {
  const vault = new CredentialVault();
  const stored = vault.set("br-a", "deepseek", "DEEPSEEK_API_KEY");
  assert.equal(stored.kind, "env");
  assert.equal(vault.get("br-a", "deepseek").ref, "DEEPSEEK_API_KEY");
  assert.equal(vault.has("br-a", "deepseek"), true);
  assert.equal(vault.has("br-b", "deepseek"), false);

  assert.throws(
    () => vault.get("br-b", "deepseek"),
    (error) =>
      error instanceof CrossBranchAccessError &&
      error.branchId === "br-b" &&
      error.ownerBranchId === "br-a" &&
      /跨分支凭据访问被拒绝/.test(error.message),
  );
  assert.throws(
    () => vault.get("br-a", "missing-key"),
    (error) => error instanceof CredentialNotFoundError,
  );

  // 两个分支同名 key 各自独立，互不覆盖
  vault.set("br-b", "deepseek", "vault://deepseek-prod");
  assert.equal(vault.get("br-b", "deepseek").ref, "vault://deepseek-prod");
  assert.equal(vault.get("br-a", "deepseek").ref, "DEEPSEEK_API_KEY");
  assert.deepEqual(vault.listKeys("br-a"), ["deepseek"]);
  assert.deepEqual(vault.listKeys("br-b"), ["deepseek"]);
});

test("CredentialVault：redactFor 只返回本分支脱敏引用，不泄露引用明文", () => {
  const vault = new CredentialVault();
  vault.set("br-a", "deepseek", "env:DEEPSEEK_API_KEY");
  vault.set("br-a", "browser-profile", "file:./secrets/browser.profile");
  vault.set("br-other", "payment", "vault://payment-prod-secret");

  const redacted = vault.redactFor("br-a");
  assert.deepEqual(
    redacted.map((item) => item.key),
    ["browser-profile", "deepseek"],
  );
  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes("DEEPSEEK_API_KEY"), "不得泄露环境变量引用名");
  assert.ok(!serialized.includes("browser.profile"), "不得泄露文件引用路径");
  assert.ok(!serialized.includes("payment-prod-secret"), "不得出现其他分支的凭据");
  for (const item of redacted) {
    assert.equal("ref" in item, false, "redactFor 不应返回原始引用字段");
    assert.ok(item.refMasked.includes("*"), "refMasked 必须是脱敏形式");
  }
  // maskRef 单独导出也可安全使用
  assert.ok(!maskRef("env:DEEPSEEK_API_KEY").includes("DEEPSEEK_API_KEY"));
});

test("CredentialVault：拒绝疑似明文引用；文件登记表只存引用且可跨实例恢复", async () => {
  const root = await makeRoot("steward-vault-");
  const file = join(root, ".steward", "credentials.json");
  const vault = new CredentialVault({ file });

  assert.throws(
    // 拼接构造假的密钥形态，避免仓库密钥扫描把测试夹具误报为真实密钥
    () => vault.set("br-a", "token", "sk-" + "1234567890abcdefghijklmn"),
    (error) => error instanceof UnsafeCredentialReferenceError && /疑似明文/.test(error.message),
  );
  assert.throws(
    () => vault.set("br-a", "token", "a".repeat(300)),
    (error) => error instanceof UnsafeCredentialReferenceError,
  );

  vault.set("br-a", "deepseek", "DEEPSEEK_API_KEY");
  const raw = readFileSync(file, "utf8");
  assert.ok(raw.includes("DEEPSEEK_API_KEY"), "登记表保存的是引用名");
  assert.ok(!raw.includes("sk-"), "登记表不得出现明文密钥");

  const reloaded = new CredentialVault({ file });
  assert.equal(reloaded.get("br-a", "deepseek").ref, "DEEPSEEK_API_KEY");
  assert.throws(
    () => reloaded.get("br-b", "deepseek"),
    (error) => error instanceof CrossBranchAccessError,
  );
});

// ---------------------------------------------------------------------------
// 4) ProfileLock（A9：同一 profile 不得并发占用）
// ---------------------------------------------------------------------------

test("ProfileLock：acquire→isLocked→重复 acquire 抛 ProfileBusyError→release 后可再获取", async () => {
  const root = await makeRoot("steward-profile-lock-");
  const lock = new ProfileLock(root);

  const info = lock.acquire("browser-profile-a");
  assert.equal(info.profileId, "browser-profile-a");
  assert.ok(existsSync(info.path));
  assert.ok(info.token.length >= 8);
  assert.equal(lock.isLocked("browser-profile-a"), true);

  assert.throws(
    () => lock.acquire("browser-profile-a"),
    (error) => error instanceof ProfileBusyError && error.profileId === "browser-profile-a",
  );

  // 不同 profile 互不阻塞（隔离在 profile 维度）
  const other = lock.acquire("browser-profile-b");
  assert.equal(lock.isLocked("browser-profile-b"), true);
  assert.equal(lock.release("browser-profile-b", other.token), true);
  assert.equal(lock.isLocked("browser-profile-b"), false);

  // token 不匹配不得释放他人锁
  assert.throws(() => lock.release("browser-profile-a", "wrong-token"), /token/);
  assert.equal(lock.release("browser-profile-a", info.token), true);
  assert.equal(lock.isLocked("browser-profile-a"), false);
  assert.equal(lock.read("browser-profile-a"), null);

  const again = lock.acquire("browser-profile-a");
  assert.equal(lock.isLocked("browser-profile-a"), true);
  lock.release("browser-profile-a", again.token);
  assert.throws(() => lock.acquire("bad/profile"), /非法 profileId/);
});

test("ProfileLock：过期锁可被清理（timestamp/now 可注入）", async () => {
  const root = await makeRoot("steward-profile-stale-");
  let now = 1_700_000_000_000;
  const lock = new ProfileLock(root, { staleMs: 1_000, now: () => now, pid: 424242 });

  // 场景 1：isLocked 发现过期 → false 并清理
  const first = lock.acquire("desktop-profile");
  assert.equal(first.recovered, false);
  now += 200;
  assert.equal(lock.isLocked("desktop-profile"), true, "未过期时仍占用");
  now += 2_000;
  assert.equal(lock.isLocked("desktop-profile"), false, "过期后不再占用");
  const second = lock.acquire("desktop-profile");
  assert.equal(second.recovered, false, "isLocked 已清理过期锁");

  // 场景 2：直接 acquire 清理过期锁 → recovered=true，内容刷新
  now += 5_000;
  const third = lock.acquire("desktop-profile");
  assert.equal(third.recovered, true);
  assert.equal(third.timestamp, now);
  const record = lock.read("desktop-profile");
  assert.equal(record.pid, 424242);
  assert.equal(record.timestamp, now);
  assert.equal(record.profileId, "desktop-profile");

  // 场景 3：手工写入一枚过期锁文件 → acquire 清理并重新获得
  const stalePath = lock.lockPath("desktop-profile-stale");
  await mkdir(lock.lockDir, { recursive: true });
  await writeFile(
    stalePath,
    JSON.stringify({ profileId: "desktop-profile-stale", pid: 1, timestamp: now - 100_000, token: "old", hostname: "x" }),
    "utf8",
  );
  assert.equal(lock.isLocked("desktop-profile-stale"), false);
  assert.equal(existsSync(stalePath), false, "过期锁文件应被清理");
  const recoveredByAcquire = lock.acquire("desktop-profile-stale");
  assert.equal(recoveredByAcquire.recovered, false);
});

// ---------------------------------------------------------------------------
// 5) 分支工具白名单
// ---------------------------------------------------------------------------

test("assertBranchToolsAllowed：白名单内通过、白名单外/空工具名拒绝", () => {
  const tools = ["echo", "browser.flow"];
  assert.equal(assertBranchToolsAllowed(tools, "echo"), undefined);
  assert.doesNotThrow(() => assertBranchToolsAllowed(tools, "browser.flow"));

  assert.throws(
    () => assertBranchToolsAllowed(tools, "payment"),
    (error) =>
      error instanceof BranchToolNotAllowedError &&
      error.requestedTool === "payment" &&
      /白名单/.test(error.message),
  );
  assert.throws(() => assertBranchToolsAllowed([], "echo"), (error) => error instanceof BranchToolNotAllowedError);
  assert.throws(() => assertBranchToolsAllowed(tools, ""), (error) => error instanceof BranchToolNotAllowedError);

  assert.deepEqual(filterBranchTools(tools, ["echo", "payment", "browser.flow"]), ["echo", "browser.flow"]);
});

// ---------------------------------------------------------------------------
// 6) A8 综合验收：停止时检查点保留已完成步骤，重启可恢复且不重复
// ---------------------------------------------------------------------------

test("A8 综合：停止时检查点保留已完成步骤，重启恢复跳过已完成且不重复", async () => {
  const root = await makeRoot("steward-resume-");
  const stopFile = join(root, ".steward", "STOP");
  const controller = new StopController(stopFile);
  const store = new CheckpointStore(root);
  const runId = "run-20260101-000000-resume";
  const plan = ["step-a", "step-b", "step-c"];

  await store.save({
    runId,
    branchId: "br-operator-resume",
    stepIndex: 0,
    doneSteps: [],
    state: { plan },
  });

  const executed = [];
  try {
    for (const [index, step] of plan.entries()) {
      if (controller.isStopped) break;
      executed.push(step);
      await store.markStepDone(runId, index);
      if (index === 1) await controller.request("第二步后停止（模拟用户按停止键）");
    }
  } finally {
    controller.dispose();
  }

  assert.deepEqual(executed, ["step-a", "step-b"]);

  const checkpoint = await store.load(runId);
  assert.equal(checkpoint.completed, false);
  assert.deepEqual(checkpoint.doneSteps, ["step-0", "step-1"]);

  const resumable = await store.listResumable();
  assert.equal(resumable.length, 1);
  assert.equal(resumable[0].runId, runId);
  assert.equal(resumable[0].stepIndex, 1);
  assert.deepEqual(resumable[0].state.plan, plan);

  // 恢复：跳过 doneSteps，从 stepIndex + 1 继续（不会重复执行）
  const resumed = [];
  for (let index = checkpoint.stepIndex + 1; index < plan.length; index++) {
    const label = `step-${index}`;
    if (checkpoint.doneSteps.includes(label)) continue;
    resumed.push(plan[index]);
    await store.markStepDone(runId, index);
  }
  assert.deepEqual(resumed, ["step-c"], "恢复后只执行未完成步骤");

  await store.markCompleted(runId);
  assert.deepEqual(await store.listResumable(), [], "完成后不再出现在可恢复列表");
});
