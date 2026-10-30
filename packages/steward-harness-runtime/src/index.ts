/**
 * `@daizhang/steward-harness-runtime`：v1.5-A 真实 DeepSeek Harness 智能体执行器。
 *
 * 把每个 agent 换成真实 harness 代理（`dsh --profile headless --json "<task>"`），
 * 实时解析 NDJSON 事件（thinking/tool_call/tool_result/text/final/usage），隔离工作区快照 diff
 * 出产物（sha256/kind），自动写 report.md；超时/abort/不可用 → ok:false 不抛异常。
 *
 * 零第三方依赖；Windows 上用 `process.execPath` + dsh `lib/bin.js` 绝对路径启动（不 spawn "dsh"）。
 */

export type {
  HarnessAgentPoolOptions,
  HarnessArtifact,
  HarnessArtifactKind,
  HarnessDescribe,
  HarnessEvent,
  HarnessEventType,
  HarnessRunInput,
  HarnessRunResult,
  HarnessRunnerOptions,
  HarnessToolCall,
  HarnessUsage,
} from "./types.js";

export {
  HARNESS_DEFAULT_MAX_OUTPUT_BYTES,
  HARNESS_DEFAULT_POOL_CONCURRENCY,
  HARNESS_DEFAULT_PROFILE,
  HARNESS_DEFAULT_TIMEOUT_MS,
  HARNESS_ENV_WHITELIST,
  HARNESS_SKIP_DIRS,
  HARNESS_SNAPSHOT_MAX_FILE_BYTES,
} from "./types.js";

export {
  artifactForFile,
  classifyArtifactKind,
  diffWorkspaceArtifacts,
  safeBaseName,
  sha256File,
  sha256Text,
  snapshotWorkspace,
} from "./snapshot.js";
export type { FileSnapshotEntry, WorkspaceSnapshot } from "./snapshot.js";

export {
  HarnessAgentRunner,
  buildHarnessEnv,
  defaultDshBin,
  truncateBytes,
  writeHarnessReport,
} from "./runner.js";
export type { HarnessRunner } from "./runner.js";

export { HarnessAgentPool } from "./pool.js";
export type { PoolRunner } from "./pool.js";
