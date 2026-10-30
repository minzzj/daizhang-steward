# v1.5 Harness Agents 真实验收 / Real Harness Acceptance

- 日期：2026-10-30
- 模型：真实 DeepSeek Harness（`dsh --profile headless --json`，用户本机 DSH 凭据，执行器不注入密钥）
- 未截图（按要求），证据为真实 run 目录、事件、产物、报告、metrics 与 E2E result.json。

## 1. 真实运行：4 步全部由 Harness 代理执行
- 会话：`sess-20261030151527-0020`（见 `runs/`、`sessions-*.json`）
- 目标：创建工作区 note.md（# hello）→ read 读回确认 → 写 report.md 总结 → reviewer 核查
- 结果：**done**；步骤 4/4；总 Token **926,392**
- 每步都有：thinking 事件、工具调用（write/read/pwsh/glob）、产物、`step-N-report.md`、`step-N-summary.json`
- 产物示例：`runs/<sid>/artifacts/step-1-operator/note.md`（7B）、`report.md`、`verify.log`；reviewer 报告 7,807B
- 证据：`runs/<sid>/harness/step-*-events.jsonl`、`step-*-artifacts.json`、`step-*-report.md`、`metrics.json`

## 2. CLI 实时过程（无网络外发）
- `steward runtime --goal "..."` 实时打印 `[harness:thinking]` / `[harness:tool]` / `[harness:tool-result]` / `[harness:final]` / `[harness:report]`
- 完成后输出产物清单与报告列表（见本次运行输出）

## 3. 控制台 v1.5 E2E（仅 result.json，无截图）
- `console-e2e/result.json`：38/38 步、407/407 检查、退出码 0（有头 Chrome）
- 覆盖：run Tabs（过程/产物/数据/报告）、实时 thinking/tool、产物中心/报告中心、agents Harness 徽章

## 4. 说明
- 真实 Harness 成本较高（本次小任务约 92.6 万 tokens）；后续对话式总控默认「查询类 0 token、任务类才走 Harness」。
- 数据为本地真实运行记录；提交前已脱敏（不含密钥、无本机敏感路径）。