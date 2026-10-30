/**
 * v1.5.1：Harness 产物/报告/数据读取测试。
 * 数据来源混合：
 * - **真实样本**：docs/test-evidence/evidence-v15-harness-real（真实 DeepSeek Harness run 的脱敏证据）
 * - **假数据**：测试内临时目录构造的边界数据（空目录/无 metrics/路径穿越）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyArtifactKind,
  harnessMetrics,
  harnessSessions,
  listHarnessArtifacts,
  listHarnessReports,
  parseArtifactId,
  readHarnessArtifact,
  sanitizeLocalPaths,
} from "../../dist/apps/cli/src/harness-data.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const realRoot = join(repoRoot, "docs", "test-evidence", "evidence-v15-harness-real", "runs");
const realSession = "sess-20261030151527-0020";

test("真实样本：识别 session 且只含 harness 目录", () => {
  const sessions = harnessSessions(realRoot);
  assert.ok(sessions.includes(realSession), `未找到真实 session：${sessions.join(",")}`);
});

test("真实样本：产物列表按 id 去重、kind 正确、路径位于 runs 内", () => {
  const artifacts = listHarnessArtifacts(realRoot);
  assert.ok(artifacts.length >= 5, `真实产物过少：${artifacts.length}`);
  const ids = artifacts.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "产物 id 未去重");
  assert.ok(artifacts.every((item) => item.kind !== "other"), "存在未分类产物");
  assert.ok(artifacts.some((item) => item.kind === "markdown"));
  assert.ok(artifacts.every((item) => !item.rel_path.includes("..")));
});

test("真实样本：报告列表包含 4 份步骤报告且已脱敏", () => {
  const reports = listHarnessReports(realRoot);
  assert.equal(reports.length, 4);
  assert.ok(reports.every((report) => report.markdown.includes("Harness 报告")));
  const joined = reports.map((report) => report.markdown).join("\n");
  const badIndex = joined.indexOf("C:\\Users\\");
  assert.equal(badIndex, -1, `报告仍含本机用户路径: ${JSON.stringify(joined.slice(Math.max(0, badIndex - 60), badIndex + 120))}`);
  assert.ok(joined.includes("<harness-workspace>") || joined.includes("<repo>"), "脱敏占位缺失");
});

test("真实样本：metrics 的 Token/步骤/工具与真实运行一致", () => {
  const metrics = harnessMetrics(realRoot, realSession);
  assert.ok(metrics !== null);
  assert.equal(metrics.steps, 4);
  assert.ok(metrics.token_total > 0);
  assert.ok(metrics.tool_calls >= 4);
  assert.deepEqual(metrics.model_modes, ["harness"]);
});

test("真实样本：读取产物内容，路径穿越/非法 id 被拒绝", () => {
  const artifacts = listHarnessArtifacts(realRoot);
  const note = artifacts.find((item) => item.rel_path.endsWith("note.md"));
  assert.ok(note !== undefined);
  const content = readHarnessArtifact(realRoot, note.id);
  assert.equal(content.ok, true);
  assert.ok((content.content ?? "").length > 0);
  const traversal = readHarnessArtifact(realRoot, `${realSession}::../../orchestrator/audit.jsonl`);
  assert.equal(traversal.ok, false);
  assert.equal(parseArtifactId("no-separator"), null);
});

test("真实样本：按 agent/kind/limit 过滤", () => {
  const all = listHarnessArtifacts(realRoot);
  const reviewer = listHarnessArtifacts(realRoot, { agent_role: "reviewer" });
  assert.ok(reviewer.length >= 1);
  assert.ok(reviewer.every((item) => item.agent_role === "reviewer"));
  assert.ok(listHarnessArtifacts(realRoot, { limit: 2 }).length <= 2);
  const md = listHarnessArtifacts(realRoot, { kind: "markdown" });
  assert.ok(md.length >= 1);
});

test("假数据：空/边界 run 目录返回空且不抛", () => {
  const fake = mkdtempSync(join(tmpdir(), "harness-data-fake-"));
  try {
    assert.deepEqual(harnessSessions(fake), []);
    assert.deepEqual(listHarnessArtifacts(fake), []);
    assert.deepEqual(listHarnessReports(fake), []);
    assert.equal(harnessMetrics(fake, "sess-fake"), null);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test("假数据：自造 manifest/report/metrics 可被读取", () => {
  const fake = mkdtempSync(join(tmpdir(), "harness-data-fake2-"));
  const session = "sess-20261030999999-0001";
  const harness = join(fake, session, "harness");
  mkdirSync(harness, { recursive: true });
  const artifactFile = join(fake, session, "artifacts", "step-1-operator", "report.md");
  mkdirSync(join(fake, session, "artifacts", "step-1-operator"), { recursive: true });
  writeFileSync(artifactFile, "# 假报告\n\n- 产物\n", "utf8");
  writeFileSync(
    join(harness, "step-1-artifacts.json"),
    JSON.stringify({ session_id: session, step: 1, role: "operator", artifacts: [{ rel_path: `${session}/artifacts/step-1-operator/report.md`, kind: "markdown", size: 10, sha256: "x" }] }),
    "utf8",
  );
  writeFileSync(join(harness, "step-1-report.md"), "# 假报告\n", "utf8");
  writeFileSync(join(harness, "step-1-summary.json"), JSON.stringify({ role: "operator" }), "utf8");
  writeFileSync(join(harness, "metrics.json"), JSON.stringify({ totals: { total_tokens: 123, steps: 1, tool_calls: 2, events: 5 }, tool_call_counts: { read: 2 }, model_modes: ["harness"] }), "utf8");
  try {
    const artifacts = listHarnessArtifacts(fake);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].agent_role, "operator");
    assert.equal(artifacts[0].kind, "markdown");
    const reports = listHarnessReports(fake);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].step, 1);
    const metrics = harnessMetrics(fake, session);
    assert.ok(metrics !== null);
    assert.equal(metrics.token_total, 123);
    const content = readHarnessArtifact(fake, artifacts[0].id);
    assert.equal(content.ok, true);
    assert.equal(sanitizeLocalPaths("C:\\Users\\x\\AppData\\Local\\Temp\\steward-harness\\a.md"), "<harness-workspace>\\a.md");
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test("路径分类：常见扩展名映射", () => {
  assert.equal(classifyArtifactKind("a.html"), "html");
  assert.equal(classifyArtifactKind("a.md"), "markdown");
  assert.equal(classifyArtifactKind("a.json"), "json");
  assert.equal(classifyArtifactKind("a.png"), "image");
  assert.equal(classifyArtifactKind("a.ts"), "code");
  assert.equal(classifyArtifactKind("a.csv"), "data");
  assert.equal(classifyArtifactKind("a.log"), "text");
  assert.equal(classifyArtifactKind("a.bin"), "other");
});
