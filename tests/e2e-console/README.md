# tests/e2e-console · 本地 Web 控制台真实浏览器 E2E（v1.1 专业版）

> 状态：**已落地并真实跑通**（有头 Chrome 155，**15/15 步、178/178 检查、15 张截图**，
> `measured_stop_ms=84`、`console_boot_ms=7`）。
> 被测对象是 `packages/steward-console` 的真实 HTTP 服务（进程内启动、随机端口）：
> `provider = createDemoConsoleProvider()` + `adminProvider = createDemoAdminProvider()`（配置中心/智能体/后台/数据）。
> **真实点击/输入/等待 + 每步截图**；不使用 mock 路由/假 DOM。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `run.mjs` | 主入口：启动控制台（含 adminProvider）→ 真实有头浏览器完成 15 步验收 → 输出 `result.json` + 截图 |
| `README.md` | 本文档 |

## 2. 前置与运行

```bash
# 1) 先构建（run.mjs 读取 dist/packages/steward-console/src/index.js）
npm run build

# 2) 有头真实浏览器（产品验收必须；默认 0=有头）
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v11

# 3) 其它用法
node tests/e2e-console/run.mjs --headless 1              # 无头（仅开发/CI 自测）
node tests/e2e-console/run.mjs --port 4180               # 固定端口（默认 0=随机，避免冲突）
node tests/e2e-console/run.mjs --console-dist <index.js> # 调试其它构建产物
```

参数：`--evidence-dir <目录>`（默认 `runs/e2e-console-<时间戳>`）、`--headless 0|1`（默认 0）、
`--port <端口>`（默认 0=随机）、`--console-dist <路径>`、`-h/--help`。
退出码：**0 全部通过 / 1 验收失败 / 2 用法或环境错误（缺构建产物等）**。
运行结束会关闭控制台并断言端口已释放（不残留进程/端口）。

## 3. 验收流程（每步一张截图）

### 原有 9 步（P1-C 运营流程，回归不破坏）

| # | 步骤 | 断言要点 |
|---|---|---|
| 1 | `open-console` | 首页 200；标题含「本地控制台」；**专业版左侧导航 + 顶部状态栏已渲染** |
| 2 | `dashboard-load` | 预算条（月/项目/单笔）、项目卡 ≥3（客户/进度）、任务数文案与任务行数一致且按代理分组、代理状态 ≥4、L0 摘要、全局「只监听 127.0.0.1 · 本地模式」 |
| 3 | `project-timeline` | 真实点击项目卡进入 `/project/:id`；时间线 ≥5 条；点开证据 → 路径 / 类型 / 置信度均有值 |
| 4 | `ledger-facts` | 账本 ≥4 笔；点第一笔 → 详情抽屉打开；**6 要素全部非空**（金额/收付方/依据/审批人/回执/所属项目，B2） |
| 5 | `approvals-decide` | 批准一张 → approved 且徽标「已批准」；驳回另一张 → rejected；刷新后状态仍在（服务端状态） |
| 6 | `takeover-stop` | 初始 halted=false；点接管键 → **≤10s 内 halted=true**；6 类接管包均有内容；计时器与实测耗时可见；记录 `measured_stop_ms` |
| 7 | `takeover-resume` | resume → halted=false；空闲态恢复、全局横幅消失 |
| 8 | `monthly-report` | 收入/成本/毛利/预算余量可见；合规事件 ≥2；下月提案 ≥2；as_of / coverage 可见 |
| 9 | `local-only` | 页面文本含 127.0.0.1/本地；服务端绑定 127.0.0.1；局域网地址不可达；无 token 写操作 401、读接口 200；全部请求同源 |

### v1.1 新增 6 步（专业版）

| # | 步骤 | 断言要点 |
|---|---|---|
| 10 | `pro-nav-status` | 左侧导航出现「智能体/后台/配置/数据」四个新入口；顶部状态栏：运行模式徽章（体验模式）、预算余量、Token 余量、接管状态=运行中、最近事件时间 |
| 11 | `settings-config` | **三模式卡片**（demo/personal/enterprise）可见；**「支付与银行卡」分组可见**（个人渠道微信/支付宝/个人银行卡 + 收款账户掩码 + AI 不代签）；体验模式 Token 上限=10,000,000；14 项功能开关；**切到个人模式保存 → 顶部状态=个人模式、三渠道启用且仅人工审批、账户掩码、Token 上限 2,000,000**；**禁用 scout 并保存 → 刷新后仍禁用（持久化）**；0 元极限模式提示可见；**非法 Token 配置保存 → 显示校验错误** |
| 12 | `agents-center` | 智能体 ≥8 个（含 conductor/operator/harness/reviewer/backend/scout）；harness=写代码、backend=后台值守；企业专属 agent 在个人模式显示「该模式不适用」；卡片含今日动作/Token/最近日志；**点击展开详情**（Token 限额/工具） |
| 13 | `backend-flow` | 按 run 分组 ≥2；全流程时间线 ≥5 条事件；含 plan/action/observe/verify/evidence 五个阶段；运行队列、Token/预算消耗、异常/接管记录可见；**事件流过滤生效**；**展开证据引用**显示路径/类型 |
| 14 | `data-manage` | 数据统计（runs/证据/配置更新时间）；**清空数据需二次确认**（弹窗→取消不执行；确认后 runs/证据归零 + 空档案引导）；**重置为演示数据**后恢复 |
| 15 | `pro-sanity` | 全程**无页面 JS 错误**；**无外链请求**（全部同源 127.0.0.1）；`pro.css`/`admin.js` 同源加载；`GET /api/config` 持久化（mode=personal、scout 禁用、note 保留、payout=personal、ai_may_sign=false）；`/api/agents` ≥8；`/api/data/stats` 演示态；`/api/flow` ≥5 事件；**无 token 的管理写操作 401 且不修改数据** |

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json            # {suite, version, ok, browser, console{url,host,port,provider,admin_provider,
│                          #  console_boot_ms, first_page_load_ms}, stop_limit_ms, measured_stop_ms,
│                          #  steps[], checks[], failures[], evidence[], screenshot_count, durationMs}
├── screenshots/001-open-console.png … 015-pro-sanity.png   # 每步真实截图（失败步骤额外存 DOM）
├── dom/                   # 仅失败时保存失败现场 DOM
├── console-server.log     # 控制台服务端请求日志（方法/路径/状态/耗时，不含 token/请求体）
└── console.log            # 页面 console / pageerror
```

- `measured_stop_ms`：点击接管按钮 → 页面进入 halted 状态的墙钟毫秒数（含浏览器事件与渲染开销）。
- `console_boot_ms`：`createConsoleServer()` 从调用到监听就绪的耗时；`first_page_load_ms`：首次打开页面并完成首屏断言前的耗时。
- 安全：`result.json` / 日志中**不包含** `X-Steward-Token` 明文（只断言其生效）。

## 5. 真实运行基线（本机实测，2026-10-26）

环境：Windows + 本机 **Google Chrome 155.0.8059.85**（有头；`chrome → msedge` 回退未触发）、
Node.js 24.15、`playwright-core@1.64.1`、控制台随机端口（仅监听 127.0.0.1）。

| 指标 | 结果 |
|---|---|
| 步骤 | **15/15 通过**（原 9 步 + 新增 6 步） |
| 检查 | **178/178 通过** |
| `measured_stop_ms` | **84 ms**（≤ 10000 ms，B6） |
| `console_boot_ms` / `first_page_load_ms` | **7 ms** / **400 ms** |
| 截图 / 证据 | **15 张 / 15 个** |
| 耗时 | **约 12.1s** |
| 端口 | 运行后 `close()` 断言已释放，无残留 |
| 退出码 | **0** |

关键检查摘录（真实输出）：

```text
✓ pro-nav-status（77ms）    新导航 4 入口 + 顶部状态栏（模式/预算/Token/接管/最近事件）
✓ settings-config（4164ms） 三模式 + 支付与银行卡（微信/支付宝/个人卡 + 掩码 + AI 不代签）
                            切个人模式 → 状态栏=个人模式；禁用 scout 保存 → 刷新仍在；校验错误提示
✓ agents-center（204ms）    11 个智能体；企业专属显示「该模式不适用」；展开详情
✓ backend-flow（704ms）     4 个 run / 19 条事件；过滤生效；证据展开
✓ data-manage（2987ms）     二次确认取消不执行；确认后归零 + 空档案；重置演示数据恢复
✓ pro-sanity（61ms）        无 JS 错误；无外链；配置持久化；无 token 写操作 401
```

## 6. 已知限制 / FAQ

- **需要先 `npm run build`**：`run.mjs` 读取 `dist/`；缺失时退出码 2 并提示。调试其它构建可加 `--console-dist`。
- **adminProvider 必需**：E2E 会传入 `createDemoAdminProvider()`；若用旧调用（不传 adminProvider），
  管理页/管理 API 返回 503（向后兼容设计）。
- **模式切换会刷新页面**：配置中心保存时若运行模式变化，前端会先在服务端应用该模式默认并刷新页面
  （E2E 已等待刷新后断言）；同一模式下的功能/预算/支付修改保存后不刷新，直接生效。
- **有头要求**：产品验收必须默认有头（真实窗口）；CI 无桌面会话时用 `--headless 1` 做开发自测。
- **端口**：默认随机端口（0）避免冲突；固定 `--port 4180` 报 EADDRINUSE 时换端口或先停占用进程。
- **外部地址断言**：若本机没有非回环 IPv4，会记录一条 `skipped` 检查并继续（绑定地址仍断言 127.0.0.1）。
- **演示数据内存态**：配置/清空状态只在本次进程内有效（重启回到默认），真实 ConfigEngine 接入后持久化。
- 本目录禁止 mock 路由/假 DOM/预录视频；配置保存、数据清空、智能体状态都由服务端真实返回并断言。
