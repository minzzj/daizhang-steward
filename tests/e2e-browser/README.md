# tests/e2e-browser · 真实浏览器 E2E

> 状态：**M1 已落地**。真实有头 Chrome/Edge 操作 `examples/demo-web`，覆盖 A2/A4/A5 的
> 真实浏览器验收与 M1 编码回路的 red test（复现预置缺陷）。
> 硬规则（见 [`tests/README.md`](../README.md)）：**只做真实点击/输入/等待/截图**；
> 禁止请求拦截（route/mock）、假 DOM、预录视频；不得用接口调用代替 UI 验收。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `login-flow.mjs` | 主入口：自管 demo-web 服务 + 真实浏览器跑 `normal` / `login-timeout` / `all`，输出 `result.json` 与每步截图 |
| `lib/demo-server.mjs` | 共享工具：启动 `server.mjs`、轮询 `/health`、`taskkill /T /F` 停止进程树、确认端口释放、写 `server.log` |
| `run.mjs` | 兼容入口：`packages/steward-harness` 的 `demoCodeTask.acceptance` 使用历史命令 `run.mjs --case login-timeout`，这里转发参数与退出码到 `login-flow.mjs` |
| `adapter-smoke.mjs` | `packages/steward-browser` 适配器冒烟测试（真实浏览器 + 证据完整性 + console 捕获 + 失败分类纯函数） |
| `README.md` | 本文档 |

## 2. 快速开始

```bash
# 默认：有头浏览器，跑全部 case，证据写到 runs/e2e-browser-<时间戳>/
node tests/e2e-browser/login-flow.mjs

# 正常流程（必须绿，退出码 0）
node tests/e2e-browser/login-flow.mjs --case normal

# 缺陷复现（修复前为红，退出码 1 属预期）
node tests/e2e-browser/login-flow.mjs --case login-timeout

# 指定证据目录（交付/CI 用）
node tests/e2e-browser/login-flow.mjs --case all --evidence-dir <证据目录>

# 修复前验收“缺陷确实按预期复现”：normal 绿 + login-timeout 红 → 退出码 0
node tests/e2e-browser/login-flow.mjs --case all --expect-red login-timeout

# 无头（仅本地开发/CI 自测；产品验收必须默认有头）
node tests/e2e-browser/login-flow.mjs --case all --headless 1
```

参数：`--case normal|login-timeout|all`（默认 all）、`--evidence-dir <目录>`、
`--workdir <demo-web 目录>`、`--port <端口>`（默认 4173）、`--headless 0|1`（默认 0=有头）、
`--channel chrome|msedge`（默认 chrome → msedge 回退）、`--expect-red <case>`、`-h/--help`。

退出码：**0 = 符合预期；1 = 失败/不符合预期；2 = 参数或环境错误**。

> `login-timeout` 是**故意为红**的测试：它断言 demo-web 的预置缺陷已被修复。修复前
> `--case all` 退出码 1 是**预期**；修复后应自然转绿（`--case all` 退出码 0）。

## 3. 用例与断言

服务：脚本自动 `spawn node <workdir>/server.mjs --port 4173`，等 `/health` 200 后开始；
结束 `taskkill /PID /T /F`，并检查 `/health` 不再可达（**确保 4173 不残留**）。

### normal（必须绿）

1. 打开 `/`：HTTP 200；`#login-view`、`#account`、`#submit` 可见/可用
2. 填 `#account` / `#password`（演示账号 `demo`，密码不写入日志）
3. 真实点击 `#submit`
4. 等 `#project-view` 可见：`#login-view` 隐藏、`#project-name` 可见、`#project-result` 存在
5. 填 `#project-name` / `#project-note`
6. 真实点击 `#create`
7. 等 `#project-result` 可见且文本含「已提交」+ 项目名；`#project-error` 隐藏、`#create` 恢复可用

### login-timeout（修复前必须红）

1. 打开 `/login?timeout=1`：HTTP 200、`#slow-mode` 自动勾选
2. 填账号密码
3. 点击 `#submit`：按钮禁用且文案「登录中…」、`#login-error` 仍 hidden（loading 态成立）
4. 等 **4.5s**（页面侧 3s 中止请求，服务端 4s 才返回 504），断言修复目标：
   - **`#submit` 恢复可用（disabled=false）**
   - **`#login-error` 可见**
   - **`#login-error` 文本包含「请求超时，请重试」**
   - `#submit` 文案恢复为「登录」（不再含「登录中」）
   - `#login-status` 清空

当前缺陷下第 4 步 5 条断言全部失败 → 用例红（这正是编码回路的修复目标；
见 `examples/demo-web/README.zh-CN.md` §7）。

## 4. 输出与证据

```text
<evidenceDir>/
├── result.json                  # 总结果：{suite, case, ok, expectations, cases[], steps[], evidence[], durationMs}
├── server.log                   # demo-web 服务端输出
└── <case>/
    ├── result.json              # 单条用例：{case, ok, steps[], evidence[], durationMs, failures[]}
    ├── screenshots/<序号>-<动作>.png   # 每步截图；失败步骤为 <动作>-fail
    ├── dom/<序号>-<动作>-fail.html     # 失败现场 DOM 快照
    └── console.log                    # 页面 console / pageerror / requestfailed（有内容时）
```

- `steps[].checks[]` 记录每条断言的 ok/message；失败的断言文本直接说明期望与实际值。
- `result.json` 中证据路径相对 `evidenceDir`（如 `normal/screenshots/001-open-login-page.png`）。

## 5. 真实运行基线（本机实测）

环境：Windows + 本机 **Google Chrome 155.0.8059.85**（有头，`chrome → msedge` 回退未触发）；
Node.js 24；`playwright-core@1.64.1`（仓库 devDependencies）。

| 命令 | 结果 | 退出码 |
|---|---|---|
| `--case normal` | **PASS（绿）**，7 步 / 7 张截图 / 1.4s | 0 |
| `--case login-timeout` | **FAIL（红：预置缺陷复现）**，4 步 / 5 个证据 / 5.1s，5 条断言失败 | 1（预期） |
| `--case all` | normal 绿 + login-timeout 红 | 1（预期，red test） |
| `--case all --expect-red login-timeout` | 两条均符合预期 | 0 |
| `--case normal --headless 1` | PASS（无头，仅开发自测） | 0 |

login-timeout 实测失败摘要（真实输出）：

```text
✗ [assert-timeout-recovery] #submit 超时后应恢复可用（disabled=false），实际 disabled=true，文案「登录中…」
✗ [assert-timeout-recovery] #login-error 超时后应可见（必须给用户提示），实际仍 hidden
✗ [assert-timeout-recovery] #login-error 文本应包含「请求超时，请重试」，实际「」
✗ [assert-timeout-recovery] #submit 文案应恢复为「登录」，实际「登录中…」
✗ [assert-timeout-recovery] #login-status 应清空，实际「正在登录，请稍候…」
```

## 6. 与编码回路（M1）的关系

- **修复前**：`--case all --expect-red login-timeout` → 退出码 0（证明缺陷按预期复现，red test 有效）。
- **修复后**：`--case all` → 退出码 0；`--case login-timeout` 转绿（缺陷消失属预期）。
- 修复只允许改 `examples/demo-web/app.js` 的登录超时错误处理，不得删除 `#submit` / `#login-error`
  等选择器；**不得**改本目录测试或 `server.mjs` 来“让测试变绿”。

## 7. 已知限制 / FAQ

- **端口占用**：4173 被占用时 demo-web 进程会提前退出，本脚本快速失败并打印 `server.log` 尾部；
  先停止占用进程，或用 `--port` 换端口。脚本结束会确认端口释放（不残留）。
- **有头要求**：产品验收必须默认有头（真实窗口）；无桌面会话的 CI 只能 `--headless 1` 做开发自测。
- **浏览器依赖**：默认 `chrome → msedge` 回退；两者都没安装时启动失败并打印尝试记录。
- **高 DPI**：截图按 CSS 像素视口（默认 1440×900）生成；Windows 125%/150% 缩放不影响断言与截图内容。
- **等待时间**：login-timeout 固定等 4.5s 覆盖页面 3s 中止 + 服务端 4s 返回；机器极慢时可适当调大
  `LOGIN_TIMEOUT_WAIT_MS`，但不要缩短（否则可能观察不到超时路径）。
- 页面 console 输出会写入 `<case>/console.log`；正常流程通常没有日志，故该文件可能不存在。
- `run.mjs` 仅为兼容旧命令；新代码请直接用 `login-flow.mjs`。
