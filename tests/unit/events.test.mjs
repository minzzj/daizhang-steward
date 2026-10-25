import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, digest } from "../../dist/packages/steward-core/src/index.js";

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "steward-events-"));
}

test("事件账本只追加、seq 递增、哈希链可验证", async () => {
  const dir = await tmpDir();
  const log = await EventLog.open(join(dir, "events.jsonl"));
  for (let i = 1; i <= 3; i++) {
    await log.append({
      branch_id: "br-test",
      tool: "echo",
      target: `step-${i}`,
      input_digest: digest({ i }),
      policy_decision: "allow",
      result: "success",
      evidence_path: "",
      confidence: "certain",
    });
  }
  const events = await log.read();
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.seq),
    [1, 2, 3],
  );
  assert.equal(events[0].prev_hash, "genesis");
  assert.equal(events[2].prev_hash, events[1].hash);
  assert.deepEqual(await log.verify(), { ok: true });
});

test("事件账本可被篡改检测", async () => {
  const dir = await tmpDir();
  const file = join(dir, "events.jsonl");
  const log = await EventLog.open(file);
  await log.append({
    branch_id: "br-test",
    tool: "echo",
    target: "tamper-me",
    input_digest: digest("x"),
    policy_decision: "allow",
    result: "success",
    evidence_path: "",
    confidence: "certain",
  });
  const raw = await readFile(file, "utf8");
  await writeFile(file, raw.replace("tamper-me", "tampered"), "utf8");
  const reopened = await EventLog.open(file);
  const verdict = await reopened.verify();
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 1);
});

test("事件 target 字段中的密钥会被脱敏", async () => {
  const dir = await tmpDir();
  const log = await EventLog.open(join(dir, "events.jsonl"));
  // 拼出假的 key 形态，避免仓库密钥扫描把测试夹具误报为真实密钥
  const fakeKey = "sk-" + "abcdefghijklmnopqrstuvwx";
  const ev = await log.append({
    branch_id: "br-test",
    tool: "http.post",
    target: `https://example.com/?key=${fakeKey}`,
    input_digest: digest("y"),
    policy_decision: "allow",
    result: "success",
    evidence_path: "",
    confidence: "certain",
  });
  assert.ok(!ev.target.includes(fakeKey));
  assert.ok(ev.target.includes("REDACTED"));
});

test("重开账本会从最后一条事件恢复 seq 与 hash", async () => {
  const dir = await tmpDir();
  const file = join(dir, "events.jsonl");
  const log = await EventLog.open(file);
  for (let i = 0; i < 2; i++) {
    await log.append({
      branch_id: "br-test",
      tool: "echo",
      target: `t${i}`,
      input_digest: digest(i),
      policy_decision: "allow",
      result: "success",
      evidence_path: "",
      confidence: "certain",
    });
  }
  const reopened = await EventLog.open(file);
  const ev = await reopened.append({
    branch_id: "br-test",
    tool: "echo",
    target: "t2",
    input_digest: digest(2),
    policy_decision: "allow",
    result: "success",
    evidence_path: "",
    confidence: "certain",
  });
  assert.equal(ev.seq, 3);
  assert.deepEqual(await reopened.verify(), { ok: true });
});
