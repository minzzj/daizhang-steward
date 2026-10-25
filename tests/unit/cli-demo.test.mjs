import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");

function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
}

test("steward demo：退出码 0，产出完整证据目录（A1/A6 骨架）", () => {
  const run = cli(["demo", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const start = run.stdout.indexOf("{");
  assert.ok(start >= 0, "demo 应输出 JSON");
  const json = JSON.parse(run.stdout.slice(start));
  assert.equal(json.ok, true);
  assert.match(json.runId, /^run-\d{8}-\d{6}-/);
  for (const file of ["prompt.md", "patch.diff", "test.log", "report.md", "console.log", "meta.json", "events.jsonl", "code-task.json", "code-result.json"]) {
    assert.ok(existsSync(join(json.artifacts.dir, file)), `缺少证据文件：${file}`);
  }
  const patch = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
  assert.equal(patch.status, 0);
});

test("steward branch：输出合法 BranchSpec JSON", () => {
  const run = cli(["branch", "--role", "dummy", "--goal", "只读冒烟"]);
  assert.equal(run.status, 0, run.stderr);
  const spec = JSON.parse(run.stdout);
  assert.equal(spec.role, "dummy");
  assert.equal(spec.prompt_ref, "dummy@1.0.0");
  assert.deepEqual(spec.tools, ["echo"]);
  assert.ok(spec.budget.token > 0);
});

test("steward report：能读取最近一次运行报告", () => {
  const demo = cli(["demo", "--json"]);
  assert.equal(demo.status, 0);
  const run = cli(["report", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(run.stdout);
  assert.ok(existsSync(json.reportPath));
});

test("steward stop / stop --clear：停止键可写可清", () => {
  const stop = cli(["stop", "--reason", "test-stop"]);
  assert.equal(stop.status, 0, stop.stderr);
  const file = join(ROOT, ".steward", "STOP");
  assert.ok(existsSync(file));
  const clear = cli(["stop", "--clear"]);
  assert.equal(clear.status, 0, clear.stderr);
  assert.ok(!existsSync(file));
});

test("steward version：输出语义化版本", () => {
  const run = cli(["version"]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /steward \d+\.\d+\.\d+/);
});
