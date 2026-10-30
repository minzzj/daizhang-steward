# DeepSeek Harness 真实智能体（v1.5）

> v1.5 起，每个专项智能体不再只是"本地模板动作"，而是**真实的 DeepSeek Harness 代理**：会思考（thinking）、调用工具（read/write/edit/bash/pwsh/browser/web_search…）、产出真实文件（产物）、写报告（report.md），全程可在控制台看到。

## 1. 为什么用 DeepSeek Harness

- 真实执行：读写文件、跑命令、写代码、验证结果，而不是生成占位文本。
- 可见过程：thinking / tool_call / tool_result / text / final / usage 逐事件流式返回。
- 产物可核对：每个文件带路径、类型、大小、sha256；报告含数据与证据。
- 成本可控：同一入口（`dsh --profile headless --json`），每次任务有超时/token 上限。

## 2. 每个智能体都有 Harness 元数据

| 角色 | 工具（示例） | 典型产物 |
|---|---|---|
| conductor | read/glob/grep（只读） | 项目计划、验收汇总 |
| operator | read/write/edit/bash/browser | HTML/文档/截图 |
| harness | read/write/edit/bash/test | 代码/补丁/测试/质量报告 |
| reviewer | read/glob/grep | 独立核查报告 |
| finance | read/write | 账本/收款草稿/财务报告 |
| backend | read/write/bash | 数据报告/事件/备份清单 |
| scout | web_search/web_fetch/write | 线索报告 |
| content | read/write | 内容草稿 |
| research | web_search/web_fetch/write | 调研报告 |
| customer | read/write | 客户沟通草稿 |
| supervisor | （系统动作层，默认不走 Harness） | 系统动作/审计记录 |

## 3. 配置（控制台 /settings 或配置中心 `harness`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 总开关；无 dsh 时自动回退旧本地动作 |
| `profile` | `headless` | dsh profile |
| `dsh_bin` | 空（自动探测 `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/lib/bin.js`） | 也可用 `STEWARD_DSH_BIN` |
| `timeout_ms` | 300000 | 单次任务超时 |
| `max_concurrency` | 2 | 并发池 |
| `artifact_retention_days` | 30 | 产物保留 |
| `report_required` | true | 必须产出 report.md |
| `roles[]` | 11 角色 | 每角色 enabled/workspace/timeout/max_tokens_per_run；supervisor 固定关闭 |

## 4. 数据与证据目录

每个 run 的 `runs/<sessionId>/`：
- `harness/step-<n>-events.jsonl`：thinking/tool/text/final/usage 原始事件（实时显示用）
- `harness/step-<n>-artifacts.json`：产物清单（rel_path/kind/size/sha256）
- `harness/step-<n>-report.md`：该 agent 报告
- `harness/step-<n>-summary.json`：思考/工具/用量/最终结论/产物
- `harness/metrics.json`：Token 输入/输出/缓存/总计、步骤、工具调用分布、耗时、事件数
- `artifacts/step-<n>-<role>/…`：复制出的真实产物文件

## 5. 安全边界

- 工作区隔离（每个步骤独立 workspace），产物复制回 run 目录；
- 不注入/不转发 API 密钥（Harness 使用本机 DSH 自己的凭据）；
- 危险动作（删除程序/插件、付款、对外发送）不自动执行，需人工审批/签署；
- Token/超时超限会终止并保留已完成证据；
- 失败自动回退旧本地动作（不假装成功）。

## 6. 成本参考

实测一个小任务（创建 note.md + 读回 + 报告，4 个步骤）= 约 92.6 万 tokens。建议：小目标、少步骤；控制台/CLI 均显示每步 Token 与实际用量。单步上限默认 200 万 tokens（可配）。
