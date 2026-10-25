# Tests

> 状态：**M3 已落地 `unit/`（11 个文件 / 74 条测试全部通过）、`e2e-browser/`（真实浏览器 E2E）、
> `e2e-desktop/`（真实 Windows 桌面 E2E）**；`contract/`、`fault/` 随后续里程碑实现。UI 验收必须真实操作。

## 运行 / Running

```bash
npm test                    # build + 全部单元+集成测试（M3 共 74 条）
npm run test:unit           # 只跑单元测试：node --test "tests/unit/*.test.mjs"
npm run test:prompts        # 提示词版本与安全条款测试（验收 A12）
node --test tests/unit/scout.test.mjs   # 只跑 Scout 21 条测试

# 真实浏览器 E2E（M1；有头默认，需本机 Chrome/Edge）
node tests/e2e-browser/login-flow.mjs --case normal             # 应绿：登录→提交→校验，逐步截图
node tests/e2e-browser/login-flow.mjs --case login-timeout      # 修复前应红：复现预置缺陷
node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout  # 缺陷按预期复现（退出码 0）
node tests/e2e-browser/adapter-smoke.mjs                        # 适配器冒烟（28/28 PASS）

# 真实桌面 E2E（M2/A3；真实 Windows 交互会话，需 Python ≥ 3.8；先 npm run build）
node tests/e2e-desktop/run.mjs                  # 真实键鼠 + 20 张逐步截图 + JSON 内容断言
node tests/e2e-desktop/run.mjs --evidence-dir runs/e2e-desktop-demo   # 指定证据目录

npm run evidence            # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance          # 本机有头一键验收（A2/A4/A5）→ docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2       # 本机真实桌面一键验收（A3/A8/A9）→ docs/test-evidence/m2-acceptance-<stamp>.*
npm run acceptance:m3       # fixture 驱动 Scout 一键验收（A7）→ docs/test-evidence/m3-acceptance-<stamp>.*
```

M3 实现范围：

- `tests/unit/`（11 文件 / 74 条）：`branch` / `cli-demo` / `events` / `harness` / `policy` / `prompts` /
  `runtime` / `code-loop`（含 Windows CI 的 CRLF 补丁归一化回归）+ M2 新增
  `m2-safety`（14 条：停止键 / 检查点 / 凭据隔离 / ProfileLock / 工具白名单）与
  `m2-runtime`（4 条：运行中停止抢占、resume 跳过已完成步骤、profile 并发、ToolContext vault）+
  M3 新增 `scout`（21 条：ICP/三场景、四因子权重与范围、来源硬校验与丢弃原因、去重保高分、合格阈值、
  ≤150 字草稿且引用 signal、默认 pending 与未批准不可发送、每日每渠道频控、退订、报告计数一致、
  无网络调用）
- `tests/e2e-browser/`：`login-flow.mjs`（`normal` / `login-timeout` / `--expect-red`）、
  `adapter-smoke.mjs`、`lib/demo-server.mjs`（自管 demo-web 服务）
- `tests/e2e-desktop/`：`run.mjs` 真实 Windows 桌面 E2E（真实窗口 + 真实键鼠 SendInput + 每步截图 +
  JSON 内容断言；A3 实测 36/36 检查、20 张截图）

```text
tests/
├── unit/           # 纯逻辑：引擎、账本、策略、编码回路、提示词、安全模块、Scout（M3: 11 文件 / 74 条）
├── e2e-browser/    # 真实 Chromium/Edge（headed）真点击/输入/截图；禁止 mock 路由（M1 已实现）
├── e2e-desktop/    # 真实 Windows 窗口 + 真实键鼠（SendInput）+ 截图 + JSON 断言（M2 已实现）
├── fixtures/       # 测试夹具：always-ok / always-fail 脚本
├── contract/       # 规划（后续里程碑）：JSON Schema 校验
└── fault/          # 规划（后续里程碑）：断网、强杀恢复、账本损坏、封号、72h 失联、循环超限
```

硬规则（见 CONTRIBUTING）：

1. `e2e-browser/` 中禁止出现 `page.route`/假 DOM/预录视频；CI 用 grep 强制。
2. UI 验收禁止用 HTTP API 或直接调用被测程序内部函数代替真实操作。
3. 每步自动截图；没有证据的“成功”视为失败。
4. 失败保留现场；重试 ≤2 次，超限升级人类。
5. CI（GitHub Actions）跑 lint + unit + evidence + Scout demo（fixture 驱动、只起草不发送）+
   `safety-check` + 无头真实浏览器 E2E（normal 流程）；有头验收（`npm run acceptance`）与真实桌面
   E2E（`npm run acceptance:m2`）在本地发布前必须跑（CI 无交互桌面）。
