import type { Budget } from "./types.js";

export type BudgetStatus = "ok" | "warn" | "exceeded";

export interface BudgetCheck {
  status: BudgetStatus;
  reason: string;
  used: Budget;
  percent: { token: number; time: number; cost: number };
}

/** Soft budget gate: warn at 80%, pause at 100% (never negative). */
export class BudgetGuard {
  private usedToken = 0;
  private usedMinutes = 0;
  private usedCost = 0;

  constructor(public readonly budget: Budget) {}

  charge(usage: Partial<Budget>): BudgetCheck {
    this.usedToken += usage.token ?? 0;
    this.usedMinutes += usage.time_minutes ?? 0;
    this.usedCost += usage.cost_cny ?? 0;
    return this.check();
  }

  check(): BudgetCheck {
    const pct = (used: number, limit: number): number =>
      limit <= 0 ? 100 : Math.round((used / limit) * 1000) / 10;
    const token = pct(this.usedToken, this.budget.token);
    const time = pct(this.usedMinutes, this.budget.time_minutes);
    const cost = pct(this.usedCost, this.budget.cost_cny);
    const worst = Math.max(token, time, cost);
    const status: BudgetStatus = worst >= 100 ? "exceeded" : worst >= 80 ? "warn" : "ok";
    const reason =
      status === "exceeded"
        ? `预算已用尽（token ${token}% / 时间 ${time}% / 费用 ${cost}%）→ 暂停`
        : status === "warn"
          ? `预算接近上限（token ${token}% / 时间 ${time}% / 费用 ${cost}%）→ 告警`
          : `预算正常（token ${token}% / 时间 ${time}% / 费用 ${cost}%）`;
    return {
      status,
      reason,
      used: {
        token: this.usedToken,
        time_minutes: this.usedMinutes,
        cost_cny: this.usedCost,
      },
      percent: { token, time, cost },
    };
  }
}
