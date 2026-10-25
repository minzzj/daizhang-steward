# Tests

> 状态：**阶段一 v0.5.0 + 阶段二 P1 v0.6.0 已落地 `unit/`（14 个文件 / 113 条测试全部通过）、
> `e2e-browser/`（真实浏览器 E2E）、`e2e-desktop/`（真实 Windows 桌面 E2E）、
> `e2e-console/`（真实浏览器控制台 E2E）**；`contract/`、`fault/` 随 P2–P4 实现。UI 验收必须真实操作。

## 运行 / Running

```bash
npm test                    # build + 全部单元+集成测试（v0.6.0 共 113 条）
npm run test:unit           # 只跑单元测试：node --test "tests/unit/*.test.mjs"
npm run test:prompts        # 提示词版本与安全条款测试（验收 A12）
node --test tests/unit/scout.test.mjs       # 只跑 Scout 21 条测试
node --test tests/unit/m4-release.test.mjs  # 只跑 M4 发布就绪 6 条测试（A10/A11/版本一致性）
node --test tests/unit/domain.test.mjs      # 只跑 P1 经营域 30 条测试
node --test tests/unit/phase2-cli.test.mjs  # 只跑 P1 CLI 3 条测试

# 真实浏览器 E2E（M1；有头默认，需本机 Chrome/Edge）
node tests/e2e-browser/login-flow.mjs --case normal             # 应绿：登录→提交→校验，逐步截图
node tests/e2e-browser/login-flow.mjs --case login-timeout      # 修复前应红：复现预置缺陷
node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout  # 缺陷按预期复现（退出码 0）
node tests/e2e-browser/adapter-smoke.mjs                        # 适配器冒烟（28/28 PASS）

# 真实桌面 E2E（M2/A3；真实 Windows 交互会话，需 Python ≥ 3.8；先 npm run build）
node tests/e2e-desktop/run.mjs                  # 真实键鼠 + 20 张逐步截图 + JSON 内容断言
node tests/e2e-desktop/run.mjs --evidence-dir runs/e2e-desktop-demo   # 指定证据目录

# 真实浏览器控制台 E2E（P1/B2+B6；有头默认；先 npm run build）
node tests/e2e-console/run.mjs                  # 9 步 / 73 检查 / 9 截图 / measured_stop_ms（≤10000）
node tests/e2e-console/run.mjs --headless 1 --evidence-dir runs/ci-console-e2e  # CI 用法

npm run evidence            # 离线证据包 → docs/test-evidence/test-result-<stamp>.{md,json}
npm run acceptance          # 本机有头一键验收（A2/A4/A5）→ docs/test-evidence/m1-acceptance-<stamp>.*
npm run acceptance:m2       # 本机真实桌面一键验收（A3/A8/A9）→ docs/test-evidence/m2-acceptance-<stamp>.*
npm run acceptance:m3       # fixture 驱动 Scout 一键验收（A7）→ docs/test-evidence/m3-acceptance-<stamp>.*
npm run acceptance:m4       # 发布就绪一键验收（A10/A11 + 80 测试）→ docs/test-evidence/m4-acceptance-<stamp>.*
                            #   注意：版本一致性为动态检查（package.json ↔ CLI VERSION）；阶段一里程碑检查可在后续版本重跑
npm run acceptance:p1       # P1 个人版 MVP 一键验收（B1/B2/B5/B6/B7 + 控制台 E2E + 113 测试）
                            #   → docs/test-evidence/p1-acceptance-<stamp>.* + evidence-p1-<stamp>/
```

阶段一 + P1 实现范围：

- `tests/unit/`（14 文件 / 113 条）：`branch` / `cli-demo` / `events` / `harness` / `policy` / `prompts` /
  `runtime` / `code-loop`（含 Windows CI 的 CRLF 补丁归一化回归）+ M2 新增
  `m2-safety`（14 条：停止键 / 检查点 / 凭据隔离 / ProfileLock / 工具白名单）与
  `m2-runtime`（4 条：运行中停止抢占、resume 跳过已完成步骤、profile 并发、ToolContext vault）+
  M3 新增 `scout`（21 条：ICP/三场景、四因子权重与范围、来源硬校验与丢弃原因、去重保高分、合格阈值、
  ≤150 字草稿且引用 signal、默认 pending 与未批准不可发送、每日每渠道频控、退订、报告计数一致、
  无网络调用）+ M4 新增 `m4-release`（6 条：A10 dummy 分支、A11 许可证/第三方声明/双语文档/无遥测/
  发布文档、版本一致性 0.5.0）+ **P1 新增 `domain`（30 条：8 概念/预算三层/选题/账本 6 要素/承诺追溯/
  审批超时/接管包/月报/摘要/18 条边界/仿真业务线/事件审计）与 `phase2-cli`（3 条：business、
  boundary-check、console 命令行为）**
- `tests/e2e-browser/`：`login-flow.mjs`（`normal` / `login-timeout` / `--expect-red`）、
  `adapter-smoke.mjs`、`lib/demo-server.mjs`（自管 demo-web 服务）
- `tests/e2e-desktop/`：`run.mjs` 真实 Windows 桌面 E2E（真实窗口 + 真实键鼠 SendInput + 每步截图 +
  JSON 内容断言；A3 实测 36/36 检查、20 张截图）
- `tests/e2e-console/`：`run.mjs` 真实浏览器控制台 E2E（有头 Chrome；看板/项目时间线/账本 6 要素/
  审批/接管停止+恢复/月报/只监听本机与 token 校验；9 步 / 73 检查 / 9 截图；
  `measured_stop_ms=88` ≤10000）

```text
tests/
├── unit/           # 纯逻辑：引擎、账本、策略、编码回路、提示词、安全模块、Scout、发布就绪、经营域（v0.6.0: 14 文件 / 113 条）
├── e2e-browser/    # 真实 Chromium/Edge（headed）真点击/输入/截图；禁止 mock 路由（M1 已实现）
├── e2e-desktop/    # 真实 Windows 窗口 + 真实键鼠（SendInput）+ 截图 + JSON 断言（M2 已实现）
├── e2e-console/    # 真实浏览器本地控制台 E2E：看板/账本/审批/接管/月报（P1 已实现）
├── fixtures/       # 测试夹具：always-ok / always-fail 脚本
├── contract/       # 规划（P2+）：JSON Schema 校验
└── fault/          # 规划（P2）：断网、强杀恢复、账本损坏、封号、72h 失联、循环超限
```

硬规则（见 CONTRIBUTING）：

1. `e2e-browser/` 中禁止出现 `page.route`/假 DOM/预录视频；CI 用 grep 强制。
2. UI 验收禁止用 HTTP API 或直接调用被测程序内部函数代替真实操作。
3. 每步自动截图；没有证据的“成功”视为失败。
4. 失败保留现场；重试 ≤2 次，超限升级人类。
5. CI（GitHub Actions）跑 self-check + secret scan + build + unit（113）+ evidence + Scout demo
   （fixture 驱动、只起草不发送）+ **Phase-2 `business` / `boundary-check`（B1/B2/B5/B6/B7，无网络）**
   + `dummy-branch`（A10）+ `safety-check` + **无头真实浏览器控制台 E2E**（`e2e-console`）+
   无头真实浏览器 demo-web E2E（normal 流程）；有头验收（`npm run acceptance` /
   `npm run acceptance:p1`）与真实桌面 E2E（`npm run acceptance:m2`）在本地发布前必须跑
   （CI 无交互桌面）。
