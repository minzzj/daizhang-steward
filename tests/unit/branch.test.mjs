import test from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard, DEFAULT_BUDGET, BranchManager, validateBranch, createBranch } from "../../dist/packages/steward-core/src/index.js";

test("预算：80% 告警、100% 暂停", () => {
  const guard = new BudgetGuard({ token: 1000, time_minutes: 10, cost_cny: 1 });
  assert.equal(guard.check().status, "ok");
  guard.charge({ token: 850 });
  assert.equal(guard.check().status, "warn");
  guard.charge({ token: 200 });
  assert.equal(guard.check().status, "exceeded");
});

test("BranchSpec：默认合法、可校验、非法字段可被发现", () => {
  const spec = createBranch({ role: "operator", goal: "完成 demo-web 登录并提交" });
  assert.deepEqual(validateBranch(spec), []);
  assert.equal(spec.prompt_ref, "operator@1.0.0");
  assert.ok(spec.budget.token > 0);

  const bad = { ...spec, role: "hacker", tools: [], prompt_ref: "operator" };
  const errors = validateBranch(bad);
  assert.ok(errors.length >= 3);
});

test("BranchManager：创建、查询、终止；非法分支抛错", () => {
  const manager = new BranchManager();
  const spec = manager.create({ role: "dummy", goal: "只读冒烟" });
  assert.equal(manager.get(spec.id)?.goal, "只读冒烟");
  assert.equal(manager.list().length, 1);
  assert.equal(manager.terminate(spec.id), true);
  assert.equal(manager.get(spec.id), undefined);
  assert.throws(() => manager.create({ role: "operator", goal: "" }), /BranchSpec 非法/);
});

test("预算默认值存在且为正", () => {
  for (const key of ["token", "time_minutes", "cost_cny"]) {
    assert.ok(DEFAULT_BUDGET[key] > 0, `默认预算 ${key} 应为正数`);
  }
});
