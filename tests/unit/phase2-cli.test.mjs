import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");

function runCli(args, cwd = ROOT) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseJson(text) {
  const start = text.indexOf("{");
  assert.ok(start >= 0, `输出中没有 JSON：${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start));
}

test("阶段二 business 命令：仿真业务线端到端产出 B1/B2/B5/B6/B7 证据", () => {
  const run = runCli(["business", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const json = parseJson(run.stdout);
  assert.equal(json.ok, true);
  const dir = json.artifacts.dir;
  assert.ok(existsSync(dir), "证据目录必须存在");
  const read = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

  const proposal = read("proposal.json");
  assert.ok(proposal.accepted.length >= 3, "至少 3 条合格业务线");
  for (const line of proposal.accepted) {
    assert.ok(line.sources.length > 0, "每条业务线必须有来源");
    assert.ok(line.sources.every((s) => /^https?:\/\//.test(s.url)), "来源必须是可打开的 URL");
  }
  assert.ok(proposal.proposal !== null, "≥3 条时应生成提案");

  const result = read("business-result.json");
  assert.equal(result.invoice_status, "issued");
  assert.equal(result.project.status, "delivered");

  const facts = read("ledger-facts.json");
  assert.ok(facts.length >= 2);
  for (const entry of facts) {
    for (const key of ["amount_cny", "payee_or_payer", "basis", "approved_by", "receipt_ref", "project_id"]) {
      assert.ok(entry[key], `账本 6 要素缺少 ${key}`);
    }
  }

  const promises = read("promise-traces.json");
  assert.equal(promises.authorized.authorized, true);
  assert.ok(promises.authorized.chain.length >= 3, "承诺链应包含 对话原文→委托条款→项目");
  assert.equal(promises.unauthorized.authorized, false);
  assert.equal(promises.unauthorized.reason, "未授权");

  const pack = read("takeover-pack.json");
  for (const key of ["open_orders", "pending_threads", "payables", "credentials", "risks"]) {
    assert.ok(Array.isArray(pack[key]), `接管包缺少 ${key}`);
  }
  assert.ok(pack.credentials.length > 0, "接管包应包含凭据引用（不含明文）");

  const boundaries = read("boundary-check.json");
  const denied = boundaries.filter((item) => item.result.decision === "deny");
  assert.equal(denied.length, 4, "四类越界必须 100% 拒绝");
  for (const item of denied) assert.ok(item.result.user_message.length > 5, "拒绝理由必须可读");
  assert.equal(boundaries[4].result.decision, "human", "支付类请求必须转人工");
  assert.equal(boundaries[5].result.decision, "draft_only", "报价类请求只出草稿");

  const monthly = read("monthly-report.json");
  assert.ok(monthly.income_cny > 0);
  assert.equal(monthly.gross_margin_cny, monthly.income_cny - monthly.cost_cny);
});

test("阶段二 boundary-check 命令：≥12 条规则 + 四类越界拒绝", () => {
  const run = runCli(["boundary-check", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const json = parseJson(run.stdout);
  assert.equal(json.ok, true);
  const rules = JSON.parse(readFileSync(join(json.artifacts.dir, "boundary-rules.json"), "utf8"));
  assert.ok(rules.length >= 12, `个人模式规则应 ≥12，实际 ${rules.length}`);
  const checks = JSON.parse(readFileSync(join(json.artifacts.dir, "boundary-check.json"), "utf8"));
  assert.equal(checks.filter((item) => item.result.decision === "deny").length, 4);
});

test("阶段二 takeover / approve 命令：接管≤10s + 6 类包 + 人工审批生效", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "steward-phase2-state-"));
  try {
    const takeover = runCli(["takeover", "--state", stateDir, "--json"]);
    assert.equal(takeover.status, 0, takeover.stderr);
    const taken = parseJson(takeover.stdout);
    assert.equal(taken.halted, true);
    assert.ok(taken.stop_ms < 10_000, "接管必须在 10s 内停止");
    for (const key of ["open_orders", "pending_threads", "payables", "credentials", "risks"]) {
      assert.ok(Array.isArray(taken.pack[key]), `接管包缺少 ${key}`);
    }
    assert.ok(existsSync(taken.pack_path), "接管包应落盘");

    const resume = runCli(["takeover", "--state", stateDir, "--resume", "--json"]);
    assert.equal(resume.status, 0, resume.stderr);
    assert.equal(parseJson(resume.stdout).halted, false);

    const list = runCli(["approve", "--state", stateDir, "--json"]);
    assert.equal(list.status, 0, list.stderr);
    const cards = parseJson(list.stdout);
    assert.ok(cards.cards.length >= 1, "应有待审批卡");
    const cardId = cards.cards[0].id;
    const decide = runCli(["approve", "--state", stateDir, "--id", cardId, "--decision", "approve", "--json"]);
    assert.equal(decide.status, 0, decide.stderr);
    assert.equal(parseJson(decide.stdout).status, "approved");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
