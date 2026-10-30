# @daizhang/steward-harness-runtime · 真实 Harness 智能体执行器（v1.5-A）

> 状态：**已实现**。把每个 agent 换成 **真实 DeepSeek Harness 代理**（headless NDJSON），
> 让用户看到**产物 / 数据 / 报告 / 思考过程 / 工具调用**：
> `dsh --profile headless --json "<system_prompt + task>"` → 实时事件流 → 隔离工作区产物快照（sha256/kind）→ 自动 `report.md`。
>
> 零第三方依赖；**不发起网络请求、不注入密钥**；超时/中断/不可用一律 `ok:false`（不抛异常）。

## 1. 为什么用 headless

| 方式 | 问题/优势 |
|---|---|
| `dsh --profile tui/web` | 交互式界面，无法被编排器驱动、拿不到结构化事件 |
| **`dsh --profile headless --json "<task>"`** | 一次性任务、stdout 为 NDJSON 事件流（thinking/tool_call/tool_result/text/final/usage），可 `spawn` 驱动、可实时解析、可复现留证 |

本机实测（真实 DeepSeek Harness）：任务「创建 plan.md 并读取总结」→ 真实文件 `plan.md`(1238B)、thinking 可见、工具 glob/write/read、总 token ~27.7k、退出码 0。

⚠️ **Windows 关键点**：`spawn("dsh", …)` 会 ENOENT（`dsh` 是 `.cmd` shim）。必须用
`process.execPath` + dsh 的 `lib/bin.js` 绝对路径：

```ts
spawn(process.execPath, [dshBin, "--profile", "headless", "--json", prompt], { cwd: workspace, env, windowsHide: true });
```

dsh bin 定位顺序：构造参数 `dsh_bin` → 环境变量 `STEWARD_DSH_BIN` → `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/lib/bin.js`。

## 2. 文件结构

```
packages/steward-harness-runtime/
├── src/
│   ├── types.ts    # 契约（HarnessEvent/Artifact/RunInput/RunResult/RunnerOptions…）
│   ├── snapshot.ts # 工作区快照 diff、sha256、扩展名 kind 分类、>5MB 跳过
│   ├── runner.ts   # HarnessAgentRunner（spawn/NDJSON 解析/超时/abort/报告/环境白名单）
│   ├── pool.ts     # HarnessAgentPool（并发池，结果保序，异常兜底）
│   └── index.ts    # 唯一入口
└── README.md
```

## 3. API 摘要

```ts
import { HarnessAgentRunner, HarnessAgentPool } from "../../packages/steward-harness-runtime/src/index.js";

const runner = new HarnessAgentRunner({
  dsh_bin: join(process.env.APPDATA!, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), // 缺省自动定位
  profile: "headless",
  node_bin: process.execPath,
  timeout_ms: 300_000,
});
runner.isAvailable(); // dsh bin 是否存在（不存在时 run 返回 ok:false，不抛）
runner.describe();    // { available, dsh_bin, profile, node, hint? }

const result = await runner.run({
  role: "operator",                       // conductor/operator/harness/reviewer/…（报告/事件标注）
  task: "创建 plan.md 并读取总结",
  system_prompt: "你是代掌的编码执行代理：真实执行、留证、不越界。",
  workspace_dir: "/abs/path/.steward/runs/<session>/steps/3", // 已存在的隔离工作区
  profile: "headless",
  timeout_ms: 300_000,
  max_output_bytes: 65_536,
  env: { DSH_HOME: "..." },              // 额外非密钥变量（密钥类 key 会被过滤）
  on_event: (event) => { /* SSE / 终端流式：每解析一行调一次 */ },
  on_usage: (usage) => { /* 累计 token 写回账本/预算 */ },
  signal: abortController.signal,          // 支持中断
});

result.ok;            // 成功 = 退出码 0 且收到 final
result.error;         // 失败原因（超时/中断/退出码/stderr 尾部/不可用…）
result.session_id;    // harness session（可续聊/审计）
result.final_text;    // final 文本
result.thinking;      // 思考过程（数组，按序）
result.tool_calls;    // [{tool, input}]
result.usage;         // {input_tokens, output_tokens, cache_read_tokens, total_tokens}
result.artifacts;     // 新增/修改文件 [{path, rel_path, kind, size, sha256}]
result.report_path;   // <workspace>/report.md（自动生成，也计入 artifacts）
result.duration_ms; result.exit_code; result.stderr_tail; result.command;
```

并发池（每个 step 一个 run；默认并发 2）：

```ts
const pool = new HarnessAgentPool({ concurrency: 2 });
const results = await pool.runAll(inputs); // 顺序与 inputs 一致；单个失败不影响其他
```

## 4. 事件表（headless NDJSON → `HarnessEvent`）

每行一个 JSON；本执行器重新编号 `seq`（从 1 连续递增）+ `at` ISO 时间，并实时回调 `on_event`。

| dsh type | 说明 | data 关键字段 |
|---|---|---|
| `session` | 会话建立 | `sessionId, cwd` |
| `status` | 阶段/用量 | `phase: turn_start\|step_start\|step_end\|turn_end, turn, step, usage{inputTokens,outputTokens,cacheReadTokens,totalTokens}` |
| `thinking` | 思考过程 | `text`（按序进 `result.thinking[]`） |
| `tool_call` | 工具调用 | `callId, tool, input`（进 `result.tool_calls[]`） |
| `tool_result` | 工具结果 | `callId, status, result`（长输出按 `max_output_bytes` 截断 + `truncated:true`） |
| `text` | 增量文本 | `text` |
| `final` | 最终结论 | `text` → `result.final_text` |
| `usage` | 独立用量 | `usage`（可选；与 status.usage 一样汇总） |
| `error` | 错误/解析告警 | `message`；畸形行记 `parse_error:true` 不中断执行 |

`usage` 汇总规则：按 `(turn, step)` 取最后一次 status.usage 再求和（step_end 覆盖 step_start）；
`on_usage` 每次更新回调一次，`result.usage.total_tokens` 为最终值。
未知事件类型保留为 `error`（`unrecognized_type`），**不阻断执行**。

## 5. 产物与报告

- 运行前递归快照工作区；运行后再快照，diff 出**新增/内容修改**的文件为 `artifacts`
  （sha256 对比；未变文件不计；跳过 `node_modules`/`.git`/`.hg`/`.svn`、符号链接、>5MB 大文件）。
- `kind` 分类：`html` / `markdown` / `json` / `image` / `code` / `data` / `text` / `other`。
- 自动写 `<workspace>/report.md`：标题「`<role>` · Harness 报告」+ 生成时间/耗时/退出码/session_id
  + tokens + 工具调用统计 + 思考过程节选 + 最终结论 + 产物清单（相对路径/大小/kind/sha256 前 16）。
  **失败也会写报告**（保留现场）；`report.md` 本身列入 artifacts（kind=markdown）。
- 报告只记录任务/摘要/产物，不含密钥与环境变量。

## 6. 超时 / 中断 / 并发

- `timeout_ms`（默认 300s）：超时 → `kill(SIGTERM)`，500ms 未退再 `SIGKILL`；返回 `ok:false`，
  保留已收集 `events/thinking/tool_calls/artifacts`（并写报告）。
- `signal: AbortSignal`：UI/编排取消 → 同样终止子进程并 `ok:false`（error 说明中断）。
- 非 0 退出 / spawn 失败 / dsh 不可用 / 工作区缺失 / 无 final → `ok:false` + 可读 error（**不抛异常**）。
- `HarnessAgentPool`：worker 数 = min(concurrency, inputs.length)，结果数组保序；自定义 runner 抛错时兜底为 `ok:false`。

## 7. 安全边界

1. **不注入密钥**：子进程环境 = 系统必需变量白名单（PATH/SYSTEMROOT/TEMP/APPDATA/DSH_HOME…）+
   调用方 `env` 里的非密钥变量；key 名含 `KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL/AUTH/COOKIE/SESSION` 的一律过滤。
   错误/报告/结果只含 stderr 尾部，**不打印完整环境**。
2. **工作区隔离**：每个 step 一个独立 `workspace_dir`（由编排器创建），harness 只在该目录内执行；
   产物 diff 只针对该目录。
3. **不联网**：本包自身零网络；真实模型调用由 DeepSeek Harness（用户已配置的 provider/key）在子进程中完成。
4. **不可写仓库外**：不写工作区之外的路径（报告也写在工作区内）；不修改 `.git`。
5. **危险动作仍需编排层审批**：本执行器只负责「真实执行 + 留证」，系统动作白名单/二次确认/审批仍在
   `steward-orchestrator` + `steward-system` + `steward-runtime` 的审批策略层。

## 8. 与 orchestrator / RunManager / 控制台对接

### 8.1 每个 step 用真实 harness 执行（替换 `runLocalAction`）

```ts
// 编排器执行项目步骤时（packages/steward-orchestrator 的 step 执行处，v1.5-B 接线）
import { HarnessAgentRunner } from "../../packages/steward-harness-runtime/src/index.js";

const runner = new HarnessAgentRunner();
const workspace = join(session.evidence_dir, "steps", String(step.step));
mkdirSync(workspace, { recursive: true });

const harnessResult = await runner.run({
  role: step.agent_role,
  task: step.action_plan?.action?.description ?? step.summary,
  system_prompt: promptForRole(step.agent_role),          // 现有专业提示词（prompts/*）
  workspace_dir: workspace,
  on_event: (event) => publishHarnessEvent(session.id, step.step, event), // SSE/console 时间线
  on_usage: (usage) => orchestrator.reportTokens(session.id, usage.total_tokens),
  signal: abortController.signal,
});

if (!harnessResult.ok) {
  // 步骤失败：真实报错进证据/事件，交给 RunManager 的返工或阻塞逻辑（不是"模型输出回退"）
  return { ok: false, summary: harnessResult.error ?? "harness 执行失败", detail: JSON.stringify(harnessResult.stderr_tail) };
}
const evidenceRefs = harnessResult.artifacts.map((artifact) => artifact.rel_path);
return {
  ok: true,
  summary: harnessResult.final_text.slice(0, 500),
  detail: JSON.stringify({
    report: harnessResult.report_path,
    thinking: harnessResult.thinking,
    tools: harnessResult.tool_calls,
    usage: harnessResult.usage,
  }),
  evidence_refs: evidenceRefs, // AgentTurn.evidence_refs / 步骤证据
};
```

### 8.2 用 `runStep` 手动验证一个 agent（CLI/调试）

```ts
const runner = new HarnessAgentRunner();
const workspace = join(repoRoot, ".steward", "runs", "manual-step-1");
mkdirSync(workspace, { recursive: true });
const result = await runner.run({
  role: "harness",
  task: "在当前工作区创建 plan.md，写入三步计划，然后读回并总结",
  system_prompt: "你是编码执行代理：真实执行、写文件、最后用一段话总结。",
  workspace_dir: workspace,
  on_event: (event) => console.log(`[${event.type}]`, JSON.stringify(event.data).slice(0, 200)),
});
console.log(result.ok ? "成功" : "失败", result.error ?? "", result.artifacts.map((a) => a.rel_path));
```

### 8.3 控制台实时展示（SSE / 时间线）

`on_event` 每解析一行即回调，直接桥接 console 的 SSE（v1.4 `/api/chat/runs/:id/stream` 或独立通道）：

```ts
runner.run({
  ...input,
  on_event: (event) => {
    // 写入 run 事件流/广播：{seq, at, type, data}
    broadcast("harness.event", { run_id, step, ...event });
  },
  on_usage: (usage) => broadcast("token.updated", usage),
});
```

控制台可渲染：`thinking`（思考过程）、`tool_call/tool_result`（工具面板）、`final`（报告结论）、
`artifacts`（产物卡片：kind/size/sha256，可下载/预览）、`report_path`（打开完整报告）。

### 8.4 与 RunManager 审批/返工的关系

`HarnessAgentRunner` 是**执行层**：它不决定是否执行危险动作；编排层（RunManager 审批策略）决定
「自动执行还是暂停等人工」。harness `ok:false` 会作为步骤失败进入 RunManager 的返工（`rework_limit`）
或 blocked 流程，事件/产物/报告保留在证据目录。

## 9. 测试

```bash
npm run build
node --test tests/unit/harness-runtime.test.mjs   # 19 条，零网络/零真实模型
node --test "tests/unit/*.test.mjs"               # 全量
```

测试用「node 假 dsh 脚本」（与真实启动方式一致：`process.execPath` + 脚本路径 spawn）覆盖：
可用性/describe、成功解析（session/final/thinking/tool_calls/usage）、实时 on_event 顺序与 seq、
产物 diff（未变排除/修改识别/sha256/kind）、report.md 模板字段、tool_result 截断、非 0 退出、
超时（并验证子进程被终止）、AbortSignal、工作区缺失、环境变量安全（密钥过滤）、>5MB 跳过、
畸形 NDJSON 容错、on_usage 回调、profile/system_prompt 参数、并发池（真实 runner 保序 + 并发上限 +
异常兜底）。

## 10. 已知限制

- 依赖真实 dsh 的 headless NDJSON 事件格式（本机 v0.2.0-rc.2 实测）；dsh 升级若改事件字段，
  解析器对未知类型不中断（记录 error 事件），但 thinking/final 语义可能需要同步更新。
- `thinking`/`tool_result` 大输出会占用内存（tool_result 已按 `max_output_bytes` 截断；thinking 未截断，
  仅报告展示节选）。
- 不提供续聊/multi-turn（每次 run 一次性任务）；需要续聊时可用返回的 `session_id` 交给 dsh 的 resume 能力（本包未封装）。
- 并发上限是单进程内的；大量 step 时建议配合 `HarnessAgentPool` + 工作区隔离，避免同目录并发写冲突。
