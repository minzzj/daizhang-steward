import { digest, type CodeResult, type CodeTask } from "../../steward-core/src/index.js";

/** Isolates "where code comes from" (see docs/en/adapters.md). */
export interface HarnessAdapter {
  readonly name: string;
  runTask(task: CodeTask, options?: { workdir?: string; simulateFailure?: boolean }): Promise<CodeResult>;
}

const REQUIRED_STRING_FIELDS: Array<keyof CodeTask> = [
  "task_id",
  "repo",
  "branch",
  "goal",
  "expected",
  "actual",
  "output",
];
const REQUIRED_ARRAY_FIELDS: Array<keyof CodeTask> = [
  "reproduction",
  "files",
  "acceptance",
  "constraints",
  "forbidden",
];

/** A task without reproduction/acceptance is not allowed into the code loop. */
export function validateCodeTask(task: Partial<CodeTask>): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = task[field];
    if (typeof value !== "string" || value.trim().length === 0) errors.push(`缺少字段：${field}`);
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    const value = task[field];
    if (!Array.isArray(value) || value.length === 0) errors.push(`缺少字段：${field}`);
  }
  if (task.output !== "unified_diff") errors.push("output 必须为 unified_diff");
  if (Array.isArray(task.reproduction) && task.reproduction.length < 2) {
    errors.push("reproduction 至少两步，才能被另一个工程师复现");
  }
  if (Array.isArray(task.acceptance) && task.acceptance.length === 0) {
    errors.push("acceptance 至少要一条可执行验收命令");
  }
  return errors;
}

export const DEFAULT_MOCK_PATCH = `diff --git a/examples/mock-harness/fixture.txt b/examples/mock-harness/fixture.txt
index 0000000..1111111 100644
--- a/examples/mock-harness/fixture.txt
+++ b/examples/mock-harness/fixture.txt
@@ -1,2 +1,3 @@
 daizhang-steward mock harness fixture
 本文件由 MockHarness 的示例补丁修改。
+fixed-by: MockHarness
`;

/**
 * Offline, deterministic harness used by CI and demos (no paid API required).
 * `simulateFailure` exists to exercise the "two rounds then escalate" path in tests.
 */
export class MockHarness implements HarnessAdapter {
  readonly name = "mock";

  constructor(private readonly options: { patch?: string; latencyMs?: number } = {}) {}

  async runTask(task: CodeTask, options?: { simulateFailure?: boolean }): Promise<CodeResult> {
    const errors = validateCodeTask(task);
    if (errors.length > 0) throw new Error(`CodeTask 非法：${errors.join("; ")}`);
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (options?.simulateFailure) {
      return {
        task_id: task.task_id,
        patch: "",
        summary: `MockHarness 模拟失败（task ${digest(task.task_id)}）`,
        tests_run: [],
        risks: ["mock: 模拟失败，用于验证两轮升级路径"],
        uncovered: ["真实补丁"],
      };
    }
    return {
      task_id: task.task_id,
      patch: this.options.patch ?? DEFAULT_MOCK_PATCH,
      summary: `MockHarness 生成示例补丁：${task.goal}`,
      tests_run: task.acceptance,
      risks: ["Mock 补丁不覆盖真实业务逻辑"],
      uncovered: ["真实浏览器/桌面验收（由 Operator 在 M1/M2 执行）"],
    };
  }
}

/** Placeholder adapter: M1 wires `dsh headless`; interface fixed now. */
export class DshHeadlessHarness implements HarnessAdapter {
  readonly name = "dsh-headless";
  async runTask(): Promise<CodeResult> {
    throw new Error("DshHeadlessHarness 将在 M1 实现（见 ROADMAP.md）");
  }
}

/** Placeholder adapter: direct DeepSeek API fallback; key only from env. */
export class DeepSeekApiHarness implements HarnessAdapter {
  readonly name = "deepseek-api";
  async runTask(): Promise<CodeResult> {
    throw new Error("DeepSeekApiHarness 将在 M1 后按需实现；密钥只从环境变量读取");
  }
}

/** Demo CodeTask used by `steward demo` (the seeded defect lives in examples/demo-web). */
export function demoCodeTask(repo: string): CodeTask {
  return {
    task_id: "ct-demo-login-timeout",
    repo,
    branch: "fix/demo-web-login-timeout",
    goal: "修复 demo-web 登录页在 4 秒超时后不显示错误提示",
    reproduction: [
      "启动 examples/demo-web: node server.mjs",
      "真实浏览器打开 http://127.0.0.1:4173/?timeout=1",
      "输入任意账号密码并点击登录",
      "等待 4 秒，观察页面提示",
    ],
    expected: "页面显示「请求超时，请重试」，按钮恢复可点击",
    actual: "按钮一直转圈，没有任何错误提示（预置缺陷）",
    files: ["examples/demo-web/app.js"],
    acceptance: ["node tests/e2e-browser/run.mjs --case login-timeout"],
    constraints: ["不引入第三方依赖", "不修改 API 契约"],
    forbidden: ["examples/demo-web/server.mjs"],
    output: "unified_diff",
  };
}
