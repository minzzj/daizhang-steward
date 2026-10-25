# Scout 合规线索 fixtures（纯虚构演示数据）

> 状态：**M3 交付（任务 M3-B）**。本目录提供驱动 Scout 分支测试与 A7 验收的本地线索 fixture。
> **全部数据为纯虚构演示数据**：不含真实公司、真实个人、真实联系方式；来源 URL 一律使用保留域名 `example.com` / `example.org`。

## 1. 虚构性声明（先读这一节）

- `leads.json` 中所有组织、角色、需求描述、邮箱、URL 均为**虚构**，仅用于本地测试与演示，**不得用于任何真实外联**。
- 邮箱只出现保留示例域名（如 `ops@example.com`）形态，**不采集、不包含任何真实个人邮箱或电话**。
- `source_url` 均为保留域名下的虚构路径，不对应任何真实页面；`signal` 是编写的示例原文摘要，不是真实用户发言。
- 若需替换为真实线索：**必须**换成有合法依据的公开来源，并遵守 `prompts/scout.md` 的合规条款与 `docs/zh-CN/contracts.md` 的 Lead 契约。

## 2. 文件结构

| 文件 | 说明 |
|---|---|
| `leads.json` | 线索数组（14 条记录，UTF-8 无 BOM，`JSON.parse` 可直接读取） |
| `README.zh-CN.md` | 本文档：用途、字段、分布、自检与合规边界 |

用途：

- 本地 fixture 驱动 Scout 测试（评分 / 丢弃 / 去重 / 渠道分布 / 高风险识别）；
- A7 验收「Scout ≥10 线索（来源+评分），3 条草稿未发送」的数据源；
- M3-A 已实现 `packages/steward-scout` 的 `ScoutEngine`：可直接加载本 fixture 生成评分明细、3 条草稿、待审队列与 `ScoutReport`；`npm run acceptance:m3`（脚本已就绪）在 `scout` CLI 命令落地后跑通端到端；
- 不访问网络、不依赖第三方服务，可在离线环境重复运行。

## 3. 字段说明

字段顺序固定：**契约字段在前（与 `docs/zh-CN/contracts.md` §4 Lead 一致），评分输入扩展字段在后**（契约「字段只增不减」）。

### 3.1 契约字段（必填）

| 字段 | 类型 | 说明 |
|---|---|---|
| `lead_id` | string | 线索唯一标识，`lead-001` 起编号 |
| `org` | string | 虚构组织名（均带「（虚构）」后缀） |
| `role` | string | 目标角色（如运营负责人、采购主管） |
| `source_url` | string | 来源 URL，必须是 `http(s)://`；**无来源应丢弃**（本文件保留 1 条故意缺失样本） |
| `signal` | string | 需求信号摘要（具体、可核对；不得编造） |
| `fit_score` | number | 0–1 匹配分，按下方四因子加权口径计算 |
| `channel` | string | 触达渠道：`email` / `platform_dm` / `form` |
| `consent_basis` | string | 合规依据（公开商务邮箱、明确寻求工具等）；**为空应丢弃** |
| `status` | string | 生命周期状态：`drafted` / `approved` / `sent` / `replied` / `unsubscribed` / `archived`；Scout 只产生 `drafted`，发送由人工审批 |

### 3.2 评分输入扩展字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `needs_strength` | number | 需求强度 0–1（评分权重 40%） |
| `budget_range` | string | 预算档位 `low` / `medium` / `high`（评分权重 20%；实现折算 low=0.3 / medium=0.6 / high=1.0，见 `packages/steward-scout/src/heuristics.ts` 的 `BUDGET_SCORES`） |
| `company_size` | number | 虚构企业规模（人数），用于预算/规模因子参考 |
| `reachability` | number | 可触达性 0–1（评分权重 20%） |
| `compliance_risk` | number | 合规风险 0–1（评分权重 20%，越高越扣分） |

评分口径（与 M3-A 实现 `packages/steward-scout` 对齐，便于自动复算；权重与 `prompts/scout.md`「需求强度 40% + 预算/规模 20% + 可触达性 20% + 合规风险 20%」一致）：

```text
budget_scale: low = 0.3, medium = 0.6, high = 1.0   # 见 packages/steward-scout/src/heuristics.ts BUDGET_SCORES
fit_score = clamp01(0.4 × needs_strength
                  + 0.2 × budget_scale
                  + 0.2 × reachability
                  + 0.2 × (1 − compliance_risk))
```

> 说明：`leads.json` 里的 `fit_score` 是按上述 M3-A 口径复算后保留两位小数的展示值；运行时 `ScoutEngine` 会重新计算原始 `fit_score`（不四舍五入，如 0.838），两者相差不超过 ±0.005，以引擎计算与评分理由为准。评分明细与理由由引擎输出（`score_breakdown` / `reason`），fixture 不重复存储。

## 4. 数据分布与「故意不合格样本」

总数 **14 条**，按任务要求覆盖合格、缺来源、非法来源、空合规依据、重复五类质量池：

| 质量池 | lead_id | 预期 Scout 处理 | 期望 `rejected_reasons`（M3-A 实现文案） |
|---|---|---|---|
| 合格（去重后保留） | `lead-001` ~ `lead-010` 共 10 条 | 评分后进入合格集 / 起草 | — |
| 缺 `source_url` | `lead-011` | 丢弃 | 含「缺少 source_url」 |
| `source_url` 非 http(s) | `lead-012`（`"内部名单（无来源）"`） | 丢弃 | 含「source_url 不是 http(s) 链接」 |
| `consent_basis` 为空 | `lead-013` | 丢弃 | 含「缺少 consent_basis」 |
| 与其他条重复 | `lead-014`（`org` + `signal` 与 `lead-001` 归一化后相同） | 去重丢弃 | 含「重复线索（org+signal 归一化后相同）」，并说明保留 `lead-001`、丢弃 `lead-014` |

合格判定口径（供实现对齐）：

1. `source_url` 存在、非空且为 `http://` 或 `https://` 绝对 URL；
2. `signal` 非空且为具体需求摘要；
3. `consent_basis` 非空；
4. 通过前三项后再按 `org` + `signal` 归一化去重（去首尾空白 → 转小写 → 去除空白与常见标点后比较）。
`status` 不参与合格判定。

全量分布（14 条）：

| 维度 | 分布 |
|---|---|
| 渠道 `channel` | `email` 6 条、`platform_dm` 4 条、`form` 4 条（合格 10 条中为 4 / 3 / 3） |
| 预算 `budget_range` | `low` 4 条、`medium` 6 条、`high` 4 条 |
| 状态 `status` | `drafted` 11 条、`approved` 1 条、`archived` 1 条、`unsubscribed` 1 条 |
| `fit_score` | 范围 0.39–0.84；含 2 条「高风险低分」：`lead-009`（fit 0.39 / 风险 0.75）、`lead-010`（fit 0.42 / 风险 0.65） |

**期望汇总结果**：去重后合格线索 **10 条**（满足 A7 的 ≥10 条）；其中去重后 `status=drafted` 的有 7 条（全量 11 条），可支撑「3 条草稿未发送」的验收样本。

**M3-A `ScoutEngine` 集成实测（2026-10-25 用仓库已构建的 `dist/packages/steward-scout` 直接加载本 fixture）**：

| 报告字段 | 实测值 | 说明 |
|---|---|---|
| `leads_total` | 14 | 全部输入线索 |
| `leads_discarded` | 4 | 3 条硬条件不合格 + 1 条重复（`rejected_reasons` 共 4 条） |
| `qualified_count` | 8 | 默认合格阈值 0.5：`lead-009`（0.39）、`lead-010`（0.42）低于阈值，不进合格集 |
| `drafts_count` | 3 | `lead-001` / `lead-004` / `lead-006`；全部 `status=drafted`、`cites_signal=true`、正文 110–113 字符（≤150） |
| `pending_approval` | 3 | 审批队列全部 `pending`，未获人工批准不可发送 |
| `sent_count` | 0 | 零发送（A7 要求「3 条草稿未发送」） |

该结果与 `scripts/run-acceptance-m3.mjs` 的检查口径一致：`leadsAtLeast10`、`qualifiedAtLeast8`、`drafts3`、`approvalPendingOnly`、`nothingSent`、`rejectedRecorded` 均满足。

## 5. 三高价值场景示例（ICP 校准）

1. **周报自动化**：`lead-001`（示例科技）每周手动整理 200 条客户数据 → 需求强度 0.92、预算中、合规风险低，`fit_score` 0.84，是最高价值场景（数据汇总 + 周报）。
2. **异常件核对**：`lead-006`（示例物流）每天人工核对约 300 单异常件 → 需求强、可触达性高，`fit_score` 0.81（流程自动化 + 异常推送）。
3. **供应商台账与月结对账**：`lead-004`（示例制造）在公开招标页征集实施方案、企业规模 800、预算高 → `fit_score` 0.79（采购流程自动化）。
   三条共同点：需求可核对、来源公开、合规依据明确、可触达路径清晰，适合作为 Scout 检索方向与评分校准的示例。

## 6. 合规边界（必须遵守）

- 本目录数据**只用于本地测试与演示**，禁止用于真实外联、群发或线索售卖。
- 真实使用时必须换成**有合法依据的公开来源**（公开商务邮箱、明确寻求工具等），并遵守 robots / ToS；**不抓登录后页面、不绕过付费墙、不买名单、不采集无合法依据的个人信息**。
- 外联**只起草不发送**：发送必须走 ApprovalCard 人工审批；**每日每渠道 ≤10**；**支持退订**（收到退订立即标 `unsubscribed` 并停止该渠道触达）；**不冒充人类**、不伪造身份。
- 来源打不开、`source_url` 缺失或非 http(s)、`consent_basis` 无法说明依据的，一律丢弃，不得补造。
- 本文件中出现的示例邮箱仅用于说明「合法保留域名」形态，**不是真实联系人**。

## 7. 自检命令（可重复执行）

在仓库根目录执行：

```bash
# 1) JSON.parse 通过并打印条数（期望 14）
node -e "const d=JSON.parse(require('fs').readFileSync('examples/scout-fixtures/leads.json','utf8')); console.log('JSON.parse OK, records =', d.length)"

# 2) 来源/邮箱域名白名单检查（期望 all-domains-allowed=true）
node -e "const d=JSON.parse(require('fs').readFileSync('examples/scout-fixtures/leads.json','utf8')); const s=JSON.stringify(d); const hosts=[...s.matchAll(/https?:\/\/([^\/\s]+)/g)].map(m=>m[1]); const mails=[...s.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)].map(m=>m[1]); const all=[...new Set([...hosts,...mails])]; const allowed=new Set(['example.com','example.org']); console.log('hosts =', all.join(','), '| all-domains-allowed =', all.every(h=>allowed.has(h)))"

# 3) 统计：总数 / 合格 / 丢弃原因 / 重复 / 渠道 / 预算 / 状态 / 高风险低分
node -e "const d=JSON.parse(require('fs').readFileSync('examples/scout-fixtures/leads.json','utf8')); const n=v=>String(v).trim().toLowerCase().replace(/[\s，。、；：！？,.;:!?·\-—()（）]/g,''); const miss=d.filter(x=>!('source_url' in x)); const bad=d.filter(x=>'source_url' in x&&!/^https?:\/\/\S+$/.test(x.source_url)); const nc=d.filter(x=>!String(x.consent_basis||'').trim()); const valid=d.filter(x=>!miss.includes(x)&&!bad.includes(x)&&!nc.includes(x)); const seen=new Map(); const uniq=[]; for(const x of valid){const k=n(x.org)+'|'+n(x.signal); if(seen.has(k)){console.log('duplicate_of', x.lead_id, '=', seen.get(k));} else {seen.set(k,x.lead_id); uniq.push(x);}} const cnt=(a,f)=>a.reduce((m,x)=>(m[f(x)]=(m[f(x)]||0)+1,m),{}); console.log('total =', d.length, '| accepted =', uniq.length); console.log('missing_source_url =', miss.map(x=>x.lead_id).join(',')||'无', '| invalid_source_url =', bad.map(x=>x.lead_id).join(',')||'无', '| empty_consent_basis =', nc.map(x=>x.lead_id).join(',')||'无'); console.log('channel =', JSON.stringify(cnt(uniq,x=>x.channel)), '| budget =', JSON.stringify(cnt(d,x=>x.budget_range)), '| status =', JSON.stringify(cnt(d,x=>x.status))); console.log('high_risk_low_fit =', d.filter(x=>x.compliance_risk>=0.6&&x.fit_score<0.5).map(x=>x.lead_id));"

# 4) 仓库级检查：密钥扫描不应命中本目录
node scripts/check-secrets.mjs
```

自检要点（与任务验收一致）：`JSON.parse` 通过；总数 ≥12；合格 ≥8（本文件去重后 10）；缺来源 1、非法 URL 1、空 `consent_basis` 1、重复 1；渠道 ≥3 种；无真实域名/邮箱。

## 8. 已知限制

- 静态 fixture：不含访问时间戳、抓取证据、联系方式明文字段（真实运行时由 Scout 在留证目录补充来源快照与评分明细）。
- 示例邮箱仅为「保留域名」形态；`channel=platform_dm` 与 `channel=form` 的记录不包含任何具体账号或表单提交内容。
- `fit_score` 为按 M3-A 实现口径（`low=0.3 / medium=0.6 / high=1.0`）复算并保留两位小数的展示值；运行时 `ScoutEngine` 会重新计算原始值（不四舍五入）。若 M3 评分实现调整折算，需要同步更新第 3 节说明并重算，避免文档与数据不一致。
- M3-A 的 `scout` CLI 命令与 `npm run acceptance:m3` 端到端验收依赖 M3-A 实现落地；fixture 侧已用已构建的 `ScoutEngine` 直接加载验证通过（见第 4 节实测）。`ScoutFixtureLead` 输入契约为子分数，`fit_score` / `status` 是本契约的展示字段，由引擎运行时重算/管理，fixture 存储不影响引擎计算。
- 本目录**不含**外联草稿正文与审批队列；「3 条草稿未发送」由 M3 Scout 实现基于本 fixture 生成，证据写入对应运行目录（`runs/<id>/`），不得由 fixture 冒充。
