# @daizhang/steward-desktop · 真实 Windows 桌面适配器

> 状态：**M2-A 已实现**（真实窗口 + 真实键鼠 + 真实截图 + 白名单 + 每步证据）。
> 契约：`docs/zh-CN/adapters.md` 第 2 节「桌面适配器（Windows 优先）」；
> 验收：`tests/e2e-desktop`（A3 真实 Windows 桌面验收，实测 36/36 检查通过）。
> 铁律：桌面 UI 验收必须在**真实 Windows 桌面会话**里用真实键鼠完成，**禁止 mock 窗口 /
> 直接调用被测程序内部函数**代替；没有截图的「成功」视为失败。

## 1. 职责与架构

本包由两层组成，全部零第三方依赖（Node 标准库 + Python 标准库）：

| 层 | 文件 | 职责 |
|---|---|---|
| TypeScript 适配器 | `src/index.ts` → `dist/packages/steward-desktop/src/index.js` | 白名单、失败分类、每步截图证据、步骤账本、与 `steward-core` 的 `ToolSpec/ToolResult` 衔接 |
| Python 侧车（长驻） | `scripts/desktop_sidecar.py` | 真实 Win32 系统调用：窗口枚举/聚焦、BitBlt 截图 + 自写 PNG 编码、SendInput 真实鼠标/键盘 |

真实的系统调用一览（经 `user32/gdi32/kernel32/dwmapi`）：

| 能力 | 真实实现 |
|---|---|
| 窗口枚举 | `EnumWindows` + `GetWindowTextW` + `GetWindowRect` + `ClientToScreen` + `DwmGetWindowAttribute`（可见外框/遮盖过滤） |
| 窗口聚焦 | `ShowWindow` + `BringWindowToTop` + `SetForegroundWindow`（`AttachThreadInput` 解前台锁，必要时 ALT 手势兜底），多轮重试后校验 `GetForegroundWindow` |
| 截图 | `GetDC(0)` + `BitBlt` + `GetDIBits` 取屏幕物理像素，`zlib` 自写 PNG 编码（不依赖 Pillow / System.Drawing） |
| 鼠标 | `SetCursorPos` + `SendInput`（左/右/中键、单击/双击，事件进入系统输入队列） |
| 键盘 | `SendInput` + `KEYEVENTF_UNICODE`（中文等 Unicode 直接输入，**不走剪贴板**）；组合键 TAB/ENTER/CTRL+S/SHIFT+TAB/F1-F12 等 |
| 关窗 | `PostMessage(WM_CLOSE)` + 等待窗口消失 |
| 诊断 | 一次性 `runPowerShell(script)` / `runPython(script)`（UTF-8 定长命令，中文安全） |

## 2. 环境要求

- **Windows 10/11**，真实交互桌面会话（未锁屏；Session 0 / 无桌面的 CI 无法做真实桌面验收）。
- **Node.js ≥ 22.18**（仓库 `engines`），**Python ≥ 3.8**（本机 3.11.9 实测）。
- 本机 Python 在 `PATH` 中；或用 `pythonCommand` 参数 / `STEWARD_PYTHON` 环境变量指定解释器。
- 侧车脚本位置自动解析（源码树与 `dist/` 构建产物都支持）；也可用 `sidecarScript` 参数 /
  `STEWARD_DESKTOP_SIDECAR` 环境变量显式指定。

## 3. 快速开始（TypeScript API）

```ts
import { WindowsDesktop } from "../../packages/steward-desktop/src/index.js";

const desktop = new WindowsDesktop({
  evidenceDir: "runs/<run-id>/desktop",   // 证据目录：截图 / steps.json / sidecar.log
  allowedWindows: ["代掌演示表单"],        // 白名单（标题子串，大小写不敏感）
  // pythonCommand: "python",             // 可选；默认 STEWARD_PYTHON ?? "python"
  // typingIntervalMs: 8,                 // 可选：逐字符键入间隔
});

const info = await desktop.start();       // 启动 Python 侧车（仅 Windows）
console.log(info.dpiAwareness, info.screen); // 例：per-monitor-v2 { width: 2560, height: 1440 }

const win = await desktop.waitForWindow("代掌演示表单", { timeoutMs: 20_000 });
await desktop.focusWindow("代掌演示表单");
await desktop.screenshot("opened");       // → evidenceDir/screenshots/00N-opened.png

// 真实键鼠：坐标是**屏幕物理像素**；按 clientOrigin + 逻辑布局 × 缩放 换算得到
const scale = win.clientRect.width / 640;
const { clientOrigin } = win;
await desktop.click(
  Math.round(clientOrigin.x + 300 * scale),
  Math.round(clientOrigin.y + 117 * scale),
);
await desktop.typeText("示例客户");        // 中文 Unicode，真实键盘事件
await desktop.pressKey("TAB");
await desktop.typeText("官网改版");
await desktop.pressKey(["CTRL", "S"]);    // 或 "CTRL+S"

const title = await desktop.getWindowTitle();
const focused = await desktop.isWindowFocused("代掌演示表单");
await desktop.assertNoCredentialPrompt(); // 命中凭据/安全提示 → 抛错停止交人

await desktop.closeWindow("代掌演示表单");
const close = await desktop.close();
console.log(close.steps, close.screenshots, close.sidecarExitCode);
```

动作返回结构化步骤结果（字段只增不减）：

```ts
interface DesktopStepResult {
  stepIndex: number;
  action: string;                 // focusWindow / click / typeText / pressKey / screenshot / closeWindow …
  ok: boolean;
  evidence: string[];             // 截图等证据文件绝对路径（失败时是 *-error.png 现场）
  durationMs: number;
  error?: string;
  failureKind?: "window-not-found" | "focus-lost" | "timeout" | "allowlist-denied" | "unknown";
  value?: string;
  data?: Record<string, unknown>; // 坐标、窗口信息、点击点命中的窗口等结构化数据
}
```

## 4. 证据布局

```
<evidenceDir>/
  screenshots/
    001-focusWindow.png        # 每一步动作（含失败）自动截图，序号全局递增
    002-opened.png             # 显式 screenshot("opened")
    003-click.png
    004-typeText.png
    …
    012-validation-failed.png
    NNN-<action>-error.png     # 失败时的现场截图
  steps.json                   # 启动信息 + 全部步骤（含证据路径、失败分类、结构化数据）
  sidecar.log                  # 侧车诊断日志（启动参数、协议异常、关闭统计）
```

- 证据路径一律为**绝对路径**（与 `steward-core` 的 `ArtifactBus` 约定一致）。
- `steps.json` 在每次动作后原子重写，侧车崩溃也保留已有步骤。

## 5. 白名单（默认拒绝）

- 默认白名单：`DEFAULT_ALLOWED_WINDOWS = ["代掌演示表单", "记事本", "Notepad"]`（标题子串、大小写不敏感）。
- 构造时用 `allowedWindows` 覆盖；传 `[]` 表示**拒绝一切操作**。
- **操作类动作**（`focusWindow` / `click` / `doubleClick` / `typeText` / `pressKey` / `closeWindow` /
  窗口模式 `screenshot`）命中非白名单窗口 → 抛 `DesktopAllowlistError`（`failureKind: allowlist-denied`），
  并先记录失败步骤与现场证据，**默认拒绝、不降级**。
- 只读查询（`listWindows` / `waitForWindow` / `getWindow` / `getWindowTitle` / `isWindowFocused`）
  不做白名单校验（不产生任何操作）；`screenshot({ mode: "screen" })` 为只读全屏留证，允许，
  但可能包含其他窗口内容，使用方需自行控制证据保存范围。
- 键鼠注入前还有**双重校验**：适配器确认前台窗口在白名单内且仍是本次目标窗口；侧车再校验
  `focusGuardHwnd`（前台窗口句柄），避免动作间隙焦点被抢时把事件打进其他窗口。

## 6. 凭据与安全边界

- `assertNoCredentialPrompt()` / `typeText()` 前会扫描窗口标题：命中
  `密码 / 凭据 / 登录信息 / 用户账户控制 / 安全中心 / 验证码 / 人脸识别 / 指纹 / windows security /
  password / credential / uac / sign in` 等关键词 → 抛 `DesktopCredentialPromptError`，
  **立即停止并交人**（不记录、不输入任何凭据）。
- 默认只扫描**前台窗口**标题（避免后台窗口标题误报）；`scanAllVisibleWindows: true` 可放开。
- **已知边界：Windows 无法从任意窗口可靠识别「密码输入框」**（自绘控件、网页内密码框尤其如此）。
  因此本适配器的保证是「检测到凭据/安全提示窗口就停」，而不是「识别所有密码框」。
  **凭据输入一律由人完成**：不代填、不读取、不记忆，不绕过 UAC/安全桌面/验证码。
- 不读剪贴板、不写剪贴板、不做键盘记录；`typeText` 的文本内容不写入步骤数据（只记录长度）。

## 7. 失败分类（未知 ≠ 成功）

| failureKind | 触发场景 | 处理建议 |
|---|---|---|
| `window-not-found` | 标题匹配不到可见窗口；窗口被隐藏/关闭；点击坐标不在目标窗口内 | 暂停，核对窗口标题/进程；不要盲重试 |
| `focus-lost` | 目标窗口不是前台（被抢占/最小化后无法恢复/隐藏） | 重新 `focusWindow`；仍失败则交人 |
| `timeout` | `waitForWindow` / 聚焦 / 侧车调用超过超时 | 检查桌面是否锁定、目标程序是否卡死 |
| `allowlist-denied` | 操作落在非白名单窗口 | 默认拒绝；确需操作 → 人工审批后显式扩白名单 |
| `unknown` | 截图失败、输入被系统拒绝、脚本异常等 | 保留证据并暂停核对，不猜结果 |

规则：`ok:false` 的动作是**结构化失败结果**；白名单拒绝与凭据提示属于「必须交人」的硬错误，
记录失败步骤后**向上抛出**。任何 `unknown` 一律暂停待核，不当作成功。

## 8. 与 steward-core ToolRegistry 衔接

`desktopToolSpecs()` 返回可直接注册的 `ToolSpec[]`：

| 工具名 | 风险 | 证据 | 说明 |
|---|---|---|---|
| `desktop.listWindows` | low | — | 枚举真实窗口（标题/pid/rect/是否前台） |
| `desktop.focusWindow` | medium | ✅ | 聚焦真实窗口（白名单校验） |
| `desktop.screenshot` | low | ✅ | 真实窗口/屏幕截图留证 |
| `desktop.click` | medium | ✅ | 真实鼠标单击屏幕坐标 |
| `desktop.doubleClick` | medium | ✅ | 真实鼠标双击屏幕坐标 |
| `desktop.typeText` | medium | ✅ | 真实键盘输入（Unicode，不回显内容） |
| `desktop.pressKey` | medium | ✅ | 真实键盘按键 |
| `desktop.getWindowTitle` | low | — | 读取前台窗口标题 |
| `desktop.isWindowFocused` | low | — | 判断目标窗口是否前台/白名单 |
| `desktop.assertNoCredentialPrompt` | low | — | 凭据/安全提示保护（命中即停止交人） |

**给 CLI 的集成建议（M2 由 Lead 集成，本包未改 `apps/cli`）**：
在 `apps/cli/src/index.ts` 的 `createTools(root)` 中注册一个编排级工具 `desktop.flow`，
与既有 `browser.flow` 完全同构（spawn 子进程跑真实 E2E 并留证）：

```ts
registry.register(
  {
    name: "desktop.flow",
    description: "真实 Windows 桌面（真实键鼠）执行 demo-desktop 打开/填表/保存/校验流程并逐步截图留证（A3）",
    risk: "medium",
    requiresApproval: false,
    evidence: true,
  },
  async (args, ctx): Promise<ToolResult> => {
    const e2eDir = join(ctx.evidenceDir, "e2e-desktop");
    const script = join(root, "tests", "e2e-desktop", "run.mjs");
    if (!existsSync(script)) return { ok: false, summary: `真实桌面 E2E 脚本缺失：${script}` };
    const run = spawnSync(
      process.execPath,
      [script, "--evidence-dir", e2eDir, "--timeout", String(args.timeout ?? 120_000)],
      { cwd: root, encoding: "utf8", timeout: 240_000, env: { ...process.env, NO_COLOR: "1" } },
    );
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const logPath = join(ctx.evidenceDir, "test.log");
    await writeFile(logPath, output, "utf8");
    const resultPath = join(e2eDir, "result.json");
    return {
      ok: run.status === 0,
      summary:
        run.status === 0
          ? `真实桌面流程通过（A3），截图见 ${e2eDir}`
          : `真实桌面流程失败（exit=${run.status}），详见 ${logPath}`,
      evidence: [logPath, ...(existsSync(resultPath) ? [resultPath] : []), e2eDir],
    };
  },
);
```

同时可在 CLI 顶层加一个 `steward desktop-flow [--json]` 子命令直接透传该 E2E。
更细粒度的 `desktop.*` 工具（上表）适合 M2 Operator 装配：由计划步骤按名分发，
handler 内部 `await desktop.click(...)` 等；注意一个 `WindowsDesktop` 实例对应一次 run。

## 9. 已知限制

- **高 DPI 缩放**：侧车是 Per-Monitor V2 DPI 感知进程，截图/鼠标坐标都是**物理像素**；
  被操作程序若是 DPI 未感知的旧程序（如 tkinter），其逻辑布局会被系统位图拉伸，
  调用方需要按 `clientRect.width / 逻辑宽度` 换算（`tests/e2e-desktop/run.mjs` 已按此换算，
  100%/125%/150% 下均可用）。多显示器不同缩放时建议按目标窗口 `dpi` 单独换算。
- **坐标依赖**：`click(x, y)` 接收屏幕物理坐标，适配器不提供控件级定位（Tk/Qt 自绘控件不是独立
  HWND，UIA 可访问性树本阶段未实现，见第 11 节）。E2E 的按钮/输入框坐标来自 demo 固定布局的
  像素实测（640×470 逻辑客户区内），布局变化需同步更新 `tests/e2e-desktop/run.mjs` 的 `LAYOUT`。
- **需要前台真实会话**：锁屏、RDP 断开、UAC 安全桌面、休眠唤醒期间 `SendInput`/`BitBlt` 可能失败或
  截到黑屏；此类场景会以 `focus-lost`/`timeout`/`unknown` 失败。
- **窗口标题匹配**：按标题子串定位，多匹配时优先「前台 → 未最小化 → 面积最大」；标题动态变化
  （如记事本「无标题 - 记事本」）需在调用方用稳定的标题片段。
- **截图限制**：BitBlt 抓屏幕像素，目标窗口被其他窗口遮挡时截到的是遮挡物；不含鼠标光标；
  Windows 10/11 的窗口阴影/圆角按 DWM 可见外框裁剪。
- **输入法**：Unicode 直送 `WM_CHAR`，中文输入实测可用；但极少数只接受 IME 组合输入的控件
  可能需要改用真实输入法，本适配器不模拟 IME。
- **未实现能力**（契约中列出的部分能力留待后续迭代）：拖拽、右键菜单语义、滚轮/触控板手势、
  UIA 可访问性树、剪贴板、多窗口批处理会话编排。
- **单实例单 run**：一个 `WindowsDesktop` 实例对应一次 run；并发操作同一桌面请串行化，避免焦点互相抢占。

## 10. 跨平台替代路径（Linux/macOS）

本阶段真实桌面验收只在 Windows 本机执行；Linux/macOS 的对称实现可参考：

- **Linux (X11)**：窗口 `xdotool search --name` / `wmctrl -l`；截图 `import -window`（ImageMagick）
  或 `grim`（Wayland）；鼠标 `xdotool mousemove/click`；键盘 `xdotool type/key`。
  Wayland 下全局键鼠注入与截图受合成器限制（需 portal 授权）。
- **macOS**：窗口 `osascript`(System Events) / `Accessibility API`；截图 `screencapture -l <windowid>`；
  点击/输入 `cliclick` 或 CGEvent API；需在「系统设置 → 隐私与安全性 → 辅助功能/屏幕录制」授权。

接口可保持同一 `WindowsDesktop` 的语义（沿用 `DesktopStepResult` / 失败分类），实现层按平台替换。

## 11. 自检与 E2E

```bash
# 1) 构建（TypeScript）
npm run build

# 2) 真实 Windows 桌面 E2E（A3：真实窗口 + 真实键鼠 + 每步截图 + JSON 内容断言）
node tests/e2e-desktop/run.mjs --evidence-dir C:\daizhang-build\staging\e2e-desktop

# 3) 只跑 demo 的无 GUI 自检（CI 可用，不涉及本适配器）
python examples/demo-desktop/main.py --self-test
```

**M2-A 实测结果（2026-10-25，Windows 10 Pro 22H2 build 19045，2560×1440@100%，Python 3.11.9）**：

```
检查项：36/36 通过；截图证据：20 张；交互步骤 15/15 均有截图
真实桌面 E2E 通过 ✅（16.7s，含等待桌面空闲以避免与真人操作互相打断）
```

真实运行摘要（节选，完整输出见 `tests/e2e-desktop/README.md`）：

```
OK 桌面侧车启动（真实 Win32 能力就绪） — sidecarPid=5836
OK 窗口标题为「代掌演示表单」 — 代掌演示表单
OK 窗口属于本次 spawn 的 demo Python 进程（真实子进程） — windowPid=9112 appPid=9112
OK 真实聚焦窗口成功（SetForegroundWindow）
OK 真实鼠标点击「客户名称」输入框（点击点落在 demo 窗口内） — 点击屏幕坐标 (646,486)
OK 真实键盘输入客户名称（SendInput Unicode） — 长度=4
OK 真实键盘输入项目名称（中文 Unicode） — 长度=4
OK 保存后生成真实 JSON 文件
OK JSON.customer 与真实键盘输入一致 — 期望 "示例客户"，实际 "示例客户"
OK 校验失败（客户名称为空）时 JSON 未被覆盖 — 内容一致=true mtime一致=true
OK 「校验」不写文件（项目名称为空时 JSON 未被覆盖）
OK 每个真实交互步骤都有截图证据（无截图视为失败） — 交互步骤=15 缺证据=0
OK demo 进程随窗口关闭正常退出 — exitInfo={"code":0,"signal":null,...}
OK 结束清理后无残留 demo 进程 — residue=false
```

补充说明：`pytest` 风格的单元测试不在本包内——本包的系统能力用真实 E2E 做验收；
CI（无交互桌面）只跑 `npm run build` 与 demo 的 `--self-test`。
