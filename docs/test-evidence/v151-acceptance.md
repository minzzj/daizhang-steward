# v1.5.1 验收记录 / Acceptance — Harness Agents + 对话式总控

- 日期：2026-10-30 · 版本：v1.5.1（基线 v1.4.0）
- 按要求：**控制台测试不保存截图**，证据为 result.json、真实 run 目录、会话 JSON 与单元测试输出。

## 1. 单元测试
- `node --test "tests/unit/*.test.mjs"` → **404/404 通过**（原 339 + Harness 19 + config 16 + chat 19 + harness-data 9 + 其他）。
- `npm run build` → exit 0；`npm run check` → OK；`npm run check:secrets` → OK。

## 2. 真实 DeepSeek Harness 执行（真实数据）
- 真实 4 步 run：`sess-20261030151527-0020`，全部由 Harness 代理执行（write/read/pwsh/glob 真实工具）。
- 结果：done，4/4 步，**Token 926,392**；每步 thinking/tool/产物/report.md/summary；metrics.json 可用。
- 证据目录：`docs/test-evidence/evidence-v15-harness-real/`（事件、产物 note.md/report.md/verify.log、4 份报告、metrics；已脱敏）。

## 3. 控制台 ChatGPT 式对话（真实数据 + 假数据混合）
- 小 E2E（demo provider + fake 数据）：**8/8 步、35/35 检查、8.1s、截图 0、退出码 0**（`chat-e2e/result.json`）。
- 全量回归 E2E（有头 Chrome）：**38/38 步、413/413 检查、31.6s、截图 0、退出码 0**（`console-e2e/result.json`）。
- 真实控制台验证（人工/浏览器）：
  - `/chat` 输入「系统现在怎么样」→ 工具卡 + 文本 + 数据卡（真实系统状态）。
  - 「把最新报告给我看」→ 4 张真实 reviewer/operator 报告卡（Markdown 渲染）。
  - 「帮我查一下产物并汇总」→ 9 张真实产物卡（来自真实 run）。
  - 「删除受管程序 demo-app」→ 只返回审批卡，未执行。
  - 记忆：13 条长期记忆（产物/报告），页面可查/删。
- 样本会话：`chat-conversation-sample.json`（真实数据，已脱敏）。

## 4. 结论
- 用户要求：对话式（像 ChatGPT）、AI 自己查系统/自己干、人类只管审批签字、产物/报告/数据/思考可见、有记忆、真实数据接入、无截图、发布仓库 —— 均已实现并通过测试。
- 已知限制：意图规则 18 类；记忆为关键词召回；本机单机模式。