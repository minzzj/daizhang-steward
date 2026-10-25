import test from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "../../dist/packages/steward-core/src/index.js";

test("高风险动作默认拒绝", () => {
  const policy = new PolicyEngine();
  for (const tool of ["payment", "refund", "contract.sign", "account.permission", "outreach.bulk", "captcha.bypass", "deploy.production"]) {
    const verdict = policy.evaluate({ tool, risk: "low" });
    assert.equal(verdict.decision, "deny", `${tool} 应被拒绝`);
  }
});

test("低/中风险动作允许，高/极高风险需审批", () => {
  const policy = new PolicyEngine();
  assert.equal(policy.evaluate({ tool: "browser.click", risk: "low" }).decision, "allow");
  assert.equal(policy.evaluate({ tool: "browser.type", risk: "medium" }).decision, "allow");
  assert.equal(policy.evaluate({ tool: "desktop.click", risk: "high" }).decision, "approve");
  assert.equal(policy.evaluate({ tool: "desktop.click", risk: "critical" }).decision, "approve");
});

test("风险级别未知时暂停待核（不自动放行）", () => {
  const policy = new PolicyEngine();
  const verdict = policy.evaluate({ tool: "mystery.tool" });
  assert.equal(verdict.decision, "unknown");
  assert.ok(verdict.reason.includes("暂停"));
});

test("分支 approval_policy 可要求审批或额外拒绝", () => {
  const policy = new PolicyEngine({ require_approval: ["browser.submit"], deny: ["custom.danger"] });
  assert.equal(policy.evaluate({ tool: "browser.submit", risk: "low" }).decision, "approve");
  assert.equal(policy.evaluate({ tool: "custom.danger", risk: "low" }).decision, "deny");
});
