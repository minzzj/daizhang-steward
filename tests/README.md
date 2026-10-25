# Tests

> 状态：**M1 已落地 `unit/`（8 个文件 / 35 条测试全部通过）与 `e2e-browser/`（真实浏览器 E2E）**；
> `contract/`、`e2e-desktop/`、`fault/` 随 M2+ 实现。UI 验收必须真实操作。

## 运行 / Running

```bash
npm test                    # build + 全部单元+集成测试（M1 共 35 条）
npm run test:unit           # 只跑单元测试：node --test "tests/unit/*.test.mjs"
npm run test:prompts        # 提示词版本与安全条款测试（验收 A12）

# 真实浏览器 E2E（M1；有头默认，需本机 Chrome/Edge）
node tests/e2e-browser/login-flow.mjs --case normal             # 应绿：登录→提交→校验，逐步截图
node tests/e2e-browser/login-flow.mjs --case login-timeout      # 修复前应红：复现预置缺陷
node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout  # 缺陷按预期复现（退出码 0）
node tests/e2e-browser/adapter-smoke.mjs                        # 适配器冒烟（28/28 PASS）

npm run evidence            # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance          # 本机有头一键验收（A2/A4/A5）→ docs/test-evidence/m1-acceptance-<stamp>.*
```

M1 实现范围：

- `tests/unit/`（8 文件 / 35 条）：`branch` / `cli-demo` / `events` / `harness` / `policy` / `prompts` /
  `runtime` / `code-loop`（含 Windows CI 的 CRLF 补丁归一化回归）
- `tests/e2e-browser/`：`login-flow.mjs`（`normal` / `login-timeout` / `--expect-red`）、
  `adapter-smoke.mjs`、`lib/demo-server.mjs`（自管 demo-web 服务）

```text
tests/
├── unit/           # 纯逻辑：引擎、账本、策略、编码回路、提示词校验（M1: 8 文件 / 35 条）
├── e2e-browser/    # 真实 Chromium/Edge（headed）真点击/输入/截图；禁止 mock 路由（M1 已实现）
├── fixtures/       # 测试夹具：always-ok / always-fail 脚本
├── contract/       # 规划（M2+）：JSON Schema 校验
├── e2e-desktop/    # 规划（M2）：真实 Windows 窗口真键鼠 + 截图 + UIA
└── fault/          # 规划（M2+）：断网、强杀恢复、账本损坏、封号、72h 失联、循环超限、停止键
```

硬规则（见 CONTRIBUTING）：

1. `e2e-browser/` 中禁止出现 `page.route`/假 DOM/预录视频；CI 用 grep 强制。
2. UI 验收禁止用 HTTP API 代替真实操作。
3. 每步自动截图；没有证据的“成功”视为失败。
4. 失败保留现场；重试 ≤2 次，超限升级人类。
5. CI（GitHub Actions）跑 lint + unit + evidence + 无头真实浏览器 E2E（normal 流程）；
   有头验收（`npm run acceptance`）与桌面 E2E 在本地发布前必须跑（CI 无交互桌面）。
