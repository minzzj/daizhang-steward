# tests/e2e-console · 本地 Web 控制台真实浏览器 E2E（阶段二 P1-C）

> 状态：**已落地并真实跑通**（有头 Chrome 155，9/9 步、73/73 检查，`measured_stop_ms=96`）。
> 被测对象是 `packages/steward-console` 的真实 HTTP 服务（进程内启动、随机端口），provider 为内置
> `createDemoConsoleProvider()` 仿真数据；**真实点击/输入/等待 + 每步截图**，不使用 mock 路由/假 DOM。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `run.mjs` | 主入口：启动控制台 → 真实有头浏览器完成查看/审批/接管全流程 → 输出 `result.json` + 截图 |
| `README.md` | 本文档 |

## 2. 前置与运行

```bash
# 1) 先构建（run.mjs 读取 dist/packages/steward-console/src/index.js）
npm run build

# 2) 有头真实浏览器（产品验收必须；默认 0=有头）
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console

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

| # | 步骤 | 断言要点 |
|---|---|---|
| 1 | `dashboard-load` 看板 | 预算条（月/项目/单笔）、项目卡 ≥3（客户/进度）、任务数文案与任务行数一致且按代理分组、代理状态 ≥4、L0 摘要、全局「只监听 127.0.0.1 · 本地模式」 |
| 2 | `project-timeline` 项目页 | 真实点击项目卡进入 `/project/:id`；时间线 ≥5 条；点开证据 → 路径 / 类型 / 置信度均有值 |
| 3 | `ledger-facts` 账本（**B2**） | 账本 ≥4 笔；点第一笔 → 详情抽屉打开；**6 要素全部非空**（金额/收付方/依据/审批人/回执/所属项目） |
| 4 | `approvals-decide` 审批 | 待批 ≥2；批准一张 → `approved` 且徽标「已批准」；驳回另一张 → `rejected` 且徽标「已驳回」；刷新后状态仍在（服务端状态，非仅前端 DOM） |
| 5 | `takeover-stop` 接管（**B6**） | 初始 `halted=false`；点接管大按钮 → **≤10s 内 `halted=true`**；**6 类接管包**（开放订单/待处理对话/应付款/凭据引用/风险/覆盖度）均有内容；计时器显示「已停止 …」；页面显示实测耗时；全局接管横幅出现；记录 `measured_stop_ms` |
| 6 | `takeover-resume` 恢复 | 点 resume → `halted=false`；空闲态恢复、全局横幅消失、显示恢复时间 |
| 7 | `monthly-report` 月报 | 收入 / 成本 / 毛利 / 预算余量可见；合规事件 ≥2；下月提案 ≥2；as_of / coverage 可见 |
| 8 | `local-only` 只监听本机 | 页面文本含 127.0.0.1 与「本地」；服务端绑定地址 = `127.0.0.1`；局域网地址访问不可达；**无 `X-Steward-Token` 写操作 → 401**、读接口无需 token；所有请求同源（无外链）；无页面 JS 错误 |

步骤命名与 `result.json` 的 `steps[].action` 一一对应；`open-console` 是进入首页的准备步骤。

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json            # {suite, ok, browser, console{url,host,port,provider}, stop_limit_ms,
│                          #  measured_stop_ms, steps[], checks[], failures[], evidence[], screenshot_count, durationMs}
├── screenshots/001-open-console.png … 009-local-only.png   # 每步真实截图（失败步骤额外存 DOM）
├── dom/                   # 仅失败时保存失败现场 DOM
├── console-server.log     # 控制台服务端请求日志（方法/路径/状态/耗时，不含 token/请求体）
└── console.log            # 页面 console / pageerror
```

- `measured_stop_ms`：**点击接管按钮 → 页面进入 halted 状态的墙钟毫秒数**（含浏览器事件与渲染开销，
  通常几十 ms，远小于 10000ms 上限；页面内另有一份 JS 计时，二者都 ≤10s）。
- `checks[]` 是全部断言的平铺清单（含 `step` 归属、`ok`、`message`）；任一失败 → `ok:false`、退出码 1。
- 安全：`result.json` / 日志中**不包含** `X-Steward-Token` 明文（只断言其生效）。

## 5. 真实运行基线（本机实测）

环境：Windows + 本机 **Google Chrome 155.0.8059.85**（有头；`chrome → msedge` 回退未触发）、
Node.js 24.15、`playwright-core@1.64.1`（仓库 devDependencies）、控制台随机端口（仅监听 127.0.0.1）。

| 指标 | 结果 |
|---|---|
| 步骤 | **9/9 通过**（open-console + 7 个验收步 + resume） |
| 检查 | **73/73 通过** |
| `measured_stop_ms` | **96 ms**（多次运行 80–96 ms，≤ 10000 ms，B6） |
| 截图 | 9 张（每步 1 张） |
| 耗时 | ~3.5s |
| 端口 | 运行后 `close()` 断言已释放，无残留 |
| 退出码 | **0** |

关键检查摘录（真实输出）：

```text
✓ dashboard-load（124ms） 预算条/项目卡/任务数/代理状态/L0 摘要可见
✓ project-timeline（181ms） 时间线 6 条；证据路径/类型/置信度可见
✓ ledger-facts（203ms） 6 要素均有值（金额/收付方/依据/审批人/回执/所属项目）
✓ approvals-decide（311ms） approved/rejected 即时更新且刷新后仍在
✓ takeover-stop（203ms） halted=true；6 类接管包有内容；实测 96ms ≤ 10000ms
✓ takeover-resume（105ms） halted=false 恢复
✓ monthly-report（126ms） 收入/成本/毛利/预算余量/合规/提案可见
✓ local-only（1571ms） 只监听 127.0.0.1；无 token 写操作 401；无外链请求；无页面 JS 错误
```

## 6. 已知限制 / FAQ

- **需要先 `npm run build`**：`run.mjs` 读取 `dist/`；缺失时退出码 2 并提示。调试其它构建可加
  `--console-dist`。
- **有头要求**：产品验收必须默认有头（真实窗口）；CI 无桌面会话时用 `--headless 1` 做开发自测。
- **端口**：默认随机端口（0）避免冲突；固定 `--port 4180` 报 EADDRINUSE 时换端口或先停占用进程。
- **外部地址断言**：若本机没有非回环 IPv4，会记录一条 `skipped` 检查并继续（绑定地址仍断言 127.0.0.1）。
- **measured_stop_ms 口径**：含 Playwright 点击与渲染开销，比页面内 JS 计时略大（例如页面 15ms / E2E 96ms），
  两者都远小于 10s 上限；报告以 `result.json` 的 `measured_stop_ms` 为准。
- **仿真数据**：审批/接管的状态只在此次运行的内存 provider 中有效（真实 domain 落库后由 domain 持久化）。
- 本目录禁止 mock 路由/假 DOM/预录视频；账本 6 要素、审批状态与接管状态都由服务端真实返回。
