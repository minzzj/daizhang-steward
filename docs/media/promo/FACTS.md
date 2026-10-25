# FACTS｜代掌 Steward v1.0 宣传片事实边界

> 本片为**产品自证**：所有数字来自仓库内可打开的验收证据（`docs/test-evidence/`），
> 所有画面截图为**真实运行截图**（真实浏览器 / 真实 Windows 桌面 / 本地控制台），未重绘、未生成。
> 口径日期：2026-10-26。若与后续版本不一致，以仓库最新验收证据为准。

## 0. 版本与当前状态

| 项 | 事实 | 口径 |
|---|---|---|
| 当前测试 | **151/151 通过** | `npm test`（2026-10-25/26，Windows 本机） |
| 业务命令 | **19 个** | `node dist/apps/cli/src/index.js help` |
| 阶段一 | **A1–A12 全部通过**，发布 **v0.5.0** | `docs/test-evidence/m4-acceptance-*.md` 阶段一结论 |
| 阶段二 | **B1–B8 全部通过**，发布 **v0.8.0** | `docs/test-evidence/release-v0.8.0` 相关证据 |
| CI | Windows + Ubuntu 全绿 | GitHub Actions |
| 许可 | **CC BY-NC-SA 4.0（非商用）** | `LICENSE` / `COMMERCIAL.md` |
| 仓库 | https://github.com/minzzj/daizhang-steward | GitHub |

## 1. 阶段一（v0.5.0，A1–A12）

| 事实 | 数字 / 说明 | 证据 |
|---|---|---|
| 真实浏览器验收 | **有头真实 Chrome/Edge**；A2 正常流程 **7 步 / 7 张真实截图**，每步截图 + DOM + console 日志 | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A2-browser-flow/` |
| 真实 Windows 桌面 | **真实窗口 + 真实键鼠（SendInput / BitBlt）**；**36/36 检查通过、20 张真实截图**，JSON 内容核对通过 | `evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/` |
| Harness 编码回路 | CodeTask → 补丁 → 隔离 worktree 应用 → 真实浏览器验收；A4 **第 1 轮由红转绿** | `evidence-m1-.../A4-code-loop/` |
| 失败升级 | A5 **连续两轮失败 → 停止并升级（不无限重试）** | `evidence-m1-.../A5-escalation/` |
| Scout 客户分支 | fixture **14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿 → 0 发送**；全部待审批 | `evidence-m3-2026-10-25_12-04-47/scout-run/` |
| 停止键 | 实测 **≈305ms**（目标 ≤5s） | `evidence-m2-.../A8-A9-safety-check/safety-check-result.json` |
| 检查点恢复 | resume 从检查点**跳过已完成步骤、不重复执行** | `tests/unit/m2-runtime.test.mjs` |
| 分支隔离 | 凭据不可跨分支读取、浏览器 profile 不可并发占用（`CrossBranchAccessError` / `ProfileBusyError`） | `m2-safety.test.mjs` / safety-check |
| 阶段一时点测试 | **80/80**（历史时点，当前已增长到 151/151） | `m4-acceptance-*.md` |

## 2. 阶段二（v0.8.0，B1–B8）

| 事实 | 数字 / 说明 | 证据 |
|---|---|---|
| 经营域 | **8 个核心概念**（委托/预算/项目/任务/代理/证据/账本/墓碑） | `docs/zh-CN/contracts.md` + `packages/steward-domain/` |
| 账本 6 要素 | 金额 / 收付方 / 依据 / 审批人 / 回执 / 所属项目；一笔支出点开即可看全 | 本地 Web 控制台账本页（B2） |
| 本地控制台 | 只监听 **127.0.0.1**；页面：看板 / 项目时间线 / 账本 / 审批 / 月报 / 接管；写操作需 token | `packages/steward-console/` |
| 接管键 | 长跑/演练口径 **stop_ms=3**（≤10s 目标），生成 6 类接管包（开放订单/待处理对话/应付款/凭据引用/风险/覆盖度） | `evidence-p2-2026-10-25_15-02-52/` |
| 承诺追溯 | 对外承诺可追溯到对话原文与授权条款（B5） | B5 验收证据 |
| 双人复核 | 高价值动作需第二人复核后才可执行 | B 系列验收证据 |
| 用印 | **AI 不代签**：用印/签署类动作一律交人 | B 系列验收证据 |
| 边界规则 | **30 条边界 · 双模式（个人/企业）**；越界 100% 拒绝且理由可读留痕（B7） | `boundary.ts` + B7 证据 |
| B8 双模式 | **6 类不一致阻断**（双模式各跑一单，不一致即阻断） | B8 验收证据 |

## 3. 真实长跑（演练证据）

| 演练 | 数字 | 证据 |
|---|---|---|
| B3 断网 | **120 分钟**：**1435 次承诺被拒绝 / 0 新增承诺 / 1435 次动作补记 / 0 重复** | `evidence-long-drill-2026-10-25_15-02-52/` |
| B4 平台封禁 | **15 分钟**：**9ms 检测** / **180 次尝试 0 成功** / **5 条替代方案** | 同上 |

## 4. 画面素材来源（真实截图，只读复制）

| 视频素材 | 来源（仓库相对路径） | 处理 |
|---|---|---|
| `browser-login.png` / `browser-fill.png` / `browser-submitted.png` | `docs/test-evidence/evidence-m1-2026-10-25_09-52-12/A2-browser-flow/e2e/normal/screenshots/001,005,007` | 原样（演示站为虚构数据） |
| `codeloop-red.png` / `codeloop-green.png` | `.../A4-code-loop/e2e/login-timeout/screenshots/001,004` | 原样 |
| `escalation-fail.png` | `.../A5-escalation/e2e/login-timeout/screenshots/004` | 原样 |
| `desktop-opened.png` / `desktop-filled.png` | `evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/e2e-desktop/screenshots/002,009` | 原样 |
| `desktop-saved.png` | 同上 `011-saved.png` | **裁剪底部状态行**（其中含本机绝对路径） |
| `console-dashboard/ledger/approvals/takeover/report.png` | `evidence-p1-2026-10-25_14-18-54/console-e2e/screenshots/` | 原样（127.0.0.1 本地数据，无个人隐私） |
| `console-takeover-pack.png` | 同上 `006-takeover-stop.png` | **裁剪顶部 E2E 计时行 + 底部状态条/toast**（含 P1 口径计时），保留 halted 与 6 类接管包；视频统一采用 P2 长跑口径 stop_ms=3 |
| `cli-ledger.png` | `evidence-p1-.../console-cli/ledger.png` | 原样 |
| `release-v0.8.0.png` | `docs/images/release-v0.8.0.png` | 原样 |

**隐私**：演示数据全部为虚构客户/金额；截图不含个人可识别信息；桌面「已保存」截图中的本机路径已裁剪。

## 5. 明确不做 / 不声称

- 不声称“全自动替代人”：高风险动作默认拒绝、需审批；用印 AI 不代签；验证码/2FA 停止交人。
- 不声称“已接入真实客户生产”：阶段一/二为本地演示 + 仿真业务线；真实客户数据不入片。
- 不把阶段一时点的 80 测试与当前 151 测试混用：片中“151/151”为当前口径，“80”只作阶段一历史说明。
- 不展示任何本机绝对路径、账号、密钥或真实个人信息。
