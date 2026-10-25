import type { ToolContext, ToolResult, ToolSpec } from "./types.js";

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

interface RegisteredTool {
  spec: ToolSpec;
  handler: ToolHandler;
}

/** Registry of callable tools; every tool declares risk, approval and evidence semantics. */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(spec: ToolSpec, handler: ToolHandler): this {
    if (this.tools.has(spec.name)) throw new Error(`工具已注册：${spec.name}`);
    this.tools.set(spec.name, { spec, handler });
    return this;
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)?.spec;
  }

  list(): ToolSpec[] {
    return [...this.tools.values()].map((t) => t.spec);
  }

  /** Verify a branch's allowlist refers to registered tools. */
  require(names: string[]): void {
    const missing = names.filter((n) => !this.tools.has(n));
    if (missing.length > 0) throw new Error(`分支引用了未注册工具：${missing.join(", ")}`);
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`工具不存在或未授权：${name}`);
    return tool.handler(args, ctx);
  }
}
