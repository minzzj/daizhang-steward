# 代掌 Steward v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete

- 版本 / Version：**v1.0.0**（2026-10-26）
- 仓库 / Repository：https://github.com/minzzj/daizhang-steward
- 发布 / Release：https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0
- 许可 / License：**CC BY-NC-SA 4.0**（source-available，非商业 / non-commercial）
- 测试 / Tests：**151/151 通过（16 个测试文件）**
- CLI：**19 个业务命令 + help，0 占位**
- 阶段一 / Phase 1：**A1–A12 全部通过**（v0.5.0）
- 阶段二 / Phase 2：**B1–B8 全部通过**（v0.6.0 P1、v0.8.0 P2+P3）

## 这是什么 / What is this

**代掌 Steward** 是一个可组合的**操作型 AI** 开源内核与**个人/企业 AI 经营代理**参考实现（不是聊天机器人）：

- **阶段一（操作型 AI 内核）**：Conductor 决定方向、Operator 用真实浏览器与真实 Windows 桌面执行、与 Harness 的 **CodeTask → 补丁 → 测试 → 修复** 回路、Scout 客户分支；全部证据可复现。
- **阶段二（AI 经营代理）**：8 概念经营域（委托/预算/项目/任务/代理/证据/账本/墓碑）、仿真业务线、本地 Web 控制台、审批与接管、月报、**30 条边界规则**、双人复核与企业版能力。

## 亮点 / Highlights

### 真实操作（非 API、非假 DOM）
- 真实浏览器（Playwright，本机 Chrome/Edge 有头、每步截图/DOM/console、5 类失败分类）
- 真实 Windows 桌面（Python ctypes 侧车：窗口枚举/聚焦、BitBlt 截图、SendInput 真实鼠标与 Unicode 键盘、白名单、DPI 感知）
- 编码回路：失败 → 可复现 CodeTask → unified diff → 隔离 git worktree → 真实浏览器验收；两轮失败升级（不无限重试）

### 安全与治理
- 停止键实测 **≈305ms（≤5s）**、检查点恢复不重复、分支凭据/Profile/工具白名单隔离
- 边界规则：阶段二 **30 条**（个人/企业 × 已实现/人工/不适用）；四类越界（无证业务/借用资质/陌生外呼/超预算）**100% 拒绝**且理由可读
- 审批卡超时挂起**不自动放行**；**用印 AI 不代签**；发票仅草稿、申报人确认；接管键 + 6 类接管包
- 密钥只进环境变量，仓库密钥扫描通过

### 真实故障演练（B3/B4，真实长跑不加速）
- **B3 真实断网 120 分钟**：断网期间 **1435 次承诺被拒绝、0 新增**；1435 条动作入 Outbox；恢复后全部补记、**duplicates_found=0**、二次对账 entries_added=0
- **B4 真实平台封禁 15 分钟**：**9ms 检测**、封禁期 180 次尝试 **0 成功**、停止动作 + **5 条替代方案** + 通知、解禁恢复

### 企业版（P3）
- 企业主体/授权书（人签）/用印流程（AI 不代签）、对公账户、增值税专票、**开票校验（抬头/税号/合同一致）**、申报草稿、**双人复核**（2 位不同角色才生效）、组织级审批链
- **B8 双模式一致性**：个人/企业各跑一单（主体/抬头/收款/发票一致）；**6 类不一致 100% 阻断**

### 宣传片 / Promo video（真实截图）
- 成片（真实运行截图，非重绘）：**v1.0.0 Release Assets**
  - `daizhang-steward-promo-v1.0-bgm.mp4`（1280×720 / 30fps / 约 110s / 代码合成 BGM）
  - `daizhang-steward-promo-v1.0-silent.mp4`（静音版）
  - `daizhang-steward-promo-v1.0-poster.jpg`（封面）
- 工程与分镜：`docs/media/promo/`（STORYBOARD.md / FACTS.md）

## 验收对照 / Acceptance

### 阶段一 A1–A12（全部 ✅）
| # | 验收 | 证据 |
|---|---|---|
| A1 | 干净克隆可跑，无需付费 API | `docs/test-evidence/test-result-*.{md,json}` |
| A2 | demo-web 登录/填表/提交/校验/截图 | `evidence-m1-*/`（真实浏览器 7 步 7 截图） |
| A3 | demo-desktop 打开/填表/保存/校验/截图 | `evidence-m2-*/A3-desktop-flow/`（36/36 检查、20 张真实截图） |
| A4 | 预置缺陷 → CodeTask → 补丁 → 测试通过 | `evidence-m1-*/A4-code-loop/`（patch/红→绿截图） |
| A5 | 连续失败两次 → 升级，无无限循环 | `evidence-m1-*/A5-escalation/`（escalated=true、exit 1） |
| A6 | 每次运行有 prompt/patch/test.log/截图/report 且无密钥 | M0–M4 证据包 + `npm run check:secrets` |
| A7 | Scout ≥10 线索（来源+评分），3 条草稿未发送 | `p1` 之前 `m3-acceptance-*`（14→丢4→合格8→3 草稿、0 发送） |
| A8 | 停止键 5 秒；重启恢复不重复 | `m2-acceptance-*`（stop 305ms、检查点/resume） |
| A9 | 分支隔离（凭据/浏览器配置） | `m2-acceptance-*`（CrossBranchAccessError/ProfileBusyError） |
| A10 | 新增只读 dummy 分支只靠配置 | `m4-acceptance-*`（dummy 分支 run） |
| A11 | 测试/lint/文档/许可证完整、无遥测 | `m4-acceptance-*`（10 项检查：CC BY-NC-SA 4.0/双语文档/无遥测/版本一致） |
| A12 | 4 份运行时提示词版本化 + 测试 | `npm run test:prompts` + `prompts/manifest.json` |

### 阶段二 B1–B8（全部 ✅）
| # | 验收 | 证据 |
|---|---|---|
| B1 | 选题：5 万/30 天 ≥3 条业务线、来源可查 | `p1-acceptance-2026-10-25_14-18-54` |
| B2 | 记账：任一笔支出 30 秒看到 6 要素 | P1 证据 + 控制台 `/ledger` 真实截图 |
| B3 | 断网 2 小时不产生新承诺、恢复 10 分钟补记不重复 | **真实长跑** `long-drill-2026-10-25_15-02-52`（120min/1435/0 重复） |
| B4 | 平台封禁 15 分钟停止并出替代方案 | **真实长跑**（15min/9ms/180 次 0 成功/5 条替代） |
| B5 | 对外承诺可追溯到对话原文与授权条款 | P1 证据 `promise-traces.json` |
| B6 | 接管键 10 秒停止 + 30 分钟接管包 | P1 证据（stop_ms=3）+ 控制台真实截图 |
| B7 | 四类越界请求 100% 拒绝、理由可读 | P1 + P3 30 条边界表 |
| B8 | 个人/企业模式各跑一单、不一致阻断 | `p3-acceptance-2026-10-25_15-23-46`（12/12） |

## 安装与快速开始 / Install & Quickstart

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
npm install
npm run build
npm test                 # 151/151

# 阶段一：真实操作
node dist/apps/cli/src/index.js browser-flow --json   # 真实浏览器（本机 Chrome/Edge，有头）
node dist/apps/cli/src/index.js desktop-flow --json   # 真实 Windows 桌面（本机交互会话）
node dist/apps/cli/src/index.js code-loop --json      # 编码回路
node dist/apps/cli/src/index.js scout --json          # Scout 客户分支（只起草不发送）

# 阶段二：经营代理
node dist/apps/cli/src/index.js business --json       # 经营域（B1/B2/B5/B6/B7）
node dist/apps/cli/src/index.js console               # 本地控制台 http://127.0.0.1:4180
node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 2 --json
node dist/apps/cli/src/index.js enterprise-demo --json # 企业版（B8 + 30 条边界）

# 一键验收（本机真实环境）
npm run acceptance      # 阶段一（真实浏览器有头）
npm run acceptance:m2   # 真实桌面
npm run acceptance:m3   # Scout
npm run acceptance:m4   # 发布就绪
npm run acceptance:p1   # 个人版 MVP
npm run acceptance:p2   # 故障演练（短跑；长跑 npm run drill:long ≈2.5h）
npm run acceptance:p3   # 企业版
```

## 已知限制 / Known limitations

- 仿真业务线（虚构客户/企业/发票/账户），未接真实平台、银行、税务、CA、电子签章。
- 故障演练使用真实 localhost TCP 拒绝/真实 403，非机房级断网。
- 真实 DSH/DeepSeek Harness 未接（MockHarness + 脚本补丁）；Scout 只起草不发送；桌面适配器 Windows 优先（UIA/拖拽/滚轮等次要能力未实现）。
- 企业版无独立企业 UI（复用本地控制台）；通知/IoT/MCP 等扩展为规划。

## 两阶段路线 / Roadmap

阶段一 M0–M4（v0.5.0）→ 阶段二 P1（v0.6.0）→ P2+P3（v0.8.0）→ **v1.0.0 最终发布**。
详细路线与后续扩展见 `ROADMAP.md`；交接说明见 `HANDOFF.md`；参与入口 `docs/good-first-issues.md`、`CONTRIBUTING.md`；证据索引 `docs/test-evidence/`。

> 本发布由 CI（Windows + Ubuntu）构建与测试；所有 UI 验收使用真实浏览器/真实桌面操作取证，禁止 API/假 DOM 代替。
