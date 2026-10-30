/**
 * 审批策略（纯函数）：把「Run 设置」+「计划步骤的风险信息」映射成
 * `approve_now`（自动批准继续）或 `wait_human`（暂停等人工确认）。
 *
 * 与 OrchestratorEngine 的语义对齐：
 * - project 步骤用 `requires_approval`（finance 类）；
 * - system 步骤用 `action_plan.risk` + `action_plan.requires_confirmation`（removeApp/removePlugin=high）。
 */

import type {
  ApprovalMode,
  ApprovalPolicyDecision,
  RuntimePlanStepView,
  RuntimeSettingsView,
} from "./types.js";

export const APPROVAL_MODES: readonly ApprovalMode[] = ["auto_low_risk", "auto_all", "manual"];
/** high/critical 视为危险动作（auto_low_risk 下暂停）。 */
export const DANGEROUS_RISKS: readonly string[] = ["high", "critical"];

/** 判定一个待审批步骤在当前设置下应自动批准还是等人工。 */
export function evaluateApprovalPolicy(
  step: RuntimePlanStepView,
  settings: RuntimeSettingsView,
): ApprovalPolicyDecision {
  const declaredRisk = step.action_plan?.risk;
  const risk = typeof declaredRisk === "string" && declaredRisk.length > 0 ? declaredRisk : "medium";
  const requiresConfirmation =
    step.action_plan?.requires_confirmation === true || step.requires_approval === true;
  const dangerous = step.action_plan?.requires_confirmation === true || DANGEROUS_RISKS.includes(risk);
  const base = { risk, dangerous };

  if (settings.full_auto) {
    return {
      ...base,
      decision: "approve_now",
      reason: "full_auto 已开启：全部步骤自动批准（含高风险，控制台显式开启才生效）",
    };
  }
  if (settings.approval_mode === "auto_all") {
    return { ...base, decision: "approve_now", reason: "approval_mode=auto_all：自动批准全部步骤" };
  }
  if (settings.approval_mode === "manual") {
    return {
      ...base,
      decision: "wait_human",
      reason: requiresConfirmation
        ? "approval_mode=manual：该步骤需要人工审批，暂停等待确认"
        : "approval_mode=manual：人工模式下所有审批步骤都需人工确认",
    };
  }
  // auto_low_risk（默认）：仅 high/critical 或 requires_confirmation=true 暂停
  if (dangerous) {
    return {
      ...base,
      decision: "wait_human",
      reason: `auto_low_risk：风险=${risk}${step.action_plan?.requires_confirmation === true ? "/需确认" : ""}，暂停等待人工确认`,
    };
  }
  return {
    ...base,
    decision: "approve_now",
    reason: `auto_low_risk：风险=${risk} 且无需确认，自动批准继续`,
  };
}
