# Examples

> 状态：**阶段一 v0.5.0 已完成 + 阶段二 P1 v0.6.0 / P2（短跑 + 真实长跑）/ P3 v0.8.0（已发布，
> Latest）已交付** — demo-web / demo-desktop / mock-harness（M0）、scout-fixtures（M3）、
> **demo-business（P1）**、**demo-platform（P2）** 与 **demo-enterprise（P3）**；全部为本地可跑演示
> 素材，不依赖真实客户与真实资金。

| 目录 | 内容 | 用于 | 状态 |
|---|---|---|---|
| `demo-web/` | 本地演示站点（Node 内置 http，`127.0.0.1:4173`；带预置缺陷：登录超时无提示、表单校验错位等）+ README.zh-CN | A2 / A4 / A5 真实浏览器验收 | ✅ M0 已实现 |
| `demo-desktop/` | Python 标准库 tkinter 真窗口 GUI（表单/保存/校验，`--out` JSON，`--self-test` 无窗口自检）+ README.zh-CN | A3 真实桌面验收 | ✅ M0 已实现 |
| `mock-harness/` | MockHarness fixture（`fixture.txt`）；MockHarness 本体在 `packages/steward-harness` | A1 免付费演示与 CI | ✅ M0 已实现 |
| `scout-fixtures/` | **14 条纯虚构合规线索**（`leads.json`，含来源 URL/信号/评分/合规依据；保留域名、无真实个人信息）+ README.zh-CN | A7 Scout 验收与 `scout` CLI 演示 | ✅ M3 已实现 |
| `demo-business/` | **P1 仿真个人版业务线**（`business-line.json` + README.zh-CN，20 个顶层 section）：3 条候选业务线 / 客户询价 / 报价 / 9 任务 / 7 消息 / 交付物 / 收款 / 发票 / 支出 / 月报；含八概念映射与虚构性声明 | B1/B2/B5/B6/B7 验收与 `business` CLI / 控制台演示 | ✅ P1 已实现（v0.6.0） |
| `demo-platform/` | **P2 真实 localhost 故障注入平台**（`server.mjs` + `run-drill-helper.mjs` + README.zh-CN）：主端口 `/health`/`/quote`/`/message`（幂等 `idempotency_key`）+ 控制端口 `/admin/outage`、`/admin/ban`，可真实制造 `ECONNREFUSED` 断网与 `403 + x-platform-ban` 封禁 | B3/B4 故障演练与 `fault-drill` CLI 演示 | ✅ P2 已实现（v0.7.0（随 v0.8.0 发布）） |
| `demo-enterprise/` | **P3 企业版仿真 fixtures**（`enterprise.json` + `orders.json` + README.zh-CN）：主体/授权书/用印/对公账户/税号/双人复核/3 档组织审批链/多代理串行；8 条订单 = 2 正常 + 6 不一致（全部纯虚构） | B8 双模式验收与 `enterprise-demo` CLI 演示 | ✅ P3 已实现（v0.8.0 已发布） |

自检方式（**不能替代**真实 UI 验收）：

- `examples/demo-web`：启动后 `GET /health`、`GET /api/projects` 校验服务端行为（见其 README §8）。
- `examples/demo-desktop`：`python -m py_compile main.py` + `python main.py --self-test`（无窗口，退出码 0 为通过）。
- `examples/scout-fixtures`：`JSON.parse` 成功、14 条记录、域名仅保留域名、无真实个人信息
  （自检命令见其 README §7）。
- `examples/demo-business`：`JSON.parse` 成功、20 个 section、3 条候选业务线、金额自洽、保留域名、
  无真实个人信息（自检命令见其 README §7）。
- `examples/demo-platform`：`node examples/demo-platform/server.mjs` 后 `GET /health`；断网/封禁通过
  `/admin/outage`、`/admin/ban` 真实注入（自检命令见其 README）。
- `examples/demo-enterprise`：`JSON.parse` 成功、`enterprise.json` 含主体/授权/用印/对公/双人复核/
  审批链、`orders.json` 8 条（2 正常 + 6 不一致）、全部带「虚构」标注、保留域名、无真实个人信息
  （自检命令见其 README）。
- 真实浏览器/桌面 UI 验收分别在 M1/M2 由 `tests/e2e-browser` / `tests/e2e-desktop` 执行（A2/A3）；
  Scout 由 `npm run acceptance:m3` / `node dist/apps/cli/src/index.js scout` 做 fixture 驱动验收（A7）；
  P1 由 `npm run acceptance:p1` / `node dist/apps/cli/src/index.js business` 与真实浏览器控制台 E2E
  （`tests/e2e-console/`）做验收（B1/B2/B5/B6/B7）；P2 由 `npm run acceptance:p2`（短跑）与
  `node dist/apps/cli/src/index.js fault-drill` 验收（B3/B4，长跑另跑）；P3 由
  `npm run acceptance:p3` / `node dist/apps/cli/src/index.js enterprise-demo` 验收（B8 + 30 条边界）。

规则：

- 所有 fixture 数据为**虚构**，域名用 `example.com` 等保留域名；不得使用真实个人信息。
- 演示缺陷是**故意植入**的，用于验证编码回路；不得带入产品代码。
- 截图/录屏从这些真实运行结果生成，用于文档与宣传片。
