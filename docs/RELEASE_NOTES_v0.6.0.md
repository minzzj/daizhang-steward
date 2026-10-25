# 代掌 Steward v0.6.0 — 阶段二 P1（个人版 MVP）/ Phase-2 P1 (Personal-Edition MVP)

- 阶段 / Phase：阶段二 P1 —— 个人版经营代理 MVP（Phase 2 P1）
- 版本 / Version：v0.6.0（2026-10-25）
- 仓库 / Repository：https://github.com/minzzj/daizhang-steward
- 发布 / Release：https://github.com/minzzj/daizhang-steward/releases/tag/v0.6.0
- 许可 / License：CC BY-NC-SA 4.0（source-available，非商业 / non-commercial）
- 测试 / Tests：**113/113 通过（14 个测试文件）**
- CLI：**18 个已实现命令 + 0 占位**

## 本版亮点 / Highlights

1. **经营域引擎 `packages/steward-domain`（8 概念全量数据模型）**
   - 委托（范围/期限/三层预算/禁止项）、预算三层（月/项目/单笔）、项目、任务、代理、证据、账本、墓碑；每条关系带置信度（确定/可能/未知/墓碑）。
   - 选题提案：≥3 条业务线（来源+报价+成本+毛利+最坏情况），来源缺失/超预算/需资质/线下 → 丢弃或转人工并留原因。
   - 账本 6 要素（金额/收付方/依据/审批人/回执/项目），缺失即拒绝；重复补记防护。
   - 承诺追溯：对话原文 → 委托条款 → 项目；无记录返回「未授权」。
   - 审批卡：默认 pending、超时挂起**不自动放行**。
   - 接管键：同步停止新动作 + 6 类接管包（未结订单/待办对话/待付账单/凭据引用/风险/覆盖度）；resume 恢复。
   - 月报（收支/成本/毛利/预算余量/合规事件/下月提案）+ L0/L1/L2 三层摘要；`events.jsonl` 追加式审计。
   - 边界规则：个人模式 18 条（全目录 20 条）；四类越界（无证业务/借用资质/陌生外呼/超预算）**100% 拒绝且理由可读**；支付/退款/合同/账号权限 → 人工审批或仅草稿；验证码/2FA/人脸 → 停止交人。
   - 仿真业务线端到端：客户询价 → 报价 → 交付 → 验收 → 收款 → 开票。
2. **本地 Web 控制台 `packages/steward-console`（零第三方依赖）**
   - 只监听 `127.0.0.1`；写操作 token 保护；CSP/nosniff/frame-ancestors；无 CORS。
   - 页面：看板 / 项目时间线+证据 / 账本（6 要素抽屉）/ 审批卡（批准/驳回）/ 接管键（6 类接管包+计时）/ 月报。
3. **仿真业务线 fixtures `examples/demo-business/`**：纯虚构数据（保留域名、无真实个人信息）。
4. **CLI 新命令**：`business`、`boundary-check`、`console`、`approve`（真实人工审批）、`takeover`（真实接管/恢复）。
5. **真实浏览器验收**：`tests/e2e-console` 有头 Chrome 9 步 / 73 检查 / 9 截图 / 接管 88ms；`npm run acceptance:p1` 12 项检查全绿。
6. **CI**：Windows + Ubuntu 跑 check / secret scan / build / 113 测试 / 阶段一 demo 证据 / Scout / dummy 分支 / safety-check / Phase-2 business + boundary / Console E2E（无头真实浏览器）。

## 阶段二验收对照（P1 覆盖）/ Acceptance

| # | 验收 | 结果 | 证据 |
|---|---|---|---|
| B1 | 选题：5 万预算 30 天 ≥3 条业务线、来源 30 秒可查 | ✅ | `p1-acceptance-2026-10-25_14-18-54`：3 条业务线（来源 URL 全部可查）+ 提案 |
| B2 | 记账：任一笔支出 30 秒看到 6 要素 | ✅ | `evidence-p1-2026-10-25_14-18-54/business-run/ledger-facts.json`（2 笔 × 6 要素）；控制台 `/ledger` 抽屉截图 |
| B3 | 断网 2h 不产生新承诺、恢复 10 分钟补记不重复 | ⏳ P2 | — |
| B4 | 平台封禁 15 分钟停止并出替代方案 | ⏳ P2 | — |
| B5 | 任取对外承诺可追溯到对话原文与授权条款 | ✅ | `promise-traces.json`（授权链 3 段；未记录=未授权） |
| B6 | 接管键 10 秒停止 + 30 分钟接管包 | ✅ | `takeover-result.json`（stop_ms=3ms）+ 6 类接管包 |
| B7 | 四类越界请求 100% 拒绝、理由可读且留痕 | ✅ | `boundary-check.json`（18 条规则、4/4 拒绝）+ 单元测试 |
| B8 | 个人/企业模式各跑一单、不一致阻断 | ⏳ P3 | — |

## 安装与快速开始 / Install & Quickstart

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
npm install
npm run build
npm test                       # 113/113
npm run demo                   # 阶段一空回路
node dist/apps/cli/src/index.js business --json      # 阶段二仿真业务线（B1/B2/B5/B6/B7）
node dist/apps/cli/src/index.js console             # 本地控制台 http://127.0.0.1:4180
npm run acceptance:p1          # 本机 P1 验收（真实浏览器有头）
```

## 已知限制 / Known limitations

- 数据为**仿真业务线**（虚构客户/域名），未接真实平台/支付/开票通道。
- 控制台单用户本地单机（无登录鉴权、无 HTTPS）；写操作 token 仅防误触发。
- P2 故障演练（真实断网 2h、封号注入）与 P3 企业版（30 条边界双模式、对公/专票/双人复核）尚未实现。
- 阶段一遗留：真实 DSH/DeepSeek Harness 未接（MockHarness + 脚本补丁）；Scout 只起草不发送；桌面适配器 Windows 优先、UIA/拖拽/滚轮等次要能力未做。

## 下一步 / Next

- **P2 故障演练**：断网 2h 不产生新承诺 + 恢复 10 分钟补记账本不重复（B3）；模拟平台封禁 15 分钟停止并出替代方案（B4）。
- **P3 企业版**：主体/认证/对公/发票/双人复核/组织审批链 + 30 条边界双模式标注表（B8）。
- **P4 v1.0**：真实截图宣传片、双语文档终审、Release v1.0.0。

参与 / Contribute：`docs/good-first-issues.md`、`CONTRIBUTING.md`；证据索引：`docs/test-evidence/`。
