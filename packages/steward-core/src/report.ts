import type { RunArtifacts, RunMeta, StewardEvent, StepResult } from "./types.js";

function rel(root: string, file: string): string {
  return file.startsWith(root) ? file.slice(root.length).replace(/^[/\\]/, "").replaceAll("\\", "/") : file;
}

/** Human-readable run report (also the evidence index for acceptance items). */
export function renderReport(input: {
  meta: RunMeta;
  events: StewardEvent[];
  steps: StepResult[];
  artifacts: RunArtifacts;
  root: string;
  note?: string;
}): string {
  const { meta, events, steps, artifacts, root } = input;
  const lines: string[] = [];
  lines.push(`# 运行报告 / Run Report — ${meta.runId}`, "");
  lines.push("## 目标", "", `- 目标：${meta.goal}`, `- 分支：${meta.branchId}（${meta.branchRole}）`, `- 提示词：${meta.promptRef}`, "");
  lines.push("## 结果", "");
  lines.push(`- 状态：${meta.ok ? "通过 (ok)" : "未通过 (failed / 需人工)"}`);
  lines.push(`- 开始：${meta.startedAt}`);
  lines.push(`- 结束：${meta.finishedAt ?? "(未结束)"}`);
  lines.push(`- 步骤数：${steps.length}`);
  lines.push("");
  if (steps.length > 0) {
    lines.push("## 步骤", "");
    lines.push("| # | 工具 | 策略 | 结果 | 摘要 | 证据 |");
    lines.push("|---|---|---|---|---|---|");
    steps.forEach((s, i) => {
      lines.push(
        `| ${i + 1} | ${s.tool} | ${s.decision} | ${s.ok ? "成功" : "失败/待批"} | ${s.summary.replaceAll("|", "\\|")} | ${s.evidence.map((e) => `\`${rel(root, e)}\``).join("<br>") || "—"} |`,
      );
    });
    lines.push("");
  }
  lines.push("## 审计事件", "");
  lines.push(`共 ${events.length} 条事件（哈希链）。事件账本：\`${rel(root, artifacts.events)}\``);
  lines.push("");
  const last = events.slice(-5);
  if (last.length > 0) {
    lines.push("| seq | 工具 | 策略 | 结果 |");
    lines.push("|---|---|---|---|");
    for (const ev of last) lines.push(`| ${ev.seq} | ${ev.tool} | ${ev.policy_decision} | ${ev.result} |`);
    lines.push("");
  }
  lines.push("## 证据清单", "");
  const evidenceFiles = [
    artifacts.prompt,
    artifacts.patch,
    artifacts.testLog,
    artifacts.consoleLog,
    artifacts.events,
    artifacts.meta,
  ];
  for (const f of evidenceFiles) lines.push(`- \`${rel(root, f)}\``);
  lines.push(`- \`${rel(root, artifacts.screenshotsDir)}/\`（真实浏览器/桌面截图；M1 起由 E2E 生成）`, "");
  if (input.note) {
    lines.push("## 备注", "", input.note, "");
  }
  lines.push("---", "", `${meta.ok ? "证据齐全，可进入复核。" : "未通过：保留现场，等待修复或人工处理。"}`, "");
  return lines.join("\n");
}
