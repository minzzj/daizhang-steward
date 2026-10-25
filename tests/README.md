# Tests

> 状态：**待 M0 起逐步实现**。四层结构，UI 验收必须真实操作。

```text
tests/
├── unit/           # 纯逻辑：引擎、账本、策略、评分、边界规则、提示词校验
├── contract/       # JSON Schema 校验：BranchSpec/CodeTask/CodeResult/Lead/Approval/Pack/Event
├── e2e-browser/    # 真实 Chromium/Edge（headed）真点击/输入/截图；禁止 mock 路由
├── e2e-desktop/    # 真实 Windows 窗口真键鼠 + 截图 + UIA
├── fault/          # 断网、强杀恢复、账本损坏、封号、72h 失联、循环超限、停止键
└── run-all.mjs     # 全量入口；输出 docs/test-evidence/ 结果文件
```

硬规则（见 CONTRIBUTING）：

1. `e2e-browser/` 中禁止出现 `page.route`/假 DOM/预录视频；CI 用 grep 强制。
2. UI 验收禁止用 HTTP API 代替真实操作。
3. 每步自动截图；没有证据的“成功”视为失败。
4. 失败保留现场；重试 ≤2 次，超限升级人类。
5. CI（GitHub Actions）跑 lint + unit + contract + 无头真浏览器 E2E + MockHarness；
   桌面 E2E 在本地发布前必须跑（CI 无 GUI runner）。
