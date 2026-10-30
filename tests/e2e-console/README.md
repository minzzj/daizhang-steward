# tests/e2e-console · 本地 Web 控制台真实浏览器 E2E（v1.5 专业版）

> 状态：**已落地并真实跑通**（有头 Chrome 156，**38/38 步、407/407 检查、42 张证据截图**，
> `measured_stop_ms=84`、`console_boot_ms=21`、耗时约 33.4s）。
> 被测对象是 `packages/steward-console` 的真实 HTTP 服务（进程内启动、随机端口）：
> `provider = createDemoConsoleProvider()` + `adminProvider = createDemoAdminProvider()` +
> `createDemoChatProvider()` + `createDemoSystemProvider()` + `createDemoRuntimeProvider()`（发送即执行 + SSE + 产物/报告/指标/思考流）。
> **真实点击/输入/等待 + 每步截图**；不使用 mock 路由/假 DOM。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `run.mjs` | 主入口：启动控制台 → 真实有头浏览器完成 38 步验收 → 输出 `result.json` + 截图 |
| `README.md` | 本文档 |

## 2. 前置与运行

```bash
# 1) 先构建（run.mjs 读取 dist/packages/steward-console/src/index.js）
npm run build

# 2) 有头真实浏览器（产品验收必须；默认 0=有头）
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v15

# 3) 其它用法
node tests/e2e-console/run.mjs --headless 1              # 无头（仅开发/CI 自测）
node tests/e2e-console/run.mjs --port 4180               # 固定端口（默认 0=随机，避免冲突）
node tests/e2e-console/run.mjs --console-dist <index.js> # 调试其它构建产物
```

参数：`--evidence-dir <目录>`、`--headless 0|1`（默认 0）、`--port <端口>`（默认 0=随机）、
`--console-dist <路径>`、`-h/--help`。退出码：**0 全部通过 / 1 验收失败 / 2 用法或环境错误**。
运行结束会关闭控制台并断言端口已释放（不残留进程/端口）。

## 3. 验收流程（38 步，每步截图）

### 1–31 步：既有回归（P1-C 运营 + v1.1 专业版 + v1.2 对话/证据 + v1.4 发送即执行/SSE）

| 步骤 | 断言要点（摘要） |
|---|---|
| 1–9 `open-console` → `local-only` | 首页/看板/项目时间线/账本 6 要素/审批/接管 ≤10s+resume/月报/只监听本机 |
| 10–15 `pro-nav-status` → `pro-sanity` | 专业版布局/三模式配置+支付银行卡/智能体中心/后台时间线/数据清空/sanity |
| 16–21 `chat-open` → `agent-transcript` | 发送即执行、计划/打断恢复/自动完成、run 证据、agent 轮次记录（v1.5 后 run 页为 Tabs） |
| 22–25 `chat-auto-start` → `chat-approval-pause` | 无手动按钮/SSE 实时事件/刷新恢复/高风险暂停审批 |
| 26–30 `money-epay` → `sse-sanity` | 易支付配置+收款+确认到账+账本、模型提示词、系统总控、危险动作二次确认、SSE 订阅清理 |
| 31 `v12-sanity` | API/持久化/无 token 401/run-live 完成态（v1.5 增加产物/报告/指标 API、预览/下载、路径穿越检查） |

### 32–38 步：v1.5 新增（产物 / 报告 / 数据 / 思考过程 / Harness 真实执行）

| # | 步骤 | 断言要点 |
|---|---|---|
| 32 | `run-tabs-artifacts` | `/runs/:id` 4 个 Tabs；切到「产物」：产物 ≥5、类型 ≥4（markdown/json/html/image 必须有）、Markdown 渲染、HTML 沙箱 iframe 预览、图片预览、下载链接、证据截图灯箱、日志/JSON 可展开 |
| 33 | `run-tabs-metrics` | 切到「数据」：Token 输入/输出/缓存/总计卡片（>0 且分项合计≈总计）、耗时>0、工具调用≥2 + 分布表（含具体工具名）、事件数≥5、model_modes、预算消耗 |
| 34 | `run-report-tab` | 切到「报告」：run 汇总报告 Markdown 渲染；分步报告 ≥2 份且渲染、标注 agent 角色与步骤号 |
| 35 | `chat-live-thinking` | 新 run 实时页：`#live-thinking` 思考块出现、分块累积 ≥2、文本流可见（分析/执行）、可折叠 summary、SSE `harness.thinking` ≥2 |
| 36 | `chat-live-tool` | 工具调用卡片 ≥2、显示具体工具名与状态/耗时、SSE `harness.tool_call`/`tool_result` 事件、`artifact.created` 产物即时提示 |
| 37 | `artifacts-center` | `/artifacts` 产物中心 ≥8 个、类型筛选生效（markdown/json/image）、Markdown/JSON/图片预览、下载链接 |
| 38 | `agents-harness-badge` | `/agents` 每个卡片均有「DeepSeek Harness 真实执行」徽章；卡片显示 session_id/耗时/tokens/工具/产物/报告与入口；agent 详情页含产物/报告面板 |

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json            # {suite, version:"1.5.0", ok, browser, console{..., runtime_provider, console_boot_ms,
│                          #  first_page_load_ms}, stop_limit_ms, measured_stop_ms, steps[], checks[], failures[],
│                          #  evidence[], screenshot_count, durationMs}
├── screenshots/001-open-console.png … 042-v12-sanity.png   # 38 步截图 + 4 张关键证据（money/系统/思考流）
├── dom/                   # 仅失败时保存失败现场 DOM
├── console-server.log     # 服务端请求日志（含 SSE 订阅开始/结束；不含 token/请求体）
└── console.log            # 页面 console / pageerror
```

- `measured_stop_ms`：点击接管按钮 → 页面进入 halted 状态的墙钟毫秒数。
- `console_boot_ms` / `first_page_load_ms`：服务启动 / 首屏耗时。
- 安全：`result.json` / 日志中**不包含** `X-Steward-Token` 明文。

## 5. 真实运行基线（本机实测，2026-10-30）

环境：Windows + **Google Chrome 156.0.8078.49**（有头）、Node.js 24.15、`playwright-core@1.64.1`、
控制台随机端口（仅监听 127.0.0.1）。

| 指标 | 结果 |
|---|---|
| 步骤 | **38/38 通过**（既有 31 步 + v1.5 新增 7 步） |
| 检查 | **407/407 通过** |
| `measured_stop_ms` | **84 ms**（≤ 10000 ms，B6） |
| `console_boot_ms` / `first_page_load_ms` | **21 ms** / **398 ms** |
| 截图 / 证据 | **42 张 / 42 个** |
| 耗时 | **约 33.4s** |
| 端口 | 运行后 `close()` 断言已释放，无残留 |
| 退出码 | **0** |

关键输出摘录：

```text
✓ run-tabs-artifacts（547ms）   4 Tabs；产物 ≥5/类型 4；Markdown 渲染 / HTML iframe / 图片 / 下载 / 灯箱
✓ run-tabs-metrics（94ms）      Token 输入/输出/缓存/总计 + 工具分布表 + 耗时/事件/模型来源/预算
✓ run-report-tab（78ms）        run 汇总 + 分步报告 Markdown 渲染（agent/步骤标注）
✓ chat-live-thinking（413ms）   思考分块 ≥2、文本流、可折叠、SSE harness.thinking
✓ chat-live-tool（197ms）       工具卡片 ≥2、tool_call/tool_result 事件、artifact.created 提示
✓ artifacts-center（985ms）     产物中心 ≥8、类型筛选、Markdown/JSON/图片预览、下载
✓ agents-harness-badge（203ms） 每个 agent「DeepSeek Harness 真实执行」徽章 + 最近会话/tokens/工具/产物/报告
```

## 6. 已知限制 / FAQ

- **需要先 `npm run build`**；缺失 dist 时退出码 2。调试其它构建可加 `--console-dist`。
- **provider 默认演示实现**：E2E 用内置 `createDemoRuntimeProvider()`（内存、确定性）；真实 RunManager/Harness 接入后由 `listArtifacts/listReports/getRunMetrics` + SSE 新事件（真实 data 形态见 README §15.7）透传真实数据，E2E 断言仍成立。
- **产物/报告为演示确定性内容**（HTML/Markdown/JSON/SVG/代码 + 3 份报告）；真实接入后由 `runs/<sessionId>/harness/` 真实文件替换，预览/下载/路径穿越防护逻辑不变（`getArtifactContent` / `getArtifactFilePath` + `runs/` 内绝对路径校验）。
- **数据指标**：Token 输入/输出/缓存由演示 runtime 按比例拆分；真实来源为 `harness/metrics.json` 或 TokenBudget/usage 记录。
- **SSE 断线恢复**：`since=0` 回放 + `Last-Event-ID` 续传 + seq 去重；刷新页面 = 快照 + 回放。
- **保存后自动刷新**：页面客户端操作后 reload；E2E 使用 `safeReload()` 兼容导航竞态。
- **危险动作**：E2E 用可删除的 `prog-scout-worker`；控制台自身与 money/epay 核心插件被服务端禁止删除。
- **易支付 demo**：不发起真实外网支付；跳转链接只做展示（断言 href，不点击）。
- **有头要求**：产品验收默认有头；CI 无桌面会话用 `--headless 1`。
- 本目录禁止 mock 路由/假 DOM/预录视频；对话计划、SSE 事件、产物/报告/指标、配置保存、账本收入均由服务端真实返回并断言。

## 7. v1.5.1 ChatGPT 式对话总控小 E2E（无截图）

`node tests/e2e-console/chat-e2e.mjs --headless 1 --evidence-dir <dir>`：真实浏览器验证 `/chat` ChatGPT 式主入口（多会话/内嵌卡片/记忆面板/快捷查询/SSE 逐段渲染/刷新恢复/安全），**不保存截图**，只输出 `result.json`（steps/checks/pass/fail/耗时，`screenshots:false`）。基线：**8/8 步、35/35 检查、约 8s、退出码 0**（无头 Chrome 156）。原 `run.mjs` 38 步默认也不保存截图（`--screenshots` 可显式开启），基线 **38/38 步、413/413 检查、31.6s、退出码 0**。