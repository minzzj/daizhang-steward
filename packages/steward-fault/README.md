# `@daizhang/steward-fault` — 故障演练模块（阶段二 P2 / B3 + B4）

代掌 Steward 阶段二 P2 的**故障演练**核心：用**真实 localhost HTTP** 复现两类生产故障，并证明代理不越界：

| 验收 | 场景 | 本模块证明什么 |
|---|---|---|
| **B3** 断网 | 真实断网（目标 2 小时；acceptance 短跑 1–3 真实分钟） | 断网期间**不产生新承诺**（`PromisesGate` 拒绝并计数）；待办动作进 `Outbox`；恢复后幂等重放 + 对账，**账本不重复**（`LedgerReconciler.duplicates_found === 0`，二次对账全部跳过） |
| **B4** 平台封禁 | 模拟平台 B 封禁 15 分钟（acceptance 短跑 1–3 真实分钟） | 真实检测 `403 + x-platform-ban: true` → **停止动作**（封禁期间成功动作数 0）→ 生成可读**替代方案**并写本地通知 → 解禁后恢复 |

- 零第三方依赖：只用 Node 内置 `fetch` / `node:http`（测试侧）/ `node:fs`；
- 网络必须真实：探针、封禁检测、恢复重放全部发真实 HTTP 请求，**不用 mock/stub 替代网络**；
- 无真实外发：通知只写本地 markdown；不连外网、不产生真实支付；
- 时间诚实：`outage_minutes` / `ban_minutes` 是**真实分钟**；`time_scale` 仅测试/演示加速且写入证据。

---

## 1. 真实故障注入方式（两种，均为真实网络故障）

### 1.1 demo-platform 的 `/admin/*` 端点（推荐单机验收）

`examples/demo-platform/server.mjs`（另一任务交付）在 **127.0.0.1** 起两个端口：

- **主端口**（默认 4195）：`/health`、`POST /quote`、`POST /message`（幂等 `idempotency_key`）；
- **控制端口**（默认主端口+1，即 4196）：主端口被模拟断网关闭后，只能通过它执行
  `/admin/outage {mode:"up"}` 恢复；主端口正常时两个端口都接受 `/admin/*`。

| 端点 | 作用 |
|---|---|
| `GET /health` | 健康探针（**ban 期间仍 200**，只有 outage 才不可达） |
| `POST /quote`、`POST /message` | 业务动作（同 `idempotency_key` 幂等；ban 时 403 + `x-platform-ban:true`） |
| `GET /admin/state` | 平台状态（quotes/messages/bans/outage/端口） |
| `POST /admin/outage {mode:"down"|"up"}` | 真实断网：`down` 关闭主端口并销毁所有 socket → 客户端收到**真实 ECONNREFUSED**；`up` 重新 listen |
| `POST /admin/ban {minutes}` | 模拟封禁（**整数分钟**，0 = 取消）：业务端点返回 403 + `x-platform-ban: true` |
| `POST /admin/reset` / `POST /admin/shutdown` | 重置内存状态 / 优雅关闭 |

启动（随机端口 + JSON 第一行输出 `{ok,url,port,control_url,control_port,pid}`）：

```bash
node examples/demo-platform/server.mjs --port 0 --control-port 0 --json
# → {"ok":true,"url":"http://127.0.0.1:xxxxx","port":xxxxx,"control_url":"http://127.0.0.1:yyyyy",...}
```

DrillRunner 传参：`platform_url = startup.url`、`control_url = startup.control_url`
（**断网恢复必须走控制端口**；不传 `control_url` 时默认同主地址，适用于自带定时恢复的测试服务）。

### 1.2 `outage_control` 回调（推荐长跑/进程级故障）

长跑（断网 120 分钟）时建议由 CLI/验收脚本管理平台**子进程**，用回调注入：

```ts
const control = {
  down: async () => { platformChild.kill(); await waitPortClosed(port); },   // 真实进程退出 → ECONNREFUSED
  up: async () => { platformChild = spawnPlatform(port); await waitHealthy(url); },
};
await new DrillRunner().runNetOutageDrill({ platform_url, control_url, state_dir, outage_minutes: 120, outage_control: control });
```

`outage_control.down/up` 与 `/admin/*` 两种方式可随时切换；测试里两种路径都覆盖（真实 ECONNREFUSED）。

---

## 2. 组件与 API

| 组件 | 作用 | 关键 API |
|---|---|---|
| `ConnectivityProbe` | 真实探针：能拿到任意 HTTP 响应（含 403/500）即在线；拒连/超时才离线 | `probe(url, timeoutMs=2000) → {online, latency_ms, error?}`；`waitOnline(url, timeoutMs)` |
| `PromisesGate` | **断网不产生新承诺**；离线抛 `OfflinePromiseError`（文案含“断网期间不产生新承诺”）并计数 | `assertMayPromise(online)`；`blockedCount`；`reset()` |
| `Outbox` | 离线动作队列，JSON 原子持久化 `<state_dir>/outbox.json`；**同幂等键入队幂等、重放跳过已重放** | `enqueue(action)` / `list(filter?)` / `replay(executor)` / `stats()` / `findByIdempotencyKey(key)` |
| `BanDetector` | 真实封禁检测：403/429 **且** `x-platform-ban: true` → `PlatformBannedError`（含 `retry_after_ms/reason`）；非封禁 403、超时**不误判** | `check(url, {method, body, headers, timeoutMs})`；`isBanned`；`last` |
| `AlternativePlan` | 生成可读替代方案（每项：渠道/为什么/下一步/负责人） | `generate({platform?, reason?, ban_minutes?, available_channels?})` |
| `NotificationCenter` | 本地留痕通知：`<state_dir>/notifications/<ts>-<kind>.md`（原子写，不外发） | `notify({kind, title, body, severity}) → path`；`list()` |
| `LedgerReconciler` | 恢复后按 `receipt_ref/idempotency_key` 去重对账；要求 `duplicates_found===0` | `reconcile(domainLedgerApi, outbox) → {replayed, skipped_duplicates, duplicates_found, entries_added, ledger_entries_total}` |
| `JsonLedgerApi` | 本地 JSON 账本（演练用，幂等 `recordLedger`） | 实现 `DomainLedgerApi`（`recordLedger`/`ledger`） |
| `DrillRunner` | 两个真实演练 | `runNetOutageDrill(opts)` / `runPlatformBanDrill(opts)` |

错误类：`FaultValidationError`（输入/前置条件）、`OfflinePromiseError`、`PlatformBannedError`、`OutboxReplayError`。

### 快速开始：B3 断网演练（真实 2 分钟短跑示例）

```ts
import { DrillRunner } from "@daizhang/steward-fault";

const runner = new DrillRunner();
const result = await runner.runNetOutageDrill({
  platform_url: "http://127.0.0.1:4195",
  control_url: "http://127.0.0.1:4196", // demo-platform 控制端口（断网恢复用）
  state_dir: "runs/fault-drill-net",
  outage_minutes: 2,      // 真实 2 分钟（验收短跑 1–3 分钟；目标场景 120）
  tick_seconds: 5,        // 每 5 秒探测 + 承诺门尝试 + 动作入 Outbox
  time_scale: 1,          // 1 = 真实分钟口径
});
console.log(result.ok, result.blocked_promises, result.queued_actions, result.replayed, result.duplicates_found);
```

### 快速开始：B4 封禁演练

```ts
const result = await runner.runPlatformBanDrill({
  platform_url: "http://127.0.0.1:4195",
  control_url: "http://127.0.0.1:4196",
  state_dir: "runs/fault-drill-ban",
  ban_minutes: 2,         // 真实 2 分钟（目标场景 15）
  poll_seconds: 5,
  time_scale: 1,
});
console.log(result.ban_detected_within_ms, result.stopped, result.notification_path, result.recovered);
```

---

## 3. 时间口径与 `time_scale`（诚实原则）

- `outage_minutes` / `ban_minutes` 以**真实分钟**计量；`outage_ms` / `recovery_ms` 用 `Date.now()` 真实测量；
- `time_scale > 1` 只用于测试/演示加速：`effective_ms = nominal_ms / time_scale`；
- 证据里同时记录 `nominal_outage_ms`（真实分钟口径）与 `outage_ms`（实际观测窗口）、`time_scale`、`accelerated`；
- `now` 参数只影响证据里的 ISO 时间戳，**不参与任何时长计算**（禁止用假时钟伪装真实时长）。

| 场景 | 建议参数 |
|---|---|
| 目标验收（B3/B4 文档口径） | `outage_minutes=120` / `ban_minutes=15`，`time_scale=1`（由 Lead 长跑） |
| 短跑验收（本任务证据） | `outage_minutes=1–2` / `ban_minutes=1–2`，`time_scale=1`（真实分钟） |
| 单元测试 | `0.02–0.05` 分钟（真实 1–3 秒）+ 可选 `time_scale` |

---

## 4. 证据结构（落盘 JSON，字段只增不减）

### `drill-net-outage.json`

| 字段 | 含义 |
|---|---|
| `case: "net_outage"` / `started_at` / `finished_at` | 演练标识与时间 |
| `outage_ms` / `nominal_outage_ms` / `time_scale` / `accelerated` | 实际观测离线窗口 / 名义分钟口径 / 是否加速 |
| `probes[]` | 每次真实探测 `{at, online, latency_ms, error?}` |
| `blocked_promises` | 断网期间被 PromisesGate 拦下的承诺次数（>0） |
| `promises_created_during_outage` | 断网期间实际产生的承诺数（必须 0） |
| `queued_actions` / `replayed` | 进入 Outbox 的动作数 / 恢复后真实重放成功数（应相等） |
| `duplicates_found` | 对账发现的真实重复账本条目数（必须 0） |
| `recovered` / `recovery_ms` / `recovered_within_10min` | 恢复状态 / 恢复耗时 / 是否 10 分钟内 |
| `reconcile` / `reconcile_repeat` | 首次补记（entries_added=queued_actions）+ 二次对账（entries_added=0，全部跳过） |
| `ticks[]` / `notifications[]` / `evidence_paths[]` / `environment` / `events[]` | 过程留痕与本地通知路径 |
| `ok` | 全链路是否达标 |

### `drill-platform-ban.json`

| 字段 | 含义 |
|---|---|
| `case: "platform_ban"` / `started_at` / `finished_at` | 演练标识与时间 |
| `ban_minutes` / `time_scale` / `accelerated` | 真实分钟口径 / 加速标记 |
| `ban_detected` / `ban_detected_within_ms` | 是否真实检测到 403+header / 检测耗时 |
| `actions_attempted_during_ban` / `successful_actions_during_ban` | 封禁期间尝试动作数 / 成功数（必须 0） |
| `stopped` | 是否已停止动作（= detected 且成功数为 0） |
| `alternative_plan` | 替代方案 `{title, items[{channel,why,next_action,owner}], generated_at}` |
| `notification_path` / `recovery_notification_path` | 本地通知文件（替代方案可读留痕） |
| `recovered` / `recovered_within_ms` | 解禁后是否恢复 / 恢复耗时 |
| `polls[]` / `evidence_paths[]` / `environment` / `events[]` / `ok` | 过程留痕与结论 |

此外：`outbox.json`、`ledger.json`、`notifications/*.md`、`alternative-plan.json` 均落在 `state_dir`；所有 JSON 原子写（tmp+rename）。

---

## 5. 测试（`tests/unit/fault.test.mjs`，20 条）

全部用 Node 内置 `http` 起**真实本地服务**（端口 0），不使用 mock 网络：

- Probe：真实在线 / 真实 ECONNREFUSED / 真实超时；
- Outbox：幂等入队、跨实例持久化、重放跳过（executor 不重复调用）、duplicate 统计、executor 抛错 → `OutboxReplayError` + failed 状态；
- PromisesGate：离线拒绝 + blockedCount；
- BanDetector：真实 403+`x-platform-ban:true` → `PlatformBannedError`（retry_after/reason）、普通 403/200 不误判、超时不误判；
- AlternativePlan 字段可读；NotificationCenter 文件落盘；
- LedgerReconciler：首次全新增、二次全跳过、`duplicates_found=0`；人为注入重复时能发现 `duplicates_found>0`；
- net-outage drill：3 秒真实断网（admin 注入）、`outage_control` 杀/重启路径、平台不可达拒绝演练、`time_scale` 记录诚实、证据 JSON 字段完整；
- platform-ban drill：1.2 秒真实封禁 → 检测/停止/替代方案/通知/恢复；平台未真正封禁时 `ok=false`（不谎报）。

```bash
npm run build
node --test tests/unit/fault.test.mjs
```

---

## 6. CLI 集成建议（给 Lead）

建议新增命令（与现有 `apps/cli/src/index.ts` 风格一致）：

```ts
// steward fault-drill --case net-outage|platform-ban --outage-minutes N --ban-minutes N --json
case "fault-drill": {
  const runner = new DrillRunner();
  const platformUrl = flagString(flags, "platform-url") ?? "http://127.0.0.1:4195";
  const controlUrl = flagString(flags, "control-url") ?? "http://127.0.0.1:4196";
  const stateDir = join(root, "runs", `fault-${Date.now()}`);
  const caseName = flagString(flags, "case") ?? "net-outage";
  const result =
    caseName === "platform-ban"
      ? await runner.runPlatformBanDrill({
          platform_url: platformUrl, control_url: controlUrl, state_dir: stateDir,
          ban_minutes: Number(flagString(flags, "ban-minutes") ?? 15),
          poll_seconds: Number(flagString(flags, "poll-seconds") ?? 5),
          time_scale: Number(flagString(flags, "time-scale") ?? 1),
        })
      : await runner.runNetOutageDrill({
          platform_url: platformUrl, control_url: controlUrl, state_dir: stateDir,
          outage_minutes: Number(flagString(flags, "outage-minutes") ?? 120),
          tick_seconds: Number(flagString(flags, "tick-seconds") ?? 5),
          time_scale: Number(flagString(flags, "time-scale") ?? 1),
        });
  console.log(flags.json === true ? JSON.stringify(result, null, 2) : `${caseName}: ok=${result.ok}`);
  return result.ok ? 0 : 1;
}
```

demo-platform 启停（CLI/验收脚本）：

```ts
import { spawn } from "node:child_process";
// 启动：--port 0 --control-port 0 --json → 解析 stdout 第一行 JSON 拿 url/control_url
const child = spawn(process.execPath, ["examples/demo-platform/server.mjs", "--port", "0", "--control-port", "0", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
// 关闭：优先 POST <control_url>/admin/shutdown（优雅）；兜底 child.kill()
```

`npm run acceptance:p2` 建议串联：启动 demo-platform（随机端口）→ `fault-drill --case net-outage --outage-minutes 2` → `fault-drill --case platform-ban --ban-minutes 2` → 汇总证据到 `docs/test-evidence/`；CI 用 `--time-scale` 跑 1–2 分钟加速版并在证据中标注 `accelerated=true`。

---

## 7. 非目标与已知限制

- 不连接真实外网/真实平台账号；demo-platform 是纯本地仿真（只监听 127.0.0.1）；
- 通知**不外发**（只写本地 markdown）；接入企业微信/邮件由后续通知适配器负责；
- 封禁检测依赖平台返回 `x-platform-ban` 头（demo-platform 已按契约实现）；无该头的 403 按普通错误处理，不误判；
- `/admin/ban` 只接受整数分钟：短跑时演练会用 `ceil(minutes)≥1` 注入并在窗口结束时显式取消，不改变实际封禁窗口；
- 断网恢复必须走平台控制端口（或 `outage_control` 重启进程）——主端口关闭后无法再收到 HTTP 请求；
- 长跑（120 分钟断网 / 15 分钟封禁）由 Lead 用同一 `DrillRunner` 执行；长跑期间进程需保持存活（演练本身不依赖假时钟）；
- Windows/Node 计时精度：`tick_seconds` 最小支持 0.02s（内部下限 20ms），极短 tick 可能带来少量调度抖动，证据会记录真实时延。
