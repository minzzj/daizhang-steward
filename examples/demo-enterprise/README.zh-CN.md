# demo-enterprise · 企业版仿真 fixtures

> 状态：**阶段二 P3-B 交付**（2026-10-25）。本目录提供**纯虚构**的企业版（对公/专票/授权书/用印/双人复核）数据与企业订单场景，用于 **P3 企业版验收 / B8（个人/企业双模式各跑一单，不一致阻断）**。
> **全部数据为虚构演示数据**：示例科技企业、示例法人、示例经办人、示例银行均为编造；执照号、税号、银行账号均带「虚构」标注（账号仅掩码），联系方式仅使用保留域名 `example.com`；不含任何真实企业、真实执照、真实税号、真实银行账号或真实个人信息。

## 1. 虚构性声明（先读这一节）

- `enterprise.json` 与 `orders.json` 中所有组织、人员、编号、账号均为**虚构**，仅用于本地仿真与验收。
- 统一社会信用代码/税号为**虚构字符串**（`91330100MA2DEMO01X（虚构…）`），不对应任何真实主体；银行账号仅以掩码 `**** **** **** 8888` 展示，**不包含完整账号**；银行名称为「示例银行（虚构）」。
- 唯一邮箱为 `finance@example.com`（保留域名）；不采集、不包含真实个人身份信息、手机号、证件号。
- 真实使用时**必须**替换为真实企业认证材料（营业执照、法人授权书、用印记录）与真实对公账户/税号，并由授权人本人在审批卡上确认；不得把本 fixture 用于真实签约、收款、开票或申报。

## 2. 文件结构

| 文件 | 说明 |
|---|---|
| `enterprise.json` | 企业主体与策略：entity（对公/授权书/用印/税号/经营范围）、invoice_defaults（默认专票）、review_policy（双人复核 + 三档审批链）、seats、multi_agent_serial、mode_rules、conflict_codes |
| `orders.json` | 企业订单场景数组（8 条）：2 条正常单（personal / enterprise 各一）+ 6 条不一致场景（全部期望阻断） |
| `README.zh-CN.md` | 本文档：虚构声明、字段说明、场景表、B8 映射、消费方式、合规边界、自检命令、已知限制 |

用途：

- P3 企业版验收 fixture（对公账户 / 增值税专票 / 授权书人签 / 用印 / 双人复核 / 组织审批链 / 多账号串行）；
- **B8 验收**：个人/企业各跑一单证明「主体/抬头/收款/发票类型一致」；6 类不一致场景 100% 阻断且 `conflict_code` 可读；
- 未来 `steward enterprise-demo`（Lead 将实现）的输入契约草案与回归数据。

## 3. `enterprise.json` 字段说明

### 3.1 entity（企业主体）

| 字段 | 值/说明 |
|---|---|
| `kind` | `company`（企业主体） |
| `name` | `示例科技企业（虚构）`（企业版要求主体、发票抬头、开票主体一致） |
| `license_no` | 虚构统一社会信用代码（含「虚构」标注） |
| `legal_representative` | `示例法人（虚构）` |
| `agent_name` | `示例经办人（虚构）`（唯一授权签署人之一） |
| `authorization_letter` | `{status:"signed", signed_by:"示例法人（虚构，人签）", path:"evidence/authorization-letter.md", scope:[...]}`；授权书必须法人本人签署，AI 只生成待签文件并定位签署页 |
| `seal` | `{status:"signed", signed_by:"示例法人（虚构，人签）", path:"evidence/seal-record.md"}`；用印必须人签，AI 不代盖 |
| `bank_account` | `{account_name, account_no_masked:"**** **** **** 8888", bank_name:"示例银行（虚构）", type:"corporate"}`；仅对公账户 + 掩码展示 |
| `tax_no` | 虚构税号（与 `invoice_defaults.tax_no` 完全一致） |
| `scope` | 经营范围：软件开发 / 数据处理 / 技术服务；排除「需行政许可或行业资质的业务、用工/派遣类、线下施工」 |
| `contact_email` | `finance@example.com`（保留域名） |

### 3.2 invoice_defaults（默认开票）

`{type:"vat_special", type_label:"增值税专用发票", title:企业抬头, tax_no:同 entity.tax_no, issuer_subject:企业主体, default_status:"draft_only"}`。
企业版默认专票；**AI 只生成开票草稿**，申报与提交必须由授权人确认（AI 不代申报）。

### 3.3 review_policy（双人复核 + 组织审批链）

- `dual_review_threshold_cny = 5000`：**单笔 ≥ 5000 元**需要 `finance + legal` 双人复核；
- `dual_review_roles = ["finance", "legal"]`；`dual_review_scope` 还覆盖收款账户变更、发票抬头/税号变更、对外合同与承诺；
- `approval_chain` 三档（金额边界左闭右闭、整数元）：

| 档位 | 金额区间 | 审批人 | 双人复核 | SLA |
|---|---|---|---|---|
| `tier-1-small` | 0–4999 元 | 示例经办人（虚构） | 否 | 4h |
| `tier-2-medium` | 5000–50000 元 | 示例财务负责人（虚构）、示例法务负责人（虚构） | 是 | 8h |
| `tier-3-large` | > 50000 元 | 示例法人（虚构）、示例财务负责人（虚构）、示例法务负责人（虚构） | 是 | 24h |

> AI 只发起审批，不代批；审批超时挂起，不自动放行。审批链档位按整数金额匹配（`min_cny`/`max_cny`）。

### 3.4 seats / multi_agent_serial（席位与多账号串行）

- `seats`：组织管理员 / 财务复核 / 法务复核 / **AI 代理席位**；AI 席位 `can_sign=false`（无签署/付款/申报/变更账户权限），人工席位要求 MFA。
- `multi_agent_serial`：`enabled=true`、`max_concurrent_agents=1`、串行队列、每个代理独立凭据引用（禁止跨代理读取明文）、操作按序写 `events.jsonl`。

### 3.5 mode_rules（双模式一致性规则）

| 模式 | 允许客户类型 | 允许收款方式 | 允许发票类型 |
|---|---|---|---|
| `personal` | `individual` | `personal_account` | `none` / `vat_general`（**禁专票**） |
| `enterprise` | `company` | `corporate_account` | `vat_special` / `vat_general` |

企业模式额外要求：授权书 `signed`、用印 `signed`、发票抬头/税号与 entity 一致、签署人必须是 `agent_name` 或 `legal_representative`。任一不一致 → `expected_blocked=true` 并给出 `conflict_code`（AI 只解释与留痕，不绕过）。

### 3.6 conflict_codes（不一致分类目录）

| conflict_code | 含义 | 触发条件 |
|---|---|---|
| `MODE_CLIENT_TYPE_MISMATCH` | 模式与客户主体类型不一致 | personal 接 company 客户（或 enterprise 接 individual） |
| `MODE_PAYMENT_METHOD_MISMATCH` | 模式与收款方式不一致 | enterprise 用 personal_account（或 personal 用 corporate_account） |
| `MODE_INVOICE_TYPE_MISMATCH` | 模式与发票类型不一致 | personal 模式开增值税专用发票 |
| `AUTHORIZATION_LETTER_NOT_SIGNED` | 企业授权书未完成人签 | enterprise 模式 `authorization_letter.status != signed` |
| `INVOICE_TITLE_MISMATCH` | 发票抬头与认证主体不一致 | `client_invoice_title != entity.name / invoice_defaults.title` |
| `TAX_NO_MISMATCH` | 税号与认证主体不一致 | `client_tax_no != entity.tax_no / invoice_defaults.tax_no` |
| `SIGNATORY_NOT_AUTHORIZED` | 签署人非授权经办人 | `signatory` 既非 `agent_name` 也非 `legal_representative` |

## 4. `orders.json` 字段与 8 个场景

每条订单：`case_id / order_kind / label / mode / client_type / client_name / quote_cny / currency / invoice_type_requested / payment_method / client_invoice_title / client_tax_no / signatory / signatory_role / seal_required / seal_status / authorization_letter_status / expected_blocked / expected_conflict_code / expected_related_conflict_codes / expected_reason / expected_dual_review / expected_approval_tier / expected_approval_roles / notes / confidence`。

### 4.1 正常订单（`expected_blocked: false`，共 2 条）

| case_id | 模式 | 客户/收款/发票 | 金额 | 期望结果 |
|---|---|---|---|---|
| `order-normal-personal` | personal | 个人客户 / personal_account / 无票 | 3000 元 | 放行；`< 5000` 无需双人复核（`tier-1-small`，经办人审批） |
| `order-normal-enterprise` | enterprise | 企业客户 / corporate_account / 专票；抬头与税号=认证主体；授权书+用印已人签；经办人签署 | 16000 元 | 放行；`≥ 5000` → `tier-2-medium` 双人复核（finance + legal），**不阻断** |

### 4.2 不一致场景（`expected_blocked: true`，共 6 条）

| case_id | 场景 | 主冲突码 | 相关冲突 |
|---|---|---|---|
| `order-mismatch-01-personal-company-vat` | personal 模式 + 企业客户 + 专票（模式冲突） | `MODE_CLIENT_TYPE_MISMATCH` | `MODE_INVOICE_TYPE_MISMATCH` |
| `order-mismatch-02-enterprise-personal-payment` | enterprise 模式 + personal_account 收款 | `MODE_PAYMENT_METHOD_MISMATCH` | — |
| `order-mismatch-03-auth-pending` | enterprise 模式 + 授权书 `pending_human`（未人签） | `AUTHORIZATION_LETTER_NOT_SIGNED` | — |
| `order-mismatch-04-title` | 发票抬头与认证主体不一致 | `INVOICE_TITLE_MISMATCH` | — |
| `order-mismatch-05-tax` | 税号与认证主体不一致 | `TAX_NO_MISMATCH` | — |
| `order-mismatch-06-signatory` | 签署人非授权经办人 | `SIGNATORY_NOT_AUTHORIZED` | — |

> 6 条场景的主冲突码互不相同、均可从 `enterprise.json` 的 `mode_rules` + `entity` 复算得到（不依赖人工判断）；`expected_related_conflict_codes` 记录同一订单的次要冲突，便于实现返回完整冲突列表。

## 5. B8 验收映射（个人/企业各跑一单，不一致阻断）

1. **个人侧**：`order-normal-personal` 走 personal 模式 → 个人客户 / 个人收款 / 无票，主体与收款方式一致，金额 3000 元无需双人复核 → 放行。
2. **企业侧**：`order-normal-enterprise` 走 enterprise 模式 → 企业客户 / 对公 / 专票，抬头与税号 = 认证主体，授权书与用印已人签，经办人签署 → 放行（16000 元触发 finance+legal 双人复核）。
3. **不一致阻断**：6 条 `order-mismatch-*` 必须 100% `expected_blocked: true`，并返回对应 `expected_conflict_code`；实现只解释、不绕过、不自动补全税号/抬头/签署人。
4. 验收证据建议：逐单输出 `{case_id, blocked, conflict_code, conflicts[], approval_tier, dual_review, reason}`，与 `orders.json` 的 `expected_*` 字段逐条对照，并写入 `runs/<run-id>/`（本 fixture 不含运行证据，避免伪造）。

## 6. 如何被 `steward enterprise-demo` 消费（Lead/P3 将实现）

> 命令与脚本名以 Lead 最终实现为准；本 fixture 的字段设计即输入契约草案。

```bash
# 规划中（P3 实现后可用）
node dist/apps/cli/src/index.js enterprise-demo --fixture examples/demo-enterprise --json
```

期望行为（供实现对齐）：

1. 加载 `enterprise.json` + `orders.json`，校验企业主体、授权书/用印已人签、默认专票与税号/抬头一致；
2. 逐单按 `mode_rules` 校验 mode / client_type / payment_method / invoice_type，再校验 enterprise 的授权书、抬头、税号、签署人；
3. 正常单输出审批档位（`approval_chain` 匹配）与是否需要双人复核；打断单输出 `blocked:true` + `conflict_code` + 可读理由（`expected_reason` 同义）；
4. 涉及金额 ≥5000 的动作必须走 `review_policy` 双人复核；AI 只发起/起草，不代签、不代批、不代申报；
5. 输出写入 `runs/<run-id>/`（结果 JSON + 人可读报告 + events.jsonl），供 B8 验收与接管包引用；
6. 不产生真实签署、支付、开票、申报动作（全部为仿真状态）。

## 7. 合规边界（必须遵守）

- **AI 不代签**：授权书、合同、用印一律由法人在真实文件上人签；AI 只生成待签文件并定位签署页。
- **AI 不代申报**：发票/税务申报只出草稿，由授权人确认后提交税务系统；本 fixture 不接税务、银行、CA。
- **AI 不自动付款/变更账户**：对公账户仅掩码展示；收款账户变更必须双人复核。
- **双人复核与组织审批链**：≥5000 元或账户/抬头/税号变更必须 finance + legal 人工确认；超时挂起不自动放行。
- **经营范围校验**：超出「软件开发/数据处理/技术服务」或需行政许可的业务一律转人工/拒绝。
- 本目录不采集真实个人信息、不保存完整银行账号、不用于真实签约/收款/开票/申报。

## 8. 自检命令（可重复执行）

在仓库根目录执行：

```bash
# 1) 两个文件 JSON.parse 通过并打印关键计数（期望 entity.kind=company、orders=8、normal=2、blocked=6）
node -e "const e=JSON.parse(require('fs').readFileSync('examples/demo-enterprise/enterprise.json','utf8')); const o=JSON.parse(require('fs').readFileSync('examples/demo-enterprise/orders.json','utf8')); console.log('entity.kind =', e.entity.kind, '| orders =', o.length, '| normal =', o.filter(x=>!x.expected_blocked).length, '| blocked =', o.filter(x=>x.expected_blocked).length)"

# 2) 一致性复算：企业正常单的抬头/税号 = 认证主体；6 条不一致主冲突码分布
node -e "const e=JSON.parse(require('fs').readFileSync('examples/demo-enterprise/enterprise.json','utf8')); const o=JSON.parse(require('fs').readFileSync('examples/demo-enterprise/orders.json','utf8')); const n=o.find(x=>x.case_id==='order-normal-enterprise'); console.log('title_match =', n.client_invoice_title===e.entity.name, '| tax_match =', n.client_tax_no===e.entity.tax_no, '| dual_review =', n.expected_dual_review); console.log('conflict_codes =', o.filter(x=>x.expected_blocked).map(x=>x.expected_conflict_code).join(','))"

# 3) 虚构性/域名检查（期望 only-example.com=true、无 18 位纯数字）
node -e "const raw=require('fs').readFileSync('examples/demo-enterprise/enterprise.json','utf8')+require('fs').readFileSync('examples/demo-enterprise/orders.json','utf8'); const mails=[...raw.matchAll(/@([A-Za-z0-9.-]+)/g)].map(m=>m[1]); console.log('only-example.com =', mails.every(d=>d==='example.com'), '| masked_account =', /\*{4} \*{4} \*{4} \d{4}/.test(raw), '| no_18_digits =', !/(?<!\d)\d{18}(?!\d)/.test(raw))"

# 4) 仓库级检查：密钥扫描不应命中本目录
node scripts/check-secrets.mjs
```

自检应全部通过，并满足：`orders=8`（2 正常 + 6 不一致）、6 类不一致主冲突码互不相同且全部可复算、正常企业单抬头/税号与认证主体一致、双人复核阈值 5000、所有编号带「虚构」标注、银行账号掩码、无真实邮箱服务商域名/真实银行名/真实个人信息。

## 9. 已知限制

- **静态 fixture**：`authorization_letter.path` / `seal.path` 是真实运行后生成的预期证据路径（`evidence_status: "fixture_placeholder"`），本目录不伪造证据文件。
- **命令与验收脚本未实现**：`steward enterprise-demo` 与 `npm run acceptance:p3` 属于 P3 后续实现（由 Lead/P3-A 落）；本 README 的命令为规划示例，落地后以实际命令为准。
- **conflict_code 为实现契约草案**：目录见 §3.6；若 P3 实现调整命名/新增分类，需同步更新 `orders.json` 的 `expected_conflict_code`、本 README 与验收脚本，保持「字段只增不减」。
- **仅仿真状态**：不接税务/UKey/CA/银行接口；税号与抬头校验是字符串相等（仿真），不对接真实工商/税务核验。
- **审批/双人复核只有策略数据**：不含真实审批 UI 与通知通道；P3/P4 控制台与通知实现后应读取 `review_policy` 与 `seats`。
- **金额口径**：整数人民币；审批档位边界为 `[0,4999]` / `[5000,50000]` / `>50000`，双人复核阈值按「单笔 ≥ 5000 元」；若实现改边界需同步更新。
- **企业主体与席位均为虚构**：不得用于真实业务；真实使用时替换全部编号/账号/人员并走人工复核。
