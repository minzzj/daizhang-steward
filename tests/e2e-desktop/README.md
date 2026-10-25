# tests/e2e-desktop · A3 真实 Windows 桌面验收

> 真实 `examples/demo-desktop`（Python tkinter 真窗口）+ `packages/steward-desktop` 真实键鼠 +
> 每步截图 + `--out` JSON 内容断言。**不使用任何 mock**：没有截图的「成功」视为失败。
> 适配器说明见 [`packages/steward-desktop/README.md`](../../packages/steward-desktop/README.md)。

## 1. 运行

```bash
# 前置：TypeScript 已构建（本脚本 import dist 里的适配器）
npm run build

# 真实桌面验收（Windows 真实交互会话，未锁屏）
node tests/e2e-desktop/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-desktop

# 默认证据目录 runs/e2e-desktop-<时间戳>（gitignore 已忽略 runs/）
node tests/e2e-desktop/run.mjs

# 查看全部参数
node tests/e2e-desktop/run.mjs --help
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--evidence-dir <目录>` | `runs/e2e-desktop-<时间戳>` | 证据目录：`result.json` / `screenshots/` / `steps.json` / `sidecar.log` / `app.log` / 演示 JSON |
| `--out <JSON 路径>` | `<evidence-dir>/project.json` | demo 保存的 JSON；脚本以它做内容断言 |
| `--workdir <目录>` | `examples/demo-desktop` | demo-desktop 所在目录 |
| `--timeout <毫秒>` | `120000` | 整个 E2E 总超时 |
| `--python <命令>` | `$STEWARD_PYTHON` 或 `python` | Python 解释器 |
| `--headed` | 默认开启 | 真实桌面模式（桌面验收必须，保留该参数用于显式声明） |
| `--keep-app` | 关闭 | 调试用：不清理 demo 进程（会残留，禁止用于验收） |
| `-h, --help` | — | 帮助 |

退出码：`0` 全部通过 / `1` 验收失败 / `2` 用法或环境错误（缺 `dist` 构建产物、缺 demo、参数错误）。
不支持 `--headless`（桌面验收必须真实桌面，会直接报参数错误）。

## 2. 验收流程（每步都有截图证据）

0. **准备**：启动 `WindowsDesktop` 适配器（不抢焦点）→ 用 `GetLastInputInfo` 等待桌面空闲
   （真人最近输入 ≥800ms 才开始，避免与真人键鼠互相打断；超时则继续并在结果中记录）。
1. **打开**：`spawn python -u main.py --out <JSON>`（真实子进程），用适配器
   `waitForWindow("代掌演示表单")` 等待真实窗口出现（最长 20s），校验：
   标题、窗口 pid == 子进程 pid、可见且未最小化、客户区尺寸有效。
2. **聚焦 + 打开截图**：`focusWindow`（`SetForegroundWindow`）→ `screenshot("opened")`。
3. **填表（真实键鼠）**：按 `clientOrigin + 逻辑布局 × 缩放` 换算屏幕物理坐标 →
   真实鼠标点击「客户名称」输入框 → `typeText("示例客户")`（SendInput Unicode）→
   真实键盘 `TAB` → `typeText("官网改版")` → 截图。
4. **保存**：真实鼠标点击「保存」按钮 → 等待 JSON 落盘（≤5s）→ 读取真实 JSON 断言
   `customer` / `project` / `saved_at`（带时区 ISO 8601）与真实键盘输入一致 → 截图。
5. **校验失败（客户名称为空）**：真实鼠标点击「清空」→ 点击「保存」→ 等待 1.2s →
   断言 JSON **内容与 mtime 均未变化**（demo 校验失败不写文件）→ 截图
   （截图中状态标签显示「校验失败：客户名称为空」）。
6. **部分校验（项目名称为空）**：只输入客户名称 → 点击「校验」→ 断言 JSON 仍未被覆盖 → 截图
   （状态标签显示「校验失败：项目名称为空」）。
7. **凭据保护**：`scanCredentialPrompts()` 断言当前无凭据/安全提示窗口（凭据输入一律交人）。
8. **关闭清理**：`WM_CLOSE` 真实关窗 → 等待 demo 进程退出（真实 exit code 0）；
   未退出则 `taskkill /PID /T /F` 兜底 → 断言无残留进程；适配器 `close()` 关闭侧车。
9. **证据完整性**：断言每个真实交互步骤都有截图证据、所有截图文件真实存在（实测 15 个交互步骤
   / 20 张截图）。

**真实桌面并发安全**：真实桌面是共享资源。脚本会先等桌面空闲；若填表期间焦点被真人抢走或
输入被真人键击污染（表现为 JSON 内容不符），会在**不把键鼠注入非白名单窗口**的前提下有限次
重试（填表 ≤4 次、校验场景 ≤3 次），每次尝试的失败步骤与截图都会保留在 `steps.json` 与
`screenshots/` 中（`result.json.interference` 记录尝试次数）。

## 3. 证据目录

```
<evidence-dir>/
  result.json        # 总结果：checks[] / steps[] / adapterSteps[] / screenshots[] / cleanup / ok
  project.json       # demo 真实保存的 JSON（断言对象，同时是证据）
  app.log            # demo 进程 stdout/stderr
  steps.json         # 适配器步骤账本（每步证据路径、失败分类、结构化数据）
  sidecar.log        # 桌面侧车诊断日志
  screenshots/
    001-focusWindow.png          # 打开：聚焦
    002-opened.png               # 打开：窗口截图
    003-focusWindow.png          # 填表：聚焦
    004-click.png                # 填表：点击「清空」
    005-click.png                # 填表：点击「客户名称」
    006-typeText.png             # 填表：输入客户名称
    007-pressKey.png             # 填表：TAB
    008-typeText.png             # 填表：输入项目名称
    009-filled.png               # 填表：填表后截图
    010-click.png                # 保存：点击「保存」
    011-saved.png                # 保存：保存后截图（状态标签显示已保存路径）
    012-focusWindow.png          # 校验失败场景：聚焦
    013-click.png                # 校验失败场景：点击「清空」
    014-click.png                # 校验失败场景：点击「保存」
    015-validation-failed.png    # 校验失败场景截图（状态标签显示校验失败）
    016-focusWindow.png          # 部分校验场景：聚焦
    017-click.png                # 部分校验场景：点击「客户名称」
    018-typeText.png             # 部分校验场景：输入部分客户名称
    019-click.png                # 部分校验场景：点击「校验」
    020-validate-partial.png     # 部分校验场景截图
```

> 失败步骤会额外产出 `*-error.png`；真实桌面有并发操作时重试尝试的截图也会保留。

`result.json` 关键字段：

```jsonc
{
  "case": "desktop-form-a3",
  "ok": true,
  "durationMs": 16654,                 // 含等待桌面空闲（真人最近输入 ≥800ms 才开始）
  "window": { "hwnd": 4458182, "title": "代掌演示表单", "pid": 9112, "clientRect": {...}, "clientOrigin": { "x": 346, "y": 369 } },
  "layout": { "scale": 1, "points": { "saveButton": { "x": 407, "y": 738 } } },
  "checks": [ { "name": "真实鼠标点击「保存」按钮", "ok": true, "detail": "点击屏幕坐标 (407,738)" } ],
  "adapterSteps": [ { "stepIndex": 3, "action": "focusWindow", "ok": true, "evidence": ["…/screenshots/003-focusWindow.png"] } ],
  "interference": { "fillAttempts": 1, "validationAttempts": 1, "retried": false },
  "screenshots": ["…/screenshots/001-focusWindow.png", "…"],
  "cleanup": { "sidecarClosed": true, "appExitCode": 0, "appResidue": false },
  "failures": [],
  "error": null
}
```

## 4. 实测结果（M2-A 验收，2026-10-25）

环境：Windows 10 Pro 22H2（build 19045）、2560×1440 @ 100% DPI、Python 3.11.9、Node v24、真实交互桌面。

```
[e2e-desktop] STEP 启动真实桌面适配器 — sidecar=0.1.0 python=3.11.9 dpi=per-monitor-v2 screen=2560x1440 allowed=代掌演示表单
[e2e-desktop] STEP 等待桌面空闲 — 真人最近输入已过 4703ms（阈值 800ms）
[e2e-desktop] STEP spawn demo-desktop — python -u main.py --out C:\daizhang-build\staging\e2e-desktop\project.json（pid=9112）
[e2e-desktop] OK   窗口标题为「代掌演示表单」 — 代掌演示表单
[e2e-desktop] OK   窗口属于本次 spawn 的 demo Python 进程（真实子进程） — windowPid=9112 appPid=9112
[e2e-desktop] OK   真实聚焦窗口成功（SetForegroundWindow）
[e2e-desktop] OK   真实鼠标点击「客户名称」输入框（点击点落在 demo 窗口内） — 点击屏幕坐标 (646,486)
[e2e-desktop] OK   真实键盘输入客户名称（SendInput Unicode） — 长度=4
[e2e-desktop] OK   真实键盘 TAB 切换焦点
[e2e-desktop] OK   真实键盘输入项目名称（中文 Unicode） — 长度=4
[e2e-desktop] OK   真实鼠标点击「保存」按钮 — 点击屏幕坐标 (407,738)
[e2e-desktop] OK   保存后生成真实 JSON 文件 — C:\daizhang-build\staging\e2e-desktop\project.json
[e2e-desktop] OK   JSON.customer 与真实键盘输入一致 — 期望 "示例客户"，实际 "示例客户"
[e2e-desktop] OK   JSON.project 与真实键盘输入一致 — 期望 "官网改版"，实际 "官网改版"
[e2e-desktop] OK   JSON.saved_at 为带时区偏移的 ISO 8601 — 2026-10-25T18:41:34+08:00
[e2e-desktop] OK   校验失败（客户名称为空）时 JSON 未被覆盖 — 内容一致=true mtime一致=true
[e2e-desktop] OK   「校验」不写文件（项目名称为空时 JSON 未被覆盖） — 内容一致=true
[e2e-desktop] OK   未检测到凭据/安全提示窗口（凭据输入一律交人）
[e2e-desktop] OK   demo 进程在真实操作全程保持存活（未崩溃）
[e2e-desktop] OK   WM_CLOSE 真实关闭窗口 — closed=true
[e2e-desktop] OK   demo 进程随窗口关闭正常退出 — exitInfo={"code":0,"signal":null,...}
[e2e-desktop] OK   每个真实交互步骤都有截图证据（无截图视为失败） — 交互步骤=15 缺证据=0
[e2e-desktop] OK   截图证据文件全部真实存在 — 截图=20 缺失=0
[e2e-desktop] OK   桌面侧车正常关闭 — sidecarExitCode=0
[e2e-desktop] OK   结束清理后无残留 demo 进程 — residue=false
[e2e-desktop] 检查项：36/36 通过；截图证据：20 张
[e2e-desktop] 真实桌面 E2E 通过 ✅（16.7s，含等待桌面空闲）
```

演示 JSON（真实落盘内容）：

```json
{
  "customer": "示例客户",
  "project": "官网改版",
  "note": "",
  "saved_at": "2026-10-25T18:41:34+08:00"
}
```

## 5. 常见问题 / 排错

- **`缺少桌面适配器构建产物`**：先 `npm run build`（脚本从 `dist/packages/steward-desktop/src/index.js` 导入）。
- **`等待窗口超时`**：确认是真实交互会话（不是 Session 0/无桌面 CI）、未被锁屏；
  `app.log` 里会记录 demo 的 stdout/stderr（例如 tkinter 无法创建窗口）。
- **点击坐标错位**：检查 Windows 显示缩放（`layout.scale` 应等于 `clientRect.width / 640`）；
  本脚本按 `clientOrigin + 逻辑布局 × scale` 自动换算，125%/150% 下同样可用。
- **窗口出现后消失/聚焦后不可见**：这是 Win32 的经典坑——以 `windowsHide`（STARTUPINFO
  `SW_HIDE`）启动的进程，其**第一次 `ShowWindow` 调用会被系统覆盖**；侧车已用「必要时重复
  ShowWindow」兜底（见 `scripts/desktop_sidecar.py` 的 `_ensure_window_shown`）。
- **其他程序/真人抢焦点**：真实桌面是共享资源。脚本先等桌面空闲，再在每次输入前用
  `focusGuardHwnd` 双重校验；焦点被抢会以 `focus-lost`/`allowlist-denied` 失败或触发有限次重试，
  **绝不会把键盘输入打进别的窗口**。实测中曾遇到真人同时操作（Minecraft 抢焦点、键击混入表单），
  适配器按白名单直接拒绝并在 `steps.json` 留证，重跑后通过。
- **缺截图证据**：断言会失败（`每个真实交互步骤都有截图证据` → FAIL），检查磁盘/权限。
- **CI 说明**：无交互桌面的 CI 只跑 `npm run build` + `python examples/demo-desktop/main.py --self-test`；
  真实桌面 E2E 只在本机 Windows 会话执行。
