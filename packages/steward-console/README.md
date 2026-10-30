# packages/steward-console · 本地 Web 控制台（v1.4 专业版）

> 状态：**v1.4 已实现**（发送即执行 + SSE 实时流；含 v1.2/v1.3 的对话/证据/变现+易支付/模型提示词/系统总控）。
> 零第三方依赖：Node 内置 `node:http` + 原生 HTML/CSS/JS；**只监听 127.0.0.1**；写操作需
> `X-Steward-Token`；无 CDN / 外链 / 外网字体。真实浏览器 E2E：`tests/e2e-console/run.mjs`
> （有头 Chrome，**31 步 / 338 检查 / 35 张证据截图**，输出 `measured_stop_ms` 与 `console_boot_ms`）。

## 1. 目录 / 文件

| 文件 | 说明 |
|---|---|
| `src/server.ts` | `createConsoleServer({provider, adminProvider?, chatProvider?, systemProvider?, host?, port?, token?, log?})`：页面/API 路由、token 校验、安全头、`close()` |
| `src/provider.ts` | 运营数据契约 `ConsoleDataProvider` + `createDemoConsoleProvider()`；v1.2 扩展 `recordIncome()`（确认到账写账本） |
| `src/admin.ts` | 管理契约 `ConsoleAdminProvider` + `createDemoAdminProvider()`（配置/智能体/后台/数据）；v1.3 增加 `supervisor` 角色与「超级总调度 / 项目总调度」标题 |
| `src/chat.ts` | **v1.2 契约 `ConsoleChatProvider`** + `createDemoChatProvider()`：对话/计划/新建项目/打断恢复/审批、run 与证据、agent 轮次、变现请求、模型与提示词设置；`MoneyMethod` 含 **epay** |
| `src/system.ts` | **v1.3 契约 `ConsoleSystemProvider`** + `createDemoSystemProvider()`：超级总调度对话、两层结构、受管程序/插件、日志、快捷命令、**危险动作二次确认**（风险+备份路径+确认 token）、**易支付**配置与跳转链接 |
| `src/runtime.ts` | **v1.4 契约 `ConsoleRuntimeProvider`** + `createDemoRuntimeProvider()`：发送即执行、确定性自动推进（150ms/事件）、SSE 事件日志（回放+订阅）、审批暂停/打断/恢复、run 详情与 agent 轮次 |
| `src/pages.ts` | 页面骨架（左侧固定导航 + 顶部状态栏）+ 总览/项目/账本/审批/月报/接管 |
| `src/pages-admin.ts` | 项目列表 / 配置中心 / 智能体中心 / 后台 / 数据管理（配置中心内嵌模型、提示词、易支付分组） |
| `src/pages-chat.ts` | 对话列表/会话详情、智能体对话记录、run 详情与证据、变现/易支付、模型与提示词分组 |
| `src/pages-system.ts` | 系统总控页（supervisor 对话/两层结构/程序/插件/模型/日志/危险弹窗/快捷命令）+ 易支付设置分组 |
| `src/assets.ts` / `assets-admin.ts` / `assets-chat.ts` / `assets-system.ts` | 内联 CSS/JS：基础运营页、专业版布局、对话/证据灯箱/变现、系统总控/易支付/危险确认交互 |
| `src/index.ts` | 公开入口（`export *`） |

## 2. 启动方式

CLI 由 Lead 在 `apps/cli/src/phase2.ts` 的 `cmdConsole()` 接入；**v1.2/v1.3 默认零配置可用**：

```ts
// 仅传 provider + adminProvider 时，chatProvider/systemProvider/runtimeProvider 自动启用内置演示实现（本地可交互）
const handle = await createConsoleServer({ provider, adminProvider, port: 4180 });

// 接真实引擎时显式传入适配器（推荐；见 §11）
const handle = await createConsoleServer({
  provider: domainConsoleProvider,     // 真实 domain 适配器
  adminProvider,                       // apps/cli/src/console-admin.ts 的 createConfigAdminProvider
  chatProvider,                        // OrchestratorEngine 适配器（见 §11.2）
  systemProvider,                      // SystemController + ConfigEngine 适配器（见 §11.3）
  runtimeProvider,                     // RunManager/Orchestrator runtime 适配器（见 §14.5，发送即执行+SSE）
  port: 4180,
});
```

- `host` 默认 `127.0.0.1`，只允许回环地址；`port` 默认 `4180`（0=随机，E2E 推荐）。
- 写操作 token 随机 32hex，页面通过 `<meta name="steward-token">` 同源注入。
- `chatProvider: null` / `systemProvider: null` / `runtimeProvider: null` 可显式关闭（对应页面/API 返回 503）。
- `/health` 返回 `version:"1.4.0"`、`chat_enabled`、`system_enabled`、`runtime_enabled`、`sse_active_streams`、`mode`、`halted`。

## 3. 布局与导航

左侧固定导航（v1.2/v1.3 新增 3 项）：
- **运营**：总览 / **对话** / 项目 / 账本 / 审批 / 月报 / 接管 / **变现**
- **管理**：**系统** / 智能体 / 后台 / 配置 / 数据

顶部状态栏：运行模式徽章、预算余量、Token 余量、接管状态、最近事件；保存/操作后自动刷新。
统一设计 token、空态/错误态、键盘焦点可见；1280×800 优先，1440 宽自适应。

## 4. 页面清单

| 路径 | 页面 | 要点 |
|---|---|---|
| `/` | 总览 | 项目卡、任务、预算条、代理状态、L0 摘要、halted 横幅 |
| `/chat` | **对话** | 会话列表 + 新建项目（目标/预算/Token 上限/模式）；点入会话看总调度对话与计划 |
| `/chat/:id` | **会话详情** | 用户与总调度气泡（每轮简略摘要）、计划卡（步骤/负责 agent/需审批标记）、审批卡、**打断/恢复/开始执行**、跳 run |
| `/agents` | 智能体中心 | 12 个智能体卡片（含 supervisor），展开详情，**每个 agent 可进对话记录** |
| `/agents/:role` | **智能体对话记录** | 每轮输入/输出摘要、Token、状态、证据引用；相关 run；supervisor/conductor 记录也可看 |
| `/runs/:id` | **run 详情** | 全流程时间线（计划→行动→观察→验证→留证）、**证据截图缩略图→点开大图（灯箱）**、report.md 渲染、日志/JSON 展开、各 agent 对话摘要 |
| `/money` | **变现 / 收款** | 「为什么收不到钱」说明（演示渠道未接真实支付、**此前 ¥10 只是测试金额**）、收款账户/渠道摘要、**易支付设置**、创建收款请求（金额/客户/用途/渠道）、收款链接/二维码占位、**人工确认到账 → 账本收入** |
| `/money/request/:id` | 收款页（演示） | 收款链接落地页：金额/客户/用途/渠道、二维码占位、demo 提示 |
| `/system` | **系统总控** | 与**超级总调度（supervisor）**对话、**两层结构**（supervisor → 项目总调度 → 专项智能体）、受管程序（运行/停止/重启/删除）、插件（启用/禁用/删除）、各 agent 当前模型/Token、系统日志、快捷命令、**危险动作二次确认弹窗** |
| `/settings` | 配置中心 | 三模式、功能开关、预算/Token、**支付与银行卡（含易支付）**、**模型与 API 密钥**、**系统提示词**、智能体开关（含 supervisor）、审批与接管、数据 |
| `/projects` `/project/:id` `/ledger` `/approvals` `/report` `/takeover` `/backend` `/data` | 既有页面 | 保持 v1.1 能力（账本 6 要素、接管 6 类包、后台时间线、数据清空二次确认等） |

## 5. 对话与项目（v1.2）

1. `/chat` 填「我要做什么 + 预算/Token 上限/模式」→ 创建项目 → **总调度生成计划**（4–6 步：确认目标 →
   执行/检索 → 写代码或产出草稿 → 核查 → 对外交付审批，企业模式再加合同/用印核对）。
2. 点「开始执行」→ 状态 `执行中` 并生成 run（可跳 `/runs/:id` 看证据）；
3. 中途「打断」→ `已打断（暂停）`，记录断点；「恢复执行」→ `执行中`，**不重复已完成动作**；
4. 关键步骤（对外交付）出现**审批卡**：批准 → 继续并完成；驳回 → 项目 `已阻塞`；
5. 会话页可继续输入消息（总调度基于约束回复，每轮有摘要）；
6. 每轮记录：`/agents/:role`（按角色汇总所有轮次）+ `/runs/:id`（按 run 汇总各 agent 摘要）。

> 演示 provider 为内存状态机；真实 Orchestrator 接入后由引擎生成计划/执行/证据。

## 6. 证据可见（v1.2）

`/runs/:id` 一页看全：
- **全流程时间线**：plan / action / observe / verify / evidence（+ error/takeover）；
- **证据**：截图缩略图（点击开灯箱看大图，内联 SVG 占位；真实运行由浏览器适配器写入真实 PNG）、
  `report.md` 服务端渲染（标题/列表/代码块/引用/粗体）、日志与 JSON 证据可展开查看；
- **各智能体对话摘要**：conductor/operator/harness/reviewer 等每轮输入→输出与 Token；
- 演示证据均为**内置占位图/示例日志**，不发起任何外网请求。

## 7. 变现与易支付（v1.2/v1.3）

**流程**：配置收款账户/渠道 → 创建收款请求 → 展示收款链接/二维码 → **人工确认到账** → 写入账本收入。

- 页面明确说明：**当前是演示资金渠道，未接真实支付**（微信/支付宝/对公需商户号与回调），
  收款码/链接只是占位、不会真实扣款；**此前 ¥10 只是测试金额**，金额可自定。
- **易支付（epay）**分组（`/money` 可编辑；`/settings` 支付分组同字段）：
  启用开关、模式 `demo|live`、网关地址、商户 ID、**密钥引用（`env:`/`keychain:`，只显示掩码）**、
  支付方式 `alipay/wxpay`、`notify_url`、`return_url`、保存校验（live 必填、密钥引用格式、网关 http(s)）。
- 创建请求时渠道可选 **易支付（epay）** → 生成**易支付跳转链接**（网关+pid+out_trade_no+money+notify/return）
  与二维码占位；demo 模式链接带 `__demo=1` 不真实扣款，live 需商户配置。
- 确认到账必须**人工点击**（演示 provider）；确认后通过 `ConsoleDataProvider.recordIncome()` 写入账本收入
  （金额/收付方/依据/审批人=人工确认/回执/所属项目 6 要素），`/ledger` 可见，并在 `/money` 显示 ledger_entry_id。
- 二维码/大图均为内联 `data:image/svg+xml`，**不产生外链请求**。

## 8. 系统总控（v1.3，`/system`）

- **超级总调度对话（supervisor）**：系统级命令与状态汇报，危险动作先说明影响与风险；
- **两层结构图**：L1 超级总调度（系统级）→ L2 项目总调度（conductor，每项目一个）→ L3 专项智能体 12 个（可点进对话记录）；
- **系统状态卡**：
  - 受管程序列表（运行/停止/重启 + 健康度 + pid/端口）——控制台自身禁止自停/自删；
  - 插件列表（启用/禁用/删除；money/epay 等核心插件禁止删除、只能禁用）；
  - 各 agent 当前 provider/模型/今日 Token/限额；
  - 全部日志（级别/来源/时间，最近 20 条 + API 最近 50 条）；
- **危险动作二次确认**（删除程序/插件）：
  1. 点「删除…」→ 服务端返回 `{risk, backup_path, confirm_token, expires_at}` → 弹窗展示；
  2. 必须**输入确认令牌**（5 分钟有效）+ 输入「确认删除」→ 才执行；错误 token/文本被拒绝且不执行；
  3. 执行后写系统日志（审计），备份路径已展示（真实引擎应先备份再删除）；
- **快捷命令示例**：查看系统状态 / 重启模型网关 / 停止 scout-worker / 启用易支付插件 /
  禁用找客户分支 / 切换 harness 模型 / 修改系统提示词 / 委派项目给项目总调度。

## 9. 模型与提示词（v1.2/v1.3，`/settings`）

- **多模型 provider**：DeepSeek（官方）/ OpenAI 兼容网关 / 本地模型（示例）；每行可编辑 base_url、模型、密钥引用、启用；
- **API 密钥**：只显示引用与掩码（`sk-****9f2a` / `epk-****4250`），**不存明文**；支持**一键同步密钥到所有功能**（providers + agents，写同步状态与时间）；
- **每个智能体的模型**：12 个角色（含 **supervisor**）逐一选择 provider + 模型，保存校验引用存在；
- **系统提示词**：supervisor / conductor / operator / harness / reviewer / scout / finance / customer / backend 可编辑；
  保存校验（≥30 字符；**总调度与 supervisor 提示词必须含安全条款「不绕过」**），保存递增版本号并写日志。

## 10. Provider 契约（v1.2/v1.3）

### `ConsoleChatProvider`（`src/chat.ts`）

| 方法 | 说明 |
|---|---|
| `listSessions / createSession / getSession / sendMessage` | 对话会话 |
| `startProject / interrupt / resume / decideApproval(sessionId, step, decision)` | 项目执行、打断、恢复、审批 |
| `listRuns / getRunDetail / getAgentTranscripts / listEvidence` | run、证据、每轮记录 |
| `listMoneyRequests / createMoneyRequest / confirmMoneyReceived` | 变现（确认到账回调写账本） |
| `getModelSettings / saveModelSettings / syncKeysToAll / savePrompts` | 模型/密钥/提示词（v1.2 设置页扩展） |

### `ConsoleSystemProvider`（`src/system.ts`）

| 方法 | 说明 |
|---|---|
| `supervisorMessages / sendSupervisorMessage` | 超级总调度对话 |
| `getSystemStatus` | 两层结构 + 程序 + 插件 + agent 模型 + 日志 |
| `programAction(id, start/stop/restart) / pluginAction(id, enabled)` | 程序/插件操作 |
| `getSystemLogs / runQuickCommand` | 日志、快捷命令 |
| `prepareDangerousAction / executeDangerousAction` | **危险动作**：风险+备份路径+确认 token；执行需 token + 「确认删除」 |
| `getEpayConfig / saveEpayConfig / buildEpayPayLink` | 易支付配置与收款链接 |

## 11. 接真实引擎建议（Lead 接线）

> 现有真实引擎：`packages/steward-orchestrator`（`OrchestratorEngine`）、`packages/steward-system`
> （`SystemController`）、`packages/steward-config`（`ConfigEngine`，已含 `payments.epay` /
> `ModelRoutingConfig` / `OrchestratorSettings` / supervisor agent）、`packages/steward-money`（`MoneyEngine`）。

### 11.1 适配器位置

建议在 `apps/cli/src/` 新增（控制台包保持零依赖）：
- `console-chat.ts`：`createOrchestratorChatProvider(engine, configEngine): ConsoleChatProvider`
- `console-system.ts`：`createSystemProvider(controller, configEngine, moneyEngine): ConsoleSystemProvider`
- 在 `phase2.ts cmdConsole()` 创建 engine/controller 后传入 `{ chatProvider, systemProvider }`。

### 11.2 Chat 映射（OrchestratorEngine → ConsoleChatProvider）

| Console | OrchestratorEngine |
|---|---|
| `listSessions / getSession / createSession / sendMessage` | 同名方法（`OrchestratorSession` → 映射 `messages/plan/status/budget/token`） |
| `startProject / interrupt / resume / decideApproval` | 同名方法（`decideApproval(sessionId, step, "approve"|"reject")`） |
| `getRunDetail / getAgentTranscripts / listEvidence` | 同名方法（`getRunDetail(sessionId)` 的 `events/evidence/report_md/agents` 直接映射；截图真实路径 → 控制台 `data:` 占位仅演示） |
| `listRuns` | `listSessions().map(s => getRunDetail(s.id))` 摘要 |
| 变现 | `MoneyEngine.createRequest` / `confirmReceived`（真实写 ledger）→ 映射 `MoneyRequest`；确认到账后 `ledger_entry_id` 用真实账本 id |
| 模型/密钥/提示词 | `ConfigEngine`：`ModelRoutingConfig` ↔ `ModelSettings`（`providers[].default_model/models` ↔ 控制台 `model`；`agent_models` ↔ `agent_bindings`）；`OrchestratorSettings.system_prompts/conductor_prompt` ↔ 控制台 `prompts`；`syncApiKey` ↔ `syncKeysToAll` |

### 11.3 System 映射（SystemController + ConfigEngine → ConsoleSystemProvider）

| Console | 真实引擎 |
|---|---|
| `getSystemStatus` | `controller.listApps()` ↔ programs；`listPlugins()` ↔ plugins；`systemInfo()` + `auditTrail()` ↔ logs；agent 模型取 `configEngine.modelRouting()` + session 用量 |
| `programAction / pluginAction` | `controller.plan({action,...})` → 低风险直接 `controller.execute()`；启动/停止/启用/禁用 |
| `prepareDangerousAction` | `controller.plan({action:"remove_app"/"remove_plugin"})` → `ConfirmationRequiredError` 信息或 `plan.requires_confirmation` ↔ `{risk, backup_path, confirm_token}`；备份路径取 `controller` 回收站路径 |
| `executeDangerousAction` | `controller.execute({confirm_token, confirm_text})`（引擎强制确认令牌 + 「确认删除」）→ 成功后审计 |
| `getEpayConfig / saveEpayConfig` | `ConfigEngine` 的 `payments.epay`（字段：`enabled/gateway_url/pid/key_ref/pay_types/notify_url/return_url/mode/sign_type`）↔ 控制台 `EpayConfig`（`merchant_id↔pid`、`key_ref↔api_key_ref`、`pay_types↔methods`）；密钥只引用 |
| `buildEpayPayLink` | 用 `payments.epay` 拼 `gateway_url?pid&type&out_trade_no&money&name&notify_url&return_url`；QR 用实际网关二维码（演示用内联 SVG） |

### 11.4 一键同步 / 危险动作 / 审计

- `syncKeysToAll` → `configEngine.syncApiKey()`（`single_key_all`/`per_provider`），返回 affected providers；控制台只展示掩码；
- 危险动作必须**服务端强制**：确认 token 校验 + 确认文本校验 + 过期时间 + 审计日志（控制台演示已实现同样语义，真实引擎以此为准）；
- 配置/危险动作/模型同步都应写 `EventLog`（哈希链）与配置审计。

## 12. HTTP API（v1.2/v1.3 新增；写操作需 `X-Steward-Token`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/chat/sessions` | 会话列表 / 新建项目 `{goal,budget_cny,token_limit,mode}` |
| GET | `/api/chat/sessions/:id` | 会话详情 |
| POST | `/api/chat/sessions/:id/messages` | 发送消息 `{text}` |
| POST | `/api/chat/sessions/:id/start` · `/interrupt` · `/resume` | 开始 / 打断 / 恢复 |
| POST | `/api/chat/sessions/:id/approvals` | `{step, decision:"approve"|"reject"}` |
| GET | `/api/chat/runs` · `/api/chat/runs/:id` | run 列表 / 详情（时间线/证据/report/agent 摘要） |
| GET | `/api/chat/agents/:role/transcripts` | 智能体轮次记录 |
| GET | `/api/chat/evidence?run_id=` | 证据列表 |
| GET/POST | `/api/money/requests` | 收款请求列表 / 创建 `{amount_cny,client,purpose,payment_method}`（含 `epay`） |
| POST | `/api/money/requests/:id/confirm` | 人工确认到账 `{by}` → 写账本收入 |
| GET/PUT | `/api/model-settings` | 模型 provider/绑定 |
| POST | `/api/model-settings/sync` | 一键同步密钥 |
| GET/PUT | `/api/prompts` | 系统提示词 |
| GET | `/api/system/status` | 系统总控状态（程序/插件/agent 模型/日志） |
| GET/POST | `/api/system/supervisor/messages` | supervisor 对话 |
| POST | `/api/system/programs/:id/action` | `{action:"start"|"stop"|"restart"}` |
| POST | `/api/system/plugins/:id/action` | `{enabled:boolean}` |
| GET | `/api/system/logs?limit=` | 系统日志 |
| POST | `/api/system/command` | 快捷命令 `{command}` |
| POST | `/api/system/danger/prepare` | 危险动作**第一步**：`{action,target_id}` → `{risk,backup_path,confirm_token,expires_at}` |
| POST | `/api/system/danger/execute` | 危险动作**第二步**：`{action,target_id,confirm_token,confirm_text}` |
| GET/PUT | `/api/system/epay` | 易支付配置（密钥只引用/掩码） |

错误码：401 未授权、400 校验失败（含 `data.errors`）、404、405、409、503（provider 未启用）。

## 13. 安全边界

- 只监听回环地址；写操作 token 同源注入、不进 URL/日志/证据文件；
- 无 CORS、CSP `script-src 'self'`、`img-src 'self' data:`、`frame-ancestors 'none'`；无 CDN/外链；
- **危险动作**：风险 + 备份路径 + 5 分钟确认 token + 手动输入「确认删除」；禁删控制台自身、禁删 money/epay 核心插件；执行写审计日志；
- **密钥**：只存引用（env:/keychain:）与掩码，不存明文、不回显；epay 同样只存 `key_ref`；
- **AI 不代签**：支付配置 `ai_may_sign` 固定 false；
- **资金**：演示渠道不真实扣款；live 需商户配置与真实回调，确认到账仍人工。

## 14. 发送即执行 + SSE 实时流（v1.4）

**用户痛点**：发消息后不实时处理、还要手动点执行、看不到过程。v1.4 起 `/chat` **发送即执行**，页面通过 SSE 实时显示全程。

### 14.1 流程（无手动按钮）

1. `/chat` 输入目标（可设预算/Token 上限/模式）→ 点「发送并自动执行」/回车；
2. 服务端 `POST /api/chat/runs` **立即创建 session + run 并自动开始执行**（返回 `{session, run}`）；
3. 浏览器跳转 `/chat/:sessionId` 并打开 `EventSource('/api/chat/runs/:runId/stream?since=0')`；
4. 实时显示：**总调度思考中 → 计划生成（逐步点亮）→ 每步开始/完成 → 每个 agent 每轮输入/输出摘要+Token → 审批卡（高风险/危险动作立即暂停）→ 完成/失败**；
5. 完成卡给出 `/runs/:id` 证据链接；中断/恢复按钮与审批按钮都在实时面板内；
6. **刷新页面恢复**：页面加载时先取 `GET /api/chat/runs/:id` 快照，再以 `since=0` 回放事件并继续实时；`EventSource` 重连带 `Last-Event-ID` 续传（按 `seq` 去重），不会重复渲染；
7. 「开始执行」按钮已移除（`#chat-start` 不存在；历史 v1.2 会话标注为只读记录）。

### 14.2 SSE 事件表（`ConsoleRuntimeEvent`）

| 事件 `type` | 含义 | 关键 data |
|---|---|---|
| `run.created` | 发送即执行：run 已创建排队 | goal/mode/steps_total/budget_cny/token_limit |
| `conductor.thinking` | 总调度思考中 | summary |
| `plan.created` | 计划生成 | steps[]（step/agent_role/agent_title/action/summary/requires_approval） |
| `run.started` | 开始执行 | mode |
| `step.started` / `step.completed` | 步骤开始/完成 | step/agent_role/agent_title/action/status |
| `agent.turn.started` / `agent.turn.completed` | 每 agent 每轮输入/输出摘要 | step/agent_role/input_summary/output_summary/tokens/model_mode |
| `approval.required` | 高风险步骤暂停，等待人工审批 | step/summary/risk/action |
| `approval.approved` / `approval.rejected` | 审批通过/驳回 | step/summary |
| `run.interrupted` / `run.resumed` | 打断 / 恢复 | reason/current_step |
| `run.completed` | 完成 | steps_total/steps_done/token_used/evidence_count |
| `run.failed` | 失败/阻塞 | error/step |

### 14.3 API（v1.4 新增；写操作需 `X-Steward-Token`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/chat/runs` | **发送即执行**：`{goal,budget_cny?,token_limit?,mode?}` → `{session, run}` |
| GET | `/api/chat/runs` | run 列表（历史 chatProvider run + 实时 run 合并；含 status/steps/token） |
| GET | `/api/chat/runs/:id` | run 记录（实时 run；旧 chat run 详情兼容） |
| POST | `/api/chat/runs/:id/approvals` | `{step, decision:"approve"|"reject"}` |
| POST | `/api/chat/runs/:id/interrupt` · `/resume` | 打断 / 恢复 |
| GET | `/api/chat/runs/:id/stream?since=<seq>` | **SSE**：`text/event-stream`；`id: <seq>` + `data: <json>`；15s 心跳注释；只读、**无需 token**；支持 `Last-Event-ID` 续传；客户端断开即清理订阅（`/health.sse_active_streams` 可观测） |

### 14.4 `ConsoleRuntimeProvider` 契约（`src/runtime.ts`）

| 方法 | 说明 |
|---|---|
| `createAndStart({goal,budget_cny?,token_limit?,mode?})` | 创建 session+run 并自动开始（发送即执行） |
| `listRuns / getRun` | run 列表 / 记录（status/steps/token/current_step/pending_approval） |
| `approve(runId, step, decision)` / `interrupt` / `resume` | 审批 / 打断 / 恢复（均返回最新 `ConsoleRunRecord`） |
| `subscribeRun(runId, sinceSeq, onEvent)` | 先回放 since 之后事件再实时订阅；返回取消函数（SSE 断开时调用） |
| `eventLog(runId, sinceSeq?)` | 事件日志回放（断线恢复/审计） |
| （页面扩展）`getSession / listSessions / getRunDetail / getAgentTranscripts` | 实时会话页、run 证据页、智能体记录合并展示 |

演示实现 `createDemoRuntimeProvider()`：内存、**确定性**（每 150ms 一个事件，5 步计划约 2.5s 完成）、高风险目标（付款/对外/发布/删除/签约等关键词）自动在最后一步暂停等待审批；不依赖模型/网络，E2E 稳定。

### 14.5 接真实 RunManager / Orchestrator 映射

| ConsoleRuntimeProvider | 真实引擎（`packages/steward-orchestrator` 等） |
|---|---|
| `createAndStart` | `OrchestratorEngine.createSession()` + `startProject()`（或 RunManager.createRun+start），随后返回 session/run |
| `subscribeRun(runId, sinceSeq, onEvent)` | 订阅 runtime 的步骤事件流/事件文件（EventLog/run 目录），先回放 since 之后的事件再 live；无推送能力时适配器内用轮询事件日志+定时回调模拟（对 SSE handler 透明） |
| `eventLog` | `OrchestratorEngine.readLogs()` / run 目录 `events.jsonl` |
| `approve / interrupt / resume` | `OrchestratorEngine.decideApproval / interrupt / resume` 一一对应 |
| `getRun / listRuns` | `OrchestratorEngine.getRunDetail(sessionId)` / `listSessions()` 映射 `ConsoleRunRecord` |
| `getSession/getRunDetail/getAgentTranscripts` | `OrchestratorEngine.getSession/getRunDetail/getAgentTranscripts`（真实证据路径替换演示 SVG） |

适配器放 `apps/cli/src/`（如 `console-runtime.ts`：`createOrchestratorRuntimeProvider(engine): ConsoleRuntimeProvider`），`cmdConsole()` 传入 `runtimeProvider` 即可；SSE/页面/E2E 全部复用。
## 15. 真实浏览器验收

```bash
npm run build
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v13
```

实测（有头 Chrome 156，2026-10-30）：**31/31 步、338/338 检查、35 张证据截图**、
`measured_stop_ms=79`、`console_boot_ms=20`、`first_page_load_ms=410`、耗时 **31.9s**、退出码 0。
详见 [`tests/e2e-console/README.md`](../../tests/e2e-console/README.md)。

## 16. 已知限制

- 演示 `chatProvider`/`systemProvider` 为**内存状态**（会话、程序/插件、epay 配置、危险动作只在本进程有效，
  重启回到默认）；真实 Orchestrator/SystemController/ConfigEngine/MoneyEngine 接入后持久化到 `.steward/`。
- 演示执行是**状态机模拟**（无真实浏览器/编码回路）；证据为内置占位图与示例日志；真实接入由 run 目录提供真实截图/报告。
- 演示 epay **不发起真实支付请求**（不发外网请求）；live 模式仅为配置校验 + 链接拼接，真实扣款需商户回调。
- 功能开关/预算/Token 的**执行侧拒绝**由真实引擎提供（`checkFeature/checkBudget/TokenBudget.consume`）；控制台只保存与展示。
- 单用户、无登录鉴权、无 HTTPS（本地单机假设）；深色内容区未做，目标分辨率 1280×800 起。
- **v1.4 演示 runtime 为内存状态机**：run/事件在进程内，重启丢失；真实 RunManager 接入后事件应持久化（`events.jsonl`）并支持跨进程回放。
- **SSE 为单进程内存广播**：多实例部署需换成 Redis/消息队列/反向代理广播（当前本地单机不涉及）；`/runs/:id` 页面为快照视图，实时流在 `/chat/:id`（可选用 SSE 增强）。
- 演示 runtime 的高风险判定基于目标关键词（付款/对外/发布/删除/签约等），真实引擎应由风险策略/ActionPolicy 决定并强制审批。
