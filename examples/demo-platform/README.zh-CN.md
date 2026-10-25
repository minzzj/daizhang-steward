# demo-platform · 真实 localhost 外部平台 fixtures

> 状态：**阶段二 P2-B 交付**（2026-10-25）。本目录提供一个**真实运行的本地 HTTP 平台服务**，用于 P2 故障演练：
> **B3 断网**（客户端收到真实 `ECONNREFUSED`）与 **B4 平台封禁**（业务端点真实 `403` + `x-platform-ban: true`）。
> 纯本地仿真：只监听 `127.0.0.1`，不访问外网、不产生真实支付、不接收真实个人信息。

## 1. 虚构性与安全声明（先读这一节）

- 这是**本地仿真平台**，业务数据（报价/消息）均为虚构演示数据，进程退出即清空；不连接任何真实平台、不产生真实外网请求与真实支付。
- 只监听回环地址 `127.0.0.1`（主端口默认 **4195**，控制端口默认 **4196**），**不监听 `0.0.0.0`**，同一局域网内的其他机器无法访问。
- `/admin/*` 管理端点**无鉴权**（本机演练需要脚本直接注入故障）；**仅限本机测试使用，不得部署到共享网络或生产环境**。若需对外必须另行加鉴权、HTTPS 与网络隔离。
- 请求日志不打印请求体，避免把业务内容写进日志；平台不采集真实客户信息、不保存支付信息。

## 2. 文件结构

| 文件 | 说明 |
|---|---|
| `server.mjs` | 零依赖 Node 内置 http 平台服务：幂等 `/quote`、幂等 `/message`、健康探针、故障注入管理端点、优雅关闭 |
| `run-drill-helper.mjs` | 可选辅助脚本：把 `server.mjs` 作为子进程启动、打印 URL，并从 stdin 接受 `down/up/ban/reset/state/quit` 管理命令 |
| `README.zh-CN.md` | 本文档：端点表、幂等语义、断网恢复契约、演练示例、安全边界、已知限制 |

## 3. 快速开始

```bash
# 在仓库根目录
node examples/demo-platform/server.mjs
# → [demo-platform] 演示平台已启动：http://127.0.0.1:4195
# → [demo-platform] 控制端口（断网恢复用）：http://127.0.0.1:4196

# 推荐给脚本/CLI 使用：--json 模式
node examples/demo-platform/server.mjs --json
# stdout 第一行（可直接 JSON.parse）：
# {"ok":true,"url":"http://127.0.0.1:4195","port":4195,"control_url":"http://127.0.0.1:4196","control_port":4196,"pid":12345}
```

可选参数：

| 参数 | 说明 |
|---|---|
| `--port <端口>` | 主端口，默认 `4195`；`0` = 随机端口（实际端口见启动 JSON）。也可用环境变量 `PORT` |
| `--control-port <端口>` | 控制端口，默认主端口 + 1；`0` = 随机端口。也可用环境变量 `CONTROL_PORT` |
| `--json` | 启动成功后向 **stdout 第一行**打印单行 JSON；管理/事件日志改走 stderr（请求日志仍写 stdout） |
| `--quiet` | 不打印请求日志（仍打印启动/管理事件） |
| `-h, --help` | 帮助 |

停止（优雅关闭，端口全部释放）：

```bash
curl -s -X POST http://127.0.0.1:4196/admin/shutdown   # 推荐：控制端口（--json 的 control_url）
# 或前台 Ctrl+C / SIGINT / SIGTERM
```

## 4. 端点表

> **端口说明**：主端口（默认 4195）承载业务端点；控制端口（默认 4196）始终监听，用于主端口断网后恢复。
> 主端口正常时，两个端口都接受 `/admin/*`；控制端口只额外接受 `/health`，业务路径在控制端口返回 404。

| 方法 | 路径 | 可用端口 | 说明 |
|---|---|---|---|
| GET | `/health` | 主 + 控制 | 健康探针，返回 `{ok:true, ts}`；**ban 期间仍 200**；outage 期间主端口不可达、控制端口仍 200 |
| POST | `/quote` | 主 | 幂等创建报价（body `{idempotency_key, customer, amount_cny, note}`）→ `{ok, quote_id, duplicate, quote}`；ban 期间 403 |
| POST | `/message` | 主 | 幂等追加消息（body `{idempotency_key, thread_id, text}`）→ `{ok, message_id, duplicate, thread_id, thread_seq, message}`；ban 期间 403 |
| GET | `/admin/state` | 主 + 控制 | `{ok, quotes, messages, bans:{active,until,remaining_ms}, outage, port, control_port, main_url, control_url, quote_list, message_list, counters, uptime_ms}`；`quotes`/`messages` 为条数 |
| POST | `/admin/outage` | 主 + 控制 | body `{mode:"down"|"up"}`。`down`：先返回响应，随后主端口 **close + 销毁所有 socket**（客户端真实 `ECONNREFUSED`）；可带 `reopen_after_ms`（毫秒，优先）或 `minutes`（分钟，可为小数）→ 到点**自动重新 listen 主端口**（P2 演练器的默认用法）；也支持经控制端口手动 `up` |
| POST | `/admin/ban` | 主 + 控制 | body `{minutes}`（数字 0–1440，**支持小数分钟**如 `0.05`；`0` = 取消）。之后 `/quote`、`/message` 返回 403 + `x-platform-ban: true` + `{ok:false, error:"platform_banned", retry_after_ms}`；到期自动解除 |
| POST | `/admin/reset` | 主 + 控制 | 清空报价/消息/幂等键/封禁（断网状态不变） |
| POST | `/admin/shutdown` | 主 + 控制 | 优雅关闭进程（退出码 0，端口释放） |

错误统一为 `{ok:false, error:"...", message?:"..."}`：参数错 `400`、未知路径 `404`、方法错 `405`、封禁 `403`、内部错误 `500`。

## 5. 幂等语义（B3 补记不重复的关键）

- `/quote` 与 `/message` 都必须带 `idempotency_key`（非空字符串）。**同一 key 只会产生一条记录**：
  - 第一次：`duplicate:false`，返回新建的 `quote_id` / `message_id`；
  - 第二次起（同 key）：`duplicate:true`，返回**同一** `quote_id` / `message_id` 与首次结果，**不重复建单/追加**。
- 幂等键按端点类型分别维护（quote key 与 message key 互不影响）；不同 key 但相同内容会各自创建（平台不去重业务内容）。
- 同 key 但 body 不同时，仍返回**首次**创建结果（不做参数冲突校验）——演练中用于验证"重试/补记不会产生重复记录"。
- 幂等键保存在内存：进程重启或 `/admin/reset` 后失效，演练可从干净状态重复执行。
- `/message` 额外返回 `thread_seq`（同一 `thread_id` 内的顺序号），用于核对补记消息的顺序与条数。

## 6. 断网（outage）与封禁（ban）的真实性

| 演练 | 真实观测（不是伪造错误） |
|---|---|
| `POST /admin/outage {mode:"down"}` | 主端口 socket 被销毁且不再 `listen` → 新连接在操作系统层面被拒绝：Node 客户端 `error.code === "ECONNREFUSED"`；`curl` 报 `curl: (7) Failed to connect` |
| `POST /admin/outage {mode:"down", reopen_after_ms:N}` | 同上，且服务端安排 **N 毫秒后自动恢复**（响应返回 `auto_reopen:true` / `reopen_at`；`minutes` 可作为回退参数，支持小数）。P2 演练器默认使用这种方式，因为主端口断开后无法再向主端口发 `up` |
| `POST /admin/outage {mode:"up"}`（经控制端口） | 手动恢复：主端口在同一端口重新 `listen` → `/health` 恢复 200；会取消已安排的自动恢复计划 |
| `POST /admin/ban {minutes:N}` | 业务端点真实返回 `403` + 响应头 `x-platform-ban: true` + 错误体 `platform_banned`（`retry_after_ms` 为剩余冷却毫秒）；`/health` 仍 `200`；`/admin/*` 不受影响；到期自动解除（支持小数分钟便于加速演练） |
| `POST /admin/ban {minutes:0}` | 立即取消封禁，业务端点恢复 `200` |
| `POST /admin/shutdown` | 进程退出码 0，主/控制端口均不再监听（无残留端口） |

> **为什么需要控制端口？** `down` 之后主端口已不再监听，HTTP 上不可能再从主端口下发 `up`。因此平台**始终**在控制端口（默认主端口+1）提供 `/admin/*`；断网恢复必须走控制端口（`down` 响应与 `/admin/state` 都会返回 `control_url` 与 `recovery` 提示）。这是本 fixture 的固定集成契约。

## 7. 演练示例（B3 断网 / B4 封禁）

以下示例在仓库根目录、平台已用 `node examples/demo-platform/server.mjs --json` 启动后执行（Windows 用 `curl.exe`）：

```bash
# 0) 正常写入：第一次 duplicate=false，第二次同 key duplicate=true（幂等）
curl -s -X POST http://127.0.0.1:4195/quote \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"drill-quote-1\",\"customer\":\"示例客户（虚构）\",\"amount_cny\":16000,\"note\":\"演练报价\"}"
curl -s http://127.0.0.1:4195/admin/state          # quotes = 1

# 1) B3 断网（P2 演练器默认用法：到点自动恢复）
curl -s -X POST http://127.0.0.1:4195/admin/outage \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"down\",\"reopen_after_ms\":3000}"
# → {"ok":true,...,"auto_reopen":true,"reopen_at":"..."}（也可用分钟："minutes":0.05）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4195/health
# curl: (7) Failed to connect to 127.0.0.1 port 4195 ...（真实 ECONNREFUSED，非 HTTP 错误码）
curl -s http://127.0.0.1:4196/admin/state          # outage=true，quotes/messages 保留
sleep 3                                            # 等待自动恢复（PowerShell: Start-Sleep -Seconds 3）
curl -s http://127.0.0.1:4195/health               # {ok:true,...}：主端口已自动重新监听

# 2) 手动恢复（可选，控制端口；会取消自动恢复计划）
curl -s -X POST http://127.0.0.1:4196/admin/outage \
  -H "Content-Type: application/json" -d "{\"mode\":\"up\"}"
curl -s http://127.0.0.1:4195/health               # {ok:true,...}

# 3) B4 封禁 15 分钟：业务 403 + x-platform-ban: true，health 仍 200
curl -s -X POST http://127.0.0.1:4195/admin/ban \
  -H "Content-Type: application/json" -d "{\"minutes\":15}"
curl -s -i -X POST http://127.0.0.1:4195/quote -H "Content-Type: application/json" -d "{}" | head -n 12
# HTTP/1.1 403 ... x-platform-ban: true ... {"ok":false,"error":"platform_banned","retry_after_ms":...}
curl -s http://127.0.0.1:4195/health               # 仍 200
curl -s -X POST http://127.0.0.1:4195/admin/ban \
  -H "Content-Type: application/json" -d "{\"minutes\":0}"    # 取消封禁

# 4) 复位与停止
curl -s -X POST http://127.0.0.1:4195/admin/reset  # 清空数据/封禁（演示重复执行）
curl -s -X POST http://127.0.0.1:4196/admin/shutdown
```

辅助脚本（可选，适合人工演练或简单进程管理）：

```bash
node examples/demo-platform/run-drill-helper.mjs --port 4195
# → [demo-platform-helper] server_url=http://127.0.0.1:4195
# → [demo-platform-helper] control_url=http://127.0.0.1:4196
# stdin 输入：state | down | up | ban 15 | reset | shutdown | quit
```

## 8. 给演练脚本的集成约定（P2-A）

1. 用 `spawn(process.execPath, ["examples/demo-platform/server.mjs", "--json", "--port", "4195"])` 启动；
   `--json` 模式 **stdout 第一行**就是启动 JSON（`{ok,url,port,control_url,control_port,pid}`），可直接解析；请求日志在其后逐行输出。
2. 断言断网必须检查**真实错误码**：`net.connect` 的 `error.code === "ECONNREFUSED"`；
   `fetch` 失败时看 `error.cause.code`（不要把它当成 HTTP 5xx 或超时）。
3. 断网恢复：`down` 时带 `reopen_after_ms`（P2 演练器默认会带，也可用小数 `minutes`）→ 平台**到点自动恢复**；
   若需手动恢复，主端口此时已不可达，**只能**用启动 JSON 里的 `control_url` 发
   `POST {control_url}/admin/outage {"mode":"up"}`（会取消自动恢复计划）。`down` 响应里也带了同样的 `recovery` 提示。
4. 演练结束用 `POST {control_url}/admin/shutdown` 关闭，等待子进程退出码 0，并确认端口不再监听。
5. 断言封禁：HTTP 状态 403、响应头 `x-platform-ban: true`、错误体 `error === "platform_banned"`；
   同时断言 `/health` 仍 200（平台整体存活、仅业务被拒）。ban 的 `minutes` 支持小数（如 `0.05` = 3 秒），便于加速演练。

## 9. 自检（真实运行，5 项核心）

| # | 操作 | 期望（真实观测） |
|---|---|---|
| 1 | 启动后 `GET /health` | `200 {"ok":true,"ts":"..."}` |
| 2 | 同 `idempotency_key` 连续 `POST /quote` 两次 | 第 1 次 `duplicate:false`；第 2 次 `duplicate:true` 且 `quote_id` 相同；`/admin/state` 的 `quotes` 仍为 1 |
| 3 | `POST /admin/outage {"mode":"down"}` 后发新请求 | 客户端 `ECONNREFUSED`（`curl` 报 `(7) Failed to connect`）；控制端口 `/admin/state` 显示 `outage:true` 且数据保留；经控制端口 `up` 后 `/health` 恢复 200 |
| 4 | `POST /admin/ban {"minutes":1}` 后 `POST /quote` | `403` + `x-platform-ban: true` + `platform_banned`；`/health` 仍 200；`minutes:0` 后业务恢复 200 |
| 5 | `POST /admin/shutdown` | 进程退出码 0；主端口/控制端口均无监听（`ECONNREFUSED`）；无残留进程 |

开发期已用独立自检脚本对以上流程做过完整真实运行（含 `--json` 首行、请求日志、helper 启停、无残留端口），全部通过；该脚本不随仓库提交，仓库内可用第 7 节命令复跑。

## 10. 安全边界（必须遵守）

- 只监听 `127.0.0.1`；**不得**改成 `0.0.0.0` 或暴露到公网/共享网络。
- `/admin/*` **无鉴权**，任何本机进程都能触发断网/封禁；仅用于本地演练，用完立即 `/admin/shutdown`。
- 不接入真实平台、不发起真实外网请求、不产生真实支付或真实外发消息；数据仅内存、纯虚构。
- 不接收/记录真实个人信息、账号、密钥；请求日志只记录方法/路径/状态/耗时，不记录请求体。
- 本 fixture 不是生产服务器：无 HTTPS、无鉴权、无持久化、无多租户、无速率限制。

## 11. 已知限制

- **内存态**：进程重启后数据、幂等键、封禁状态全部清空；重复演练请先 `/admin/reset` 或重启。
- **控制端口可能被占**：默认主端口+1，被占用时会自动尝试 +2…+21；`--control-port` 可显式指定。控制端口在启动时若全部不可用则进程退出（断网后无法恢复，必须保证有控制端口）。
- **up 冲突**：断网期间若主端口被其他进程抢占，`up` 返回 `500 listen_failed` 并保持断网状态；演练前确认端口空闲。
- **"断网"的边界**：这里模拟的是"本机到该平台端口的 TCP 连接被拒绝"。B3 的"断网 2 小时"若要覆盖互联网/防火墙级丢包，应从操作系统防火墙或网络层演练；本平台用于"外部平台不可达"这一子场景的真实故障注入。
- **自动恢复依赖进程存活**：`reopen_after_ms` 定时器在平台进程内；若演练器选择"杀进程"式注入（`outage_control`），自动恢复不会生效，需要由演练器重启进程。自动恢复上限 24 小时（`reopen_after_ms` ≥ 1ms）。
- **封禁时长**：`minutes` 支持 0–1440 的小数（如 `0.01` = 600ms，便于加速演练）；真实 15 分钟演练请传 `15`，不要依赖加速值做验收。
- **`curl` 与 Node 观测不同**：`curl` 只显示退出码/错误文本（如 `(7) Failed to connect`），Node 通过 `error.code` 拿到 `ECONNREFUSED`；fetch 需读 `error.cause.code`。
- 仅接受 `application/json` 请求体；`/quote`、`/message` 只做格式/长度校验，不校验真实业务规则；未做并发压力测试。
- 辅助脚本 `run-drill-helper.mjs` 仅观察/转发子进程，不替演练脚本做断言；正式验收仍应使用 P2-A 的演练 runner + 真实证据。
