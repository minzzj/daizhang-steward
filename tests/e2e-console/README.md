# tests/e2e-console · 本地 Web 控制台真实浏览器 E2E（v1.4 专业版）

> 状态：**已落地并真实跑通**（有头 Chrome 156，**31/31 步、338/338 检查、35 张证据截图**，
> `measured_stop_ms=79`、`console_boot_ms=20`、耗时约 31.9s）。
> 被测对象是 `packages/steward-console` 的真实 HTTP 服务（进程内启动、随机端口）：
> `provider = createDemoConsoleProvider()` + `adminProvider = createDemoAdminProvider()` +
> v1.2/v1.3/v1.4 自动启用的 `createDemoChatProvider()` + `createDemoSystemProvider()` + `createDemoRuntimeProvider()`（发送即执行 + SSE）。
> **真实点击/输入/等待 + 每步截图**；不使用 mock 路由/假 DOM。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `run.mjs` | 主入口：启动控制台 → 真实有头浏览器完成 31 步验收 → 输出 `result.json` + 截图 |
| `README.md` | 本文档 |

## 2. 前置与运行

```bash
# 1) 先构建（run.mjs 读取 dist/packages/steward-console/src/index.js）
npm run build

# 2) 有头真实浏览器（产品验收必须；默认 0=有头）
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v14

# 3) 其它用法
node tests/e2e-console/run.mjs --headless 1              # 无头（仅开发/CI 自测）
node tests/e2e-console/run.mjs --port 4180               # 固定端口（默认 0=随机，避免冲突）
node tests/e2e-console/run.mjs --console-dist <index.js> # 调试其它构建产物
```

参数：`--evidence-dir <目录>`、`--headless 0|1`（默认 0）、`--port <端口>`（默认 0=随机）、
`--console-dist <路径>`、`-h/--help`。退出码：**0 全部通过 / 1 验收失败 / 2 用法或环境错误**。
运行结束会关闭控制台并断言端口已释放（不残留进程/端口）。

## 3. 验收流程（31 步，每步截图）

### 原有 15 步（P1-C + v1.1，回归不破坏）

| # | 步骤 | 断言要点 |
|---|---|---|
| 1–9 | `open-console` → `dashboard-load` → `project-timeline` → `ledger-facts` → `approvals-decide` → `takeover-stop` → `takeover-resume` → `monthly-report` → `local-only` | 首页/看板/项目时间线/账本 6 要素/审批批准驳回/接管 ≤10s + resume/月报/只监听本机（原能力） |
| 10–15 | `pro-nav-status` → `settings-config` → `agents-center` → `backend-flow` → `data-manage` → `pro-sanity` | 专业版布局与状态栏/三模式与支付银行卡/14 功能开关/智能体中心/后台时间线/数据清空二次确认/收尾（无 JS 错误、无外链、写 API 401） |

### v1.2 对话/证据步骤（v1.4 起改为「发送即执行 + SSE 实时流」）

| # | 步骤 | 断言要点 |
|---|---|---|
| 16 | `chat-open` | 导航含「对话/变现/系统」；会话列表；发送按钮=「发送并自动执行」；**已无「开始执行」按钮**；说明无需手动开始 |
| 17 | `chat-create-project` | 填目标/预算/Token/模式 → **点发送后不点任何开始按钮** → 进入实时会话页，出现实时状态（排队/思考/执行）、目标/预算/Token 正确、SSE 连接状态存在 |
| 18 | `chat-interrupt-resume` | 实时页显示计划卡（≥4 步）→ 点打断 → 状态=已打断 + 恢复按钮 → 恢复 → 状态=执行中；打断/恢复事件进入实时时间线 |
| 19 | `chat-auto-complete` | **≤15s 自动完成**（无需人工触发）→ 完成卡出现、无 error、Token 实时累计、步骤进度更新、完成卡含 run 证据链接 |
| 20 | `chat-run-evidence` | run 详情：时间线 ≥5 事件（5 阶段齐全）、截图缩略图 ≥2、**点缩略图灯箱大图**（内联 SVG 无外链）、report.md 渲染、日志/JSON 展开、各 agent 摘要含「写代码 Harness」 |
| 21 | `agent-transcript` | `/agents/harness`：每轮输入/输出摘要、Token、状态、证据引用、agent 信息卡 |

### v1.4 新增 6 步

| # | 步骤 | 断言要点 |
|---|---|---|
| 22 | `chat-auto-start` | `/chat` 填目标 → 点发送 → **不点「开始执行」** → 进入页面即出现实时状态（发送→实时面板含导航耗时<8s）、页面上无 `#chat-start`、SSE 连接建立（data-state=open/connecting） |
| 23 | `chat-live-events` | SSE 收到 **≥3 类事件**（`plan.created` / `step.started` / `agent.turn.completed` 均出现）、实时时间线 ≥3 条、计划卡 ≥4 步且逐步点亮（≥1 步 done）、总调度思考/执行提示、实时 Token 累计 |
| 24 | `chat-reconnect` | 执行中**刷新页面** → 恢复同一 run、从事件日志回放（since=0）恢复进度、状态仍正确、断线后继续执行并完成 |
| 25 | `chat-approval-pause` | 高风险目标（对外发送/收款）→ **审批卡出现、run 状态=等待审批**、风险说明含「高风险」、SSE 收到 `approval.required`；点「批准并继续」→ 继续完成且审批卡消失 |
| 26 | `money-epay` | 变现页说明（**未接真实支付**、**此前 ¥10 只是测试金额**）；渠道含易支付；易支付设置保存持久化（网关/商户/密钥引用掩码/demo）；创建 epay 收款请求 → 跳转链接+二维码占位；**人工确认到账** → 已到账 + ledger_entry_id；`/ledger` 出现 ¥1,288.00 收入 |
| 27 | `settings-models-prompts` | 多模型 provider ≥3 + 密钥掩码；supervisor 提示词/模型绑定/智能体开关；支付分组含易支付；提示词太短保存失败（校验错误）；模型保存 + **一键同步**；提示词保存后刷新持久 |
| 28 | `system-control` | `/system`：supervisor 对话、两层结构（L1/L2/L3 ≥10）、受管程序 ≥5、插件 ≥4、各 agent 模型/Token ≥12（含 supervisor）、日志 ≥3、快捷命令 ≥8；发消息得到回复；快捷命令写日志；插件启停生效 |
| 29 | `system-danger-confirm` | 点删除程序 → **危险动作二次确认弹窗**：风险+备份路径+确认令牌；错误 token 拒绝（弹窗保留）；正确 token +「确认删除」→ 删除成功、列表移除、系统日志记录审计 |
| 30 | `sse-sanity` | 无页面 JS 错误；health version=1.4.0、runtime_enabled=true、**离开页面后 SSE 订阅清理**（sse_active_streams=0）；无外链请求；使用同源 SSE 端点 `/api/chat/runs/:id/stream` |
| 31 | `v12-sanity` | 无 JS 错误/无外链；chat sessions/runs/transcripts/evidence；**run-live run 列表与完成态校验**；epay 持久化（demo、只存 key_ref）；model/prompts 持久；epay 请求 paid+账本 id；**无 token 的「发送即执行」/危险动作写 API 返回 401** |

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json            # {suite, version:"1.4.0", ok, browser, console{url,host,port,provider,admin_provider,
│                          #  chat_provider, system_provider, runtime_provider, console_boot_ms, first_page_load_ms},
│                          #  stop_limit_ms, measured_stop_ms, steps[], checks[], failures[], evidence[],
│                          #  screenshot_count, durationMs}
├── screenshots/001-open-console.png … 035-v12-sanity.png   # 每步截图（31 张）
├── dom/                   # 仅失败时保存失败现场 DOM
├── console-server.log     # 控制台服务端请求日志（方法/路径/状态/耗时，含 SSE 订阅开始/结束；不含 token/请求体）
└── console.log            # 页面 console / pageerror
```

- `measured_stop_ms`：点击接管按钮 → 页面进入 halted 状态的墙钟毫秒数（含浏览器事件与渲染开销）。
- `console_boot_ms` / `first_page_load_ms`：服务启动 / 首屏耗时。
- 安全：`result.json` / 日志中**不包含** `X-Steward-Token` 明文（只断言其生效）。

## 5. 真实运行基线（本机实测，2026-10-30）

环境：Windows + 本机 **Google Chrome 156.0.8078.49**（有头）、Node.js 24.15、`playwright-core@1.64.1`、
控制台随机端口（仅监听 127.0.0.1）。

| 指标 | 结果 |
|---|---|
| 步骤 | **31/31 通过**（原 25 步 + v1.4 新增 6 步） |
| 检查 | **338/338 通过** |
| `measured_stop_ms` | **79 ms**（≤ 10000 ms，B6） |
| `console_boot_ms` / `first_page_load_ms` | **20 ms** / **410 ms** |
| 截图 / 证据 | **35 张 / 35 个** |
| 耗时 | **约 31.9s** |
| 端口 | 运行后 `close()` 断言已释放，无残留 |
| 退出码 | **0** |

关键输出摘录：

```text
✓ chat-open（228ms）            发送按钮=发送并自动执行；无「开始执行」按钮
✓ chat-create-project（287ms）  发送即进入实时页（未点开始）→ 实时状态出现
✓ chat-interrupt-resume（407ms）打断→已打断→恢复→执行中（事件入时间线）
✓ chat-auto-complete（890ms）   run 自动完成、完成卡、Token/步骤更新、run 证据链接
✓ chat-run-evidence（527ms）    5 阶段时间线 / 缩略图灯箱 / report.md / 日志+JSON / agent 摘要
✓ chat-auto-start（213ms）      发送→实时面板（<8s 含导航）、无手动按钮、SSE 连接
✓ chat-live-events（206ms）     SSE ≥3 类事件（plan/step/agent.turn）、计划点亮、Token
✓ chat-reconnect（1194ms）      执行中刷新→同 run/since 回放→继续完成
✓ chat-approval-pause（1344ms） 高风险暂停=等待审批+风险说明→批准→完成
✓ sse-sanity（86ms）            health 1.4.0、runtime_enabled、sse_active_streams=0、无外链
✓ v12-sanity（79ms）            run-live 完成态、epay/model/prompts 持久、无 token 写 API 401
```

## 6. 已知限制 / FAQ

- **需要先 `npm run build`**：`run.mjs` 读取 `dist/`；缺失时退出码 2。调试其它构建可加 `--console-dist`。
- **v1.2/v1.3/v1.4 provider 默认启用演示实现**：E2E 直接用内置 `createDemoChatProvider()` / `createDemoSystemProvider()` / `createDemoRuntimeProvider()`（内存态）；
  Lead 接真实 Orchestrator/RunManager 后传入 `runtimeProvider` 适配器即可复用同一套 E2E（断言仍成立）。
- **SSE 断线恢复**：页面首次连接用 `since=0` 回放全部事件；EventSource 自动重连带 `Last-Event-ID`，服务端从该 seq 继续，前端按 seq 去重；刷新页面 = 快照 + 回放，E2E 已覆盖（`chat-reconnect`）。
- **保存后自动刷新**：对话/易支付/危险动作等操作由页面客户端调用 API 后自动 reload；E2E 使用 `safeReload()` 兼容导航竞态。
- **危险动作**：E2E 用可删除的 `prog-scout-worker` 演示；控制台自身与 money/epay 核心插件被服务端禁止删除。
- **易支付 demo**：不发起真实外网支付请求；跳转链接只做展示（E2E 断言 href，不点击）；live 模式仅配置校验。
- **有头要求**：产品验收必须默认有头（真实窗口）；CI 无桌面会话时用 `--headless 1` 做开发自测。
- **端口**：默认随机端口（0）；固定 `--port 4180` 报 EADDRINUSE 时换端口或先停占用进程。
- **外部地址断言**：若本机无非回环 IPv4，会记录一条 `skipped` 检查并继续（绑定地址仍断言 127.0.0.1）。
- 本目录禁止 mock 路由/假 DOM/预录视频；对话计划、SSE 事件、配置保存、易支付、危险动作删除、账本收入都由服务端真实返回并断言。
