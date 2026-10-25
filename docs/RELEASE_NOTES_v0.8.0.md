# 代掌 Steward v0.8.0 — 阶段二 P2（故障演练）+ P3（企业版）/ Phase-2 P2 (Fault Drills) + P3 (Enterprise)

- 阶段 / Phase：阶段二 P2 + P3 完成（Phase 2 P2 fault drills & P3 enterprise edition）
- 版本 / Version：v0.8.0（2026-10-26）
- 仓库 / Repository：https://github.com/minzzj/daizhang-steward
- 发布 / Release：https://github.com/minzzj/daizhang-steward/releases/tag/v0.8.0
- 许可 / License：CC BY-NC-SA 4.0（source-available，非商业 / non-commercial）
- 测试 / Tests：**151/151 通过（16 个测试文件）**
- CLI：**19 个业务命令 + help，0 占位**

## 本版亮点 / Highlights

### P2 故障演练（B3 / B4）
- `packages/steward-fault`：真实网络故障演练模块（零依赖；Node 内置 fetch）
  - 断网期间 **PromisesGate 拒绝一切新承诺**；对外动作进入 **Outbox 幂等排队**；恢复后按幂等键补发，**账本不重复**
  - 平台封禁检测（真实 403 + `x-platform-ban`）、**替代方案**（5 渠道）、本地通知留痕、审计
- `examples/demo-platform`：真实 localhost 外部平台 fixtures（幂等报价/消息、`/admin/outage` 真实断网 ECONNREFUSED、`/admin/ban` 真实 403、控制端口恢复、优雅关闭）
- CLI `fault-drill --case net-outage|platform-ban`（自动启停平台、随机端口）
- **真实长跑证据（真实时长，不加速）**：
  - B3：真实断网 **120 分钟（7215 秒）** → 断网期间 **1435 次承诺被拒绝、0 新增**，1435 条动作排队 → 恢复后 **1435 条全部补记，duplicates_found=0**，二次对账 `entries_added=0`，恢复在 10 分钟内
  - B4：真实平台封禁 **15 分钟（900 秒）** → **9ms 内检测**，封禁期 180 次尝试 **0 成功**，停止动作 + **5 条替代方案** + 通知落盘，解禁后恢复
  - 证据：`docs/test-evidence/long-drill-2026-10-25_15-02-52.{md,json}` + `evidence-long-drill-2026-10-25_15-02-52/`
- 短跑验收 `npm run acceptance:p2`（断网 2 分钟/封禁 2 分钟）11 项检查全绿

### P3 企业版（B8 + 30 条边界）
- `packages/steward-enterprise`：企业主体与认证（执照/经办人/**授权书人签**）、**用印流程（AI 不代签，仅 human 可签）**、对公账户、增值税普票/专票、**开票校验（抬头/税号/合同一致）**、**申报草稿（draft_pending_human，人确认提交）**、**双人复核**（2 位不同角色才生效）、组织级审批链（≤5000 1 级 / 5000–50000 2 级 / >50000 3 级）、多代理串行、用工/派遣/资质类转人工、经营范围校验
- **30 条边界双模式标注表**（个人/企业 × 已实现/人工/不适用；四类重点越界双模式一律拒绝）：`docs/zh-CN/enterprise.md`、`docs/en/enterprise.md`
- **B8 双模式一致性**：个人/企业各跑一单（主体/抬头/收款/发票类型一致）；**6 类不一致 100% 阻断**且不产生发票/收款
- `examples/demo-enterprise/`：虚构企业档案 + 8 条订单场景（2 正常 + 6 不一致）
- CLI `enterprise-demo`；`npm run acceptance:p3` 12 项检查全绿

## 阶段二验收对照（B1–B8）/ Acceptance

| # | 验收 | 结果 | 证据 |
|---|---|---|---|
| B1 | 选题：5 万/30 天 ≥3 条业务线、来源可查 | ✅ | `docs/test-evidence/p1-acceptance-2026-10-25_14-18-54` |
| B2 | 记账：任一笔支出 30 秒看到 6 要素 | ✅ | P1 证据 `ledger-facts.json` + 控制台 `/ledger` 截图 |
| B3 | 断网 2 小时不产生新承诺、恢复 10 分钟补记不重复 | ✅ | **真实长跑**：`long-drill-2026-10-25_15-02-52`（120min，1435 动作，0 重复） |
| B4 | 平台封禁 15 分钟停止并出替代方案 | ✅ | **真实长跑**：`long-drill-2026-10-25_15-02-52`（15min，0 成功动作，5 条替代方案） |
| B5 | 对外承诺可追溯到对话原文与授权条款 | ✅ | P1 证据 `promise-traces.json` |
| B6 | 接管键 10 秒停止 + 30 分钟接管包 | ✅ | P1 证据 `takeover-result.json`（stop_ms=3）+ 控制台截图 |
| B7 | 四类越界请求 100% 拒绝、理由可读 | ✅ | P1 `boundary-check.json` + P3 30 条边界表 |
| B8 | 个人/企业模式各跑一单、不一致阻断 | ✅ | `p3-acceptance-2026-10-25_15-23-46`（12/12）+ `dual-mode-orders.json` |

## 安装与快速开始 / Install & Quickstart

```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
npm install
npm run build
npm test                 # 151/151
node dist/apps/cli/src/index.js business --json          # P1 经营域（B1/B2/B5/B6/B7）
node dist/apps/cli/src/index.js console                 # 本地控制台 http://127.0.0.1:4180
node dist/apps/cli/src/index.js fault-drill --case net-outage --outage-minutes 2 --json   # B3（短跑）
node dist/apps/cli/src/index.js fault-drill --case platform-ban --ban-minutes 2 --json    # B4（短跑）
node dist/apps/cli/src/index.js enterprise-demo --json  # P3 企业版（B8 + 30 条边界）
npm run acceptance:p2    # 本机故障演练验收（真实 localhost HTTP）
npm run acceptance:p3    # 本机企业版验收
```

## 已知限制 / Known limitations

- 全部业务数据为**仿真业务线**（虚构客户/企业/发票/账户），未接真实平台、银行、税务、CA、电子签章。
- 故障演练使用真实 localhost TCP 拒绝/真实 403，但非机房级断网；企业版无独立企业 UI（复用本地控制台）。
- 多智能体 / 通知 / IoT / MCP 等扩展仍为规划；阶段一遗留（真实 DSH/DeepSeek Harness、Scout 真实发送通道、桌面 UIA/拖拽）未变。

## 下一步 / Next

- **P4 v1.0**：中英双语文档终审、30 条边界与 8 条验收完整对照、**真实截图宣传片**、GitHub Release **v1.0.0**、发布验证。

参与 / Contribute：`docs/good-first-issues.md`、`CONTRIBUTING.md`；证据索引：`docs/test-evidence/`。
