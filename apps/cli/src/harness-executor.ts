/**
 * v1.5：真实 DeepSeek Harness 智能体执行器（Orchestrator AgentExecutor 适配）。
 *
 * 把配置中心的 HarnessSettings（总开关/profile/dsh_bin/超时/角色开关）+ composeHarnessPrompt(role)
 * 接到 steward-harness-runtime 的 HarnessAgentRunner；所有专项智能体步骤优先走真实 DSH 代理执行。
 */
import { mkdirSync } from "node:fs";
import { ConfigEngine, composeHarnessPrompt } from "../../../packages/steward-config/src/index.js";
import { HarnessAgentRunner } from "../../../packages/steward-harness-runtime/src/index.js";
import type {
  AgentExecutor,
  HarnessAgentRunInput,
  HarnessAgentRunResult,
} from "../../../packages/steward-orchestrator/src/index.js";

export interface HarnessExecutorOptions {
  /** 可覆盖 dsh bin 路径（默认读取配置/自动探测）。 */
  dsh_bin?: string;
  /** 可覆盖 profile。 */
  profile?: string;
}

export interface HarnessExecutorHandle {
  executor: AgentExecutor | undefined;
  runner: HarnessAgentRunner;
  describe: () => { enabled: boolean; available: boolean; dsh_bin: string; profile: string; max_concurrency: number };
}

export function createHarnessAgentExecutor(config: ConfigEngine, options: HarnessExecutorOptions = {}): HarnessExecutorHandle {
  const settings = config.getHarnessSettings();
  const runner = new HarnessAgentRunner({
    ...(options.dsh_bin ?? settings.dsh_bin ? { dsh_bin: options.dsh_bin ?? settings.dsh_bin } : {}),
    ...(options.profile ?? settings.profile ? { profile: options.profile ?? settings.profile } : {}),
  });
  const describe = () => ({
    enabled: settings.enabled,
    available: runner.isAvailable(),
    dsh_bin: runner.describe().dsh_bin,
    profile: runner.describe().profile,
    max_concurrency: settings.max_concurrency,
  });
  if (!settings.enabled) return { executor: undefined, runner, describe };

  const roles = new Map(settings.roles.map((role) => [role.role, role]));
  const executor: AgentExecutor = {
    available: () => runner.isAvailable(),
    run: async (input: HarnessAgentRunInput): Promise<HarnessAgentRunResult> => {
      const roleSettings = roles.get(input.role);
      if (roleSettings !== undefined && roleSettings.enabled === false) {
        return {
          ok: false,
          error: `角色 ${input.role} 的 Harness 已关闭（配置中心 harness.roles）`,
          final_text: "",
          artifacts: [],
          usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
          thinking: [],
          tool_calls: [],
          events_count: 0,
          duration_ms: 0,
        };
      }
      try {
        mkdirSync(input.workspace_dir, { recursive: true });
      } catch {
        /* runner 会再次校验 */
      }
      let systemPrompt = "";
      try {
        systemPrompt = composeHarnessPrompt(input.role);
      } catch {
        systemPrompt = "";
      }
      const result = await runner.run({
        role: input.role,
        task: input.task,
        ...(systemPrompt.length > 0 ? { system_prompt: systemPrompt } : {}),
        workspace_dir: input.workspace_dir,
        timeout_ms: roleSettings?.timeout_ms ?? settings.timeout_ms,
        on_event: input.on_event,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return {
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        final_text: result.final_text,
        ...(result.report_path ? { report_path: result.report_path } : {}),
        artifacts: result.artifacts.map((artifact) => ({
          path: artifact.path,
          rel_path: artifact.rel_path,
          kind: artifact.kind,
          size: artifact.size,
          sha256: artifact.sha256,
        })),
        usage: result.usage,
        thinking: result.thinking,
        tool_calls: result.tool_calls,
        events_count: result.events.length,
        duration_ms: result.duration_ms,
      };
    },
  };
  return { executor, runner, describe };
}
