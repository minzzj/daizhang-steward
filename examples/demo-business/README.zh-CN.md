# demo-business · 仿真个人版业务线 fixtures

> 状态：**阶段二 P1-B 交付**（2026-10-25）。本目录提供一条**纯虚构**的个人版仿真业务线数据，用于经营域（`steward-domain`，Lead 将实现）与 `steward business` 命令的测试、演示与 B1 / B2 / B5 验收。
> **全部数据为虚构演示数据**：示例工作室、示例客户、虚构供应商与来源 URL 均为编造；不包含任何真实公司、真实个人、真实联系方式、真实银行账号或真实税号。

## 1. 虚构性声明（先读这一节）

- `business-line.json` 中所有组织、人名、邮箱、来源链接、账号与税号均为**虚构**，仅用于本地仿真与验收。
- 来源 URL 一律使用保留域名 `https://example.com/...` 下的虚构路径，不对应任何真实页面；唯一邮箱为虚构的 `buyer@example.com`。
- 金额、发票、回执均为演示数据；`runs/...` 下的 `evidence_ref` / `receipt_ref` 是**待真实运行生成的预期路径**（`evidence_status: "fixture_placeholder"`），本目录不伪造这些证据文件。
- 真实使用时**必须**替换为真实授权书（人签）、真实客户与有合法依据的公开来源，并重新走人工审批；不得把本 fixture 直接用于真实外联、收款或开票。

## 2. 文件结构

| 文件 | 说明 |
|---|---|
| `business-line.json` | 一条仿真个人版业务线的完整数据（20 个顶层 section，UTF-8 无 BOM、`JSON.parse` 可直接读取） |
| `README.zh-CN.md` | 本文档：虚构声明、用途、字段与八概念映射、数据口径、消费方式、合规边界、自检命令 |

## 3. 用途

- 阶段二 P1 经营域数据模型与 `steward business` 命令的**离线 fixture**（不依赖真实客户与真实资金）。
- 验收证据源：
  - **B1 选题**：5 万预算 30 天内 ≥3 条候选业务线，含来源/报价/成本/毛利/最坏情况；
  - **B2 记账**：任一笔支出可 30 秒看到 6 要素（金额 / 收款方 / 依据 / 审批人 / 回执 / 项目）；
  - **B5 承诺追溯**：对外承诺可追溯到对话原文与授权条款（`quote.commitment_trace`）；
  - 另覆盖 B6（接管包可用账本/待办数据生成）、B7（四类越界请求拒绝留痕）。
- 覆盖个人版 MVP 的**八概念**与**六能力**（见第 4、5 节）。

## 4. 八概念 → fixture 字段映射

| 经营域概念 | fixture 位置 | 说明 |
|---|---|---|
| 委托（mandate） | `mandate` | 授权人「示例工作室」、scope（线上数字化交付）、有效期、三层预算、禁止项、`clauses` 条款（供承诺追溯） |
| 预算（budget） | `mandate.budget_limits`、`ledger.budget_snapshot`、`monthly_summary.budget_remaining` | 月 50000 / 单项目 20000 / 单笔 5000 元，含已用与剩余 |
| 项目（project） | `project` | 关联业务线与报价、状态 accepted、开始/交付/验收/截止时间、项目预算 |
| 任务（tasks） | `tasks` | 9 条任务（含 1 条取消任务）：`depends_on` 依赖、`assignee_role` 四角色、`acceptance_criteria` 验收标准、`evidence_ref` |
| 代理（agents） | `agents` | conductor / developer / customer / finance 四个代理，含职责与 `tools_allowlist` |
| 证据（evidence） | `business_lines[].sources`、`deliverables[].evidence_ref`、`tasks[].evidence_ref`、`messages`、`quote.commitment_trace` | 来源、交付物、任务与承诺均可回溯到证据引用 |
| 账本（ledger） | `ledger` + `payment` / `expenses` / `invoice` | 只追加条目（收入 1 条 + 支出 2 条）、合计、预算快照；收款/开票状态 |
| 墓碑（tombstone） | `tombstones` + 各处 `confidence: "tombstone"` | 失效来源 1 条、被取消任务 1 条；置信度取「确定 / 可能 / 未知 / 墓碑」 |

## 5. 六能力 → fixture 覆盖

| 能力 | 覆盖 |
|---|---|
| 选题（三条业务线：来源/报价/成本/毛利/最坏情况） | `business_lines` 恰好 3 条，字段齐全，来源 URL 可打开（演示用保留域名） |
| 调度看板 | `project` + `agents` + `tasks`（状态/依赖/负责人），可直接渲染看板 |
| 真实办公（交付） | `deliverables` 2 个（代码仓库提交说明 + 文档）与客户交付时间线 |
| 客户交付时间线 | `messages` 7 条（询价 → 需求确认 → 报价确认 → 进度 → 交付 → 验收 → 收款/开票通知） |
| 账本与预算条 | `ledger`（收入/支出/净额/预算快照）+ `payment` + `expenses` |
| 接管键 + 月报 | `monthly_summary`（收支、成本、毛利、预算余量、合规事件、下月提案引用）+ `tombstones`（异常留痕） |

## 6. 关键数据与一致性口径

数字全部为整数人民币（CNY），自检脚本会逐项复算：

| 项 | 值 | 口径 |
|---|---|---|
| 可执行线报价 `quote.amount_cny` | 16000 元 | ≤ 单项目预算 20000 元 |
| 成本合计（`expenses` 两条） | 4200 元（云服务 800 + 外包 3400） | = 可执行线 `cost_cny` |
| 毛利 `gross_margin` | `(16000 − 4200) / 16000 = 0.7375` | 保留 4 位小数（0.5 进位） |
| 最坏情况 `worst_case_cny` | `quote_cny × 0.5 − cost_cny`（客户只付 50%、成本全额发生时的净额，可为负） | 可执行线 = 3800；被拒线下线 = −2000 |
| 账本合计 | 收入 16000 − 支出 4200 = 净额 11800 元 | = `ledger.totals`，与 `monthly_summary` 一致 |
| 预算快照 | 月剩余 45800（50000−4200）、项目剩余 15800（20000−4200）、单笔最大 3400 ≤ 5000 | `ledger.budget_snapshot` |
| 收款与发票 | 收款 16000（已审批，有回执）→ 增值税普通发票 16000「已开」 | 个人开票主体，税号为虚构占位 |
| 时间线 | 2026-10-08 询价 → 10-10 接单 → 10-21 交付 → 10-22 验收 → 10-23 收款并开票 | 演示月份 2026-10 |

## 7. 三条候选业务线与决策

| business_line_id | 名称 | 报价 | 成本 | 毛利 | 最坏情况 | 需许可证 | 需线下 | 决策 |
|---|---|---|---|---|---|---|---|---|
| `bl-online-report` | 月度经营报表自动化（线上交付） | 16000 | 4200 | 0.7375 | 3800 | 否 | 否 | ✅ selected（可执行） |
| `bl-license-consulting` | 企业资质合规咨询（需许可证） | 30000 | 9000 | 0.7 | 6000 | 是 | 否 | ❌ rejected（需许可证，超项目预算） |
| `bl-offline-inspection` | 门店设备巡检与现场施工（线下） | 26000 | 15000 | 0.4231 | −2000 | 否 | 是 | ❌ rejected（线下不在委托 scope） |

> 两条被拒线索的来源仍保留在 `sources` 中并带置信度；其中页面失效的一条在 `tombstones` 中标记为墓碑，**不作为证据**。

## 8. 客户沟通时间线（7 条）

| 消息 | 时间 | 方向 | 类型 | 内容摘要 |
|---|---|---|---|---|
| `msg-001` | 2026-10-08 | 客户 → 我方 | inquiry | 询价：多平台报表人工汇总耗时，预算 15000–20000，问两周能否交付 |
| `msg-002` | 2026-10-09 | 我方 → 客户 | requirement_confirm | 确认需求与验收标准，报 16000 元 / 14 天 |
| `msg-003` | 2026-10-10 | 客户 → 我方 | quote_confirm | 确认报价与付款方式，同意开工（B5 追溯原文） |
| `msg-004` | 2026-10-15 | 我方 → 客户 | progress_update | 第 5 天进度同步，无需求变更 |
| `msg-005` | 2026-10-21 | 我方 → 客户 | delivery_confirm | 交付 2 个交付物，请按验收标准验收 |
| `msg-006` | 2026-10-22 | 客户 → 我方 | acceptance_passed | 验收通过（B2/B5 依据） |
| `msg-007` | 2026-10-23 | 我方 → 客户 | invoice_notice | 收款与开票通知（仿真） |

## 9. 如何被 `steward business` 消费（Lead 将实现）

本 fixture 的字段设计即 `steward business` 的**输入契约草案**（经营域尚未实现，命令为规划项）：

```bash
# 规划中的使用方式（由 Lead 实现 `steward business` 命令后可用；当前仅 fixture + 自检）
node dist/apps/cli/src/index.js business --fixture examples/demo-business/business-line.json --json
```

期望行为（供实现对齐）：

1. 校验委托有效期与三层预算，禁止项命中即 `deny` 并留痕；
2. 读取 3 条候选业务线，按「来源/报价/成本/毛利/最坏情况/许可/线下」决策，保留 1–2 条可执行；
3. 渲染客户交付时间线、账本与预算条、L0/L1/L2 摘要与月报；
4. 所有对外承诺（报价/收款/开票）必须关联人工审批记录；超出审批或预算即暂停交人；
5. 运行产物写入 `runs/<run-id>/`，并把 fixture 中的 `evidence_ref` 占位替换为真实证据路径。

在命令落地前，可用第 11 节命令直接解析并校验本 fixture（离线、无需构建）。

## 10. 合规边界（必须遵守）

- 本目录仅用于**本地仿真与测试**，不得用于真实客户、真实收款或真实开票。
- 真实使用必须替换为**真实授权**（人签授权书）与**合法公开来源**；不采集真实个人信息；不使用来路不明的名单。
- 外联、收款、开票、单笔 ≥3000 元支出必须**人工审批**；审批超时挂起，不自动放行。
- 全面禁止：线下施工/上门、需行政许可或资质的业务、代客户签字、自动付款/转账、绕过验证码/风控、抓取登录后页面、购买名单、未经审批的对外承诺。
- 发票与税号均为虚构占位；真实开票由授权人按当地税务规则人工完成。
- 墓碑（失效来源/取消任务）只追加、不删除，用于异常留痕与接管包风险项。

## 11. 自检命令（可重复执行）

在仓库根目录执行：

```bash
# 1) JSON.parse 通过并打印关键计数（期望 3 / 7 / 2 / 2 / 1 / 1）
node -e "const d=JSON.parse(require('fs').readFileSync('examples/demo-business/business-line.json','utf8')); console.log('business_lines =', d.business_lines.length, '| messages =', d.messages.length, '| deliverables =', d.deliverables.length, '| expenses =', d.expenses.length, '| payment =', d.payment ? 1 : 0, '| invoice =', d.invoice ? 1 : 0)"

# 2) 金额与毛利自洽（期望 quote=16000 cost=4200 margin=0.7375 ledger 净额 11800）
node -e "const d=JSON.parse(require('fs').readFileSync('examples/demo-business/business-line.json','utf8')); const ln=d.business_lines.find(x=>x.decision==='selected'); const cost=d.expenses.reduce((s,e)=>s+e.amount_cny,0); console.log('quote =', ln.quote_cny, '| cost =', cost, '| margin =', (ln.quote_cny-cost)/ln.quote_cny, '| stored_margin =', ln.gross_margin); console.log('worst =', ln.quote_cny*0.5-cost, '| stored_worst =', ln.worst_case_cny, '| ledger_net =', d.ledger.totals.net_cny, '| invoice =', d.invoice.amount_cny, '| payment =', d.payment.amount_cny)"

# 3) 域名白名单（期望 only-example.com = true）
node -e "const raw=require('fs').readFileSync('examples/demo-business/business-line.json','utf8'); const hosts=[...raw.matchAll(/https?:\/\/([^\/\s]+)/g)].map(m=>m[1].split(':')[0]); const mails=[...raw.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)].map(m=>m[1]); const all=[...new Set([...hosts,...mails])]; console.log('domains =', all.join(','), '| only-example.com =', all.every(h=>h==='example.com'))"

# 4) 仓库级检查：密钥扫描不应命中本目录
node scripts/check-secrets.mjs
```

自检应全部通过，并满足：3 条业务线（1 条可执行、1 条因需许可证被拒、1 条因线下被拒）、≥6 条沟通消息、2 个交付物、2 条支出、1 条收款、1 条发票；金额/毛利/最坏情况/账本/预算可复算一致；不含真实域名、真实邮箱与真实个人信息（真实邮箱服务商关键词不在文档中抄写，避免自命中，由自检脚本与仓库密钥扫描覆盖）。

## 12. 已知限制

- **静态 fixture**：不启动真实命令，`runs/...` 证据路径是真实运行后才会生成的占位（`evidence_status: "fixture_placeholder"`）。
- **单条业务线**：仅覆盖「个人版 + 一条仿真业务线」；企业版（多主体、专票、用印、对公账户）与 P2 故障演练（断网/封号/72h 失联）不在本 fixture 范围。
- **里程碑时序**：报价/收款/开票的审批记录已按「已审批」写入 fixture，用于演示业务闭环；真实运行时这些必须由 ApprovalCard 人工产生，不得从 fixture 直接复制为已完成动作。
- **来源可用性**：保留域名 `example.com` 下的路径不对应真实页面（B1 的「30 秒打开来源」在真实数据替换后才有意义）。
- **金额口径**：`gross_margin` 保留 4 位小数、`worst_case_cny` 采用文档化公式（报价 × 50% − 成本）；若经营域实现调整口径，应同步更新第 6 节并重算，避免文档与数据不一致。
