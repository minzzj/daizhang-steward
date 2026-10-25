# @daizhang/steward-browser · Playwright 真实浏览器适配器

> 状态：**M1 已实现**（真实浏览器，有头默认）。契约见 [`docs/zh-CN/adapters.md`](../../docs/zh-CN/adapters.md)；
> 铁律：UI 验收必须真实 Chromium/Edge 有头模式，**禁止** mock DOM / mock API 代替；**不做任何风控绕过**。

## 1. 职责

- 打开/导航、点击、输入、按键、等待元素/文本、读取文本、可见/可用查询、截图、DOM 快照、控制台日志采集。
- 默认**有头**启动本机 Chrome（失败回退 Edge）；每个 run 使用独立 `userDataDir`（配置隔离，`close()` 清理）。
- **每步自动留证**：截图 + DOM 快照 + 控制台日志汇总，失败也保留现场。
- 失败分类：元素找不到 / 导航超时 / 权限拒绝 / **风控拦截** / 未知。
- 命中风控关键词（验证码、captcha、安全验证、2FA…）→ 抛 `RiskControlStopError`：**停止并交人，不绕过**。

## 2. 用法

```ts
import { PlaywrightBrowser } from "../../packages/steward-browser/src/index.js";

const browser = new PlaywrightBrowser();
const info = await browser.launch({
  evidenceDir: "runs/<run-id>", // 必填：证据目录
  headless: false,              // 默认 false（有头，产品验收必须）
  // channel: "chrome",         // 可选；缺省 chrome → msedge 依次尝试
  // viewport: { width: 1440, height: 900 },
});
console.log(info.channel, info.browserVersion, info.userDataDir);

await browser.goto("http://127.0.0.1:4173/");
await browser.fill("#account", "demo");
await browser.fill("#password", "demo");
await browser.click("#submit");
await browser.waitFor("#project-view");
await browser.waitForText("#project-result", "已提交");
const text = await browser.text("#project-result"); // step.value 即文本
await browser.screenshot("final-state");
await browser.domSnapshot("final-state");
const logs = await browser.collectConsole();
await browser.close();
```

- 一个 `PlaywrightBrowser` 实例对应一次 run；新 run 请新建实例。
- 步骤返回结构化结果（字段只增不减）：

```ts
interface BrowserStepResult {
  stepIndex: number;
  action: string;
  ok: boolean;
  evidence: string[];   // 绝对路径
  durationMs: number;
  selector?: string;
  error?: string;
  failureKind?: "element-not-found" | "navigation-timeout" | "permission-denied" | "risk-control" | "unknown";
  value?: string;       // text()/isVisible()/waitForText() 的结果
  httpStatus?: number;  // goto() 的响应状态码
}
```

普通失败**不抛异常**（返回 `ok:false` + `failureKind`，由上层决定停止/重试）；只有
`RiskControlStopError` 会抛出，强制“停止交人”。

## 3. 证据目录

```text
<evidenceDir>/
├── screenshots/<序号>-<name>.png    # 每步自动截图；失败为 <action>-error
├── dom/<序号>-<name>.html           # 每步自动 DOM 快照
├── console.log                      # 浏览器 console / pageerror / 每步记录 / launch·close 记录
└── steps.json                       # { runId, launch, steps[], console[] } 结构化汇总
```

- 证据路径一律**绝对路径**，可直接交给 `steward-core` 的 `ArtifactBus.rel()` 转仓库相对路径。
- `fill()` 的输入值不会写入日志/步骤（避免凭据泄漏）；`console.log` 统一过 `redactSecrets()`。
- 证据含页面截图与 DOM，可能包含敏感信息：只放 `runs/<run-id>/`（已 gitignore），禁止提交仓库。

## 4. 失败分类与风控

| failureKind | 判定依据（Playwright 错误信息 / 页面文本） |
|---|---|
| `element-not-found` | `waiting for locator` / `strict mode violation` / `locator.click` 超时等 |
| `navigation-timeout` | `page.goto` 超时、`net::ERR_*`、`navigation failed/interrupted` |
| `permission-denied` | `Permission denied` / `EACCES` / `EPERM` / `not allowed` |
| `risk-control` | 页面文本或错误信息命中 `RISK_CONTROL_KEYWORDS` → 记录现场后抛 `RiskControlStopError` |
| `unknown` | 其它 → 视为未知（内核按“未知 ≠ 成功”处理，暂停待核，不猜） |

```ts
import { isLikelyRiskControl, detectRiskControlKeywords, RiskControlStopError } from "../../packages/steward-browser/src/index.js";

isLikelyRiskControl("请完成安全验证");            // true
detectRiskControlKeywords("请输入验证码 / CAPTCHA"); // ["验证码", "captcha"]
```

- 关键词只收录**强信号**（避免把普通登录文案误判）；命中即停止交人，**没有**任何绕过/打码路径。
- 阈值/关键词表可按客户场景扩展（`detectRiskControlKeywords(text, extraKeywords)`）。

## 5. 与 ToolRegistry 衔接

`browserToolSpecs()` 返回 `browser.goto` / `browser.click` / `browser.fill` / `browser.press` /
`browser.waitFor` / `browser.text` / `browser.waitForText` / `browser.isVisible` / `browser.isEnabled` /
`browser.screenshot` / `browser.domSnapshot` 共 11 条 `ToolSpec`（声明风险级别、审批与证据语义），
交给 `ToolRegistry.register(spec, handler)` 即可；handler 由 M1 Operator 分支装配：

```ts
import { ToolRegistry } from "../../steward-core/src/index.js";
import { browserToolSpecs } from "../../packages/steward-browser/src/index.js";

const registry = new ToolRegistry();
for (const spec of browserToolSpecs()) {
  // handler 内调用 browser.<action>()，返回 ToolResult（evidence 用 step.evidence）
}
```

## 6. 真实运行自检

仓库根目录先构建（适配器是 TypeScript，编译到 `dist/`）：

```bash
npm run build
node tests/e2e-browser/adapter-smoke.mjs --evidence-dir runs/adapter-smoke
```

`adapter-smoke.mjs` 用**真实有头浏览器**验证：通道回退、每步截图/DOM、`console.log`、
`steps.json`、`collectConsole()`、`userDataDir` 隔离与清理、失败分类纯函数。
默认读取 `dist/packages/steward-browser/src/index.js`；调试其它构建产物可加
`--adapter-dist <path>`。

## 7. 已知限制

- **有头模式需要桌面会话**：CI 无 GUI runner 时只能 `headless: true` 做开发自测；
  产品验收（A2/A4/A5）必须本机有头 Chrome/Edge。
- **依赖本机安装的浏览器**：`playwright-core` 不带浏览器二进制；未安装 Chrome/Edge 时启动失败并给出尝试记录。
  默认按 `chrome → msedge` 回退，可用 `channel` 指定首选。
- **高 DPI 缩放**：截图内容按 CSS 像素视口（默认 1440×900）生成；Windows 125%/150% 缩放下
  窗口物理像素与 CSS 像素不同，截图不受影响，但按物理坐标调试需按 CSS 像素换算。
- 每步自动截图+DOM 会产生较多文件（每步 2 个），长流程 run 的证据目录会较大。
- 多标签：新标签页自动成为当前操作页，暂未提供显式标签切换 API。
- 下载/上传/滚屏/选择等能力按 `docs/zh-CN/adapters.md` 在 M1 后续迭代补齐。
- 风控关键词为启发式：**漏判**靠页面文本与错误分类兜底、**误判**方向是安全（停止交人）。
- 仅 Windows 实测（Chrome 155 / Edge 已安装）；Linux/macOS 未验证。
