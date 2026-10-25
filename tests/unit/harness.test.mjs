import test from "node:test";
import assert from "node:assert/strict";
import { MockHarness, validateCodeTask, demoCodeTask, DEFAULT_MOCK_PATCH } from "../../dist/packages/steward-harness/src/index.js";

test("CodeTask 校验：缺少复现步骤/验收命令时拒绝进入回路", () => {
  const task = demoCodeTask("github.com/minzzj/daizhang-steward");
  assert.deepEqual(validateCodeTask(task), []);

  const missing = { ...task, reproduction: [] };
  assert.ok(validateCodeTask(missing).some((e) => e.includes("reproduction")));

  const noAcceptance = { ...task, acceptance: [] };
  assert.ok(validateCodeTask(noAcceptance).some((e) => e.includes("acceptance")));

  const badOutput = { ...task, output: "diff" };
  assert.ok(validateCodeTask(badOutput).some((e) => e.includes("output")));
});

test("MockHarness 返回可保存的 unified diff 与测试记录", async () => {
  const harness = new MockHarness();
  const task = demoCodeTask("github.com/minzzj/daizhang-steward");
  const result = await harness.runTask(task);
  assert.equal(result.task_id, task.task_id);
  assert.equal(result.patch, DEFAULT_MOCK_PATCH);
  assert.deepEqual(result.tests_run, task.acceptance);
  assert.ok(result.patch.startsWith("diff --git"));
  assert.ok(result.risks.length > 0);
  assert.ok(result.uncovered.length > 0);
});

test("MockHarness 失败模式用于验证两轮升级路径（不无限重试）", async () => {
  const harness = new MockHarness();
  const task = demoCodeTask("github.com/minzzj/daizhang-steward");
  const failed = await harness.runTask(task, { simulateFailure: true });
  assert.equal(failed.patch, "");
  assert.equal(failed.tests_run.length, 0);
  assert.ok(failed.risks.some((r) => r.includes("模拟失败")));
});

test("CodeTask 非法时 runTask 抛出可读错误", async () => {
  const harness = new MockHarness();
  await assert.rejects(
    () => harness.runTask({ ...demoCodeTask("x"), goal: "" }),
    /CodeTask 非法/,
  );
});
