/**
 * v1.5-A：steward-harness-runtime（真实 DeepSeek Harness 智能体执行器）单元测试。
 *
 * 零网络 / 零真实模型：用「假 dsh 脚本」（node fake-dsh.mjs）模拟 headless NDJSON 事件流，
 * 由本包 HarnessAgentRunner 用 process.execPath + 脚本路径 spawn 执行（与真实 dsh 相同的启动方式）。
 * 覆盖：可用性/成功解析/实时事件/产物 diff/sha256/kind/报告/截断/非 0 退出/超时/abort/
 * 环境变量安全/大文件跳过/畸形 NDJSON/usage 回调/并发池（真实 + fake）/profile+system_prompt。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  HarnessAgentPool,
  HarnessAgentRunner,
  buildHarnessEnv,
  classifyArtifactKind,
  defaultDshBin,
  snapshotWorkspace,
  truncateBytes,
} from "../../dist/packages/steward-harness-runtime/src/index.js";

const BASE = mkdtempSync(join(tmpdir(), "steward-harness-rt-"));
const FAKE_DSH = join(BASE, "fake-dsh.mjs");

// ---------------------------------------------------------------------------
// 假 dsh 脚本（模拟 `dsh --profile headless --json "<task>"` 的 NDJSON 输出）
// ---------------------------------------------------------------------------

const FAKE_DSH_SOURCE = String.raw`
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] ?? "";
const scenario = process.env.FAKE_DSH_SCENARIO ?? "success";
const pidFile = process.env.FAKE_DSH_PID_FILE;
if (pidFile) writeFileSync(pidFile, String(process.pid));
const out = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ws = process.cwd();

function mk(rel, content) {
  const file = join(ws, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

async function main() {
  out({ type: "session", sessionId: "session-fake-001", cwd: ws });

  if (scenario === "exit_nonzero") {
    out({ type: "status", phase: "turn_start", turn: 1, step: 1 });
    process.stderr.write("boom: fake harness config missing\n");
    process.exit(3);
  }
  if (scenario === "malformed") {
    process.stdout.write("this is not json\n");
    out({ type: "thinking", text: "畸形行之后继续执行" });
    out({ type: "final", text: "畸形行已跳过" });
    return;
  }
  if (scenario === "no_final") {
    out({ type: "status", phase: "turn_start", turn: 1, step: 1 });
    out({ type: "text", text: "只有 text 没有 final" });
    return;
  }
  if (scenario === "env_probe") {
    mk("env-probe.json", JSON.stringify({
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      hasSecretKey: Boolean(process.env.STEWARD_SECRET_KEY),
      hasDshHome: process.env.DSH_HOME ?? null,
      hasCustom: process.env.FAKE_CUSTOM ?? null,
    }));
    out({ type: "final", text: "env probe done" });
    return;
  }
  if (scenario === "argv_probe") {
    mk("argv.json", JSON.stringify({ argv, cwd: ws }));
    out({ type: "final", text: "argv probe done" });
    return;
  }
  if (scenario === "sleep") {
    await sleep(10000);
    out({ type: "final", text: "不应该到这里" });
    return;
  }
  if (scenario === "long_result") {
    out({ type: "tool_call", callId: "call-long", tool: "bash", input: { command: "cat huge.log" } });
    out({ type: "tool_result", callId: "call-long", status: "completed", result: "X".repeat(5000) });
    out({ type: "final", text: "长输出已截断" });
    return;
  }
  if (scenario === "bigfile") {
    mk("huge-created.bin", Buffer.alloc(6 * 1024 * 1024, 1));
    mk("small-created.txt", "small");
    out({ type: "final", text: "bigfile done" });
    return;
  }

  // success：流式事件 + 真实写工作区文件（含修改已存在文件 note.txt）
  out({ type: "status", phase: "turn_start", turn: 1, step: 0 });
  await sleep(5);
  out({ type: "thinking", text: "先写 plan.md，随后读取并总结。" });
  out({ type: "thinking", text: "再生成数据与页面文件作为产物。" });
  out({ type: "status", phase: "step_start", turn: 1, step: 1 });
  out({ type: "tool_call", callId: "call-write", tool: "write", input: { path: "plan.md" } });
  mk("plan.md", "# Plan\n\n- 创建 plan.md\n- 读取并总结\n");
  if (process.env.FAKE_DSH_SCENARIO !== "no_note") appendFileSync(join(ws, "note.txt"), "\nmodified by fake harness\n");
  out({ type: "tool_result", callId: "call-write", status: "completed", result: "wrote plan.md (1238 bytes)" });
  await sleep(5);
  out({ type: "tool_call", callId: "call-glob", tool: "glob", input: { pattern: "**/*" } });
  out({ type: "tool_result", callId: "call-glob", status: "completed", result: "plan.md\nnote.txt" });
  mk("data.json", JSON.stringify({ ok: true, items: [1, 2, 3] }));
  mk("page.html", "<!doctype html><html><body>harness page</body></html>");
  mk("assets/chart.png", "PNG-FAKE-BYTES");
  mk("code/util.py", "def add(a, b):\n    return a + b\n");
  mk("table.csv", "a,b\n1,2\n");
  mk("notes.txt", "harness notes");
  out({ type: "text", text: "已创建产物文件。" });
  out({ type: "status", phase: "step_end", turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, totalTokens: 1250 } });
  out({ type: "status", phase: "step_end", turn: 1, step: 2, usage: { inputTokens: 20000, outputTokens: 5000, cacheReadTokens: 2700, totalTokens: 27700 } });
  out({ type: "final", text: "已完成 plan.md 的创建与读取总结。" });
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
`;

writeFileSync(FAKE_DSH, FAKE_DSH_SOURCE, "utf8");
// 全文件固定指向假 dsh，杜绝测试误启动真实 harness（零网络/零真实模型）
process.env.STEWARD_DSH_BIN = FAKE_DSH;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

let wsSeq = 0;
const SHA256_RE = /^[0-9a-f]{64}$/;

function makeWorkspace(prefix = "ws") {
  wsSeq += 1;
  const dir = join(BASE, `${prefix}-${wsSeq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeRunner(overrides = {}) {
  return new HarnessAgentRunner({ dsh_bin: FAKE_DSH, ...overrides });
}

function inputFor(workspace, overrides = {}) {
  return {
    role: "operator",
    task: "TASK_MARK 创建 plan.md 并读取总结",
    workspace_dir: workspace,
    env: { FAKE_DSH_SCENARIO: "success" },
    ...overrides,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function findArtifact(result, relPath) {
  return result.artifacts.find((artifact) => artifact.rel_path === relPath);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForCondition(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(20);
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// 1) 可执行文件定位 / 可用性
// ---------------------------------------------------------------------------

test("dsh 定位：STEWARD_DSH_BIN / defaultDshBin / isAvailable / describe；不可用 → ok:false 可读 error", async () => {
  const saved = process.env.STEWARD_DSH_BIN;
  process.env.STEWARD_DSH_BIN = FAKE_DSH;
  try {
    assert.equal(defaultDshBin(), FAKE_DSH);
    const runner = new HarnessAgentRunner();
    assert.equal(runner.isAvailable(), true);
    const desc = runner.describe();
    assert.equal(desc.available, true);
    assert.equal(desc.dsh_bin, FAKE_DSH);
    assert.equal(desc.profile, "headless");
    assert.equal(desc.node, process.execPath);

    const missing = new HarnessAgentRunner({ dsh_bin: join(BASE, "missing", "lib", "bin.js") });
    assert.equal(missing.isAvailable(), false);
    const missingDesc = missing.describe();
    assert.equal(missingDesc.available, false);
    assert.ok(missingDesc.hint.includes("STEWARD_DSH_BIN"));

    const ws = makeWorkspace("unavailable");
    const result = await missing.run(inputFor(ws));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("不可用"));
    assert.equal(result.events.length, 0);
    assert.equal(result.artifacts.length, 0);
  } finally {
    if (saved === undefined) delete process.env.STEWARD_DSH_BIN;
    else process.env.STEWARD_DSH_BIN = saved;
  }
});

// ---------------------------------------------------------------------------
// 2) 成功解析：session/final/thinking/tool_calls/usage
// ---------------------------------------------------------------------------

test("成功解析：session_id/final_text/thinking/tool_calls/usage 汇总正确", async () => {
  const ws = makeWorkspace();
  writeFileSync(join(ws, "keep.txt"), "保持不变");
  writeFileSync(join(ws, "note.txt"), "原始内容");
  const result = await makeRunner().run(inputFor(ws, { role: "operator", system_prompt: "PRO_SYS 专业提示词" }));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.session_id, "session-fake-001");
  assert.ok(result.final_text.includes("已完成 plan.md"));
  assert.ok(result.thinking.length >= 2, "thinking 应按序拼接为数组");
  assert.ok(result.thinking.join("\n").includes("plan.md"));
  assert.ok(result.tool_calls.length >= 2);
  assert.equal(result.tool_calls[0].tool, "write");
  assert.equal(result.tool_calls[0].input.path, "plan.md");
  assert.ok(result.tool_calls.map((call) => call.tool).includes("glob"));
  assert.deepEqual(result.usage, {
    input_tokens: 21_000,
    output_tokens: 5_200,
    cache_read_tokens: 2_750,
    total_tokens: 28_950,
  });
  assert.equal(result.role, "operator");
  assert.equal(result.profile, "headless");
  assert.equal(result.exit_code, 0);
  assert.ok(result.duration_ms >= 0);
  assert.ok(result.events.length >= 10);

  const types = result.events.map((event) => event.type);
  for (const expected of ["session", "status", "thinking", "tool_call", "tool_result", "text", "final"]) {
    assert.ok(types.includes(expected), `事件流应包含 ${expected}`);
  }
  assert.equal(result.events[0].type, "session");
  assert.equal(result.events[result.events.length - 1].type, "final");

  // 命令必须是 node + dsh bin（Windows 不能直接 spawn "dsh"）
  assert.equal(result.command[0], process.execPath);
  assert.equal(result.command[1], FAKE_DSH);
  assert.deepEqual(result.command.slice(2, 5), ["--profile", "headless", "--json"]);
  assert.ok(result.command[5].includes("PRO_SYS"), "system_prompt 应拼进任务提示");
  assert.ok(result.command[5].includes("TASK_MARK"));
});

// ---------------------------------------------------------------------------
// 3) 实时事件流
// ---------------------------------------------------------------------------

test("on_event 实时回调：每解析一行调用一次，顺序与 seq 连续", async () => {
  const ws = makeWorkspace();
  const live = [];
  const result = await makeRunner().run(inputFor(ws, { on_event: (event) => live.push(event) }));
  assert.equal(result.ok, true, result.error);
  assert.equal(live.length, result.events.length);
  assert.deepEqual(live.map((event) => event.seq), result.events.map((event) => event.seq));
  assert.deepEqual(live.map((event) => event.type), result.events.map((event) => event.type));
  assert.deepEqual(
    live.map((event) => event.seq),
    Array.from({ length: live.length }, (_, index) => index + 1),
  );
  for (const event of live) {
    assert.ok(!Number.isNaN(Date.parse(event.at)), "每条事件应有合法 ISO 时间");
    assert.equal(typeof event.data, "object");
  }
});

// ---------------------------------------------------------------------------
// 4) 产物 diff / sha256 / kind
// ---------------------------------------------------------------------------

test("artifacts：只含新增/修改文件（未变排除、修改识别、sha256/size/绝对路径）", async () => {
  const ws = makeWorkspace();
  writeFileSync(join(ws, "keep.txt"), "完全没有被改动");
  writeFileSync(join(ws, "note.txt"), "原始内容");
  writeFileSync(join(ws, "old.json"), '{"old":true}');
  const result = await makeRunner().run(inputFor(ws));
  assert.equal(result.ok, true, result.error);

  const rels = result.artifacts.map((artifact) => artifact.rel_path);
  assert.ok(!rels.includes("keep.txt"), "未改动文件不能算产物");
  assert.ok(!rels.includes("old.json"), "未改动文件不能算产物");
  assert.ok(rels.includes("note.txt"), "被修改文件应识别为产物");
  for (const expected of [
    "plan.md",
    "data.json",
    "page.html",
    "assets/chart.png",
    "code/util.py",
    "table.csv",
    "notes.txt",
    "report.md",
  ]) {
    assert.ok(rels.includes(expected), `应包含产物 ${expected}`);
  }
  assert.equal(rels.filter((rel) => rel === "report.md").length, 1);
  for (const artifact of result.artifacts) {
    assert.ok(SHA256_RE.test(artifact.sha256), `sha256 应为 hex：${artifact.rel_path}`);
    assert.ok(artifact.size > 0);
    assert.ok(existsSync(artifact.path));
    assert.ok(artifact.path.startsWith(ws));
    assert.ok(!artifact.rel_path.startsWith("node_modules/"));
  }
  const note = findArtifact(result, "note.txt");
  assert.ok(note.size > 12, "修改后的 note.txt 应更大");
});

test("kind 分类：html/markdown/json/image/code/data/text/other", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(inputFor(ws));
  assert.equal(result.ok, true, result.error);
  const expectations = {
    "page.html": "html",
    "plan.md": "markdown",
    "data.json": "json",
    "assets/chart.png": "image",
    "code/util.py": "code",
    "table.csv": "data",
    "notes.txt": "text",
    "report.md": "markdown",
  };
  for (const [relPath, kind] of Object.entries(expectations)) {
    const artifact = findArtifact(result, relPath);
    assert.ok(artifact !== undefined, relPath);
    assert.equal(artifact.kind, kind, relPath);
  }
  assert.equal(classifyArtifactKind("no-extension"), "other");
  assert.equal(classifyArtifactKind("x.unknown"), "other");
});

// ---------------------------------------------------------------------------
// 5) report.md
// ---------------------------------------------------------------------------

test("report.md：自动生成，含角色/耗时/tokens/工具统计/最终结论/产物清单", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(inputFor(ws, { role: "harness" }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.report_path, join(ws, "report.md"));
  assert.ok(existsSync(result.report_path));
  const report = readFileSync(result.report_path, "utf8");
  for (const token of [
    "# harness · Harness 报告",
    "生成时间",
    "耗时",
    "Tokens",
    "工具调用",
    "思考过程",
    "最终结论",
    "产物清单",
    "session_id",
    "已完成 plan.md 的创建与读取总结。",
    "plan.md",
    "data.json",
    "page.html",
    "write",
  ]) {
    assert.ok(report.includes(token), `报告应包含 ${token}`);
  }
  assert.ok(report.includes("total：28950") || report.includes("total：28,950") || report.includes("28950"), "报告应含 token 汇总");
  const reportArtifact = findArtifact(result, "report.md");
  assert.ok(reportArtifact !== undefined);
  assert.equal(reportArtifact.kind, "markdown");
});

// ---------------------------------------------------------------------------
// 6) 截断 / 非 0 退出 / 超时 / abort
// ---------------------------------------------------------------------------

test("max_output_bytes：tool_result 长输出按上限截断并标记 truncated", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(
    inputFor(ws, { env: { FAKE_DSH_SCENARIO: "long_result" }, max_output_bytes: 300 }),
  );
  assert.equal(result.ok, true, result.error);
  const toolResult = result.events.find((event) => event.type === "tool_result");
  assert.ok(toolResult !== undefined);
  assert.ok(Buffer.byteLength(String(toolResult.data.result), "utf8") <= 300);
  assert.equal(toolResult.data.truncated, true);
  assert.ok(!String(toolResult.data.result).includes("X".repeat(1000)));
  assert.equal(truncateBytes("X".repeat(1000), 300).length, 300);
});

test("非 0 退出：ok:false + error（退出码/stderr 尾部），保留事件并写失败报告，不抛异常", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(inputFor(ws, { env: { FAKE_DSH_SCENARIO: "exit_nonzero" } }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("退出码 3"));
  assert.ok(result.error.toLowerCase().includes("boom"));
  assert.ok(result.events.length >= 1, "失败也要保留已收集事件");
  assert.ok(existsSync(join(ws, "report.md")), "失败也要写报告保留现场");
  const report = readFileSync(join(ws, "report.md"), "utf8");
  assert.ok(report.includes("失败"));
});

test("超时：ok:false、错误可读、子进程被终止", async () => {
  const ws = makeWorkspace();
  const pidFile = join(BASE, "pid-timeout.txt");
  const started = Date.now();
  const result = await makeRunner().run(
    inputFor(ws, {
      timeout_ms: 600,
      env: { FAKE_DSH_SCENARIO: "sleep", FAKE_DSH_PID_FILE: pidFile },
    }),
  );
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("超时"));
  assert.ok(elapsed < 10_000, `超时应快速返回，实际 ${elapsed}ms`);
  const startedObserved = await waitForCondition(() => existsSync(pidFile), 2_000);
  assert.ok(startedObserved, "假 dsh 进程应已启动");
  const pid = Number(readFileSync(pidFile, "utf8"));
  await delay(500);
  assert.equal(isProcessAlive(pid), false, "超时后子进程必须被终止");
});

test("AbortSignal：取消后 ok:false（中断），子进程被终止", async () => {
  const ws = makeWorkspace();
  const pidFile = join(BASE, "pid-abort.txt");
  const controller = new AbortController();
  const started = Date.now();
  const pending = makeRunner().run(
    inputFor(ws, {
      signal: controller.signal,
      env: { FAKE_DSH_SCENARIO: "sleep", FAKE_DSH_PID_FILE: pidFile },
    }),
  );
  const startedObserved = await waitForCondition(() => existsSync(pidFile), 2_000);
  assert.ok(startedObserved, "假 dsh 进程应已启动");
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("中断"));
  assert.ok(Date.now() - started < 10_000);
  const pid = Number(readFileSync(pidFile, "utf8"));
  await delay(500);
  assert.equal(isProcessAlive(pid), false, "中断后子进程必须被终止");
});

// ---------------------------------------------------------------------------
// 7) 边界：工作区缺失 / 环境变量安全 / 大文件 / 畸形 NDJSON / usage 回调
// ---------------------------------------------------------------------------

test("工作区不存在 → ok:false 清晰错误（不抛、无 report）", async () => {
  const missing = join(BASE, "workspace-does-not-exist-xyz");
  const result = await makeRunner().run(inputFor(missing));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("工作区不存在"));
  assert.equal(result.events.length, 0);
  assert.equal(result.report_path, undefined);
});

test("环境变量安全：密钥类 env 不注入，白名单/额外变量可用，错误与结果不含密钥", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(
    inputFor(ws, {
      env: {
        FAKE_DSH_SCENARIO: "env_probe",
        OPENAI_API_KEY: "sk-secret".repeat(2),
        STEWARD_SECRET_KEY: "also-secret" + "-value",
        DSH_HOME: "C:/fake/dsh-home",
        FAKE_CUSTOM: "ok-value",
      },
    }),
  );
  assert.equal(result.ok, true, result.error);
  const probe = readJson(join(ws, "env-probe.json"));
  assert.equal(probe.hasOpenAIKey, false, "API key 不得注入子进程");
  assert.equal(probe.hasSecretKey, false, "SECRET 类变量不得注入子进程");
  assert.equal(probe.hasDshHome, "C:/fake/dsh-home");
  assert.equal(probe.hasCustom, "ok-value");
  assert.ok(!JSON.stringify(result).includes("sk-super-secret-value"));
  assert.ok(!readFileSync(join(ws, "report.md"), "utf8").includes("sk-super-secret-value"));

  const env = buildHarnessEnv({ OPENAI_API_KEY: "sk-x", DSH_HOME: "h", FAKE_CUSTOM: "c" });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.DSH_HOME, "h");
  assert.equal(env.FAKE_CUSTOM, "c");
  assert.ok(typeof env.PATH === "string" || typeof env.Path === "string");
});

test("快照跳过 >5MB 大文件（既不算既有文件也不纳入产物）", async () => {
  const ws = makeWorkspace();
  writeFileSync(join(ws, "preexisting-big.bin"), Buffer.alloc(6 * 1024 * 1024, 1));
  const snapshot = snapshotWorkspace(ws);
  assert.ok(!snapshot.has("preexisting-big.bin"));
  const result = await makeRunner().run(inputFor(ws, { env: { FAKE_DSH_SCENARIO: "bigfile" } }));
  assert.equal(result.ok, true, result.error);
  const rels = result.artifacts.map((artifact) => artifact.rel_path);
  assert.ok(!rels.includes("preexisting-big.bin"));
  assert.ok(!rels.includes("huge-created.bin"), "新增大文件 >5MB 也不纳入产物");
  assert.ok(rels.includes("small-created.txt"));
});

test("畸形 NDJSON 行：不中断执行，记录 parse_error 事件，seq 仍连续", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(inputFor(ws, { env: { FAKE_DSH_SCENARIO: "malformed" } }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.final_text, "畸形行已跳过");
  const parseError = result.events.find((event) => event.type === "error" && event.data.parse_error === true);
  assert.ok(parseError !== undefined, "应记录畸形行 parse_error 事件");
  assert.deepEqual(
    result.events.map((event) => event.seq),
    Array.from({ length: result.events.length }, (_, index) => index + 1),
  );
});

test("on_usage 回调：每次 usage 更新回调，汇总单调递增且与最终结果一致", async () => {
  const ws = makeWorkspace();
  const snapshots = [];
  const result = await makeRunner().run(inputFor(ws, { on_usage: (usage) => snapshots.push({ ...usage }) }));
  assert.equal(result.ok, true, result.error);
  assert.ok(snapshots.length >= 1, "on_usage 应被调用");
  for (let index = 1; index < snapshots.length; index += 1) {
    assert.ok(snapshots[index].total_tokens >= snapshots[index - 1].total_tokens, "token 汇总应单调递增");
  }
  assert.deepEqual(snapshots[snapshots.length - 1], result.usage);
  assert.equal(result.usage.total_tokens, 28_950);
});

test("退出码 0 但未收到 final/text → ok:false 明确错误（仍写失败报告）", async () => {
  const ws = makeWorkspace();
  const result = await makeRunner().run(inputFor(ws, { env: { FAKE_DSH_SCENARIO: "no_final" } }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("final"));
  assert.ok(existsSync(join(ws, "report.md")));
  assert.ok(readFileSync(join(ws, "report.md"), "utf8").includes("失败"));
});

// ---------------------------------------------------------------------------
// 8) profile / system_prompt 参数
// ---------------------------------------------------------------------------

test("profile 与 system_prompt：命令参数正确、提示词按「system → task」拼接（argv 探针）", async () => {
  const ws = makeWorkspace();
  const runner = makeRunner({ profile: "custom-profile" });
  const result = await runner.run(
    inputFor(ws, {
      system_prompt: "PRO_SYS 专业提示词",
      task: "TASK_MARK 具体任务",
      profile: "custom-profile",
      env: { FAKE_DSH_SCENARIO: "argv_probe" },
    }),
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.profile, "custom-profile");
  const probe = readJson(join(ws, "argv.json"));
  assert.equal(probe.argv[0], "--profile");
  assert.equal(probe.argv[1], "custom-profile");
  assert.equal(probe.argv[2], "--json");
  assert.equal(typeof probe.argv[3], "string");
  assert.equal(probe.argv.length, 4);
  assert.ok(probe.cwd.length > 0);
  const prompt = probe.argv[probe.argv.length - 1];
  assert.ok(prompt.includes("PRO_SYS"));
  assert.ok(prompt.includes("TASK_MARK"));
  assert.ok(prompt.indexOf("PRO_SYS") < prompt.indexOf("TASK_MARK"));
  assert.equal(result.command[3], "custom-profile");
  assert.equal(result.command[1], FAKE_DSH);
});

// ---------------------------------------------------------------------------
// 9) 并发池
// ---------------------------------------------------------------------------

test("并发池（真实 runner）：并发执行，结果顺序与输入一致", async () => {
  const pool = new HarnessAgentPool({ runner: makeRunner(), concurrency: 2 });
  const inputs = ["A", "B", "C"].map((tag) =>
    inputFor(makeWorkspace(`pool-${tag}`), { role: "operator", task: `TASK_MARK-${tag} 并行任务` }),
  );
  const results = await pool.runAll(inputs);
  assert.equal(results.length, 3);
  assert.equal(pool.concurrency, 2);
  results.forEach((result, index) => {
    assert.equal(result.ok, true, result.error);
    assert.equal(result.role, "operator");
    assert.equal(result.workspace_dir, inputs[index].workspace_dir, "结果顺序必须与输入一致");
    assert.ok(result.report_path !== undefined);
  });
  assert.deepEqual(await pool.runAll([]), []);
});

test("并发池：并发上限生效（4 输入/上限 2 → maxActive=2），runner 抛错兜底为 ok:false", async () => {
  let active = 0;
  let maxActive = 0;
  const fakeRunner = {
    async run(input) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await delay(40);
        if (input.role === "boom") throw new Error("模拟执行器异常");
        return {
          ok: true,
          final_text: `done-${input.role}`,
          events: [],
          thinking: [],
          tool_calls: [],
          usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
          artifacts: [],
          duration_ms: 1,
          role: input.role,
          workspace_dir: input.workspace_dir,
        };
      } finally {
        active -= 1;
      }
    },
  };
  const pool = new HarnessAgentPool({ runner: fakeRunner, concurrency: 2 });
  const inputs = ["one", "two", "boom", "four"].map((role) => ({
    role,
    task: "t",
    workspace_dir: makeWorkspace("pool-fake"),
  }));
  const results = await pool.runAll(inputs);
  assert.equal(maxActive, 2, "并发上限必须生效");
  assert.deepEqual(results.map((result) => result.role), ["one", "two", "boom", "four"]);
  assert.equal(results[2].ok, false);
  assert.ok(results[2].error.includes("模拟执行器异常"));
  for (const index of [0, 1, 3]) {
    assert.equal(results[index].ok, true);
    assert.equal(results[index].final_text, `done-${inputs[index].role}`);
  }
});
