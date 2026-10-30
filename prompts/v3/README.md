<!-- prompt-set: prompts/v3 | version: 3.0.0 | updated: 2026-10-30 -->

# prompts/v3 — 真实 Harness 代理提示词（11 个 agent）

> 状态：**v1.5-D 交付**（11 篇角色提示词 + 本 README）。v3 面向真实 DeepSeek Harness 执行：
> 每个 agent 都是真实代理，必须调用工具、把产物落盘、写 `report.md`、给出可核对证据与数据。
> 这些文本作为 harness agent 的 **system directive**，由 `composeHarnessPrompt(role)` 组合注入。

## 1. v3 定位

- 与 v2 的「角色人格 + 权限边界」不同，v3 是**执行型提示词**：固定工作循环（写计划 → 调工具执行 → 观察 → 验证 → 写报告 → 产物清单）+ 工具使用策略 + 角色专属产物 + 报告规范。
- 真实执行：`HarnessAgentRunner` 用 `dsh --profile headless --json` 在隔离工作区跑真实代理，stdout 输出 NDJSON 事件（`thinking` / `tool_call` / `tool_result` / `status` / `final` / `usage`），运行器解析后把思考、工具调用、Token、产物、报告展示给用户。
- 没有执行的动作不得声称完成；没有证据的「成功」视为未完成。产物 = 工作区真实新增/修改文件（html / md / json / code / data / image 等），运行器计算大小与 sha256 并生成 artifacts 清单。
- 工作区：`workspace/<role>/`（相对 run 目录），每个 step 一个隔离工作区；`report.md` 由 agent 产出、运行器补充元数据（时间 / 耗时 / Token / 工具统计 / 产物清单）。

## 2. 与 v2 的差异

| 维度 | v2（角色系统提示词） | v3（真实 Harness 代理提示词） |
|---|---|---|
| 目标 | 角色定位、权限边界、两层协作、危险动作确认 | 真实执行：工具调用、产物落盘、report.md、证据与数据核对 |
| 流程 | 设置目标 → 计划 → 执行 → 观察 → 验证 → 留证 → 报告 | 写计划 → 调工具执行 → 观察工具结果 → 验证（读回 / 跑测试）→ 写报告 → 产物清单 |
| 工具 | 抽象工具心智模型 | 明确工具白名单与使用策略（read / write / edit / bash / glob / grep / browser / web_search / web_fetch） |
| 输出四段 | 做了什么 / 证据在哪 / 是否通过 / 下一步 | 做了什么 / **产物与证据（路径+大小）** / 是否通过（数据核对） / 下一步 |
| 产物 | 证据路径（抽象） | 角色专属产物清单（如 operator=HTML/文档，harness=补丁/测试，reviewer=核查报告） |
| 报告 | 无强制文件 | 必须写 `report.md`，含关键数据（字节 / 行数 / 通过数 / token） |

v2 仍保留在 `prompts/v2/` 作为配置中心角色人格默认值；v3 用于真实 Harness 执行阶段（可覆盖或经 `composeHarnessPrompt` 附加）。

## 3. 角色 · 工具 · 必产物对照

| role | 标题 | 主要工具（v1.5-C 注册表） | 必产物 |
|---|---|---|---|
| `supervisor` | 超级总调度 | 系统动作层（默认不走 Harness 执行） | 系统操作回执 / 审计摘要 / 委派记录 / 状态报告 |
| `conductor` | 项目总调度 | read / glob / grep（只读） | 项目计划 / 验收汇总 / 委派记录 / report.md |
| `operator` | 执行（浏览器 / 桌面） | read / write / edit / bash / browser | deliverable.html（自包含）/ 截图 / 验收清单 / report.md |
| `harness` | 写代码 Harness | read / write / edit / bash | 代码 / patch.diff / test.log / quality-report / report.md |
| `customer` | 客户对接 | read / write | message-drafts.md / customer-brief.md（不发送） |
| `finance` | 财务记账 | read / write | 账本条目（6 要素）/ 收款请求草稿 / 财务报告 / report.md |
| `reviewer` | 核查复核 | read / glob / grep（只读） | 独立核查报告 / 不通过项清单（不写业务文件） |
| `backend` | 后台值守 | read / write / bash | data-stats.json / events-digest.md / backup-manifest / report.md |
| `scout` | 找客户 | web_search / web_fetch / write | lead-report.md / leads.json / 外联草稿（不发送） |
| `content` | 内容创作 | read / write | draft.md / risk-notes.md / assets-list.json（不发布） |
| `research` | 调研检索 | web_search / web_fetch / write | research-report.md / sources.json（来源+访问时间+置信度） |

## 4. 如何接入（ConfigEngine / Harness 运行器）

1. **组合提示词**：`composeHarnessPrompt(role)` = 本目录对应 `<role>.md` 全文（v3 system directive）+ `HARNESS_AGENT_DIRECTIVE`（统一执行指令）+ 角色专属产物要求（可与本目录第四节一致，避免冲突）。
2. **配置中心**：`HarnessSettings { enabled, profile, dsh_bin, timeout_ms, max_concurrency, artifact_retention_days, report_required, roles[] }`；`HarnessRoleSettings { role, enabled, workspace, timeout_ms, max_tokens_per_run }`；supervisor 默认 `enabled=false`（只走系统动作层），其余 10 个角色默认 `enabled=true`。
3. **提示词来源**：由 Lead 决定接入方式——(A) 把 v3 文本写入该角色 `system_prompts[role].system_prompt`（配置中心可编辑、写审计）；(B) 由 `composeHarnessPrompt` 读取本目录文本组合。两种方式都保留 `role/title/system_prompt/updated_at` 字段，`updated_at` 用 2026-10-30。
4. **运行器契约**：`HarnessAgentRunner.run({ role, task, system_prompt, workspace_dir, timeout_ms, max_tokens })` → 返回 `final_text / thinking / tool_calls / usage / artifacts / report_path`；超时 / 失败返回 `ok:false` 并保留已收集事件，不抛异常。
5. **可见性**：思考（thinking）、工具调用（tool_call/tool_result）、产物（artifacts）、报告（report.md）、Token / 耗时通过事件流与控制台 `/runs/:id` 展示；demo 数据也按同一契约生成。

## 5. 自检结果（交付时执行）

- 11/11 篇 PASS：文件头 `<!-- prompt: <role> | version: 3.0.0 | updated: 2026-10-30 -->`；行数 50–120；含固定循环（计划 / 工具 / 观察 / 验证 / 报告 / 产物清单）、`report.md` 规范、角色专属产物、四段输出（做了什么 / 产物与证据 / 是否通过 / 下一步）、危险动作对象、共同安全条款。
- 角色专属关键词（产物 / 工具 / 报告字段）逐篇校验通过；无本机绝对路径、无密钥 / 真实账号、无 `{{占位符}}`。
- 复跑方式：对 `prompts/v3/*.md` 执行关键词与行数检查脚本（Lead 可并入 `npm run test:prompts`（如新增 v3 测试））。

## 6. 维护规则

- 修改任一提示词：升版本（`<role>@3.x.y`）、更新文件头日期、重跑自检与 Harness 冒烟（真实跑一次 `dsh --profile headless --json` 并核对产物 / report.md）。
- v3 文件本身不含密钥、账号、客户信息；运行时密钥由本机 DSH 凭据 / 环境变量提供，不注入提示词。
- 与 v2 并存：v2 管「角色人格与权限」，v3 管「真实执行与产物验收」；冲突时以更严格的安全条款为准。

## 7. 双语要点 / Bilingual key points

- Every agent is a **real agent**, not a chatbot: it must call tools, write artifacts to its workspace, produce `report.md`, and show evidence + data.
- Fixed loop: **plan → call tools → observe results → verify (read back / run tests) → write report → list artifacts**.
- No claim without execution; a "success" without evidence counts as unfinished.
- Role-specific artifacts: operator = self-contained HTML/docs; harness = code/patch/tests/quality report; reviewer = independent review report; finance = ledger entries/collection drafts; backend = data stats/backups; scout = lead report; content = drafts + risk notes; research = report with sources/access time/confidence; customer = drafts only; conductor = plan/acceptance summary.
- Safety: never bypass CAPTCHA/2FA/face/risk control; never leak secrets; dangerous actions need human confirmation `{action, risk, requires_confirmation, reason}`; at most two repair rounds then escalate; stay inside the workspace.
