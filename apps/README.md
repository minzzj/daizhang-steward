# Apps

> 状态：**待 M0 实现**。

| App | 说明 |
|---|---|
| `cli` | `steward` 命令：`run` / `branch` / `report` / `stop` / `takeover` / `demo`。阶段一主接口。 |
| `profile` | 可选「DSH 驾驶舱」：`dsh --profile daizhang web`，挂载 `steward-mcp` + `dsh-browser` + `dsh-computer-use` + Agent Teams，供人观察/审批/接管。 |

约定：

- CLI 只负责参数解析与输出，业务逻辑在 `packages/*`。
- profile 只是可选集成，不参与核心决策；核心可在无 DSH 环境运行（MockHarness）。
- 所有命令支持 `--json` 输出（便于测试与自动化取证）。
