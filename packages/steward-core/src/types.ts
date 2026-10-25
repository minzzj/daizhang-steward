/**
 * Core contracts (see docs/en/contracts.md and docs/zh-CN/contracts.md).
 * Fields may only be added, never removed.
 */

export type Confidence = "certain" | "probable" | "unknown" | "tombstone";
export type PolicyDecision = "allow" | "deny" | "approve" | "unknown";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type BranchRole = "conductor" | "operator" | "scout" | "reviewer" | "dummy";

export interface Budget {
  token: number;
  time_minutes: number;
  cost_cny: number;
}

export interface ApprovalPolicy {
  require_approval: string[];
  deny: string[];
}

export interface BranchSpec {
  id: string;
  parent_id: string | null;
  role: BranchRole;
  goal: string;
  tools: string[];
  budget: Budget;
  approval_policy: ApprovalPolicy;
  expires_at: string | null;
  prompt_ref: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  risk: RiskLevel;
  requiresApproval: boolean;
  /** Whether the tool produces evidence paths (screenshots/logs). */
  evidence: boolean;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  evidence?: string[];
  data?: unknown;
}

export interface ToolContext {
  runId: string;
  branchId: string;
  evidenceDir: string;
}

export interface PlannedStep {
  tool: string;
  args?: Record<string, unknown>;
  description?: string;
}

export interface StepResult {
  tool: string;
  decision: PolicyDecision;
  ok: boolean;
  summary: string;
  evidence: string[];
}

export interface CodeTask {
  task_id: string;
  repo: string;
  branch: string;
  goal: string;
  reproduction: string[];
  expected: string;
  actual: string;
  files: string[];
  acceptance: string[];
  constraints: string[];
  forbidden: string[];
  output: "unified_diff";
}

export interface CodeResult {
  task_id: string;
  patch: string;
  summary: string;
  tests_run: string[];
  risks: string[];
  uncovered: string[];
}

export interface LeadRecord {
  lead_id: string;
  org: string;
  role: string;
  source_url: string;
  signal: string;
  fit_score: number;
  channel: string;
  consent_basis: string;
  status: "drafted" | "approved" | "sent" | "replied" | "unsubscribed" | "archived";
}

export interface ApprovalCard {
  id: string;
  branch: string;
  action: string;
  target: string;
  amount_cny?: number;
  risk_level: RiskLevel;
  evidence: string[];
  options: ["approve", "revise", "reject"];
  expires_at: string;
  decided_by?: string;
  decided_at?: string;
  decision?: "approve" | "revise" | "reject" | "timeout";
}

export interface TakeoverPack {
  open_orders: string[];
  pending_threads: string[];
  payable: string[];
  credentials: string[];
  risks: string[];
  generated_at: string;
  coverage: "complete" | "partial" | "not_covered";
}

export interface StewardEvent {
  seq: number;
  ts: string;
  prev_hash: string;
  hash: string;
  branch_id: string;
  tool: string;
  target: string;
  input_digest: string;
  policy_decision: PolicyDecision;
  result: "success" | "failure" | "pending_approval" | "unknown" | "started" | "ended";
  evidence_path: string;
  confidence: Confidence;
}

export type EventInput = Omit<StewardEvent, "seq" | "ts" | "prev_hash" | "hash"> & {
  ts?: string;
};

export interface RunMeta {
  runId: string;
  goal: string;
  branchId: string;
  branchRole: BranchRole;
  promptRef: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  steps?: number;
  evidenceRoot: string;
}

export interface RunArtifacts {
  runId: string;
  dir: string;
  prompt: string;
  patch: string;
  testLog: string;
  screenshotsDir: string;
  report: string;
  consoleLog: string;
  meta: string;
  events: string;
}

export interface RunResult {
  runId: string;
  branchId: string;
  ok: boolean;
  steps: StepResult[];
  artifacts: RunArtifacts;
  reportPath: string;
}
