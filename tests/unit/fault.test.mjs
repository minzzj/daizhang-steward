/**
 * 阶段二 P2-A / B3 + B4 故障演练单元测试（≥14 条）。
 *
 * 网络全部真实：用 Node 内置 `http` 起本地服务（端口 0），通过真实 close+destroy socket
 * 制造 ECONNREFUSED、通过真实 403 + `x-platform-ban: true` 制造封禁；不使用 mock/stub 网络。
 * 文件全部用 mkdtemp 临时目录，不写仓库 runs/。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AlternativePlan,
  BanDetector,
  ConnectivityProbe,
  DrillRunner,
  FaultValidationError,
  JsonLedgerApi,
  LedgerReconciler,
  NotificationCenter,
  OfflinePromiseError,
  Outbox,
  OutboxReplayError,
  PlatformBannedError,
  PromisesGate,
} from "../../dist/packages/steward-fault/src/index.js";

// ---------------------------------------------------------------------------
// 测试基础设施：真实本地 HTTP 服务
// ---------------------------------------------------------------------------

async function makeTmp(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

/** 起一个真实 HTTP 服务（127.0.0.1，端口 0）。 */
async function startServer(handler) {
  const sockets = new Set();
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      try {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "test_server_error" }));
      } catch {
        // ignore
      }
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    url: (path = "/") => `http://127.0.0.1:${port}${path}`,
    port,
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** 起服务后立刻关闭：返回一个确定无人监听的端口（真实 ECONNREFUSED）。多次尝试避免端口被复用。 */
async function closedPortUrl() {
  const probe = new ConnectivityProbe({ timeoutMs: 300 });
  for (let attempt = 0; attempt < 5; attempt++) {
    const server = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("{}");
    });
    await server.close();
    const url = server.url("/health");
    const result = await probe.probe(url);
    if (!result.online) return url;
  }
  throw new Error("测试环境异常：无法获得确定关闭的本地端口");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * 仿真外部平台（真实 HTTP）：支持 /health、POST /quote、POST /message（幂等）、
 * /admin/state、/admin/outage（真实 close+destroy socket，可定时自动恢复）、/admin/ban（真实 403+header）。
 */
class FakePlatform {
  constructor(options = {}) {
    this.quotes = new Map();
    this.messages = new Map();
    this.banUntil = 0;
    this.banEnabled = options.banEnabled !== false;
    this.server = null;
    this.port = 0;
    this.host = "127.0.0.1";
    this.sockets = new Set();
    this.reopenTimer = null;
  }

  async start() {
    await this.listen(0);
    return this;
  }

  async listen(port) {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        try {
          if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "platform_error" }));
        } catch {
          // ignore
        }
      });
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.host, resolve);
    });
    this.server = server;
    this.port = server.address().port;
    return this.port;
  }

  url(path = "/") {
    return `http://${this.host}:${this.port}${path.startsWith("/") ? path : `/${path}`}`;
  }

  send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      ...headers,
    });
    res.end(text);
  }

  async handle(req, res) {
    const url = new URL(req.url ?? "/", this.url("/"));
    const banned = this.banEnabled && this.banUntil > Date.now();
    if (url.pathname === "/health") {
      return this.send(res, 200, { ok: true, ts: new Date().toISOString(), banned_now: banned });
    }
    if (url.pathname === "/admin/state") {
      return this.send(res, 200, {
        ok: true,
        quotes: this.quotes.size,
        messages: this.messages.size,
        bans: { active: banned, until: this.banUntil },
        outage: this.server === null,
      });
    }
    if (url.pathname === "/admin/outage") {
      const body = await readJsonBody(req);
      if (body.mode === "down") {
        this.send(res, 200, { ok: true, mode: "down" });
        this.scheduleDown(body.reopen_after_ms);
        return;
      }
      this.send(res, 200, { ok: true, mode: "up" });
      return;
    }
    if (url.pathname === "/admin/ban") {
      const body = await readJsonBody(req);
      const minutes = Number(body.minutes ?? 15);
      if (this.banEnabled) this.banUntil = minutes <= 0 ? 0 : Date.now() + minutes * 60_000;
      return this.send(res, 200, { ok: true, minutes, ban_until: this.banUntil, ban_enabled: this.banEnabled });
    }
    if (url.pathname === "/admin/reset") {
      this.quotes.clear();
      this.messages.clear();
      this.banUntil = 0;
      return this.send(res, 200, { ok: true });
    }

    if (banned && (url.pathname === "/quote" || url.pathname === "/message")) {
      return this.send(
        res,
        403,
        { ok: false, error: "platform_banned", retry_after_ms: Math.max(0, this.banUntil - Date.now()) },
        { "x-platform-ban": "true", "retry-after": "2" },
      );
    }
    if (url.pathname === "/quote") {
      const body = await readJsonBody(req);
      const key = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
      if (key === "") return this.send(res, 400, { ok: false, error: "missing_idempotency_key" });
      const existing = this.quotes.get(key);
      if (existing !== undefined) return this.send(res, 200, { ok: true, quote_id: existing, duplicate: true });
      const id = `q-${randomUUID()}`;
      this.quotes.set(key, id);
      return this.send(res, 200, { ok: true, quote_id: id, duplicate: false });
    }
    if (url.pathname === "/message") {
      const body = await readJsonBody(req);
      const key = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
      if (key === "") return this.send(res, 400, { ok: false, error: "missing_idempotency_key" });
      const existing = this.messages.get(key);
      if (existing !== undefined) return this.send(res, 200, { ok: true, message_id: existing, duplicate: true });
      const id = `m-${randomUUID()}`;
      this.messages.set(key, id);
      return this.send(res, 200, { ok: true, message_id: id, duplicate: false });
    }
    return this.send(res, 404, { ok: false, error: "not_found" });
  }

  scheduleDown(reopenAfterMs) {
    setImmediate(() => {
      void this.closeServer().then(() => {
        if (typeof reopenAfterMs === "number" && Number.isFinite(reopenAfterMs) && reopenAfterMs >= 0) {
          this.reopenTimer = setTimeout(() => {
            void this.up();
          }, reopenAfterMs);
          this.reopenTimer.unref?.();
        }
      });
    });
  }

  async closeServer() {
    const server = this.server;
    if (server === null) return;
    this.server = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** 真实关闭监听（客户端将收到 ECONNREFUSED）。 */
  async down() {
    if (this.reopenTimer !== null) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
    }
    await this.closeServer();
  }

  /** 在同一端口真实恢复监听。 */
  async up() {
    if (this.reopenTimer !== null) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
    }
    if (this.server !== null) return;
    await this.listen(this.port);
  }

  async ban(minutes) {
    this.banUntil = minutes <= 0 ? 0 : Date.now() + minutes * 60_000;
  }

  async stop() {
    if (this.reopenTimer !== null) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
    }
    await this.closeServer();
  }
}

// ---------------------------------------------------------------------------
// 1) ConnectivityProbe：真实在线 / 离线 / 超时
// ---------------------------------------------------------------------------

test("Probe：真实 HTTP 服务在线（status/latency 字段）", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const probe = new ConnectivityProbe();
    const result = await probe.probe(server.url("/health"));
    assert.equal(result.online, true);
    assert.ok(result.latency_ms >= 0);
    assert.equal(result.error, undefined);
  } finally {
    await server.close();
  }
});

test("Probe：真实连接拒绝（ECONNREFUSED）与超时都判离线", async () => {
  const offlineUrl = await closedPortUrl();
  const probe = new ConnectivityProbe({ timeoutMs: 500 });
  const offline = await probe.probe(offlineUrl);
  assert.equal(offline.online, false);
  assert.match(String(offline.error), /ECONNREFUSED|connect/i, `应保留真实网络错误码：${offline.error}`);

  const slowServer = await startServer(async (_req, res) => {
    await delay(400);
    res.writeHead(200);
    res.end("{}");
  });
  try {
    const timedOut = await probe.probe(slowServer.url("/health"), 80);
    assert.equal(timedOut.online, false);
    assert.match(String(timedOut.error), /timeout/i);
  } finally {
    await slowServer.close();
  }
});

// ---------------------------------------------------------------------------
// 2) Outbox：幂等入队 / 持久化 / 重放跳过 / duplicate 统计 / 失败
// ---------------------------------------------------------------------------

test("Outbox：同 idempotency_key 幂等入队，outbox.json 原子持久化", async () => {
  const root = await makeTmp("steward-fault-outbox-");
  try {
    const outbox = new Outbox(root);
    const first = await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-001", payload: { customer: "客户 A", amount_cny: 100 } });
    const second = await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-001", payload: { customer: "客户 A", amount_cny: 100 } });
    assert.equal(second.id, first.id, "同幂等键必须返回同一项");
    const third = await outbox.enqueue({ action_kind: "message", idempotency_key: "idem-002", payload: { text: "hi" } });
    assert.notEqual(third.id, first.id);
    const list = await outbox.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].status, "queued");
    assert.equal(list[0].attempts, 0);

    const files = await readdir(root);
    assert.deepEqual(files.sort(), ["outbox.json"]);
    const onDisk = JSON.parse(await readFile(join(root, "outbox.json"), "utf8"));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.items.length, 2);
    const stats = await outbox.stats();
    assert.deepEqual(stats, { total: 2, queued: 2, replayed: 0, failed: 0 });
  } finally {
    await cleanup(root);
  }
});

test("Outbox：重启后从 outbox.json 恢复条目", async () => {
  const root = await makeTmp("steward-fault-outbox-persist-");
  try {
    const first = new Outbox(root);
    await first.enqueue({ action_kind: "invoice", idempotency_key: "idem-restart", payload: { amount_cny: 88 } });
    const second = new Outbox(root);
    const list = await second.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].idempotency_key, "idem-restart");
    assert.equal(list[0].action_kind, "invoice");
  } finally {
    await cleanup(root);
  }
});

test("Outbox：replay 跳过已重放项（不重复执行），duplicate 计入 duplicates_found", async () => {
  const root = await makeTmp("steward-fault-outbox-replay-");
  try {
    const outbox = new Outbox(root);
    await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-r1", payload: {} });
    await outbox.enqueue({ action_kind: "message", idempotency_key: "idem-r2", payload: {} });
    const calls = [];
    const executor = async (item) => {
      calls.push(item.idempotency_key);
      return { ok: true, duplicate: item.idempotency_key === "idem-r2", ref: `ref-${item.idempotency_key}` };
    };
    const report = await outbox.replay(executor);
    assert.equal(report.replayed, 2);
    assert.equal(report.failed, 0);
    assert.equal(report.duplicates_found, 1);
    assert.equal(calls.length, 2);
    assert.equal((await outbox.stats()).replayed, 2);

    // 再 replay：全部跳过，executor 不再被调用
    const second = await outbox.replay(executor);
    assert.equal(second.replayed, 0);
    assert.equal(second.skipped_duplicates, 2);
    assert.equal(second.duplicates_found, 0);
    assert.equal(calls.length, 2, "已重放项不得再次调用 executor");
  } finally {
    await cleanup(root);
  }
});

test("Outbox：executor 抛异常 → OutboxReplayError 且失败状态持久化", async () => {
  const root = await makeTmp("steward-fault-outbox-fail-");
  try {
    const outbox = new Outbox(root);
    await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-fail", payload: {} });
    await assert.rejects(
      () =>
        outbox.replay(async () => {
          throw new Error("网络仍未恢复");
        }),
      (error) => error instanceof OutboxReplayError && /网络仍未恢复/u.test(error.message),
    );
    const reloaded = new Outbox(root);
    const list = await reloaded.list();
    assert.equal(list[0].status, "failed");
    assert.match(list[0].last_error, /网络仍未恢复/u);
    assert.equal(list[0].attempts, 1);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 3) PromisesGate：断网不产生新承诺（B3 核心）
// ---------------------------------------------------------------------------

test("PromisesGate：在线放行，离线抛 OfflinePromiseError 并累计 blockedCount", () => {
  const gate = new PromisesGate();
  assert.doesNotThrow(() => gate.assertMayPromise(true));
  assert.equal(gate.blockedCount, 0);
  for (let index = 1; index <= 2; index++) {
    assert.throws(
      () => gate.assertMayPromise(false),
      (error) => error instanceof OfflinePromiseError && error.blocked_count === index,
    );
  }
  assert.equal(gate.blockedCount, 2);
  try {
    gate.assertMayPromise(false);
  } catch (error) {
    assert.match(error.message, /断网期间不产生新承诺/u);
  }
  gate.reset();
  assert.equal(gate.blockedCount, 0);
});

// ---------------------------------------------------------------------------
// 4) BanDetector：真实 403 + x-platform-ban: true；不误判；超时不误判
// ---------------------------------------------------------------------------

test("BanDetector：真实 403 + x-platform-ban:true → PlatformBannedError（retry_after/reason）", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/banned") {
      res.writeHead(403, {
        "content-type": "application/json",
        "x-platform-ban": "true",
        "retry-after": "2",
      });
      res.end(JSON.stringify({ ok: false, error: "platform_banned", retry_after_ms: 1500 }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const detector = new BanDetector();
    await assert.rejects(
      () => detector.check(server.url("/banned")),
      (error) =>
        error instanceof PlatformBannedError &&
        error.status === 403 &&
        error.retry_after_ms === 2000 &&
        /platform_banned|平台封禁/u.test(error.reason),
    );
    assert.equal(detector.isBanned, true);
    assert.equal(detector.last.banned, true);
  } finally {
    await server.close();
  }
});

test("BanDetector：普通 403/200（无 ban 头）不误判", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/forbidden") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return;
    }
    if (req.url === "/ok-with-ban-header") {
      // 200 即使带 x-platform-ban 头也不算封禁（必须 403/429）
      res.writeHead(200, { "content-type": "application/json", "x-platform-ban": "true" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const detector = new BanDetector();
    const forbidden = await detector.check(server.url("/forbidden"));
    assert.equal(forbidden.banned, false);
    assert.equal(forbidden.status, 403);
    assert.equal(detector.isBanned, false);
    const ok = await detector.check(server.url("/ok-with-ban-header"));
    assert.equal(ok.banned, false);
    assert.equal(detector.isBanned, false);
  } finally {
    await server.close();
  }
});

test("BanDetector：网络超时不算封禁（banned=false + error）", async () => {
  const server = await startServer(async (_req, res) => {
    await delay(500);
    res.writeHead(200);
    res.end("{}");
  });
  try {
    const detector = new BanDetector({ timeoutMs: 60 });
    const result = await detector.check(server.url("/slow"));
    assert.equal(result.banned, false);
    assert.match(String(result.error), /timeout/i);
    assert.equal(detector.isBanned, false);
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// 5) AlternativePlan / NotificationCenter
// ---------------------------------------------------------------------------

test("AlternativePlan：生成可读替代方案（title/items/字段齐全）", () => {
  const plan = new AlternativePlan();
  const result = plan.generate({ platform: "平台 B（示例）", reason: "平台封禁 15 分钟", ban_minutes: 15 });
  assert.equal(typeof result.title, "string");
  assert.ok(result.title.includes("平台 B（示例）"));
  assert.ok(Array.isArray(result.items) && result.items.length >= 2);
  for (const item of result.items) {
    for (const field of ["channel", "why", "next_action", "owner"]) {
      assert.equal(typeof item[field], "string", `替代方案缺少 ${field}`);
      assert.ok(item[field].length >= 4, `字段 ${field} 必须可读`);
    }
  }
  assert.match(result.generated_at, /^\d{4}-\d{2}-\d{2}T/u);
  const onlyPrivate = plan.generate({ available_channels: ["企业微信", "邮件"] });
  assert.ok(onlyPrivate.items.length >= 1);
  assert.ok(onlyPrivate.items.every((item) => /企业微信|邮件/u.test(item.channel)));
});

test("NotificationCenter：本地通知文件落盘（标题/正文/严重级别），不外发", async () => {
  const root = await makeTmp("steward-fault-notify-");
  try {
    const center = new NotificationCenter(root);
    const path = await center.notify({
      kind: "ban",
      title: "平台封禁通知",
      body: "平台 B 暂停服务，已停止动作并给出替代方案。",
      severity: "critical",
    });
    assert.ok(existsSync(path), "通知文件必须落盘");
    const content = await readFile(path, "utf8");
    assert.ok(content.includes("# 平台封禁通知"));
    assert.ok(content.includes("kind: ban"));
    assert.ok(content.includes("severity: critical"));
    assert.ok(content.includes("平台 B 暂停服务"));
    assert.ok(content.includes("不发送到任何外部渠道"));
    const second = await center.notify({ kind: "recovery", title: "恢复", body: "已恢复", severity: "info" });
    assert.notEqual(second, path);
    const files = await center.list();
    assert.equal(files.length, 2);
    const names = files.map((file) => file.replaceAll("\\", "/").split("/").pop());
    assert.ok(names.every((name) => /-(ban|recovery)\.md$/u.test(name)), `文件名应符合 <ts>-<kind>.md：${names.join(",")}`);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 6) LedgerReconciler：补记不重复（B3「账本不重复」）
// ---------------------------------------------------------------------------

test("LedgerReconciler：首次补记全新增，二次对账全部判重跳过、duplicates_found=0", async () => {
  const root = await makeTmp("steward-fault-ledger-");
  try {
    const outbox = new Outbox(root);
    await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-l1", payload: { amount_cny: 100, receipt_ref: "receipt-l1" } });
    await outbox.enqueue({ action_kind: "invoice", idempotency_key: "idem-l2", payload: { amount_cny: 200, receipt_ref: "receipt-l2" } });
    const api = new JsonLedgerApi(root);
    const reconciler = new LedgerReconciler();
    const first = await reconciler.reconcile(api, outbox);
    assert.equal(first.replayed, 2);
    assert.equal(first.entries_added, 2);
    assert.equal(first.skipped_duplicates, 0);
    assert.equal(first.duplicates_found, 0);
    assert.equal(first.ledger_entries_total, 2);

    const second = await reconciler.reconcile(api, outbox);
    assert.equal(second.entries_added, 0, "第二次对账不得新增条目");
    assert.equal(second.skipped_duplicates, 2, "第二次应全部按幂等键跳过");
    assert.equal(second.duplicates_found, 0, "账本不得出现真实重复");
    assert.equal(second.ledger_entries_total, 2);

    const ledgerOnDisk = JSON.parse(await readFile(join(root, "ledger.json"), "utf8"));
    assert.equal(ledgerOnDisk.version, 1);
    assert.equal(ledgerOnDisk.entries.length, 2);
  } finally {
    await cleanup(root);
  }
});

test("LedgerReconciler：账本里出现真实重复条目时 duplicates_found > 0（能发现问题）", async () => {
  const root = await makeTmp("steward-fault-ledger-dup-");
  try {
    const outbox = new Outbox(root);
    await outbox.enqueue({ action_kind: "quote", idempotency_key: "idem-d1", payload: { receipt_ref: "receipt-d1" } });
    const entries = [];
    const api = {
      async recordLedger(input) {
        entries.push({ id: `e-${entries.length}`, idempotency_key: input.idempotency_key, receipt_ref: input.receipt_ref });
        return { ok: true };
      },
      async ledger() {
        return entries;
      },
    };
    const reconciler = new LedgerReconciler();
    const first = await reconciler.reconcile(api, outbox);
    assert.equal(first.duplicates_found, 0);
    // 人为制造一条真实重复（同 receipt_ref）
    entries.push({ id: "e-dup", idempotency_key: "idem-other", receipt_ref: "receipt-d1" });
    const second = await reconciler.reconcile(api, outbox);
    assert.ok(second.duplicates_found > 0, "对账必须能发现账本真实重复");
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 7) DrillRunner：B3 断网演练（真实 HTTP；短跑用真实 1–3 秒）
// ---------------------------------------------------------------------------

test("net-outage drill：真实断网→承诺被拒→恢复补记→账本不重复（平台 admin 注入）", async () => {
  const platform = await new FakePlatform().start();
  const root = await makeTmp("steward-fault-net-");
  try {
    const ticks = [];
    const runner = new DrillRunner();
    const result = await runner.runNetOutageDrill({
      platform_url: platform.url("/"),
      state_dir: root,
      outage_minutes: 0.05, // 0.05 分钟 = 3 秒真实断网
      tick_seconds: 0.15,
      time_scale: 1,
      probe_timeout_ms: 500,
      recovery_timeout_ms: 15_000,
      onTick: (tick) => ticks.push(tick),
    });

    assert.equal(result.ok, true, `演练失败：${result.error ?? ""}`);
    assert.equal(result.case, "net_outage");
    assert.equal(result.recovered, true);
    assert.equal(result.recovered_within_10min, true);
    assert.ok(result.outage_ms >= 1_000, `应观测到真实离线窗口，实际 ${result.outage_ms}ms`);
    assert.equal(result.nominal_outage_ms, 3_000);
    assert.equal(result.time_scale, 1);
    assert.equal(result.accelerated, false);
    assert.ok(result.blocked_promises > 0, "断网期间必须有承诺被拒绝");
    assert.equal(result.promises_created_during_outage, 0, "断网期间不得产生新承诺");
    assert.ok(result.queued_actions > 0, "断网期间动作应进入 Outbox");
    assert.equal(result.replayed, result.queued_actions, "恢复后应全部重放");
    assert.equal(result.duplicates_found, 0, "账本不得重复");
    assert.ok(ticks.length > 0);
    assert.ok(result.evidence_paths.length >= 1);

    const evidencePath = join(root, "drill-net-outage.json");
    assert.ok(existsSync(evidencePath));
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    const requiredFields = [
      "case",
      "started_at",
      "finished_at",
      "outage_ms",
      "nominal_outage_ms",
      "time_scale",
      "accelerated",
      "probes",
      "blocked_promises",
      "queued_actions",
      "replayed",
      "duplicates_found",
      "recovered_within_10min",
      "ok",
      "recovered",
      "promises_created_during_outage",
      "recovery_ms",
      "ticks",
      "notifications",
      "evidence_paths",
    ];
    for (const field of requiredFields) assert.ok(field in evidence, `证据缺少字段 ${field}`);
    assert.ok(evidence.probes.length >= 2);
    assert.equal(evidence.reconcile.duplicates_found, 0);
    assert.equal(evidence.reconcile_repeat.entries_added, 0);
    assert.ok(evidence.reconcile_repeat.skipped_duplicates === evidence.queued_actions);
    assert.ok(evidence.evidence_paths.includes(evidencePath));
    assert.ok(evidence.notifications.length >= 1, "应有断网/恢复本地通知");

    // 平台侧：补记的报价/消息确实到达（真实 HTTP 重放成功）
    const state = await (await fetch(platform.url("/admin/state"))).json();
    assert.ok(state.quotes + state.messages >= result.queued_actions, "重放动作应真实到达平台");
  } finally {
    await platform.stop();
    await cleanup(root);
  }
});

test("net-outage drill：outage_control 外部杀/重启（真实 ECONNREFUSED 路径）", async () => {
  const platform = await new FakePlatform().start();
  const root = await makeTmp("steward-fault-net-control-");
  try {
    const control = {
      async down() {
        await platform.down();
      },
      async up() {
        await platform.up();
      },
    };
    const runner = new DrillRunner();
    const result = await runner.runNetOutageDrill({
      platform_url: platform.url("/"),
      state_dir: root,
      outage_minutes: 0.02, // 1.2 秒真实断网
      tick_seconds: 0.1,
      time_scale: 1,
      probe_timeout_ms: 500,
      recovery_timeout_ms: 15_000,
      outage_control: control,
    });
    assert.equal(result.ok, true, `演练失败：${result.error ?? ""}`);
    assert.ok(result.blocked_promises > 0);
    assert.ok(result.queued_actions > 0);
    assert.equal(result.duplicates_found, 0);
    assert.equal(result.recovered, true);
  } finally {
    await platform.stop();
    await cleanup(root);
  }
});

test("net-outage drill：平台初始不可达 → FaultValidationError（拒绝伪造演练）", async () => {
  // 127.0.0.1:1 上确定无人监听（真实 ECONNREFUSED/连接失败）
  const deadBaseUrl = "http://127.0.0.1:1";
  const root = await makeTmp("steward-fault-net-dead-");
  try {
    const probe = new ConnectivityProbe({ timeoutMs: 500 });
    const baseline = await probe.probe(`${deadBaseUrl}/health`);
    assert.equal(baseline.online, false, "前置断言：该地址必须真实不可达");
    const runner = new DrillRunner();
    await assert.rejects(
      () =>
        runner.runNetOutageDrill({
          platform_url: deadBaseUrl,
          state_dir: root,
          outage_minutes: 0.01,
          tick_seconds: 0.1,
          probe_timeout_ms: 300,
        }),
      (error) => error instanceof FaultValidationError && /平台不可达/u.test(error.message),
    );
  } finally {
    await cleanup(root);
  }
});

test("net-outage drill：time_scale 加速必须写入证据（nominal 与 actual 分开）", async () => {
  const platform = await new FakePlatform().start();
  const root = await makeTmp("steward-fault-net-scale-");
  try {
    const runner = new DrillRunner();
    const result = await runner.runNetOutageDrill({
      platform_url: platform.url("/"),
      state_dir: root,
      outage_minutes: 0.05, // nominal 3s
      tick_seconds: 0.1,
      time_scale: 5, // 实际等待 0.6s（允许的显式加速，必须记录）
      probe_timeout_ms: 500,
      recovery_timeout_ms: 15_000,
    });
    assert.equal(result.ok, true, `演练失败：${result.error ?? ""}`);
    assert.equal(result.time_scale, 5);
    assert.equal(result.accelerated, true);
    assert.equal(result.nominal_outage_ms, 3_000);
    const evidence = JSON.parse(await readFile(join(root, "drill-net-outage.json"), "utf8"));
    assert.equal(evidence.accelerated, true);
    assert.equal(evidence.time_scale, 5);
    assert.equal(evidence.nominal_outage_ms, 3_000);
    assert.match(evidence.environment.time_scale_note ?? "accelerated=true", /accelerated/u);
  } finally {
    await platform.stop();
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// 8) DrillRunner：B4 平台封禁演练
// ---------------------------------------------------------------------------

test("platform-ban drill：真实 403 封禁→停止+替代方案+通知→解禁恢复", async () => {
  const platform = await new FakePlatform().start();
  const root = await makeTmp("steward-fault-ban-");
  try {
    const runner = new DrillRunner();
    const result = await runner.runPlatformBanDrill({
      platform_url: platform.url("/"),
      state_dir: root,
      ban_minutes: 0.02, // 1.2 秒真实封禁
      poll_seconds: 0.1,
      time_scale: 1,
      probe_timeout_ms: 500,
      recovery_timeout_ms: 15_000,
    });

    assert.equal(result.ok, true, `演练失败：${result.error ?? ""}`);
    assert.equal(result.case, "platform_ban");
    assert.equal(result.ban_detected, true);
    assert.ok(result.ban_detected_within_ms >= 0 && result.ban_detected_within_ms < 10_000);
    assert.ok(result.actions_attempted_during_ban >= 1, "封禁窗口内应有业务尝试");
    assert.equal(result.successful_actions_during_ban, 0, "封禁期间不得有成功动作");
    assert.equal(result.stopped, true);
    assert.ok(result.alternative_plan.items.length >= 2);
    assert.ok(existsSync(result.notification_path), "替代方案通知必须落盘");
    assert.equal(result.recovered, true);

    const evidencePath = join(root, "drill-platform-ban.json");
    assert.ok(existsSync(evidencePath));
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    for (const field of [
      "case",
      "ban_detected_within_ms",
      "ban_detected",
      "actions_attempted_during_ban",
      "successful_actions_during_ban",
      "stopped",
      "alternative_plan",
      "notification_path",
      "recovered",
      "recovered_within_ms",
      "ok",
      "polls",
      "evidence_paths",
    ]) {
      assert.ok(field in evidence, `证据缺少字段 ${field}`);
    }
    assert.ok(evidence.evidence_paths.includes(evidencePath));
    assert.ok(existsSync(join(root, "alternative-plan.json")));
    const notificationContent = await readFile(result.notification_path, "utf8");
    assert.match(notificationContent, /替代方案|平台/u);
  } finally {
    await platform.stop();
    await cleanup(root);
  }
});

test("platform-ban drill：平台未真正封禁（无 403）→ ok=false 且不谎报检测成功", async () => {
  const platform = await new FakePlatform({ banEnabled: false }).start();
  const root = await makeTmp("steward-fault-ban-negative-");
  try {
    const runner = new DrillRunner();
    const result = await runner.runPlatformBanDrill({
      platform_url: platform.url("/"),
      state_dir: root,
      ban_minutes: 0.02,
      poll_seconds: 0.1,
      time_scale: 1,
      probe_timeout_ms: 500,
      recovery_timeout_ms: 5_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ban_detected, false);
    assert.match(String(result.error), /未能在封禁窗口内检测到/u);
    assert.equal(result.stopped, false);
  } finally {
    await platform.stop();
    await cleanup(root);
  }
});
