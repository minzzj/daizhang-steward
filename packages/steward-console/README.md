# packages/steward-console · 本地 Web 控制台（v1.1 专业版）

> 状态：**v1.1 专业版已实现**（配置中心 / 智能体中心 / 后台 / 数据管理 + 运营页升级）。
> 零第三方依赖：Node 内置 `node:http` + 原生 HTML/CSS/JS；**只监听 127.0.0.1**；写操作需
> `X-Steward-Token`；无 CDN / 外链 / 外网字体。真实浏览器 E2E：`tests/e2e-console/run.mjs`
> （有头 Chrome，15 步 / 178 检查 / 15 张截图，输出 `measured_stop_ms` 与 `console_boot_ms`）。

## 1. 目录 / 文件

| 文件 | 说明 |
|---|---|
| `src/server.ts` | `createConsoleServer({provider, adminProvider?, host?, port?, token?, log?})`：HTTP 服务、页面/API 路由、token 校验、安全头、`close()` 释放端口 |
| `src/provider.ts` | 运营数据契约 `ConsoleDataProvider`（不依赖 `steward-domain`）+ `createDemoConsoleProvider()` |
| `src/admin.ts` | **管理侧契约 `ConsoleAdminProvider`**（配置/智能体/后台/数据）+ **`createDemoAdminProvider()`**：三模式默认配置、11 个智能体、流程时间线、数据统计；保存/切模式/清空真实生效（内存） |
| `src/pages.ts` | 页面骨架（**左侧固定导航 + 顶部状态栏**）+ 总览 / 项目时间线 / 账本 / 审批 / 月报 / 接管 |
| `src/pages-admin.ts` | 项目列表 / **配置中心** / **智能体中心** / **后台** / **数据管理** 页面渲染 |
| `src/assets.ts` | 基础 CSS + 前端 JS（账本抽屉、证据详情、审批决策、接管/恢复、倒计时、halted 横幅） |
| `src/assets-admin.ts` | **专业版 CSS**（左导航/状态栏/配置中心/智能体/后台/数据组件）+ **管理页前端 JS**（保存/切模式/校验/清空确认/过滤） |
| `src/index.ts` | 公开入口（`export *`） |

## 2. 启动方式

CLI 由 Lead 接入（建议命令 `steward console [--port 4180]`，本任务不改 `apps/cli`）：

```ts
// apps/cli/src/index.ts
import {
  createConsoleServer,
  createDemoConsoleProvider,
  createDemoAdminProvider,
} from "../../../packages/steward-console/src/index.js";

const provider = createDemoConsoleProvider();     // 后续替换为真实 domain 适配器
const adminProvider = createDemoAdminProvider();  // 后续替换为 steward-config 的 ConfigEngine 适配器
const consoleServer = await createConsoleServer({ provider, adminProvider, port: 4180 });
console.log(`本地控制台已启动：${consoleServer.url}（只监听 ${consoleServer.host}，Ctrl+C 退出）`);
const shutdown = async () => { await consoleServer.close(); process.exit(0); };
process.on("SIGINT", () => void shutdown());
```

- `host` 默认 `127.0.0.1`；只允许回环地址（`127.0.0.1` / `::1` / `localhost`），其他 host 抛
  `ConsoleSecurityError`。
- `port` 默认 `4180`，`0` 为随机端口（E2E/CI 推荐）。
- `token` 缺省 `crypto.randomBytes(16)`；页面通过 `<meta name="steward-token">` 同源注入，
  前端 JS 放进 `X-Steward-Token`（不进 URL、不写日志）。
- **`adminProvider` 可选**：不传时 v1.0 运营页/API 照常工作，管理页与 `/api/config` 等返回 503
  （向后兼容）。真实浏览器 E2E 与演示使用 `createDemoAdminProvider()`。

## 3. 专业版布局

- **左侧固定导航**（运营：总览 / 项目 / 账本 / 审批 / 月报 / 接管；管理：智能体 / 后台 / 配置 / 数据），
  当前页高亮；底部常驻「只监听 127.0.0.1 · 本地模式」安全徽章。
- **顶部状态栏**：运行模式徽章（体验/个人/企业）、预算余量、Token 余量（剩余/上限）、接管状态
  （运行中/已接管停止）、最近事件时间；保存配置或接管后自动刷新。
- 统一设计 token（状态色/卡片/表格/表单/空态/错误态/键盘焦点可见），以 **1280×800** 为优先，
  1440 宽下侧栏与内容区自适应；深色侧栏 + 浅色内容区。

## 4. 页面清单

| 路径 | 页面 | 要点 |
|---|---|---|
| `/` | 总览看板 | 项目卡（状态/进度/客户）、任务（按代理分组）、预算条（月/项目/单笔）、代理状态、L0 摘要、halted 横幅 |
| `/projects` | 项目列表 | 项目表格 → 进入 `/project/:id` |
| `/project/:id` | 项目时间线 | 消息/任务/交付证据；点开证据显示路径 / 类型 / 置信度 / 采集时间 |
| `/ledger` | 账本 | 点任一笔 → 抽屉显示 **6 要素**（金额/收付方/依据/审批人/回执/所属项目，B2） |
| `/approvals` | 审批卡 | 批准/驳回即时更新且服务端持久；未批准不得自动放行 |
| `/report` | 月报 | 收入/成本/毛利/预算余量/合规事件/下月提案/as_of/coverage |
| `/takeover` | 接管键 | ≤10s halted + 6 类接管包 + 计时 + resume（B6） |
| `/agents` | **智能体中心** | 全部 11 个智能体卡片（名称/角色/状态/当前任务/今日动作/Token/最近 3 条日志），点击展开详情；企业专属 agent 在个人/体验模式显示「该模式不适用」 |
| `/backend` | **后台** | 全流程时间线（计划→行动→观察→验证→留证，按 run 分组）+ 运行队列 + 事件流过滤 + Token/预算消耗 + 异常/接管记录，证据可展开 |
| `/settings` | **配置中心** | 三模式卡片、14 项功能开关、预算（支持 0 元）、Token 预算、**支付与银行卡**、智能体开关、审批与接管；保存/恢复默认/导出 JSON，非法配置显示校验错误 |
| `/data` | **数据管理** | 数据统计（runs/证据/账本项目/磁盘/配置更新时间）、**清空数据（二次确认）**、重置为演示数据、导出配置 JSON；清空后显示空档案引导 |

## 5. 配置中心（`/settings`）

### 5.1 运行模式（三张卡片，切换即应用该模式默认）

| 维度 | 体验模式（demo） | 个人模式（personal） | 企业模式（enterprise） |
|---|---|---|---|
| 支付渠道 | 人工记账（不对接资金渠道） | **微信支付 / 支付宝 / 个人银行卡**（均仅人工审批） | **对公账户** + 人工复核打款 |
| 收款账户 | 演示账户掩码 | 个人：户名/开户行/卡号掩码、微信/支付宝 ID 掩码 | 企业：对公户名/开户行/卡号掩码 |
| 发票 | 不开票 | 个人收据（草稿） | **增值税普票/专票**（抬头+税号掩码，草稿） |
| 合同/签字 | 关闭 | **无签字法务流程** | 启用合同/授权书流程 |
| 双人复核 | 关闭 | 关闭 | **开启**（阈值可配） |
| 用印 | AI 不代签 | AI 不代签 | AI 不代签（**仅草稿+核对清单，人类签署/盖印**） |
| 演示数据 | 开启 | 关闭 | 关闭 |
| 预算默认 | 月 50,000 / 项目 20,000 / 单笔 5,000 | 月 5,000 / 项目 2,000 / 单笔 500 | 月 50,000 / 项目 20,000 / 单笔 5,000 |
| Token 默认 | 10,000,000（演示上限） | 2,000,000 | 10,000,000 |
| 企业主体 | — | — | 必填（名称/统一社会信用代码掩码/法人/授权智能体） |

### 5.2 功能开关（全部可逐项禁用）

`browser / desktop / coding_loop / scout / content / research / payments / invoicing /
notifications / auto_send / console / fault_drills / enterprise / demo_data` —— 每项：
**启用/禁用 + 是否需审批 + 禁用原因（note）**；保存后内核侧应据此拒绝执行并给出可读原因
（演示 provider 仅保存配置，执行拒绝逻辑由真实 ConfigEngine 提供）。

### 5.3 预算与 Token

- 月 / 项目 / 单笔三档预算，**均支持 0 元**；勾选「0 元极限模式」提示「只允许免费本地动作」。
- Token 预算：上限（演示默认 10,000,000）、单步上限、超限策略（阻断/仅通知）、已用/剩余进度条。

### 5.4 支付与银行卡（用户要求：位置清晰可见）

固定位于 `/settings` 中部 **「支付与银行卡」** 高亮分组（琥珀色边框），分两组：

- **个人模式渠道**：微信支付 / 支付宝 / 个人银行卡三行，每行显示 启用开关、渠道模式（仅人工审批）、
  账户掩码（微信 ID / 支付宝 / 银行卡后 4 位）；下方「收款账户」面板显示户名、类型、开户行、
  卡号掩码、微信/支付宝掩码。
- **企业模式结算**：发票类型（普票/专票）、抬头、税号掩码、双人复核开关、合同/授权书流程开关；
  并固定展示 **「AI 不代签」** 徽章与说明。
- 切换模式时该分组按模式应用默认（个人→个人渠道；企业→对公+专票+双人复核；体验→人工记账）。
- **只保存掩码**（卡号仅后 4 位、微信/支付宝 ID 打码），不存明文、不做凭据代填。

### 5.5 其他

- 智能体开关：每个 agent 启用 / 自主等级（只读/只起草/需审批/有限自主）/ Token 限额。
- 审批与接管：审批超时分钟、双人复核阈值、接管快捷键；「自动批准」固定为「永不自动放行」。
- 保存配置：前端校验 + 服务端校验（预算/Token/支付渠道/模式一致性），失败显示**可读错误列表**；
  提供「恢复默认」「导出配置 JSON」。

## 6. 智能体中心（`/agents`）

内置 11 个智能体（演示数据）：总调度 `conductor`、执行 `operator`、**写代码 `harness`**、客户 `customer`、
财务 `finance`、**核查 `reviewer`**、**后台 `backend`**、**找客户 `scout`**、内容 `content`、调研 `research`、
企业合规/用印 `enterprise_admin`（企业模式专属；个人/体验模式显示「该模式不适用」）。

卡片显示：名称/角色/模型、状态（运行中/空闲/等待审批/已禁用/不适用）、当前任务、今日动作数、
Token 消耗、最近 3 条日志；点击展开详情（Token 限额、工具清单、启用状态、适用模式）。

## 7. 后台（`/backend`）

- **全流程时间线**：按 run 分组，事件阶段 `plan → action → observe → verify → evidence`
  （另含 `error` / `takeover`），显示序号、阶段、时间、摘要、执行智能体；证据引用可点击展开
  （路径/类型/置信度/采集时间）。
- **事件流过滤**：按阶段过滤（全部/计划/行动/观察/验证/留证/异常/接管）。
- **运行队列**、**Token/预算消耗**、**异常/接管记录**（风控拦截→停止交人、halted 状态）。

## 8. 数据管理（`/data`）

- 数据统计：运行记录（runs）、证据文件、账本项目、磁盘占用、配置更新时间、数据根目录。
- **清空数据**：必须二次确认（弹窗「确认清空」→ 确认执行）；只清运行数据（runs/证据/账本/流程/队列），
  **保留配置**；清空后页面显示「空档案」引导，统计归零。
- **重置为演示数据**：恢复演示态，便于继续测试。
- **导出配置 JSON**：浏览器下载 `steward-config.json`。

## 9. Provider 扩展：`ConsoleAdminProvider`

定义在 `src/admin.ts`（与 `ConsoleDataProvider` 分离、向后兼容；全部方法 `MaybePromise`）：

| 方法 | 说明 |
|---|---|
| `getConfig()` / `saveConfig(partial)` / `resetConfig(mode?)` / `exportConfig()` | 配置读写（含服务端校验，失败返回 `errors`） |
| `applyMode(mode)` | 切换三模式并应用默认（支付/发票/审批/主体/agent），返回 `diff` |
| `getAgents()` / `getAgentDetail(role)` / `updateAgent(role, patch)` | 智能体中心 |
| `getFlow(filter?)` / `getQueue()` | 后台全流程时间线 / 运行队列 |
| `getDataStats()` / `resetData()` / `resetDemoData()` | 数据管理（清空/重置） |
| `getTokenBudget()` / `getPaymentConfig()` / `getAdminStatus()` | 顶部状态栏与 Token/支付视图 |
| `auditTrail()` | 配置变更/拒绝/超限审计（演示 provider 记录最近 200 条） |

**演示数据**：`createDemoAdminProvider({ mode?, now? })` 提供三模式默认配置（与 task-27
`packages/steward-config` 的 `StewardConfig` 字段对齐）、11 个智能体、4 个 run / 19 条流程事件、
3 项队列、数据统计（46 runs / 187 证据 / 3 项目）；保存与切模式写入内存并即时生效。

### 接真实 `ConfigEngine` 的建议

```ts
import type { ConfigEngine } from "../../packages/steward-config/src/index.js";
import type { ConsoleAdminProvider, StewardConfig } from "../../packages/steward-console/src/index.js";

export function createConfigAdminProvider(engine: ConfigEngine): ConsoleAdminProvider {
  return {
    getConfig: () => engine.load() as StewardConfig,                 // 字段同名，可直接映射
    saveConfig: (partial) => {
      try { const config = engine.save(partial); return { ok: true, config, errors: [] }; }
      catch (error) { return { ok: false, config: engine.load(), errors: [String(error)] }; }
    },
    applyMode: (mode) => engine.setMode(mode),                       // 契约返回 {ok, config, mode, diff}
    resetConfig: (mode) => engine.reset(mode),
    exportConfig: () => JSON.stringify(engine.export(), null, 2),
    getAgents: () => engine.listAgentsWithRuntime(...),              // 静态配置 + 运行态拼接
    getAgentDetail: (role) => ...,
    updateAgent: (role, patch) => { engine.setAgentEnabled(...); ... },
    getFlow: (filter) => readFlowFromArtifacts(dataRoot, filter),    // 复用 EventLog / runs 目录
    getQueue: () => readQueue(dataRoot),
    getDataStats: () => scanDataRoot(dataRoot),
    resetData: () => engine.resetData(dataRoot),                     // 白名单子目录 + 防路径穿越
    resetDemoData: () => engine.reset("demo"),
    getTokenBudget: () => engine.tokenBudget(),                      // 已实现 consume(amount,{agentRole,action})
    getPaymentConfig: () => engine.load().payments,
    getAdminStatus: () => composeStatus(engine, domainProvider),     // budget/token/halted/last_event
    auditTrail: () => engine.auditTrail(),
  };
}
```

接线注意：
1. **字段对齐**：`StewardConfig` 字段与 task-27 契约一致（version/profile/features/budgets/token_budget/
   payments/agents/approval/data/updated_at），适配层只做类型别名与运行态拼接。
2. **写操作留痕**：`saveConfig/applyMode/updateAgent/resetData` 必须写 `EventLog`（哈希链）与配置审计；
   控制台只是入口。
3. **Token/预算门槛**：真实引擎用 `TokenBudget.consume()` 与 `checkBudget()` 在**执行前**拦截，
   控制台只展示与配置；顶部状态栏 `getAdminStatus()` 返回真实剩余。
4. **数据清空安全**：`resetData(dataRoot)` 只能在白名单子目录（runs/evidence/ledger/events/domain）内删除，
   必须防路径穿越；配置保留。
5. **未知 ≠ 成功**：provider 异常时页面/接口报错（503/500），不得伪造成功态。

## 10. HTTP API（v1.1 新增管理侧；旧 API 不变）

读接口无需 token；**写接口必须 `X-Steward-Token`**。统一 `{ok:true,data}` / `{ok:false,error,message}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 当前完整配置（StewardConfig） |
| PUT | `/api/config` | 保存局部配置（body 可直接为 patch 或 `{patch}`）；校验失败 400 + `data.errors` |
| GET | `/api/config/export` | `{json, filename}` 导出 |
| POST | `/api/config/apply-mode` | `{mode:"demo"|"personal"|"enterprise"}` → `{config, mode, diff}` |
| POST | `/api/config/reset` | `{mode?}` 恢复默认 |
| GET | `/api/agents` · `/api/agents/:role` | 智能体列表 / 详情（404） |
| POST | `/api/agents/:role` | `{enabled?, autonomy?, token_limit?}` 更新（400） |
| GET | `/api/flow?phase&run_id&limit` | 全流程时间线（可按阶段/run 过滤） |
| GET | `/api/queue` | 运行队列 |
| GET | `/api/data/stats` | 数据统计 |
| POST | `/api/data/reset` | 清空数据，**必须 `{confirm:true}`**（否则 400 `confirm_required`） |
| POST | `/api/data/reset-demo` | 重置为演示数据 |
| GET | `/api/token-budget` · `/api/payment-config` | Token 预算 / 支付配置（掩码） |
| GET | `/api/admin/status` | 顶部状态栏（mode/budget/token/halted/last_event） |
| GET | `/api/admin/audit` | 配置审计（演示 provider 最近 200 条） |
| GET | `/health` | 存活探测（version 1.1.0 / admin_enabled / mode / halted） |

错误码约定：401 未授权、400 校验失败（`data.errors`）、404 不存在、405 方法不允许、
409 审批冲突、**503 管理功能未启用（未传 adminProvider）**。

## 11. 安全边界

- **只监听回环**：`127.0.0.1`/`::1`/`localhost` 之外 host 直接拒绝启动；无对外网/局域网监听。
- **写操作 token**：随机 32 hex，仅同源 `<meta>` 注入；缺失/错误 → 401；不写日志、不进 URL/结果文件。
- **无 CORS 头**、CSP（`script-src 'self'`、`frame-ancestors 'none'`）、nosniff、no-referrer；
  静态资源全部同源，无 CDN/外链。
- **账户掩码**：支付/银行卡/微信/支付宝 ID 只存掩码；控制台不做凭据代填。
- **AI 不代签**：支付配置 `ai_may_sign` 固定 false；合同/用印仅草稿与核对清单，人类签署。
- **清空数据**：必须二次确认 + 服务端 `confirm:true` 校验；真实引擎侧限制在白名单目录内。

## 12. 真实浏览器验收

```bash
npm run build
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console-v11
```

真实有头 Chrome 完成 15 步（原 9 步运营流程 + 6 步专业版：导航/状态栏、配置中心三模式与支付银行卡、
禁用 scout 持久化与校验错误、智能体中心、后台时间线/过滤/证据、数据清空二次确认与重置、收尾无 JS 错误/无外链）。
实测：**15/15 步、178/178 检查、15 张截图、`measured_stop_ms=84`、`console_boot_ms=7`、约 12s、退出码 0**。
详见 [`tests/e2e-console/README.md`](../../tests/e2e-console/README.md)。

## 13. 已知限制

- **单用户、无登录鉴权、无 HTTPS**：本地单机假设；远程/多人使用需另加认证与 TLS。
- 演示 `adminProvider` 为**内存态**：保存/切模式/清空在进程内生效，重启回到默认；真实 ConfigEngine
  接入后持久化到 `<root>/config.json`（原子写）。
- 演示配置中的金额/账户/智能体日志均为**虚构数据**；支付渠道不做真实扣款/收款，只做配置与审批语义。
- 功能开关的**执行侧拒绝**（`checkFeature`）由真实 ConfigEngine/运行时提供；演示 UI 只保存配置。
- 「导出配置 JSON」依赖浏览器下载；无网络/CDN 依赖但需允许 `blob:` 下载。
- 深色专业主题未做（当前为深色侧栏 + 浅色内容区）；移动端仅基础响应式，目标分辨率 1280×800 起。
