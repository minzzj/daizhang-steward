/**
 * 本地工具动作：专项智能体在 `<root>/<sessionId>/` 证据目录里执行**真实本地文件动作**
 * （零外部付费、零网络、零真实资金）。
 *
 * 动作清单（按 step.action 分派；未知动作落 note.md，保证每一步都有证据）：
 * - operator.build_deliverable：生成交付物页面 deliverable.html + 报告 deliverable.md；
 * - harness.quality_check：本地质检（文件存在/结构/标题/正文）→ quality-check.json；
 * - reviewer.review_evidence：核查证据是否支撑结论 → review.json；
 * - backend.write_events：写 events.jsonl + evidence-index.json（证据索引）；
 * - finance.collect_payment：生成收款请求 payment-request.json（演示渠道，待人工确认到账），
 *   有 ledger 依赖注入时调用 recordIncome，无注入时写本地 ledger.json；
 * - scout.research_brief：调研要点 + 线索草稿 research.md（**不外发**）；
 * - customer.reply_draft：客户回复草稿 customer-reply.md（**不自动发送**）；
 * - content.draft：内容/文案草稿 content-draft.md；
 * - research/未知：note.md 兜底。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

import type {
  EvidenceItem,
  EvidenceKind,
  LedgerSink,
  OrchestratorSession,
  PlanStep,
} from "./types.js";

export interface LocalActionInput {
  /** 数据根目录（证据相对路径以此为基准）。 */
  root: string;
  evidenceDir: string;
  session: OrchestratorSession;
  step: PlanStep;
  nowIso: string;
  ledger?: LedgerSink | undefined;
}

export interface LocalActionResult {
  ok: boolean;
  /** 一句话结果（用于 AgentTurn.output_summary）。 */
  output_summary: string;
  /** 全文细节（用于 AgentTurn.detail 展开）。 */
  detail: string;
  /** 证据引用（相对 root，正斜杠）。 */
  evidence_refs: string[];
}

// ---------------------------------------------------------------------------
// 证据工具（引擎 getRunDetail 也复用）
// ---------------------------------------------------------------------------

export function evidenceKindFor(filePath: string): EvidenceKind {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md") return "report";
  if (ext === ".json") return "json";
  if (ext === ".jsonl" || ext === ".log" || ext === ".txt") return "log";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "screenshot";
  return "other";
}

/** 扫描证据目录，返回证据清单（相对 root 的路径 + 类型 + 标题）。 */
export function listEvidenceFiles(root: string, evidenceDir: string): EvidenceItem[] {
  if (!existsSync(evidenceDir)) return [];
  const items: EvidenceItem[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const absolute = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      items.push({
        path: relative(root, absolute).split(sep).join("/"),
        kind: evidenceKindFor(name),
        title: basename(name),
      });
    }
  };
  walk(evidenceDir);
  items.sort((left, right) => left.path.localeCompare(right.path));
  return items;
}

function relativeRef(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function writeText(root: string, filePath: string, content: string): string {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return relativeRef(root, filePath);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** 从目标里解析金额（如“报价 880 元”“¥100”）；缺省演示金额 100 元。 */
export function parseAmountFromGoal(goal: string): number {
  const text = typeof goal === "string" ? goal : "";
  const match = /[¥￥]\s*(\d+(?:\.\d+)?)/u.exec(text) ?? /(\d+(?:\.\d+)?)\s*元/u.exec(text);
  const value = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 100;
}

function renderPlanTable(session: OrchestratorSession): string {
  if (session.plan.length === 0) return "（暂无计划）";
  return session.plan
    .map((step) => `| ${step.step} | ${step.agent_role} | ${step.action} | ${step.summary} | ${step.status} |`)
    .join("\n");
}

function buildDeliverableHtml(session: OrchestratorSession, step: PlanStep, nowIso: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>代掌交付物 · ${escapeHtml(session.title)}</title>
<style>
  :root { color-scheme: light; --bg:#f5f7fb; --card:#ffffff; --ink:#17223b; --muted:#5c6b8a; --line:#dfe5f2; --accent:#2f6bff; }
  body { margin:0; font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width: 880px; margin: 40px auto; padding: 0 20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px 32px; box-shadow:0 10px 30px rgba(23,34,59,.06); }
  h1 { font-size:26px; margin:0 0 8px; }
  .muted { color:var(--muted); font-size:14px; }
  .badge { display:inline-block; background:#e8efff; color:var(--accent); border-radius:999px; padding:4px 12px; font-size:12px; margin-right:8px; }
  table { width:100%; border-collapse:collapse; margin-top:18px; font-size:14px; }
  th, td { text-align:left; border-bottom:1px solid var(--line); padding:9px 8px; vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  footer { margin-top:20px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<main>
  <section class="card">
    <span class="badge">本地编排内核生成</span><span class="badge">未连接外部系统</span>
    <h1>${escapeHtml(session.title)}</h1>
    <p class="muted">目标：${escapeHtml(session.goal)}</p>
    <p class="muted">会话：${escapeHtml(session.id)}｜当前步骤：${step.step}. ${escapeHtml(step.summary)}｜生成于：${escapeHtml(nowIso)}</p>
    <h2 style="font-size:18px;margin-top:26px;">计划与执行状态</h2>
    <table>
      <thead><tr><th>#</th><th>智能体</th><th>动作</th><th>说明</th><th>状态</th></tr></thead>
      <tbody>
${renderPlanTable(session)}
      </tbody>
    </table>
    <footer>本页面由代掌 Steward 编排内核在本地生成，仅用于演示与验收；不含真实客户数据。</footer>
  </section>
</main>
</body>
</html>`;
}

function buildDeliverableMarkdown(session: OrchestratorSession, step: PlanStep, nowIso: string): string {
  return `# 交付物报告：${session.title}

- 会话：\`${session.id}\`
- 目标：${session.goal}
- 生成时间：${nowIso}
- 生成步骤：${step.step}. ${step.agent_role} / ${step.action}（${step.summary}）
- 预算：¥${session.budget_cny}；Token 上限：${session.token_limit}

## 计划与执行状态

| # | 智能体 | 动作 | 说明 | 状态 |
|---|---|---|---|---|
${session.plan
  .map((item) => `| ${item.step} | ${item.agent_role} | ${item.action} | ${item.summary} | ${item.status} |`)
  .join("\n")}

## 说明

本报告由\`operator.build_deliverable\`在本地生成（零外部依赖、未连接真实系统），后续步骤会做质检、
证据核查与事件留痕；收款请求仅为演示渠道，到账需人工确认。
`;
}

function buildQualityCheckHtml(htmlPath: string): { ok: boolean; checks: Record<string, boolean>; size: number } {
  if (!existsSync(htmlPath)) {
    return { ok: false, checks: { file_exists: false, has_html_tag: false, has_title: false, has_body: false }, size: 0 };
  }
  const html = readFileSync(htmlPath, "utf8");
  const size = Buffer.byteLength(html, "utf8");
  const checks = {
    file_exists: true,
    has_html_tag: /<html[\s>]/iu.test(html),
    has_title: /<title>[\s\S]*?<\/title>/iu.test(html),
    has_body: /<body[\s>]/iu.test(html),
    has_plan_table: /<table[\s>]/iu.test(html),
    size_ok: size > 500,
  };
  const ok = Object.values(checks).every(Boolean);
  return { ok, checks, size };
}

function appendLocalLedger(root: string, evidenceDir: string, entry: Record<string, unknown>): string {
  const ledgerPath = join(evidenceDir, "ledger.json");
  let entries: unknown[] = [];
  if (existsSync(ledgerPath)) {
    try {
      const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      entries = [];
    }
  }
  entries.push(entry);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return relativeRef(root, ledgerPath);
}

function flattenTurns(session: OrchestratorSession): Array<{ seq: number; agent_role: string; at: string; status: string; summary: string }> {
  const turns = Object.entries(session.children).flatMap(([role, list]) =>
    (list ?? []).map((turn) => ({
      seq: turn.seq,
      agent_role: role,
      at: turn.at,
      status: turn.status,
      summary: turn.output_summary,
    })),
  );
  turns.sort((left, right) => left.seq - right.seq);
  return turns;
}

// ---------------------------------------------------------------------------
// 动作分派
// ---------------------------------------------------------------------------

/** 执行一个计划步骤对应的真实本地动作。 */
export async function runLocalAction(input: LocalActionInput): Promise<LocalActionResult> {
  const { root, evidenceDir, session, step, nowIso, ledger } = input;
  mkdirSync(evidenceDir, { recursive: true });
  const action = typeof step.action === "string" && step.action.length > 0 ? step.action : "operator.build_deliverable";
  const role = typeof step.agent_role === "string" ? step.agent_role : "operator";

  // 1) operator：生成交付物（HTML + Markdown 报告）
  if (action === "operator.build_deliverable" || (role === "operator" && action.startsWith("operator."))) {
    const htmlRef = writeText(
      root,
      join(evidenceDir, "deliverable.html"),
      buildDeliverableHtml(session, step, nowIso),
    );
    const mdRef = writeText(
      root,
      join(evidenceDir, "deliverable.md"),
      buildDeliverableMarkdown(session, step, nowIso),
    );
    return {
      ok: true,
      output_summary: `已生成交付物页面与报告（${htmlRef}、${mdRef}）`,
      detail: `动作：${action}\n智能体：${role}\n目标：${session.goal}\n输出：\n- ${htmlRef}\n- ${mdRef}\n说明：本地生成，无外部依赖。`,
      evidence_refs: [htmlRef, mdRef],
    };
  }

  // 2) harness：本地质检
  if (action === "harness.quality_check" || role === "harness") {
    const htmlPath = join(evidenceDir, "deliverable.html");
    const quality = buildQualityCheckHtml(htmlPath);
    const ref = writeText(
      root,
      join(evidenceDir, "quality-check.json"),
      JSON.stringify({ ok: quality.ok, checks: quality.checks, size_bytes: quality.size, checked_at: nowIso, action }, null, 2),
    );
    const passed = Object.entries(quality.checks)
      .filter(([, value]) => value)
      .map(([name]) => name);
    return {
      ok: quality.ok,
      output_summary: quality.ok
        ? `本地质检通过（${passed.length}/${Object.keys(quality.checks).length} 项：${passed.join("/")}）`
        : `本地质检未通过：${Object.entries(quality.checks)
            .filter(([, value]) => !value)
            .map(([name]) => name)
            .join("/")}`,
      detail: `动作：${action}\n质检文件：${relativeRef(root, htmlPath)}\n结果：${JSON.stringify(quality.checks)}\n证据：${ref}`,
      evidence_refs: [ref],
    };
  }

  // 3) reviewer：核查证据
  if (action === "reviewer.review_evidence" || role === "reviewer") {
    const files = listEvidenceFiles(root, evidenceDir);
    const hasReport = files.some((file) => file.title === "deliverable.md" || file.title === "deliverable.html");
    const hasQuality = files.some((file) => file.title === "quality-check.json");
    const issues: string[] = [];
    if (!hasReport) issues.push("缺少交付物证据（deliverable.html/md）");
    // 没有独立 harness 质检文件时，reviewer 自己对交付物做结构/金额/外链/占位符复核（不假装质检通过）。
    let selfCheckNote = "";
    if (hasReport && !hasQuality) {
      try {
        const htmlFile = files.find((file) => file.title === "deliverable.html");
        const reportFile = files.find((file) => file.title === "deliverable.md");
        const target = htmlFile ?? reportFile;
        if (!target) {
          issues.push("缺少可读取的交付物文件");
        } else {
          const raw = readFileSync(join(root, target.path), "utf8");
          const checks: Record<string, boolean> = {
            size_ok: raw.length > 300,
            has_amount: /合计|金额|小计|报价|¥|￥/.test(raw),
            no_external_asset: !/(src|href)\s*=\s*["']https?:/i.test(raw) && !/<script[^>]+src\s*=\s*["']https?:/i.test(raw),
            no_placeholder: !/(TODO|待补充|占位|\{\{)/.test(raw),
          };
          const passed = Object.values(checks).every(Boolean);
          selfCheckNote = `reviewer 自行复核（无独立质检文件）：${Object.entries(checks)
            .map(([name, value]) => `${name}=${value}`)
            .join("，")}`;
          if (!passed) issues.push("缺少质检证据（quality-check.json）且 reviewer 复核未通过");
        }
      } catch {
        issues.push("缺少质检证据（quality-check.json），且读取交付物复核失败");
      }
    }
    const ok = issues.length === 0;
    const ref = writeText(
      root,
      join(evidenceDir, "review.json"),
      JSON.stringify(
        {
          ok,
          issues,
          evidence_checked: files.map((file) => file.path),
          reviewed_at: nowIso,
          review_method: selfCheckNote ? "reviewer_self_check" : "evidence_chain",
          reviewer_note: ok ? (selfCheckNote || "证据链完整：交付物 + 质检记录可核对") : "证据不足，结论不可验收",
        },
        null,
        2,
      ),
    );
    return {
      ok,
      output_summary: ok ? `证据核查通过（${files.length} 个证据文件可核对${selfCheckNote ? "；reviewer 自行结构复核通过" : ""}）` : `证据核查未通过：${issues.join("；")}`,
      detail: `动作：${action}\n核查证据：${files.length} 个\n${files.map((file) => `- ${file.path}（${file.kind}）`).join("\n")}\n${selfCheckNote ? `${selfCheckNote}\n` : ""}结论：${ok ? "通过" : `不通过：${issues.join("；")}`}\n证据：${ref}`,
      evidence_refs: [ref],
    };
  }

  // 4) backend：事件日志 + 证据索引
  if (action === "backend.write_events" || role === "backend") {
    const turns = flattenTurns(session);
    const events = turns.map((turn, index) => ({
      seq: index + 1,
      at: turn.at,
      session_id: session.id,
      agent_role: turn.agent_role,
      action: "agent.turn",
      status: turn.status,
      summary: turn.summary,
    }));
    const eventsRef = writeText(
      root,
      join(evidenceDir, "events.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n"),
    );
    const files = listEvidenceFiles(root, evidenceDir).map((file) => ({ path: file.path, kind: file.kind, title: file.title }));
    const indexRef = writeText(
      root,
      join(evidenceDir, "evidence-index.json"),
      JSON.stringify({ session_id: session.id, generated_at: nowIso, files }, null, 2),
    );
    return {
      ok: true,
      output_summary: `已写事件日志（${events.length} 条）与证据索引（${files.length} 个文件）`,
      detail: `动作：${action}\n事件：${events.length} 条 → ${eventsRef}\n证据索引：${files.length} 个文件 → ${indexRef}`,
      evidence_refs: [eventsRef, indexRef],
    };
  }

  // 5) finance：收款请求（演示渠道，待人工确认到账）
  if (action === "finance.collect_payment" || role === "finance") {
    const amount = parseAmountFromGoal(session.goal);
    const paymentId = `pay-${session.id}`;
    const client = "示例客户（虚构）";
    const request = {
      id: paymentId,
      session_id: session.id,
      amount_cny: amount,
      client,
      purpose: session.goal,
      status: "pending",
      payment_method: "manual_approval",
      note: "演示资金渠道（未接真实支付）：创建请求后需人工确认到账才记收入；¥10 仅为历史测试值。",
      created_at: nowIso,
    };
    const requestRef = writeText(root, join(evidenceDir, "payment-request.json"), JSON.stringify(request, null, 2));

    let ledgerDetail: string;
    let ledgerRef: string;
    if (ledger !== undefined) {
      const result = ledger.recordIncome({
        amount_cny: amount,
        basis: `${session.id}:${paymentId}`,
        client,
        session_id: session.id,
      });
      ledgerRef = writeText(
        root,
        join(evidenceDir, "ledger-record.json"),
        JSON.stringify({ source: "injected_ledger", amount_cny: amount, basis: `${session.id}:${paymentId}`, result }, null, 2),
      );
      ledgerDetail = `已通过注入的 ledger 记录收入 ¥${amount}（依据 ${session.id}:${paymentId}）`;
    } else {
      ledgerRef = appendLocalLedger(root, evidenceDir, {
        id: `led-${paymentId}`,
        session_id: session.id,
        type: "income",
        amount_cny: amount,
        client,
        basis: `${session.id}:${paymentId}`,
        approved_by: "待人工确认（演示）",
        receipt_ref: "pending_human_confirmation",
        occurred_at: nowIso,
      });
      ledgerDetail = `已写本地 ledger.json 记录收入候选 ¥${amount}（待人工确认到账）`;
    }
    return {
      ok: true,
      output_summary: `已生成收款请求 ¥${amount}（${paymentId}，待人工确认到账）；${ledgerDetail}`,
      detail: `动作：${action}\n收款请求：${requestRef}\n金额：¥${amount}\n状态：pending（演示渠道，未接真实支付）\n${ledgerDetail}\n说明：AI 不自动确认到账；需人工确认后进入账本收入。`,
      evidence_refs: [requestRef, ledgerRef],
    };
  }

  // 6) scout / research：调研与线索草稿（不外发）
  if (action === "scout.research_brief" || role === "scout" || role === "research") {
    const content = `# 调研要点与线索草稿（未外发）

- 会话：\`${session.id}\`
- 目标：${session.goal}
- 生成时间：${nowIso}

## 检索计划

1. 明确客户画像（行业/规模/角色）与 3 个高价值场景；
2. 只使用公开且允许的来源，记录来源 URL 与访问时间；
3. 线索必须有 source_url + signal + consent_basis，无来源直接丢弃。

## 候选线索草稿（虚构示例，非真实客户）

| 线索 | 信号 | 合规依据 | 状态 |
|---|---|---|---|
| 示例客户 A（虚构） | 需要把每周手工报表自动化 | 公开商务邮箱（示例） | 草稿 |
| 示例客户 B（虚构） | 想采购对账自动化工具 | 公开帖子明确寻求工具（示例） | 草稿 |

## 合规边界

- 只起草，**不自动外发**、不群发、不冒充人类；发送需人工审批。
`;
    const ref = writeText(root, join(evidenceDir, "research.md"), content);
    return {
      ok: true,
      output_summary: "已生成调研要点与 2 条虚构线索草稿（未外发，待人工审批）",
      detail: `动作：${action}\n输出：${ref}\n说明：只起草不外发，未连接真实平台。`,
      evidence_refs: [ref],
    };
  }

  // 7) customer：客户回复草稿（不发送）
  if (action === "customer.reply_draft" || role === "customer") {
    const content = `# 客户沟通草稿（未发送）

- 会话：\`${session.id}\`
- 目标：${session.goal}
- 生成时间：${nowIso}

您好，关于「${session.goal}」，我们可以先按小步交付：先出可核对的草稿与验收标准，确认后再排期。
如需继续，请回复希望优先解决的一个场景，我们会给出具体报价与交付时间。

> 本消息是**草稿**：AI 不会自动发送，需人工确认收件人与内容后由本人发送。
`;
    const ref = writeText(root, join(evidenceDir, "customer-reply.md"), content);
    return {
      ok: true,
      output_summary: "已生成客户回复草稿（未自动发送，待人工确认）",
      detail: `动作：${action}\n输出：${ref}\n说明：仅草稿，不自动触达客户。`,
      evidence_refs: [ref],
    };
  }

  // 8) content：内容/文案草稿
  if (action === "content.draft" || role === "content") {
    const content = `# 内容草稿（未发布）

- 会话：\`${session.id}\`
- 目标：${session.goal}
- 生成时间：${nowIso}

## 标题（示例）
把重复流程交给 AI 代掌：先出草稿，人来确认

## 正文草稿
围绕「${session.goal}」整理三个可验证的价值点，并附上本地可复现的证据链接。
内容仅作为草稿，发布前需人工审核。

> AI 不自动发布内容。
`;
    const ref = writeText(root, join(evidenceDir, "content-draft.md"), content);
    return {
      ok: true,
      output_summary: "已生成内容/文案草稿（未发布，待人工审核）",
      detail: `动作：${action}\n输出：${ref}\n说明：仅草稿，不自动发布。`,
      evidence_refs: [ref],
    };
  }

  // 9) 兜底：note.md（未知动作也保留证据）
  const content = `# 步骤执行记录

- 会话：\`${session.id}\`
- 步骤：${step.step}. ${role} / ${action}
- 说明：${step.summary}
- 时间：${nowIso}

该动作类型未内置专项实现，已生成本地记录作为证据；不执行任何外部副作用。
`;
  const ref = writeText(root, join(evidenceDir, `step-${step.step}-note.md`), content);
  return {
    ok: true,
    output_summary: `已生成步骤记录 note（${role}/${action}）`,
    detail: `动作：${action}\n输出：${ref}\n说明：未知动作兜底，不产生外部副作用。`,
    evidence_refs: [ref],
  };
}

/** 追加一条本地事件（引擎可直接用于额外留痕；可选）。 */
export function appendEventLine(evidenceDir: string, event: Record<string, unknown>): void {
  mkdirSync(evidenceDir, { recursive: true });
  appendFileSync(join(evidenceDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// v1.3：supervisor 系统动作证据（写入 evidenceDir/system-actions/）
// ---------------------------------------------------------------------------

export interface SystemActionEvidenceInput {
  root: string;
  evidenceDir: string;
  sessionId: string;
  step: number;
  action: string;
  target: string;
  args: Record<string, unknown>;
  risk: string;
  requires_confirmation: boolean;
  confirmed_by: string | null;
  result: { ok: boolean; summary: string; detail?: string | undefined; data?: unknown };
  nowIso: string;
}

/** 写系统动作证据 JSON，返回相对 root 的路径。 */
export function writeSystemActionEvidence(input: SystemActionEvidenceInput): string {
  mkdirSync(join(input.evidenceDir, "system-actions"), { recursive: true });
  const filePath = join(input.evidenceDir, "system-actions", `step-${input.step}-${input.action}.json`);
  const payload = {
    session_id: input.sessionId,
    step: input.step,
    action: input.action,
    target: input.target,
    args: input.args,
    risk: input.risk,
    requires_confirmation: input.requires_confirmation,
    confirmed_by: input.confirmed_by,
    result_ok: input.result.ok,
    result_summary: input.result.summary,
    result_detail: input.result.detail ?? null,
    result_data: input.result.data ?? null,
    generated_at: input.nowIso,
    note: "supervisor 受管系统动作：由人确认后执行；全部动作留痕，供审计/回放。",
  };
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relativeRef(input.root, filePath);
}
