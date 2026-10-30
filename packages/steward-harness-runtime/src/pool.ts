/**
 * HarnessAgentPool：并发执行池（每个 step 一个 run；默认并发 2）。
 *
 * - 结果顺序与输入顺序严格一致（results[i] 对应 inputs[i]）；
 * - 并发上限生效（worker 数 = min(concurrency, inputs.length)）；
 * - runner.run 绝不抛异常；但若自定义 runner 抛错，本池会兜底成 ok:false 结果，不产生 unhandled rejection。
 */

import { HarnessAgentRunner } from "./runner.js";
import {
  HARNESS_DEFAULT_POOL_CONCURRENCY,
  type HarnessAgentPoolOptions,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessUsage,
} from "./types.js";

export type PoolRunner = { run(input: HarnessRunInput): Promise<HarnessRunResult> };

function emptyUsage(): HarnessUsage {
  return { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
}

function failureResult(input: HarnessRunInput | undefined, error: unknown): HarnessRunResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: `harness 执行器异常：${message}`,
    final_text: "",
    events: [],
    thinking: [],
    tool_calls: [],
    usage: emptyUsage(),
    artifacts: [],
    duration_ms: 0,
    role: typeof input?.role === "string" ? input.role : "agent",
    workspace_dir: typeof input?.workspace_dir === "string" ? input.workspace_dir : "",
  };
}

export class HarnessAgentPool {
  private readonly runner: PoolRunner;
  /** 实际并发上限（最小 1）。 */
  readonly concurrency: number;

  constructor(options: HarnessAgentPoolOptions = {}) {
    const input = typeof options === "object" && options !== null ? options : {};
    this.runner = input.runner ?? new HarnessAgentRunner();
    this.concurrency =
      typeof input.concurrency === "number" && Number.isInteger(input.concurrency) && input.concurrency > 0
        ? input.concurrency
        : HARNESS_DEFAULT_POOL_CONCURRENCY;
  }

  /** 并发跑完所有任务；返回顺序与 inputs 一致。 */
  async runAll(inputs: HarnessRunInput[]): Promise<HarnessRunResult[]> {
    if (!Array.isArray(inputs)) return [];
    const results: HarnessRunResult[] = new Array<HarnessRunResult>(inputs.length);
    let nextIndex = 0;
    const workerCount = Math.min(this.concurrency, inputs.length);
    const workers: Array<Promise<void>> = [];
    for (let worker = 0; worker < workerCount; worker += 1) {
      workers.push(
        (async (): Promise<void> => {
          while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= inputs.length) return;
            const input = inputs[index];
            if (input === undefined) continue;
            try {
              results[index] = await this.runner.run(input);
            } catch (error) {
              results[index] = failureResult(input, error);
            }
          }
        })(),
      );
    }
    await Promise.all(workers);
    return results;
  }
}
