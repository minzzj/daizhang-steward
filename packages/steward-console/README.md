# packages/steward-console · 本地 Web 控制台（阶段二 P1-C）

> 状态：**已实现**（阶段二 P1 个人版 MVP 的界面层）。零第三方依赖：Node 内置 `node:http`
> + 原生 HTML/CSS/JS；**只监听 127.0.0.1**；写操作需 `X-Steward-Token`；无 CDN / 外链 / 外网字体。
> 真实浏览器 E2E：`tests/e2e-console/run.mjs`（有头 Chrome/Edge，每步截图，输出 `measured_stop_ms`）。

## 1. 目录 / 文件

| 文件 | 说明 |
|---|---|
| `src/server.ts` | `createConsoleServer({provider, host?, port?, token?, log?})`：HTTP 服务、页面/API 路由、写操作 token 校验、安全头、`close()` 释放端口 |
| `src/provider.ts` | `ConsoleDataProvider` 接口（不依赖 `steward-domain`）+ `createDemoConsoleProvider()` 内置仿真数据 |
| `src/pages.ts` | 服务端渲染页面（看板 / 项目时间线 / 账本 / 审批 / 月报 / 接管 + 错误页） |
| `src/assets.ts` | 内联 CSS + 原生前端 JS（账本抽屉、证据详情、审批决策、接管/恢复、倒计时） |
| `src/index.ts` | 公开入口（`export *`） |

## 2. 启动方式

CLI 由 Lead 接入（建议命令 `steward console`，本任务不修改 `apps/cli`）：

```ts
// apps/cli/src/index.ts
import { createConsoleServer, createDemoConsoleProvider } from "../../../packages/steward-console/src/index.js";

async function cmdConsole(parsed: ParsedArgs): Promise<number> {
  const portText = flagString(parsed.flags, "port");
  const port = portText === undefined ? 4180 : Number.parseInt(portText, 10);
  const provider = createDemoConsoleProvider(); // 后续替换为 createDomainConsoleProvider(domain)
  const consoleServer = await createConsoleServer({ provider, port });
  console.log(`本地控制台已启动：${consoleServer.url}（只监听 ${consoleServer.host}，Ctrl+C 退出）`);
  const shutdown = async () => { await consoleServer.close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown());
  return await new Promise<number>((resolve) => {
    consoleServer.server.on("close", () => resolve(0));
  });
}
```

直接调用示例：

```ts
import { createConsoleServer, createDemoConsoleProvider } from "../../packages/steward-console/src/index.js";

const server = await createConsoleServer({ provider: createDemoConsoleProvider(), port: 0 });
console.log(server.url, server.token.length); // port=0 → 随机端口，便于 E2E/CI
await server.close();
```

- `host` 默认 `127.0.0.1`；只允许回环地址（`127.0.0.1` / `::1` / `localhost`），传其它 host 会抛
  `ConsoleSecurityError`（本地单机界面不允许对外暴露）。
- `port` 默认 `4180`；`0` 表示随机端口（**E2E/CI 推荐**，避免端口冲突）。
- `token` 缺省用 `crypto.randomBytes(16)` 生成，构造时返回给调用方；页面通过
  `<meta name="steward-token">` 同源注入，前端 JS 读取后放进 `X-Steward-Token`（不进 URL、不写日志）。

## 3. 页面（中文 UI）

| 路径 | 页面 | 验收点 |
|---|---|---|
| `/` | 看板：项目卡（状态/进度/客户）、任务（按代理分组）、预算条（月/项目/单笔）、代理状态、L0 摘要、halted 横幅 | P1-C 看板 |
| `/project/:id` | 项目时间线（消息/任务/交付证据），点开证据显示**路径 / 类型 / 置信度 / 采集时间** | 证据可追溯 |
| `/ledger` | 账本表；点击任一笔 → 详情抽屉显示 **6 要素**（金额 / 收付方 / 依据 / 审批人 / 回执 / 所属项目） | **B2** |
| `/approvals` | 审批卡（内容/金额/证据/到期倒计时）；批准 / 驳回 → 状态即时更新并持久到 provider | 未批准不得自动放行 |
| `/report` | 月报：收入 / 成本 / 毛利 / 预算余量 / 合规事件 / 下月提案 / as_of / coverage | P1-C 月报 |
| `/takeover` | 接管键（大按钮）→ halted + **6 类接管包** + 计时；支持 resume | **B6**（≤10s） |
| `/health` | 存活探测 JSON（`{ok, service, local_only, halted, uptime_ms}`） | 自检 |

全局页脚/页头固定显示「只监听 127.0.0.1 · 本地模式」。

## 4. HTTP API

读接口无需 token；写接口必须带 `X-Steward-Token`（缺失/错误 → 401 JSON）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/overview` | 看板数据（项目/任务/代理/预算） |
| GET | `/api/projects/:id/timeline` | 项目时间线 |
| GET | `/api/evidence/:ref` | 证据详情（path/kind/confidence/captured_at） |
| GET | `/api/ledger?project_id&type&limit` | 账本列表（可过滤） |
| GET | `/api/ledger/:id/facts` | **账本 6 要素** |
| GET | `/api/approvals` | 审批卡列表 |
| POST | `/api/approvals/:id/decide` | body `{decision:"approve"|"reject", by?}`；重复处理 → 409 |
| GET | `/api/takeover` | 接管状态（halted / stopped_at / resumed_at / pack / elapsed_ms） |
| POST | `/api/takeover` | body `{reason?, by?}` → 停止并生成接管包 |
| POST | `/api/takeover/resume` | body `{by?}` → 恢复运行 |
| GET | `/api/monthly-report` | 月报 |
| GET | `/api/summary?level=L0|L1|L2` | 分级摘要（`provider.summary`） |

响应统一 `{ok:true,data}` / `{ok:false,error,message}`；所有响应带 `X-Content-Type-Options: nosniff`、
`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`；HTML 额外带 CSP（`script-src 'self'`、
`frame-ancestors 'none'`），页面无内联脚本（token 走 meta 标签）。

## 5. ConsoleDataProvider 契约

`src/provider.ts` 定义（**不依赖 `steward-domain`**，便于与经营域并行开发）：

| 方法 | 返回 |
|---|---|
| `overview()` | `{asOf, projects[], tasks[], agents[], budget{month_cny,spent_cny,left_cny,per_txn_cny, project_budget?}}` |
| `projectTimeline(projectId)` | `Array<{ts,kind,text,evidence_ref?}>` |
| `ledger(filter?)` | `Array<{id,project_id,type,amount_cny,payee_or_payer,basis,approved_by,receipt_ref,occurred_at}>` |
| `ledgerFacts(entryId)` | `{amount_cny,payee_or_payer,basis,approved_by,receipt_ref,project_id} \| null`（B2 6 要素） |
| `approvals()` | `Array<{id,kind,summary,amount_cny?,evidence_ids,expires_at,status}>` |
| `decideApproval(id, decision, by)` | `{ok, status, reason?}` |
| `takeover(reason, by)` | `{stopped_at, halted, pack{open_orders[],pending_threads[],payables[],credentials[],risks[],coverage}}` |
| `monthlyReport()` | `{month,income_cny,cost_cny,gross_margin_cny,budget_left_cny,compliance_events[],next_proposals[],as_of,coverage}` |
| `summary(level)` | `unknown`（L0/L1/L2） |
| `takeoverStatus()` | 扩展：`{halted, stopped_at, resumed_at, pack, elapsed_ms}`（页面刷新后仍显示接管态） |
| `resume(by)` | 扩展：`{resumed_at, halted}`（接管页 resume） |
| `evidenceDetail(ref)` | 扩展：`{id,kind,path,confidence,captured_at?} \| null`（证据点开） |

- 所有方法返回 `T | Promise<T>`（`MaybePromise`），服务端统一 `await`；仿真 provider 全同步，真实
  domain 适配器可直接返回 Promise。
- 核心 9 个方法来自 P1-C 契约；末尾 3 个是页面渲染所需扩展（字段只增不减，真实 domain 实现成本很低）。

### 接真实 domain 的建议

```ts
import type { DomainEngine } from "steward-domain"; // Lead 的 P1-A/P1-B 包
import type { ConsoleDataProvider } from "../../packages/steward-console/src/index.js";

export function createDomainConsoleProvider(domain: DomainEngine): ConsoleDataProvider {
  return {
    overview: async () => {
      const snapshot = await domain.snapshot();
      return {
        asOf: new Date().toISOString(),
        projects: snapshot.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, client: p.client_ref, progress: p.progress })),
        tasks: snapshot.tasks.map((t) => ({ id: t.id, project_id: t.project_id, agent_role: t.agent_role, goal: t.goal, status: t.status })),
        agents: snapshot.agents,
        budget: { month_cny: snapshot.budget.month_cny, spent_cny: snapshot.budget.spent_cny, left_cny: snapshot.budget.left_cny, per_txn_cny: snapshot.budget.per_txn_cny },
      };
    },
    ledger: (filter) => domain.ledger.list(filter),
    ledgerFacts: (id) => domain.ledger.facts(id),                 // 直接映射 6 要素
    approvals: () => domain.approvals.pendingAndHistory(),
    decideApproval: (id, decision, by) => domain.approvals.decide(id, decision, by), // 写操作要写事件账本
    takeover: (reason, by) => domain.takeover.halt(reason, by),   // 与 StopController 联动，≤10s
    takeoverStatus: () => domain.takeover.status(),
    resume: (by) => domain.takeover.resume(by),
    projectTimeline: (id) => domain.projects.timeline(id),
    evidenceDetail: (ref) => domain.evidence.get(ref),
    monthlyReport: () => domain.reports.monthly(),
    summary: (level) => domain.summary(level),
  };
}
```

建议映射注意：
1. **写操作留痕**：`decideApproval` / `takeover` / `resume` 都要写 `EventLog`（哈希链）与证据目录，
   控制台只是入口，审计在 domain。
2. **接管与运行时联动**：`takeover()` 应调用 `StopController.request()`（M2-A8 已实现 ≤5s 停止），
   `takeoverStatus()` 返回真实 halted 状态；`coverage` 如实标注 `complete/partial/not_covered`。
3. **凭据只给引用**：`pack.credentials` 只能是 `vault://...` 引用，禁止明文；控制台不做凭据代填。
4. **未知 ≠ 成功**：provider 取不到数据时应报错 → 页面显示错误/`coverage` 降级，不得伪造成功。

## 6. 安全边界

- **只监听回环**：`127.0.0.1`/`::1`/`localhost` 之外 host 直接拒绝启动；无对外网/局域网监听。
- **写操作 token**：随机 32 hex，仅同源页面 `<meta>` 注入；`X-Steward-Token` 缺失/错误 → 401；
  token 不写日志、不进 URL/结果文件（E2E 只断言其生效，不落盘明文）。
- **无 CORS 头**：浏览器跨源读取被同源策略阻止；自定义头写请求会触发预检失败。
- **CSP / 安全头**：`script-src 'self'`（无内联脚本）、`frame-ancestors 'none'`、`nosniff`、
  `no-referrer`；静态资源全部同源（无 CDN/外链/外网字体）。
- **最小写面**：只有审批决策、接管、恢复三类写 API；金额/账本/月报为只读渲染。
- 本地单机假设：**不做多用户鉴权/权限模型**（阶段二 P1 个人版），见「已知限制」。

## 7. 真实浏览器验收

```bash
npm run build
node tests/e2e-console/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-console
```

有头真实 Chrome/Edge，完成看板 → 项目时间线/证据 → 账本 6 要素 → 审批批准/驳回 → 接管（实测
`measured_stop_ms`）→ 月报 → 只监听本机 共 9 步，每步截图，输出 `result.json`（含 `steps/checks/
measured_stop_ms/evidence[]`）。详见 [`tests/e2e-console/README.md`](../../tests/e2e-console/README.md)。

## 8. 已知限制

- **单用户、无登录鉴权**：本地单机假设；多人/远程访问需另加认证与 HTTPS（阶段二后续）。
- **无 HTTPS**：仅回环 HTTP；token 防误触发而非抗本机恶意进程。
- 内置仿真 provider 的状态（审批决策 / 接管）**只在进程内有效**，重启即重置；接真实 domain 后落库。
- 仿真数据为虚构示例（客户名/金额/凭据引用），不来自真实客户。
- 月报 `coverage` 为 `partial` 时不得对外作为承诺依据（页面有提示）。
- 未实现：导出 CSV/PDF、通知推送（U2）、多语言 UI、移动端专门适配（响应式仅基础支持）。
