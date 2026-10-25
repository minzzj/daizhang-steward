import { newBranchId } from "./ids.js";
import type { ApprovalPolicy, BranchRole, BranchSpec, Budget } from "./types.js";

export const DEFAULT_BUDGET: Budget = {
  token: 200_000,
  time_minutes: 120,
  cost_cny: 10,
};

const ROLES: BranchRole[] = ["conductor", "operator", "scout", "reviewer", "dummy"];

export interface CreateBranchInput {
  role: BranchRole;
  goal: string;
  parentId?: string | null;
  tools?: string[];
  budget?: Partial<Budget>;
  approvalPolicy?: Partial<ApprovalPolicy>;
  expiresAt?: string | null;
  promptRef?: string;
}

export function createBranch(input: CreateBranchInput): BranchSpec {
  const id = newBranchId(input.role);
  return {
    id,
    parent_id: input.parentId ?? null,
    role: input.role,
    goal: input.goal,
    tools: input.tools ?? ["echo"],
    budget: { ...DEFAULT_BUDGET, ...(input.budget ?? {}) },
    approval_policy: {
      require_approval: input.approvalPolicy?.require_approval ?? [],
      deny: input.approvalPolicy?.deny ?? [],
    },
    expires_at: input.expiresAt ?? null,
    prompt_ref: input.promptRef ?? `${input.role}@1.0.0`,
  };
}

export function validateBranch(spec: BranchSpec): string[] {
  const errors: string[] = [];
  if (!spec.id.trim()) errors.push("id 不能为空");
  if (!spec.goal.trim()) errors.push("goal 不能为空");
  if (!ROLES.includes(spec.role)) errors.push(`非法角色：${spec.role}`);
  if (!Array.isArray(spec.tools) || spec.tools.length === 0) errors.push("tools 白名单不能为空");
  for (const key of ["token", "time_minutes", "cost_cny"] as const) {
    const v = spec.budget[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) errors.push(`budget.${key} 必须为正数`);
  }
  if (spec.expires_at !== null && Number.isNaN(Date.parse(spec.expires_at))) {
    errors.push("expires_at 不是合法的 ISO 时间");
  }
  if (!/^[a-z]+@\d+\.\d+\.\d+$/.test(spec.prompt_ref)) {
    errors.push(`prompt_ref 版本格式应为 role@x.y.z，收到：${spec.prompt_ref}`);
  }
  return errors;
}

/** In-memory branch registry; events are written by the runtime. */
export class BranchManager {
  private readonly branches = new Map<string, BranchSpec>();

  create(input: CreateBranchInput): BranchSpec {
    const spec = createBranch(input);
    const errors = validateBranch(spec);
    if (errors.length > 0) throw new Error(`BranchSpec 非法：${errors.join("; ")}`);
    this.branches.set(spec.id, spec);
    return spec;
  }

  get(id: string): BranchSpec | undefined {
    return this.branches.get(id);
  }

  list(): BranchSpec[] {
    return [...this.branches.values()];
  }

  terminate(id: string): boolean {
    return this.branches.delete(id);
  }
}
