# tests/e2e-console · 本地 Web 控制台真实浏览器 E2E（v1.3 专业版）

> 状态：**已落地并真实跑通**（有头 Chrome 155，**25/25 步、303/303 检查、30 张证据截图**，
> `measured_stop_ms=81`、`console_boot_ms=22`、耗时约 30.9s）。
> 被测对象是 `packages/steward-console` 的真实 HTTP 服务（进程内启动、随机端口）：
> `provider = createDemoConsoleProvider()` + `adminProvider = createDemoAdminProvider()`，
> v1.2/v1.3 还会自动启用 `createDemoChatProvider()` + `createDemoSystemProvider()`。
> **真实点击/输入/等待 + 每步截图**；不使用 mock 路由/假 DOM。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `run.mjs` | 主入口：启动控制台 → 真实有头浏览器完成 25 步验收 → 输出 `result.json` + 截图 |
| `README.md` | 本文档 |

## 2. 前置与运行

```bash
# 1) 先构建（run.mjs 读取 dist/packages/steward-console/src/index.js）
npm run build

# 2) 有头真实浏览器（产品验收必须；默认 0=有头）
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v13

# 3) 其它用法
node tests/e2e-console/run.mjs --headless 1              # 无头（仅开发/CI 自测）
node tests/e2e-console/run.mjs --port 4180               # 固定端口（默认 0=随机，避免冲突）
node tests/e2e-console/run.mjs --console-dist <index.js> # 调试其它构建产物
```

参数：`--evidence-dir <目录>`、`--headless 0|1`（默认 0）、`--port <端口>`（默认 0=随机）、
`--console-dist <路径>`、`-h/--help`。退出码：**0 全部通过 / 1 验收失败 / 2 用法或环境错误**。
运行结束会关闭控制台并断言端口已释放（不残留进程/端口）。

## 3. 验收流程（25 步，每步截图；另有 5 张关键证据截图）

### 原有 15 步（P1-C + v1.1，回归不破坏）

| # | 步骤 | 断言要点 |
|---|---|---|
| 1–9 | `open-console` → `dashboard-load` → `project-timeline` → `ledger-facts` → `approvals-decide` → `takeover-stop` → `takeover-resume` → `monthly-report` → `local-only` | 首页/看板/项目时间线/账本 6 要素/审批批准驳回/接管 ≤10s + resume/月报/只监听本机（原能力） |
| 10–15 | `pro-nav-status` → `settings-config` → `agents-center` → `backend-flow` → `data-manage` → `pro-sanity` | 专业版布局与状态栏/三模式与支付银行卡/14 功能开关/智能体中心/后台时间线/数据清空二次确认/收尾（无 JS 错误、无外链、写 API 401） |

### v1.2/v1.3 新增 10 步

| # | 步骤 | 断言要点 |
|---|---|---|
| 16 | `chat-open` | 导航出现「对话/变现/系统」；会话列表；新建项目表单（目标/预算/Token/模式）；说明总调度先拆计划 |
| 17 | `chat-create-project` | 创建项目 → 进入会话；显示目标/预算 ¥2,600/Token 180,000；**计划 ≥4 步**；用户消息 + 总调度拆解回复；**每轮有简略摘要**；点「开始执行」→ 状态执行中 + 生成 run 链接 |
| 18 | `chat-interrupt-resume` | 打断 → 状态「已打断（暂停）」+ 恢复按钮；恢复 → 执行中 + **审批卡**；批准 → 已完成、审批卡消失、计划步骤 done |
| 19 | `chat-run-evidence` | run 详情：时间线 ≥5 事件（plan/action/observe/verify/evidence 齐全）、**截图缩略图 ≥2**、**点缩略图打开灯箱大图**（内联 SVG，无外链）、report.md 渲染、日志/JSON 可展开、各 agent 摘要含「写代码 Harness」 |
| 20 | `agent-transcript` | `/agents/harness`：每轮输入/输出摘要、Token、状态、证据引用、agent 信息卡 |
| 21 | `money-epay` | 变现页说明（**未接真实支付**、**此前 ¥10 只是测试金额**）；渠道含易支付；**易支付设置保存并持久化**（网关/商户 ID/密钥引用掩码/demo）；**创建 epay 收款请求** → 易支付跳转链接（网关+金额+out_trade_no）+ 二维码占位；**人工确认到账** → 已到账 + ledger_entry_id；`/ledger` 出现 ¥1,288.00 收入（账本 6 要素） |
| 22 | `settings-models-prompts` | 多模型 provider ≥3（DeepSeek/OpenAI 兼容/本地）+ 密钥掩码；supervisor 提示词/模型绑定/智能体开关；支付分组含易支付；**提示词太短保存失败**（校验错误）；模型保存 + **一键同步**成功；提示词保存后刷新持久 |
| 23 | `system-control` | `/system`：supervisor 对话记录、**两层结构**（L1 supervisor / L2 项目总调度 / L3 专项 agent ≥10）、受管程序 ≥5、插件 ≥4、各 agent 模型/Token ≥12（含 supervisor）、日志 ≥3、快捷命令 ≥8；发消息得到回复；快捷命令写日志；插件启用/禁用生效 |
| 24 | `system-danger-confirm` | 点删除程序 → **危险动作二次确认弹窗**：风险说明 + **备份路径** + **确认令牌（DEL-）**；错误 token 被拒绝（弹窗保留、未删除）；输入正确 token + 「确认删除」→ 删除成功、列表移除、系统日志记录「危险动作已执行」 |
| 25 | `v12-sanity` | 无 JS 错误；无外链请求；health v1.3.0（chat/system enabled）；chat sessions/runs/transcripts/evidence API；system status（程序/12 agents）；**epay 配置持久化（demo、只存 key_ref）**；model-settings synced + harness 绑定持久；prompts 持久（含 E2E 标记）；epay 请求已 paid + 账本 id；**无 token 的危险动作/对话写 API 返回 401** |

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json            # {suite, version, ok, browser, console{url,host,port,provider,admin_provider,
│                          #  chat_provider, system_provider, console_boot_ms, first_page_load_ms},
│                          #  stop_limit_ms, measured_stop_ms, steps[], checks[], failures[], evidence[],
│                          #  screenshot_count, durationMs}
├── screenshots/001-open-console.png … 030-v12-sanity.png   # 25 步 + 5 张关键证据
│                          # （run-evidence-lightbox / money-epay-config / money-epay-request /
│                          #   system-danger-modal / system-overview-layers）
├── dom/                   # 仅失败时保存失败现场 DOM
├── console-server.log     # 控制台服务端请求日志（方法/路径/状态/耗时，不含 token/请求体）
└── console.log            # 页面 console / pageerror
```

- `measured_stop_ms`：点击接管按钮 → 页面进入 halted 状态的墙钟毫秒数（含浏览器事件与渲染开销）。
- `console_boot_ms`：`createConsoleServer()` 从调用到监听就绪的耗时；`first_page_load_ms`：首次打开页面并完成首屏断言前的耗时。
- 安全：`result.json` / 日志中**不包含** `X-Steward-Token` 明文（只断言其生效）。

## 5. 真实运行基线（本机实测，2026-10-26）

环境：Windows + 本机 **Google Chrome 155.0.8059.85**（有头）、Node.js 24.15、`playwright-core@1.64.1`、
控制台随机端口（仅监听 127.0.0.1）。

| 指标 | 结果 |
|---|---|
| 步骤 | **25/25 通过**（原 15 步 + v1.2/v1.3 新增 10 步） |
| 检查 | **303/303 通过** |
| `measured_stop_ms` | **81 ms**（≤ 10000 ms，B6） |
| `console_boot_ms` / `first_page_load_ms` | **22 ms** / **362 ms** |
| 截图 / 证据 | **30 张 / 30 个**（25 步 + 5 张关键证据） |
| 耗时 | **约 30.9s** |
| 端口 | 运行后 `close()` 断言已释放，无残留 |
| 退出码 | **0** |

关键输出摘录：

```text
✓ chat-create-project（970ms）    计划 ≥4 步；每轮摘要；开始执行生成 run
✓ chat-interrupt-resume（2791ms） 打断→暂停→恢复→审批卡→批准→完成
✓ chat-run-evidence（562ms）      时间线 5 阶段 / 2 缩略图 / 灯箱大图 / report.md / 日志+JSON / agent 摘要
✓ agent-transcript（208ms）       harness 每轮输入输出摘要 + Token + 证据
✓ money-epay（3409ms）            易支付配置持久 + 创建 epay 请求（链接/QR 占位）+ 人工确认到账 → 账本 ¥1,288.00
✓ settings-models-prompts（3701ms）多 provider / 掩码 / 一键同步 / 提示词校验与持久 / supervisor 绑定
✓ system-control（3268ms）        两层结构 + 程序/插件/模型/日志 + supervisor 对话 + 快捷命令
✓ system-danger-confirm（2311ms） 风险+备份路径+确认 token；错误 token 拒绝；正确 token 删除成功并审计
✓ v12-sanity（148ms）             无 JS 错误 / 无外链 / API 与持久化 / 无 token 写 API 401
```

## 6. 已知限制 / FAQ

- **需要先 `npm run build`**：`run.mjs` 读取 `dist/`；缺失时退出码 2。调试其它构建可加 `--console-dist`。
- **v1.2/v1.3 provider 默认启用演示实现**：E2E 直接用内置 `createDemoChatProvider()` / `createDemoSystemProvider()`（内存态）；
  Lead 接真实 Orchestrator/SystemController 后传入适配器即可复用同一套 E2E（断言仍成立）。
- **保存后自动刷新**：对话/易支付/危险动作等操作由页面客户端调用 API 后自动 reload；E2E 使用 `safeReload()`
  兼容“客户端已自行刷新”的导航竞态（v1.1 保存配置后自动刷新同理）。
- **危险动作**：E2E 用可删除的 `prog-scout-worker` 演示；控制台自身与 money/epay 核心插件被服务端禁止删除。
- **易支付 demo**：不发起真实外网支付请求；跳转链接只做展示（E2E 断言 href，不点击）；live 模式仅配置校验。
- **有头要求**：产品验收必须默认有头（真实窗口）；CI 无桌面会话时用 `--headless 1` 做开发自测。
- **端口**：默认随机端口（0）；固定 `--port 4180` 报 EADDRINUSE 时换端口或先停占用进程。
- **外部地址断言**：若本机无非回环 IPv4，会记录一条 `skipped` 检查并继续（绑定地址仍断言 127.0.0.1）。
- 本目录禁止 mock 路由/假 DOM/预录视频；对话计划、配置保存、易支付配置、危险动作删除、账本收入都由服务端真实返回并断言。
