# Examples

> 状态：**M3 已完成** — demo-web / demo-desktop / mock-harness（M0）与 scout-fixtures（M3）；
> `demo-business`（阶段二）仍待实现。全部为本地可跑演示素材，不依赖真实客户与真实资金。

| 目录 | 内容 | 用于 | 状态 |
|---|---|---|---|
| `demo-web/` | 本地演示站点（Node 内置 http，`127.0.0.1:4173`；带预置缺陷：登录超时无提示、表单校验错位等）+ README.zh-CN | A2 / A4 / A5 真实浏览器验收 | ✅ M0 已实现 |
| `demo-desktop/` | Python 标准库 tkinter 真窗口 GUI（表单/保存/校验，`--out` JSON，`--self-test` 无窗口自检）+ README.zh-CN | A3 真实桌面验收 | ✅ M0 已实现 |
| `mock-harness/` | MockHarness fixture（`fixture.txt`）；MockHarness 本体在 `packages/steward-harness` | A1 免付费演示与 CI | ✅ M0 已实现 |
| `scout-fixtures/` | **14 条纯虚构合规线索**（`leads.json`，含来源 URL/信号/评分/合规依据；保留域名、无真实个人信息）+ README.zh-CN | A7 Scout 验收与 `scout` CLI 演示 | ✅ M3 已实现 |
| `demo-business/` | 阶段二仿真业务线（客户对话、交付物、收款与发票状态） | B1–B8 | 待实现（阶段二） |

自检方式（**不能替代**真实 UI 验收）：

- `examples/demo-web`：启动后 `GET /health`、`GET /api/projects` 校验服务端行为（见其 README §8）。
- `examples/demo-desktop`：`python -m py_compile main.py` + `python main.py --self-test`（无窗口，退出码 0 为通过）。
- `examples/scout-fixtures`：`JSON.parse` 成功、14 条记录、域名仅保留域名、无真实个人信息
  （自检命令见其 README §7）。
- 真实浏览器/桌面 UI 验收分别在 M1/M2 由 `tests/e2e-browser` / `tests/e2e-desktop` 执行（A2/A3）；
  Scout 由 `npm run acceptance:m3` / `node dist/apps/cli/src/index.js scout` 做 fixture 驱动验收（A7）。

规则：

- 所有 fixture 数据为**虚构**，域名用 `example.com` 等保留域名；不得使用真实个人信息。
- 演示缺陷是**故意植入**的，用于验证编码回路；不得带入产品代码。
- 截图/录屏从这些真实运行结果生成，用于文档与宣传片。
