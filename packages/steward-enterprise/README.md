# @daizhang/steward-enterprise · 阶段二 P3 企业版核心模块

> 状态：**P3-A 已实现**（验收 B8：个人/企业双模式各跑一单且不一致必须阻断；30 条边界双模式标注表；四类重点越界双模式 deny）。
> 纯逻辑、零第三方依赖、无网络、无真实资金/开票/税务/银行动作。

## 1. 定位与职责

企业版在个人版（个人经营者 MVP）之上补齐「企业主体」经营所需的合规增量：

| 增量 | 本模块实现 |
|---|---|
| 主体与认证 | `validateEntity()`：营业执照号 + 公司授权书**人签** + 对公账户 + 税号四项硬校验 |
| 用印 | `sealFlow()` 生成待签草案并定位签署页；`markSealSignedByHuman()` 只允许自然人签署，**AI 不代签** |
| 钱与票 | 对公账户收款校验、增值税普票/专票、`createInvoiceDraft()` 开票校验（抬头/税号/合同一致，仅 `draft_pending_human`） |
| 申报 | `createTaxFilingDraft()` 税务申报草稿（`ai_may_submit=false`，人确认提交） |
| 权限 | `requestAccountChange()` + `reviewAccountChange()` 双人复核（2 个不同角色批准才生效）；`approvalChainFor()` 组织级审批链（按金额分档）；`acquireAgentSlot()` 多代理/多账号串行 |
| 合规 | `checkBoundary()` 30 条边界判定（用工/派遣/资质类转人工、经营范围校验、未授权承诺拒绝、四类重点越界双模式 deny） |
| 边界表 | `boundaryRules30()` 恰好 30 条 `BoundaryRow30`；`boundaryTableMarkdown()` 可直接入库的中文表头 Markdown |
| B8 | `runDualModeOrders()`：个人/企业各跑一单 + 6 类不一致全部阻断（不产生发票/收款） |

```
packages/steward-enterprise/
├── src/
│   ├── types.ts     # 契约类型（BusinessEntity/EnterpriseProfile/OrderContext/ModeConflict/...）
│   ├── errors.ts    # EnterpriseValidationError / ModeConflictError / DualReviewRequiredError / InvalidInvoiceError
│   ├── fixtures.ts  # 虚构企业档案与个人主体（与 examples/demo-enterprise 同一套数据）
│   ├── boundary.ts  # 30 条边界规则 + 双模式标注表 + 判定器
│   ├── engine.ts    # EnterpriseEngine（认证/模式一致性/开票/复核/审批/用印/边界/B8）
│   └── index.ts     # 唯一入口，re-export 全部公开 API
└── README.md
```

## 2. API 摘要

```ts
import {
  EnterpriseEngine,
  MODE_CONFLICT_CODES,
  EnterpriseValidationError,
  ModeConflictError,
  DualReviewRequiredError,
  InvalidInvoiceError,
  type OrderContext,
} from "../../packages/steward-enterprise/src/index.js";

const engine = new EnterpriseEngine({
  // profile?: EnterpriseProfile     缺省 = defaultProfile()（虚构示例企业）
  // now?: () => Date                时钟注入（测试确定性）
  // personal_entity?: BusinessEntity B8 个人模式主体（缺省内置虚构个人主体）
});
const profile = engine.defaultProfile(); // 虚构企业档案（非真实公司）
```

| 方法 | 说明 |
|---|---|
| `defaultProfile()` | 虚构企业默认档案（与 `examples/demo-enterprise/enterprise.json` 一致） |
| `validateEntity(entity?)` / `assertValidEntity(entity?)` | 企业四项认证硬校验；返回 `{ok, issues[]}` / 不完整时抛错 |
| `checkModeConsistency(order)` / `assertNoModeConflict(order)` | 双模式一致性冲突（block/warn）；断言版存在 block 时抛 `ModeConflictError` |
| `runOrder(order)` | 跑一单：blocked 时**不产生发票/收款**（仅审计）；否则校验收款路径 + 开票草稿 |
| `createInvoiceDraft(order)` | 开票校验（抬头/税号/合同一致）→ `draft_pending_human`（**不自动提交**） |
| `requestAccountChange(input)` | 发起收款账户变更 → `pending_dual_review` |
| `reviewAccountChange(id, reviewer, decision)` | 双人复核：2 个不同角色都 `approve` 才 `applied=true` |
| `approvalChainFor(amount_cny)` | 组织级审批链 `{amount_cny, chain, roles}`：≤5000 1 级；5000–50000 2 级；>50000 3 级 |
| `submitForApproval(order)` | 提交组织审批 → `status:"pending"`（不自动放行） |
| `sealFlow(doc)` | 用印流程：生成待签草案 + 定位签署页（`pending_human`，`ai_may_sign:false`） |
| `markSealSignedByHuman(doc_id, by)` | **仅人工**可置 signed；AI/机器人署名抛 `EnterpriseValidationError` |
| `sealFlows()` / `accountChangesList()` / `auditLog()` | 证据导出（用印流程、账户变更、审计） |
| `createTaxFilingDraft(period)` | 申报草稿（`draft_pending_human`、`ai_may_submit:false`） |
| `acquireAgentSlot(agent_id)` / `releaseAgentSlot(agent_id)` | 多代理/多账号串行槽（同 profile 同时只允许一个代理） |
| `boundaryRules30()` | 恰好 30 条 `BoundaryRow30`（双模式标注齐全） |
| `boundaryTableMarkdown()` | 可直接入库的 30 条边界表（中文表头） |
| `checkBoundary(request)` | 边界判定：`deny` / `human` / `draft_only` / `allow`（留痕） |
| `runDualModeOrders()` | **B8**：个人/企业各跑一单 + 6 类 mismatch 全部阻断 → `DualModeResult` |

错误类型（均带 `code`）：`EnterpriseValidationError(INVALID_INPUT/NOT_FOUND)`、`ModeConflictError(MODE_CONFLICT,
conflicts[])`、`DualReviewRequiredError(DUAL_REVIEW_REQUIRED, request_id)`、`InvalidInvoiceError(INVALID_INVOICE, field)`。

## 3. B8 双模式一致性：6 类不一致必须阻断

`runOrder()` 先跑 `checkModeConsistency()`，任一 `severity:"block"` 冲突即 `blocked=true`：**只写审计，
不产生发票（`invoice===undefined`）、不发生收款动作（`payment.ok===false`）**。

| # | 冲突码（`MODE_CONFLICT_CODES`） | 触发 | 用户可见行为 |
|---|---|---|---|
| ① | `MODE_CLIENT_TYPE_MISMATCH` | 模式与客户主体类型不一致（personal 只接 individual；enterprise 只接 company） | block |
| ② | `MODE_PAYMENT_METHOD_MISMATCH` | enterprise 用个人账户 / personal 用对公账户 | block |
| ③ | `MODE_INVOICE_TYPE_MISMATCH` | personal 模式申请增值税专票（仅允许 none/vat_general） | block |
| ④ | `AUTHORIZATION_LETTER_NOT_SIGNED` | 企业模式公司授权书未人签（`pending_human`/`none`） | block，转人工签署 |
| ⑤ | `INVOICE_TITLE_MISMATCH` / `TAX_NO_MISMATCH` | 开票抬头/税号与认证主体不一致 | block（不产生发票） |
| ⑥ | `SIGNATORY_NOT_AUTHORIZED` | 签署人既不是授权经办人也不是法定代表人 | block，转人工 |
| ⑦ | `SEAL_NOT_SIGNED` | 需用印但用印未由自然人完成（**AI 不代签**） | block，转人工签署 |

`runDualModeOrders()` 用 6 个 mismatch 场景逐一验证（个人+企业客户+专票 / 企业+个人收款 / 授权书未签 /
抬头税号不一致 / 非授权签署人 / 用印未签），每个场景都必须 `blocked` 且无发票、无收款；
返回 `checks.{subject_consistent, invoice_consistent, payment_consistent, all_mismatches_blocked}` 与 `ok`。

## 4. 开票校验与申报草稿（人确认）

- `createInvoiceDraft()` 校验三项并给出 `checks`：`title_matches`（抬头 = 认证主体/发票默认抬头）、
  `tax_no_matches`（税号 = 认证主体税号）、`contract_matches`（发票类型 = 合同约定类型，企业默认专票、
  个人默认普票）。`ok=false` 时不生成可提交发票，转人工核对。
- 无论校验是否通过，返回的 `draft_status` 恒为 **`draft_pending_human`**：AI 只出草稿，提交必须人工。
- `createTaxFilingDraft("2026-10")`：申报草稿 `ai_may_submit:false`，人确认后在税务系统提交。
- 个人模式申请增值税专票 → 抛 `InvalidInvoiceError`（缺企业主体/对公账户）。

## 5. 双人复核与组织级审批链

- 收款账户变更：`requestAccountChange({from_account, to_account, requested_by})`（也兼容 `{from, to}` 写法）
  → `pending_dual_review`；`reviewAccountChange(id, reviewer, "approve" | "reject")`：
  - **1 人批准不生效**（`applied=false`，继续等第 2 个角色）；
  - **2 个不同角色批准** → `approved` + `applied=true`，并把档案收款账户切换为 `to_account`；
  - 重复 reviewer/同一角色复核 → 抛 `DualReviewRequiredError`（不重复计数）；
  - 任一角色 `reject` → `rejected` + `applied=false`，不生效且不能继续复核。
  - 复核人按 `profile.review_policy.dual_review_roles`（默认 `finance` / `legal`）映射角色，也可传角色名。
- `approvalChainFor(amount_cny)`：`≤5000` → `[负责人]`；`5000–50000` → `[负责人, 财务]`；
  `>50000` → `[负责人, 财务, 法人]`（角色名来自 `review_policy.approval_chain`）；
  `submitForApproval(order)` 只产生 `status:"pending"` 待办，超时挂起、不自动放行。

## 6. 用印流程（AI 不代签）

- `sealFlow({doc_id, title})` → `{status:"pending_human", ai_may_sign:false, signing_page_hint, next_action}`；
  重复调用幂等。
- `markSealSignedByHuman(doc_id, by)` 是唯一能把状态置为 `signed` 的入口；`by` 命中 AI/机器人/agent
  语义（`isAiLikeSigner`）时抛 `EnterpriseValidationError`，不写入。
- `validateEntity()` 也会检查授权书/用印的 `signed_by` 不能是 AI。

## 7. 30 条边界规则与双模式标注表

`boundaryRules30()` 恰好 **30 条** `BoundaryRow30`：`rule_id / trigger / must / user_message / mode /
personal / enterprise / test_case_id / evidence`。每条在个人、企业两种模式都标注
「已实现（implemented）/ 人工（human）/ 不适用（not_applicable）」。

- **四类重点越界**（`EB-01` 无证业务、`EB-02` 借用资质、`EB-03` 陌生外呼、`EB-04` 超预算）：
  `mode:"both"` + `must:"deny"` + 个人/企业都 `implemented`；`checkBoundary()` 在个人、企业模式都返回 `deny`。
- 用工/劳务派遣、资质代办：`human`（转人工依法处理）；经营范围外：`deny`；未授权承诺：`deny`。
- `boundaryTableMarkdown()` 输出可直接入库的表格（中文表头：
  规则 / 触发 / 必须行为 / 用户文案 / 模式 / 个人 / 企业 / 测试 / 证据）。
- 判定顺序：deny 组在前（四类重点最先）→ human 组 → draft_only 组；无命中返回 `allow`。
  每次判定追加审计（规则 id/decision/脱敏文本摘要）。

## 8. 合规边界（产品底线）

1. **不代签**：授权书、合同、用印、税务申报一律人工完成；AI 只生成待签/草稿并定位签署页。
2. **不自动提交**：发票与申报恒为 `draft_pending_human`；组织审批只提交 pending，不自动放行。
3. **不一致必须阻断**：主体/客户类型、收款账户、发票类型、授权书、抬头/税号、签署人、用印任一项不一致
   → `blocked=true`，不产生发票与收款动作，只留审计。
4. **双人复核**：收款账户变更必须 2 个不同角色批准才生效。
5. **人工/资质类转人工**：用工派遣、资质代办、跨境外汇、数据出境等一律 `human`。
6. **四类越界 100% 拒绝**：无证业务、借用资质、陌生外呼、超预算，个人+企业模式都 `deny`。
7. 全部数据为虚构演示数据；不含真实企业/税号/银行账号，不连接真实银行/税务系统。

## 9. CLI 集成建议（`steward enterprise-demo --json`）

CLI 只装配与写证据，合规判定全部交给引擎；建议证据文件（与 `scripts/run-acceptance-p3.mjs` 对齐）：

```ts
import { EnterpriseEngine, type OrderContext } from "../../packages/steward-enterprise/src/index.js";

const engine = new EnterpriseEngine();                    // 虚构示例企业档案
const entityValidation = engine.validateEntity();         // { ok:true, issues:[] }
const seal = engine.sealFlow({ doc_id: "doc-demo-contract-001", title: "示例企业服务合同（虚构）" });
const sealSigned = engine.markSealSignedByHuman(seal.doc_id, "示例法人（虚构，人签）");
const approvalChains = [3000, 20000, 80000].map((amount) => engine.approvalChainFor(amount));

// 双人复核：1 人不生效，2 个不同角色（finance + legal）后生效
const change = engine.requestAccountChange({
  from_account: "示例银行 **** 8888（虚构）",
  to_account: "示例银行 **** 9999（虚构）",
  requested_by: "示例财务（虚构）",
});
const review1 = engine.reviewAccountChange(change.id, "示例财务负责人（虚构，finance）", "approve");
const review2 = engine.reviewAccountChange(change.id, "示例法务（虚构，legal）", "approve");

// 开票校验（仅草稿，人确认提交）
const invoice = engine.createInvoiceDraft({
  mode: "enterprise", client_type: "company", quote_cny: 20000,
  invoice_type_requested: "vat_special", payment_method: "corporate_account",
  client_invoice_title: engine.profile.invoice_defaults.title,
  client_tax_no: engine.profile.invoice_defaults.tax_no,
  signatory: engine.profile.entity.agent_name,
  seal_required: true,
});

// B8 + 30 条边界
const dualMode = engine.runDualModeOrders();
const boundaryTable = engine.boundaryRules30();
const boundaryMarkdown = engine.boundaryTableMarkdown();
const boundaryChecks = engine.checkBoundary({
  kind: "business_scope", text: "承接需要资质的用工派遣业务",
  requires_license: true, mode: "enterprise",
});
```

证据文件（`<run>/` 下，`--json` 输出 `{ok, runId, artifacts:{dir}}`）：

| 文件 | 内容 |
|---|---|
| `profile.json` | 企业档案（虚构；含发票默认值/复核策略） |
| `entity-validation.json` | 主体认证四项校验结果 |
| `seal-flow.json` | `{initial, signed}`：AI 不代签流程 |
| `org-approval.json` | 3 档审批链 `[{amount_cny, chain, roles}]` |
| `dual-review.json` | `{request, after_first_review, after_second_review, applied_only_after_two}` |
| `invoice-validation.json` | 开票校验 checks + `draft_pending_human` |
| `dual-mode-orders.json` | B8 双模式结果（6 类 mismatch 全部 blocked） |
| `boundary-table.json` / `boundary-table.md` | 30 条边界双模式标注表 |
| `boundary-checks.json` | 边界判定示例（四类越界 deny / 用工 human） |
| `report.md` | 人读报告（四段式/证据清单） |

## 10. 测试与已知限制

```bash
npm run build                                # tsc（随 packages/*/src 编译）
node --test tests/unit/enterprise.test.mjs   # ≥18 条，全绿
node --test "tests/unit/*.test.mjs"          # 全量套件（不破坏既有 133 条）
```

测试全部内存/临时目录：主体校验、7 类模式冲突、blocked 不产生发票/收款、正常订单、开票三项一致性、
双人复核（1 人/2 角色/重复/拒绝）、审批链分档、用印 AI 不代签、申报草稿、30 条边界（数量/双模式标注/
四类越界双模式 deny/用工 human）、B8 双模式 checks + 6 场景阻断、审计追加、无网络调用。

已知限制：

- 评分/判定为规则制（关键词 + 结构化字段），不替代法务/税务/银行真实合规审查；真实业务仍需人工复核。
- 银行账号只保存脱敏掩码；不接真实银行、税务、发票系统，不产生真实资金/票据动作。
- 30 条边界规则是**产品侧合规清单**（可读文案+留痕），不是法律意见；企业可按自身行业扩充/裁剪。
- 中国增值税发票类型仅覆盖 `none / 普票 / 专票`；红冲、作废、电子发票台账等未在本模块范围。
