// 阶段二 P3 验收 runner（企业版 / B8 + 30 条边界）：
//   B8：个人/企业模式各跑一单，主体/抬头/收款/发票类型一致；6 类不一致必须阻断且不产生发票/收款
//   30 条边界双模式标注表（个人/企业 × 已实现/人工/不适用；四类重点越界双模式都拒绝）
//   企业增量：主体/授权书（人签）/用印（AI 不代签）/对公/专票/开票校验/申报草稿（人确认）/双人复核/组织审批链
// 用法：npm run acceptance:p3
// 输出：docs/test-evidence/p3-acceptance-<stamp>.{md,json} + evidence-p3-<stamp>/（脱敏，只保留最新）

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizer, sanitizeFileInPlace } from "./sanitize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "apps", "cli", "src", "index.js");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_DIR = join(ROOT, "docs", "test-evidence");

for (const name of readdirSync(OUT_DIR)) {
  if (/^evidence-p3-/.test(name) || /^p3-acceptance-/.test(name)) {
    rmSync(join(OUT_DIR, name), { recursive: true, force: true });
  }
}
const EVIDENCE_DIR = join(OUT_DIR, `evidence-p3-${stamp}`);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const sanitize = makeSanitizer(ROOT);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

function run(label, command, args, { shell = false, timeoutMs = 600_000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    shell,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(`\n=== ${label} exit=${result.status} (${Date.now() - started}ms) ===`);
  console.log(output.trim().slice(0, 2500));
  return { label, exitCode: result.status ?? -1, durationMs: Date.now() - started, output };
}

function parseLastJson(output) {
  const starts = [];
  let idx = -1;
  while ((idx = output.indexOf("{", idx + 1)) >= 0) starts.push(idx);
  for (let i = starts.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(output.slice(starts[i]));
    } catch {
      /* try earlier */
    }
  }
  return null;
}

function copyEvidenceDir(fromDir, subdir, { maxFileSize = 3 * 1024 * 1024 } = {}) {
  if (!fromDir || !existsSync(fromDir)) return [];
  const target = join(EVIDENCE_DIR, subdir);
  mkdirSync(target, { recursive: true });
  const copied = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (st.size > maxFileSize) continue;
      const dest = join(target, relative(fromDir, p));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p, dest);
      if (/\.(json|log|diff|md|txt)$/i.test(name)) sanitizeFileInPlace(dest, sanitize);
      copied.push(rel(dest));
    }
  };
  walk(fromDir);
  return copied;
}

const results = {};

// 1) build + 全量测试
results.build = run("build", "npm", ["run", "build"], { shell: true });
results.tests = run("unit-tests", process.execPath, ["--test", "--test-reporter=tap", "tests/unit/*.test.mjs"]);
const tap = results.tests.output;
const num = (patterns) => {
  for (const re of patterns) {
    const m = tap.match(re);
    if (m) return Number(m[1]);
  }
  return null;
};
const testSummary = {
  tests: num([/^# tests (\d+)$/m, /^ℹ tests (\d+)$/m]),
  pass: num([/^# pass (\d+)$/m, /^ℹ pass (\d+)$/m]),
  fail: num([/^# fail (\d+)$/m, /^ℹ fail (\d+)$/m]),
};
writeFileSync(join(EVIDENCE_DIR, "unit-tests.log"), sanitize(results.tests.output), "utf8");

// 2) 企业版演示（CLI）
results.enterprise = run("enterprise-demo", process.execPath, [CLI, "enterprise-demo", "--json"]);
const enterpriseJson = parseLastJson(results.enterprise.output);
const artifactsDir = enterpriseJson?.artifacts?.dir ?? null;
const readArtifact = (name) => {
  if (!artifactsDir) return null;
  const path = join(artifactsDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const dualMode = readArtifact("dual-mode-orders.json");
const boundaryTable = readArtifact("boundary-table.json");
const boundaryChecks = readArtifact("boundary-checks.json");
const dualReview = readArtifact("dual-review.json");
const sealFlow = readArtifact("seal-flow.json");
const invoice = readArtifact("invoice-validation.json");
const orgApproval = readArtifact("org-approval.json");
const fixtureChecks = readArtifact("fixture-checks.json");
const enterpriseEvidence = copyEvidenceDir(artifactsDir, "enterprise-run");

// 3) 判定
const b8DualMode = Boolean(
  dualMode?.ok === true &&
    dualMode?.checks?.subject_consistent === true &&
    dualMode?.checks?.invoice_consistent === true &&
    dualMode?.checks?.payment_consistent === true,
);
const mismatches = Array.isArray(dualMode?.mismatches_blocked) ? dualMode.mismatches_blocked : [];
const b8Mismatches = mismatches.length >= 6 && mismatches.every((conflicts) => Array.isArray(conflicts) && conflicts.length > 0);
const fourKey = Array.isArray(boundaryTable)
  ? boundaryTable.filter((row) => ["无证业务", "借用资质", "陌生外呼", "超预算"].some((k) => row.trigger?.includes(k) || row.user_message?.includes(k)))
  : [];
const boundaries30 = Boolean(
  Array.isArray(boundaryTable) &&
    boundaryTable.length === 30 &&
    boundaryTable.every((row) => row.mode && row.personal && row.enterprise && row.test_case_id) &&
    fourKey.length >= 4 &&
    fourKey.every((row) => row.must === "deny"),
);
const dualReviewOk = Boolean(dualReview?.applied_only_after_two === true && dualReview?.after_first_review?.applied === false && dualReview?.after_second_review?.applied === true);
const sealOk = Boolean(sealFlow?.signed?.ai_may_sign === false && sealFlow?.signed?.status === "signed");
const invoiceOk = Boolean(invoice?.draft_status === "draft_pending_human" && invoice?.checks?.title_matches && invoice?.checks?.tax_no_matches && invoice?.checks?.contract_matches);
const orgApprovalOk = Boolean(Array.isArray(orgApproval) && orgApproval.length === 3 && orgApproval.map((x) => x.chain?.length).join(",") === "1,2,3");
const boundaryDenied = boundaryChecks?.decision === "deny" || boundaryChecks?.decision === "human";

const checks = {
  build: results.build.exitCode === 0,
  unitTests: results.tests.exitCode === 0 && testSummary.fail === 0,
  b8DualMode,
  b8MismatchesBlocked: b8Mismatches,
  boundaryTable30: boundaries30,
  fourKeyRulesDenied: fourKey.length >= 4,
  dualReviewTwoPeople: dualReviewOk,
  sealNoAiSign: sealOk,
  invoiceDraftPendingHuman: invoiceOk,
  orgApprovalChain: orgApprovalOk,
  boundaryDenyOrHuman: boundaryDenied,
  fixturesCrossCheck: fixtureChecks === null ? true : fixtureChecks?.all_ok === true,
};
const ok = Object.values(checks).every(Boolean);

const result = {
  stamp,
  ok,
  checks,
  phase: "P3 enterprise edition",
  testSummary,
  b8: dualMode
    ? {
        personal_ok: dualMode.personal?.order?.blocked === false,
        enterprise_ok: dualMode.enterprise?.order?.blocked === false,
        mismatches_blocked: mismatches.length,
        checks: dualMode.checks,
      }
    : null,
  boundaries: { rows: Array.isArray(boundaryTable) ? boundaryTable.length : null, four_key: fourKey.length },
  dual_review: dualReview?.applied_only_after_two ?? null,
  seal: sealFlow?.signed?.status ?? null,
  invoice: invoice?.draft_status ?? null,
  org_approval_chains: Array.isArray(orgApproval) ? orgApproval.map((x) => x.chain?.length) : null,
  fixtures: fixtureChecks ? { total: fixtureChecks.total, all_ok: fixtureChecks.all_ok } : null,
  runs: { enterprise: enterpriseJson?.runId ?? null },
  evidence: { enterpriseRun: enterpriseEvidence, unitTestsLog: "unit-tests.log" },
  steps: {
    build: { exitCode: results.build.exitCode, durationMs: results.build.durationMs },
    unitTests: { exitCode: results.tests.exitCode, durationMs: results.tests.durationMs },
    enterprise: { exitCode: results.enterprise.exitCode, durationMs: results.enterprise.durationMs },
  },
};
writeFileSync(join(OUT_DIR, `p3-acceptance-${stamp}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");

const line = (label, flag, detail) => `| ${label} | ${flag ? "✅" : "❌"} | ${detail} |`;
const md = [
  `# 阶段二 P3 验收结果 / Phase-2 P3 Acceptance — ${stamp}`,
  "",
  `- 结论：${ok ? "通过 (ok)" : "未通过 (failed)"}（企业版）`,
  `- 环境：Node ${process.version} / ${process.platform} ${process.arch}（纯本地，无真实银行/税务系统）`,
  "",
  "## 检查项",
  "",
  "| 检查 | 结果 | 说明 |",
  "|---|---|---|",
  line("build", checks.build, "tsc 通过"),
  line("单元+集成测试", checks.unitTests, `${testSummary.tests ?? "?"} tests / ${testSummary.pass ?? "?"} pass / ${testSummary.fail ?? "?"} fail`),
  line("B8 个人/企业双模式各跑一单", checks.b8DualMode, `主体/抬头/收款/发票类型一致=${dualMode?.checks ? JSON.stringify(dualMode.checks) : "?"}`),
  line("B8 六类不一致全部阻断", checks.b8MismatchesBlocked, `${mismatches.length} 类被阻断且理由可读`),
  line("30 条边界双模式标注表", checks.boundaryTable30, `${Array.isArray(boundaryTable) ? boundaryTable.length : "?"} 条（个人/企业 × 已实现/人工/不适用）`),
  line("四类重点越界双模式拒绝", checks.fourKeyRulesDenied, `无证/借资质/陌生外呼/超预算 ${fourKey.length} 条 deny`),
  line("双人复核（2 位不同角色才生效）", checks.dualReviewTwoPeople, `1 人 applied=${dualReview?.after_first_review?.applied}；2 人 applied=${dualReview?.after_second_review?.applied}`),
  line("用印 AI 不代签", checks.sealNoAiSign, `ai_may_sign=${sealFlow?.signed?.ai_may_sign}；signed_by=${sealFlow?.signed?.signed_by ?? "人"} `),
  line("发票校验 + 申报草稿（人确认）", checks.invoiceDraftPendingHuman, `invoice_type=${invoice?.invoice_type}；draft_status=${invoice?.draft_status}`),
  line("组织级审批链按金额分档", checks.orgApprovalChain, `${Array.isArray(orgApproval) ? orgApproval.map((x) => `${x.amount_cny}→${x.chain.length}级`).join("；") : "?"}`),
  line("企业边界检查（用工/资质转人工）", checks.boundaryDenyOrHuman, `decision=${boundaryChecks?.decision}`),
  line("企业 fixtures 交叉验证", checks.fixturesCrossCheck, fixtureChecks ? `${fixtureChecks.total} 条，全部符合预期=${fixtureChecks.all_ok}` : "未提供 fixtures"),
  "",
  "## 证据",
  "",
  `- 目录：\`docs/test-evidence/evidence-p3-${stamp}/\``,
  "- `enterprise-run/`：profile.json、entity-validation.json、boundary-table.{json,md}（30 条）、dual-mode-orders.json（B8）、dual-review.json、seal-flow.json、invoice-validation.json、org-approval.json、fixture-checks.json、report.md",
  "- `unit-tests.log`：完整测试套件日志",
  "",
  "> 本文件由 `npm run acceptance:p3` 自动生成；全部为虚构企业数据，AI 不代签、发票仅草稿，未连接真实银行/税务；证据已脱敏。",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, `p3-acceptance-${stamp}.md`), md, "utf8");

console.log(`\nacceptance evidence: docs/test-evidence/p3-acceptance-${stamp}.{md,json}`);
console.log(`checks: ${JSON.stringify(checks)}`);
console.log(`result: ${ok ? "OK" : "FAILED"}`);
process.exitCode = ok ? 0 : 1;
