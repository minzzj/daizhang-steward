import type { PolicyDecision, RiskLevel } from "./types.js";

/** High-risk actions denied by default (see docs/en/threat-model.md). */
export const DEFAULT_DENY_ACTIONS = [
  "payment",
  "refund",
  "contract.sign",
  "contract",
  "account.permission",
  "outreach.bulk",
  "captcha.bypass",
  "deploy.production",
  "tax.submit",
] as const;

export interface PolicyAction {
  tool: string;
  target?: string;
  risk?: RiskLevel;
}

export interface PolicyVerdict {
  decision: PolicyDecision;
  reason: string;
}

function matches(action: string, pattern: string): boolean {
  return action === pattern || action.startsWith(`${pattern}.`);
}

/** allow / deny / approve / unknown — unknown and approve both mean "human must act". */
export class PolicyEngine {
  private readonly denyList: string[];
  private readonly approvalList: string[];

  constructor(options: { require_approval?: string[]; deny?: string[] } = {}) {
    this.denyList = [...DEFAULT_DENY_ACTIONS, ...(options.deny ?? [])];
    this.approvalList = options.require_approval ?? [];
  }

  evaluate(action: PolicyAction): PolicyVerdict {
    if (this.denyList.some((p) => matches(action.tool, p))) {
      return { decision: "deny", reason: `默认拒绝高风险动作：${action.tool}` };
    }
    if (this.approvalList.some((p) => matches(action.tool, p))) {
      return { decision: "approve", reason: `该动作需要人类审批：${action.tool}` };
    }
    if (action.risk === "high" || action.risk === "critical") {
      return { decision: "approve", reason: `风险级别 ${action.risk}，需要人类审批` };
    }
    if (action.risk === undefined) {
      return { decision: "unknown", reason: "风险级别未知 → 暂停待核，不自动放行" };
    }
    return { decision: "allow", reason: `风险级别 ${action.risk}，允许执行` };
  }
}
