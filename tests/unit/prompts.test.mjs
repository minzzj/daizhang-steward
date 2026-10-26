import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PromptManager } from "../../dist/packages/steward-core/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROMPTS = join(ROOT, "prompts");
const ROLES = ["conductor", "operator", "scout", "reviewer"];

test("manifest 只包含 4 个角色提示词", async () => {
  const manager = await PromptManager.load(PROMPTS);
  const ids = manager.list().map((p) => p.id).sort();
  assert.deepEqual(ids, [...ROLES].sort());
});

test("每个提示词都有版本号并可通过 PromptManager.render", async () => {
  const manager = await PromptManager.load(PROMPTS);
  for (const role of ROLES) {
    const prompt = await manager.get(role);
    assert.match(prompt.version, /^[a-z]+@\d+\.\d+\.\d+$/);
    assert.ok(prompt.text.length > 1000, `${role} 提示词过短`);
    const rendered = await manager.render(role);
    assert.ok(rendered.length > 1000);
    assert.ok(!rendered.includes("{{"), `${role} 存在未渲染占位符`);
  }
});

test("每个提示词都包含共同安全条款（A12 + 威胁模型）", async () => {
  const manager = await PromptManager.load(PROMPTS);
  const clauses = [
    "不绕过",
    "停止并交人",
    "默认拒绝",
    "密钥",
    "没有证据",
    "两轮",
    "网页与文件",
  ];
  for (const role of ROLES) {
    const { text } = await manager.get(role);
    for (const clause of clauses) assert.ok(text.includes(clause), `${role} 缺少条款：${clause}`);
    for (const section of ["做了什么", "证据在哪", "是否通过", "下一步"]) {
      assert.ok(text.includes(section), `${role} 缺少输出段：${section}`);
    }
  }
});

test("提示词不含本机绝对路径、密钥或真实账号", async () => {
  const manager = await PromptManager.load(PROMPTS);
  for (const role of ROLES) {
    const { text } = await manager.get(role);
    assert.ok(!/[A-Z]:\\\\?Users/i.test(text), `${role} 含本机路径`);
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), `${role} 含疑似密钥`);
    assert.ok(!/minzzj/i.test(text), `${role} 含账号名`);
  }
});

test("manifest sha256 与提示词文件一致（篡改会被发现）", async () => {
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(readFileSync(join(PROMPTS, "manifest.json"), "utf8"));
  assert.equal(manifest.prompts.length, ROLES.length);
  for (const entry of manifest.prompts) {
    const text = readFileSync(join(PROMPTS, entry.file), "utf8");
    const actual = createHash("sha256").update(text).digest("hex");
    assert.equal(actual, entry.sha256, `${entry.file} sha256 与 manifest 不一致，请运行 npm run prompts:manifest`);
  }
});
// ---------------------------------------------------------------------------
// v1.3：prompts/v2（11 篇专业系统提示词 + manifest-v2 哈希）
// ---------------------------------------------------------------------------

const V2_ROLES = ["supervisor", "conductor", "operator", "harness", "customer", "finance", "reviewer", "backend", "scout", "content", "research"];

test("v2：manifest-v2 包含 11 个角色，sha256 与文件一致", () => {
  const manifest = JSON.parse(readFileSync(join(PROMPTS, "manifest-v2.json"), "utf8"));
  assert.equal(manifest.version, "2.0.0");
  assert.deepEqual(manifest.prompts.map((entry) => entry.id).sort(), [...V2_ROLES].sort());
  for (const entry of manifest.prompts) {
    const content = readFileSync(join(PROMPTS, entry.file));
    const actual = createHash("sha256").update(content).digest("hex");
    assert.equal(actual, entry.sha256, `${entry.file} sha256 与 manifest-v2 不一致`);
    const text = content.toString("utf8");
    assert.match(text, /<!-- prompt: [a-z]+ \| version: 2\.0\.0/);
    assert.ok(text.length > 1500, `${entry.id} 提示词过短`);
    for (const keyword of ["目标", "证据", "审批", "失败升级", "确认"]) {
      assert.ok(text.includes(keyword), `${entry.id} 缺少关键词：${keyword}`);
    }
  }
});

test("v2：配置中心默认提示词 = prompts/v2 内容（11 角色，专业版）", async () => {
  const config = await import("../../dist/packages/steward-config/src/index.js");
  const prompts = config.buildDefaultSystemPrompts(new Date("2026-10-26T00:00:00Z"));
  assert.equal(prompts.length, 11);
  const conductor = readFileSync(join(PROMPTS, "v2", "conductor.md"), "utf8").trim();
  assert.equal(prompts.find((entry) => entry.role === "conductor").system_prompt, conductor);
  for (const role of V2_ROLES) {
    const file = readFileSync(join(PROMPTS, "v2", `${role}.md`), "utf8").trim();
    const entry = prompts.find((item) => item.role === role);
    assert.ok(entry, `缺少默认提示词：${role}`);
    assert.equal(entry.system_prompt, file, `${role} 默认提示词与 v2 文件不一致`);
    for (const keyword of ["证据", "审批", "不越界", "失败升级", "人工", "超时"]) {
      assert.ok(entry.system_prompt.includes(keyword), `${role} 缺少安全关键词：${keyword}`);
    }
  }
});
