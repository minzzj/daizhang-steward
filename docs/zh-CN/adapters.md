# 适配器契约 / Adapters（中文）

> 适配器都是**可替换实现**：同一接口可有真实实现与 Mock 实现；CI 与演示默认走 Mock/本地 fixture。
> 每个适配器必须声明：能力、风险级别、审批要求、证据类型、失败边界（超时/不可用/未知结果）。

## 1. 浏览器适配器（阶段一，Playwright）

- 能力：打开/导航、点击、输入、选择、滚屏、截图、DOM 快照、控制台日志、下载、上传、多标签、
  有头/无头、网络与超时配置、配置目录隔离。
- 证据：每步截图 + 页面 URL + DOM 快照路径 + 控制台日志文件。
- 失败分类（5 类）：元素找不到 / 页面加载超时 / 权限拒绝 / 风控拦截 / 未知；其中风控关键词命中抛
  `RiskControlStopError` → **停止交人**，未知 → 暂停待核。
- 铁律：**UI 验收必须真实 Chromium/Edge 有头模式**，禁止 mock DOM 或 API 代替。
- **实现状态：M1 已实现** `packages/steward-browser`（参考 `dsh-browser` MIT 模式并扩展）：
  有头默认、`chrome → msedge` 回退、每 run 独立 `userDataDir`、每步截图 / DOM / console 证据；
  adapter-smoke **28/28 PASS**。下载/上传/多标签/滚屏等能力按本文契约在后续迭代补齐。
- 证据布局（M1 实测）：`runs/<run-id>/e2e/<case>/` 下 `screenshots/`、`result.json`、
  `console.log`、`server.log`；`npm run acceptance` 会把关键证据复制到
  `docs/test-evidence/evidence-m1-<stamp>/`（A2 / A4 / A5 三组）。

## 2. 桌面适配器（Windows 优先）

- 能力：列出窗口、聚焦窗口、截图、点击、双击、右键、拖拽、输入文本、按键、UIA 可访问性树。
- 白名单：只允许操作白名单进程/窗口标题；默认拒绝其他应用。
- 证据：每步全屏/窗口截图 + 目标窗口标题 + 时间戳。
- 安全：检测到密码框/凭据输入框 → 暂停并生成协助卡，由人输入；不做凭据代填。
- 失败分类：窗口不存在 / 焦点丢失 / 元素不可达 / 超时 / 未知结果（一律暂停核对，不猜）。
- 实现：`packages/steward-desktop`（Windows：UIA + SendInput + 截图）；文档化 Linux/macOS 路径；
  可选兼容 cua-driver（与 DSH `dsh-computer-use` 语义对齐）。

## 3. 模型 / Harness 适配器

| 实现 | 用途 | 依赖 | 状态 |
|---|---|---|---|
| `MockHarness` | CI、离线演示、失败注入 | 无 | ✅ M0 已实现 |
| 脚本化补丁（`examples/mock-harness/*.patch`） | M1 真实修复补丁 / 失败注入 | git | ✅ M1 已实现 |
| `DshHeadlessHarness` | 真实编码协作，生成补丁 | `@deepseek-ai/dsh`（锁定版本） | 规划（未实现） |
| `DeepSeekApiHarness` | 直连 API 的备选路径（联调用） | 环境变量 key | 规划（未实现） |

Harness 只接收 CodeTask 文本，返回 CodeResult；不接触生产凭据、不执行部署。

M1 编码回路：`packages/steward-harness/src/patch.ts` 在**隔离 git worktree** 应用 `unified_diff`
（不碰主工作区）；`loop.ts` 的 `runCodeLoop` 每轮跑真实浏览器验收，最多两轮，超限写
`escalated=true` 并以退出码 1 结束（不无限重试）；CLI `code-loop` 暴露该回路，`--fail` 使用坏补丁
验证升级路径。

## 4. 通知适配器

Windows Toast / 邮件 SMTP / Webhook（企业微信、飞书、Slack）/ CLI 审批队列；短信与电话
阶段二评估后接入。所有通知只发摘要与链接，不发凭据与个人信息原文；发送失败要重试并留证。

## 5. IoT 适配器（阶段二 stub）

- 传输：MQTT 与 HTTP JSON-RPC 编解码两种；设备清单、指令、回执、事件回传四个对象。
- 指令必须带：动作、参数、审批要求、超时；回执必须带：结果、证据、时间。
- 阶段一只提供接口与模拟设备 fixture，**不接真实设备**。

## 6. 失败与未知结果

统一原则：**未知 ≠ 成功**。任何适配器返回 `unknown` 时，内核暂停该分支、写事件、生成核对卡，
由人或下一次运行补证；不得自动重试超过 2 次，不得记成已成功。
