import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MockHarness, demoCodeTask, runCodeLoop } from "../../dist/packages/steward-harness/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX_PATCH = readFileSync(join(ROOT, "examples", "mock-harness", "fix-login-timeout.patch"), "utf8");
const BROKEN_PATCH = readFileSync(join(ROOT, "examples", "mock-harness", "broken-login-timeout.patch"), "utf8");
const OK_FIXTURE = join(ROOT, "tests", "fixtures", "always-ok.mjs");
const FAIL_FIXTURE = join(ROOT, "tests", "fixtures", "always-fail.mjs");

async function evidenceDir() {
  return mkdtemp(join(tmpdir(), "steward-loop-"));
}

test("编码回路：真实补丁在隔离 worktree 应用并通过验收", async () => {
  const dir = await evidenceDir();
  const testLogPath = join(dir, "test.log");
  const result = await runCodeLoop({
    task: demoCodeTask("github.com/minzzj/daizhang-steward"),
    harness: new MockHarness({ patch: FIX_PATCH }),
    repoRoot: ROOT,
    acceptanceCommand: `node "${OK_FIXTURE}"`,
    evidenceDir: dir,
    testLogPath,
    maxRounds: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.escalated, false);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].patchApplied, true);
  assert.equal(result.rounds[0].acceptanceExit, 0);
  assert.ok(result.patch.includes("loginPending = false"));
  const log = await readFile(testLogPath, "utf8");
  assert.ok(log.includes("acceptance exit=0"));
  assert.ok(log.includes("第 1 轮通过"));
});

test("编码回路：连续两轮验收失败 → 停止并升级（A5）", async () => {
  const dir = await evidenceDir();
  const testLogPath = join(dir, "test.log");
  const result = await runCodeLoop({
    task: demoCodeTask("github.com/minzzj/daizhang-steward"),
    harness: new MockHarness({ patch: BROKEN_PATCH }),
    repoRoot: ROOT,
    acceptanceCommand: `node "${FAIL_FIXTURE}"`,
    evidenceDir: dir,
    testLogPath,
    maxRounds: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.escalated, true);
  assert.equal(result.rounds.length, 2);
  assert.deepEqual(
    result.rounds.map((r) => r.acceptanceExit),
    [1, 1],
  );
  const log = await readFile(testLogPath, "utf8");
  assert.ok(log.includes("升级人类"));
  assert.ok(log.includes("不无限重试"));
});

test("编码回路：补丁无法应用时不会盲跑验收", async () => {
  const dir = await evidenceDir();
  const testLogPath = join(dir, "test.log");
  const result = await runCodeLoop({
    task: demoCodeTask("x"),
    harness: new MockHarness({ patch: "diff --git a/nope.txt b/nope.txt\n--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-a\n+b\n" }),
    repoRoot: ROOT,
    acceptanceCommand: `node "${OK_FIXTURE}"`,
    evidenceDir: dir,
    testLogPath,
    maxRounds: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.escalated, true);
  assert.ok(result.rounds.every((r) => r.patchApplied === false));
});

test("MockHarness 首轮失败注入：第一轮无补丁，第二轮真实补丁通过", async () => {
  const dir = await evidenceDir();
  const testLogPath = join(dir, "test.log");
  const harness = new MockHarness({ patch: FIX_PATCH });
  const original = harness.runTask.bind(harness);
  let calls = 0;
  harness.runTask = async (task, options) => {
    calls++;
    if (calls === 1) return original(task, { simulateFailure: true });
    return original(task, options);
  };
  const result = await runCodeLoop({
    task: demoCodeTask("x"),
    harness,
    repoRoot: ROOT,
    acceptanceCommand: `node "${OK_FIXTURE}"`,
    evidenceDir: dir,
    testLogPath,
    maxRounds: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].patchAvailable, false);
  assert.equal(result.rounds[1].acceptanceExit, 0);
});

test("CRLF 补丁会被归一化后应用（Windows CI 防护）", async () => {
  const dir = await evidenceDir();
  const testLogPath = join(dir, "test.log");
  const crlfPatch = FIX_PATCH.replaceAll("\n", "\r\n");
  const result = await runCodeLoop({
    task: demoCodeTask("x"),
    harness: new MockHarness({ patch: crlfPatch }),
    repoRoot: ROOT,
    acceptanceCommand: `node "${OK_FIXTURE}"`,
    evidenceDir: dir,
    testLogPath,
    maxRounds: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].patchApplied, true);
});

