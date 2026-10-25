# 企业版 / Enterprise Edition（中文）

> 状态：**阶段二 P2+P3（企业版 MVP）已完成并通过验收（B8 通过）；两阶段已最终发布 v1.0.0（2026-10-26，GitHub Release Latest）；本模块随 v0.8.0 发布**。实现：`packages/steward-enterprise`；验收：
> [`p3-acceptance-2026-10-25_15-23-46.{md,json}`](../test-evidence/p3-acceptance-2026-10-25_15-23-46.md)
> + [`evidence-p3-2026-10-25_15-23-46/`](../test-evidence/evidence-p3-2026-10-25_15-23-46/)（18 文件，已脱敏）。
> **纯本地、全部数据为虚构**：不连接真实银行/税务/CA/电子签章平台，不产生真实资金、发票与申报；
> AI **不代签、不自动开票、不自动申报**。
> 英文版见 [`docs/en/enterprise.md`](../en/enterprise.md)。

## 1. 企业版增量总览

企业版在个人版（P1 个人经营 MVP）之上，补齐「企业主体」经营所需的合规增量：

| 增量 | 实现（`packages/steward-enterprise`） | 证据 |
|---|---|---|
| 主体与认证 | `validateEntity()`：营业执照/统一社会信用代码 + 公司授权书 **人签** + 对公账户 + 税号四项硬校验；虚构执照、税号、授权书签署人、用印签署人均带「虚构」标注 | `enterprise-run/entity-validation.json`、`profile.json` |
| 钱与票 | 对公账户收款校验；增值税**普通发票/专用发票**；`createInvoiceDraft()` 开票校验（抬头 / 税号 / 合同一致）→ `draft_pending_human`（人工确认，不自动开票） | `invoice-validation.json`、`dual-mode-orders.json` |
| 申报 | `createTaxFilingDraft()` 税务申报**草稿**（`ai_may_submit=false`，必须人工核对后在税务系统提交，AI 不代提交） | `boundary-table.md` EB-21、`report.md` |
| 权限与复核 | `requestAccountChange()` + `reviewAccountChange()` **双人复核**（1 位不生效；**2 位不同角色** finance + legal 才生效）；`approvalChainFor()` **组织级审批链**（≤5000 1 级 / 5000–50000 2 级 / >50000 3 级）；`acquireAgentSlot()` 多代理/多账号**串行** | `dual-review.json`、`org-approval.json`、`profile.json` |
| 用印 | `sealFlow()` 生成待签草案并定位签署页；`markSealSignedByHuman()` 只允许自然人签署（**`ai_may_sign=false`，AI 不代签**） | `seal-flow.json` |
| 合规边界 | `checkBoundary()` 30 条边界判定（用工/派遣/资质类转人工、经营范围校验、未授权承诺拒绝、四类重点越界双模式 deny）；`boundaryRules30()` 恰好 **30 条** `BoundaryRow30`；`boundaryTableMarkdown()` 生成可入库的中文标注表 | `boundary-table.{md,json}`、`boundary-checks.json` |
| B8 双模式 | `runDualModeOrders()`：个人/企业各跑一单 + **6 类不一致全部阻断**（且 blocked 时不产生发票/收款） | `dual-mode-orders.json`、`fixture-checks.json` |
| 仿真 fixtures | `examples/demo-enterprise/`：8 条订单（2 条正常 + 6 条不一致场景），逐条交叉验证全部符合预期 | `fixture-checks.json` |

## 2. 关键能力与安全默认

- **主体认证四要素**：营业执照/统一社会信用代码、公司授权书（**人签**）、对公账户、税号；缺任一项或签署状态不符即阻断。
- **双人复核**：`review_policy.dual_review_threshold_cny`（示例 5000）以上账户/敏感变更必须 2 位**不同角色**（finance、legal）批准才 `applied=true`；1 人批准仍是 `pending_dual_review`。
- **组织审批链**：按金额分档（示例：3000 → 1 级、20000 → 2 级、80000 → 3 级），AI 只提交待审批，不越级执行。
- **用印**：`seal-flow.json` 显示 `initial.status=pending_human` → `signed.status=signed`；`ai_may_sign=false` 始终成立，`signed_by=示例法人（虚构，人签）`。
- **发票**：`invoice-validation.json` 的 `title_matches/tax_no_matches/contract_matches` 三项一致，且 `draft_status=draft_pending_human`——AI 只生成草稿，不自动开票。
- **申报**：申报只能出草稿（`ai_may_submit=false`），必须财务/负责人核对后人工提交。
- **用工/派遣/资质**：EB-26/EB-27 转为人工处理，AI 不代为招工、签约或承诺办证结果。
- **多代理/多账号串行**：`multi_agent_serial=true`，本地串行队列，避免并发冲突与越权。

## 3. 30 条边界规则双模式标注表

> 由 `packages/steward-enterprise` 的 `boundaryRules30()` 生成：每条规则在**个人、企业两种模式**都标注
> 「已实现 / 人工 / 不适用」。四类重点越界（EB-01 无证业务、EB-02 借用资质、EB-03 陌生外呼、
> EB-04 超预算）在个人 + 企业两种模式都 **deny**，理由可读并留痕。
> 来源（可逐行核对）：[`evidence-p3-2026-10-25_15-23-46/enterprise-run/boundary-table.md`](../test-evidence/evidence-p3-2026-10-25_15-23-46/enterprise-run/boundary-table.md)。

| 规则 | 触发 | 必须行为 | 用户文案 | 模式 | 个人 | 企业 | 测试 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EB-01 | 无证业务：requires_license=true，或请求涉及无证/资质不全仍要接单 | deny（拒绝） | 该业务需要经营资质，个人/企业模式下均不承接无证业务。已拒绝；请先取得对应资质，或改做无需资质的业务线。 | 双模式 | 已实现 | 已实现 | EB-01-no-license | tests/unit/enterprise.test.mjs#EB-01 |
| EB-02 | 借用资质：借用/挂靠/租用他人营业执照、资质证书或许可证 | deny（拒绝） | 借用、挂靠或租用他人资质接单属于违法经营，个人/企业模式都拒绝。请以自己或授权主体的真实资质开展业务。 | 双模式 | 已实现 | 已实现 | EB-02-borrowed-license | tests/unit/enterprise.test.mjs#EB-02 |
| EB-03 | 陌生外呼/陌生名单触达（is_unknown_outreach=true，或 outreach 含陌生名单/群发意图） | deny（拒绝） | 陌生外呼、购买名单与群发触达属于骚扰与高风险行为，个人/企业模式都拒绝。只允许对明确同意的客户触达，且需人工确认。 | 双模式 | 已实现 | 已实现 | EB-03-unknown-outreach | tests/unit/enterprise.test.mjs#EB-03 |
| EB-04 | 超预算：请求金额超过当前预算/委托额度 | deny（拒绝） | 该请求金额超出预算，已拒绝并留痕。如确需继续，请先由负责人调整预算或改为分期小额方案。 | 双模式 | 已实现 | 已实现 | EB-04-over-budget | tests/unit/enterprise.test.mjs#EB-04 |
| EB-05 | 代实名/刷单/刷评/水军/冒用身份等违规操作 | deny（拒绝） | 代实名、刷单刷评、水军或冒用身份属于违规甚至违法行为，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-05-identity-fraud | tests/unit/enterprise.test.mjs#EB-05 |
| EB-06 | 垫资/垫付/借贷/贷款/过桥等资金风险行为 | deny（拒绝） | 垫资、借贷或对外融资不在代理授权范围内，个人/企业模式都拒绝。资金安排请由主体负责人本人处理。 | 双模式 | 已实现 | 已实现 | EB-06-funds | tests/unit/enterprise.test.mjs#EB-06 |
| EB-07 | 未授权对外承诺（无对话原文与委托/授权条款支撑） | deny（拒绝） | 该承诺没有可追溯的对话原文与授权条款，属未授权承诺，已拒绝。请先由授权人确认后再记录承诺。 | 双模式 | 已实现 | 已实现 | EB-07-unauthorized-promise | tests/unit/enterprise.test.mjs#EB-07 |
| EB-08 | 虚开发票/阴阳合同/发票内容与实际不符 | deny（拒绝） | 虚开发票、阴阳合同与票实不符属于严重涉税违法，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-08-invoice-fraud | tests/unit/enterprise.test.mjs#EB-08 |
| EB-09 | 企业业务走私账/个人账户收企业款（主体与收款账户不一致） | deny（拒绝） | 企业业务必须走对公账户：个人账户收企业款会造成主体/收款不一致，个人/企业模式都拒绝。 | 双模式 | 已实现 | 已实现 | EB-09-private-account | tests/unit/enterprise.test.mjs#EB-09 |
| EB-10 | 商业贿赂/回扣/返点/好处费 | deny（拒绝） | 回扣、返点、好处费等商业贿赂行为违法，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-10-bribery | tests/unit/enterprise.test.mjs#EB-10 |
| EB-11 | 社保挂靠/代缴社保（无真实劳动关系） | deny（拒绝） | 无真实劳动关系的社保挂靠/代缴属违规，个人/企业模式都拒绝。用工必须依法建立劳动关系。 | 双模式 | 已实现 | 已实现 | EB-11-social-insurance | tests/unit/enterprise.test.mjs#EB-11 |
| EB-12 | 虚假宣传/保过承诺/绝对化用语 | deny（拒绝） | 保过、包过、绝对有效等虚假宣传违反广告法，个人/企业模式都拒绝。只能提供可核验的真实能力说明。 | 双模式 | 已实现 | 已实现 | EB-12-false-advertising | tests/unit/enterprise.test.mjs#EB-12 |
| EB-13 | 绕过平台规则/风控/验证，或抓取登录后页面 | deny（拒绝） | 绕过平台规则、风控或抓取登录后页面属于违规，个人/企业模式都拒绝。只做公开允许范围内的只读操作。 | 双模式 | 已实现 | 已实现 | EB-13-platform-bypass | tests/unit/enterprise.test.mjs#EB-13 |
| EB-14 | 超出登记经营范围的业务（out_of_scope=true 或明确超出经营范围） | deny（拒绝） | 该业务超出主体登记经营范围，已拒绝。请先依法变更经营范围，或转人工评估合规路径。 | 企业 | 不适用 | 已实现 | EB-14-out-of-scope | tests/unit/enterprise.test.mjs#EB-14 |
| EB-15 | 验证码/2FA/人脸/指纹等身份验证环节 | human（转人工） | 验证码、2FA、人脸/指纹验证必须由本人完成，AI 一律停下交人（不代过、不留存凭据）。 | 双模式 | 人工 | 人工 | EB-15-captcha | tests/unit/enterprise.test.mjs#EB-15 |
| EB-16 | 合同签署/盖章/用印（AI 不代签） | human（转人工） | 合同签署与盖章必须由本人完成；AI 只生成待签草案并定位签署页，不代签。已转人工处理。 | 双模式 | 人工 | 人工 | EB-16-seal | tests/unit/enterprise.test.mjs#EB-16 |
| EB-17 | 支付/退款/转账/大额资金动作 | human（转人工） | 支付、退款与转账必须由授权人本人在审批卡确认后执行，AI 不直接发起资金动作。已生成待办。 | 双模式 | 人工 | 人工 | EB-17-payment | tests/unit/enterprise.test.mjs#EB-17 |
| EB-18 | 账号权限/密码/管理员/授权登录/改绑 | human（转人工） | 账号权限、密码与管理操作必须由本人在受控环境完成，AI 不代管。已转人工处理。 | 双模式 | 人工 | 人工 | EB-18-account | tests/unit/enterprise.test.mjs#EB-18 |
| EB-19 | 导出客户名单/个人信息等隐私数据 | human（转人工） | 导出客户名单或个人信息涉及隐私合规，需本人确认用途与授权后处理。已转人工。 | 双模式 | 人工 | 人工 | EB-19-privacy | tests/unit/enterprise.test.mjs#EB-19 |
| EB-20 | 客户投诉/纠纷/维权/仲裁/诉讼 | human（转人工） | 客户投诉、纠纷与维权事项超出代理权限，已停下交人处理。请本人先沟通并留存证据。 | 双模式 | 人工 | 人工 | EB-20-complaint | tests/unit/enterprise.test.mjs#EB-20 |
| EB-21 | 税务申报/纳税申报提交（只出草稿，人确认提交） | human（转人工） | 税务申报只能生成草稿，必须由财务/负责人核对后在税务系统确认提交；AI 不自动申报。 | 双模式 | 人工 | 人工 | EB-21-tax-filing | tests/unit/enterprise.test.mjs#EB-21 |
| EB-22 | 增值税专用发票开具（需企业主体、对公账户与人工确认） | human（转人工） | 增值税专票开具需核对抬头、税号、合同一致并人工确认提交；AI 只生成草稿，不自动开票。 | 企业 | 不适用 | 人工 | EB-22-special-invoice | tests/unit/enterprise.test.mjs#EB-22 |
| EB-23 | 收款账户/对公账户变更（双人复核） | human（转人工） | 收款账户变更必须由两位不同角色复核批准后生效；AI 不自动变更账户。 | 企业 | 不适用 | 人工 | EB-23-account-change | tests/unit/enterprise.test.mjs#EB-23 |
| EB-24 | 组织级审批链（金额达到/超过组织阈值） | human（转人工） | 达到组织阈值的大额事项必须走组织级审批链（负责人/财务/法人），AI 只提交待审批，不越级执行。 | 企业 | 不适用 | 已实现 | EB-24-approval-chain | tests/unit/enterprise.test.mjs#EB-24 |
| EB-25 | 多代理/多账号并发操作（必须串行） | human（转人工） | 多代理/多账号必须串行操作，避免并发冲突与越权；AI 自动串行排队，跨账号动作转人工确认。 | 企业 | 不适用 | 已实现 | EB-25-multi-agent-serial | tests/unit/enterprise.test.mjs#EB-25 |
| EB-26 | 用工/劳务派遣/外包用工 | human（转人工） | 用工、劳务派遣与外包用工涉及劳动关系与派遣资质，必须转人工依法处理；AI 不代为招工或签约。 | 双模式 | 人工 | 人工 | EB-26-employment | tests/unit/enterprise.test.mjs#EB-26 |
| EB-27 | 资质代办/许可证代办/资质借用通道 | human（转人工） | 资质与许可证代办需人工审核合法路径与主体资格，AI 不代为承诺办证结果。已转人工。 | 双模式 | 人工 | 人工 | EB-27-qualification-agent | tests/unit/enterprise.test.mjs#EB-27 |
| EB-28 | 跨境支付/外汇/境外收款/结汇购汇 | human（转人工） | 跨境支付与外汇结算受外汇管理监管，必须由人工按合规路径办理；AI 不发起跨境资金动作。 | 双模式 | 人工 | 人工 | EB-28-cross-border | tests/unit/enterprise.test.mjs#EB-28 |
| EB-29 | 数据出境/敏感个人信息处理 | human（转人工） | 数据出境与敏感个人信息处理需做合规评估并取得授权，必须转人工处理；AI 不擅自传输。 | 双模式 | 人工 | 人工 | EB-29-data-export | tests/unit/enterprise.test.mjs#EB-29 |
| EB-30 | 对外报价/外联触达/私信/邮件（只出草稿） | draft_only（仅草稿） | 对外报价与触达只生成草稿，需本人确认收件人与内容后再发送；AI 不自动报价、不群发。 | 双模式 | 已实现 | 已实现 | EB-30-quote-draft | tests/unit/enterprise.test.mjs#EB-30 |

**统计**：30 条规则；**双模式 25 条 + 企业专属 5 条**（EB-14 / EB-22 / EB-23 / EB-24 / EB-25）；
四类重点越界 EB-01/02/03/04 双模式 **deny**；按「必须行为」列统计：**deny 14 条 + human 15 条 +
draft_only 1 条**。

## 4. B8 双模式一致性验收

`runDualModeOrders()` 的验收证据：[`enterprise-run/dual-mode-orders.json`](../test-evidence/evidence-p3-2026-10-25_15-23-46/enterprise-run/dual-mode-orders.json)。

- **双模式各跑一单**：个人单（`vat_general` + `personal_account`）与企业单（`vat_special` + `corporate_account`）均 `ok=true`、`blocked=false`；
  一致性检查 `subject_consistent=true`、`invoice_consistent=true`、`payment_consistent=true`、`all_mismatches_blocked=true`。
- **6 类不一致全部阻断**（`mismatch_scenarios`，blocked 时不产生发票/收款，`invoice_produced=false`、`payment_captured=false`）：

| # | 场景 | 冲突码 |
|---|---|---|
| 1 | 个人模式 + 企业客户 + 专票（模式/发票类型不一致） | `MODE_CLIENT_TYPE_MISMATCH`、`MODE_INVOICE_TYPE_MISMATCH` |
| 2 | 企业模式 + 个人账户收款（主体/收款不一致） | `MODE_PAYMENT_METHOD_MISMATCH` |
| 3 | 企业模式 + 公司授权书未人签（认证不一致，AI 不代签） | `AUTHORIZATION_LETTER_NOT_SIGNED` |
| 4 | 企业模式 + 抬头/税号与主体不一致（开票校验不一致） | `INVOICE_TITLE_MISMATCH`、`TAX_NO_MISMATCH` |
| 5 | 企业模式 + 签署人非授权经办人（签署主体不一致） | `SIGNATORY_NOT_AUTHORIZED` |
| 6 | 企业模式 + 需用印但未人签（用印不一致，AI 不代签） | `SEAL_NOT_SIGNED` |

- **fixtures 交叉验证**：`examples/demo-enterprise/orders.json` 共 **8 条**（2 条正常 + 6 条不一致），
  `fixture-checks.json` 的 `total=8`、`all_ok=true`，每条 `expected_blocked == blocked`。

## 5. P3 验收结果（12/12 检查）

`npm run acceptance:p3`（本机纯本地，无真实银行/税务系统）生成
[`p3-acceptance-2026-10-25_15-23-46.{md,json}`](../test-evidence/p3-acceptance-2026-10-25_15-23-46.md)：
build、**151/151** 测试、B8 双模式、B8 六类阻断、30 条边界表、四类重点越界双模式拒绝、
双人复核（1 人不生效 / 2 人生效）、用印 AI 不代签、发票草稿 + 申报草稿（人确认）、
组织审批链（1/2/3 级）、企业边界（用工/资质转人工）、企业 fixtures 交叉验证——**12 项检查全部 ✅**；
企业 run `run-20261025-232357-2ce6f6`。

## 6. 安全边界与已知限制

- **全部为虚构数据**：执照号、税号、银行账号、法人/经办人姓名均为编造（含「虚构」标注），
  仅用于本地验收；不得直接用于真实签约/收款/开票/申报。
- **未连接真实系统**：不接真实银行、税务、CA、电子签章平台；发票、申报只出**草稿**；用印只记录
  「人工已签」状态并留痕，不生成真实签章文件。
- **AI 不代签、不自动开票、不自动申报、不自动变更账户**；组织审批链与双人复核均由人完成。
- **多代理/多账号串行**：企业版启用 `multi_agent_serial` 的本地串行队列；跨账号动作需人工确认，
  未做分布式并发调度。
- **企业专属 UI 未新增**：控制台页面复用个人版控制台（P1）的界面能力，企业数据通过 CLI/fixtures 展示；
  企业专属看板与工作流 UI 属于后续迭代。
- 30 条边界为企业版目录的**程序可拦截范围**；企业特有流程（授权书生成、真实用印、属地税务规则差异）
  仍需人工复核，不替代法律/税务专业意见。
- 版本：P3 交付 **v0.8.0**（P2 为 v0.7.0），P2+P3 已合并发布 **v0.8.0**（GitHub Release，Latest，2026-10-26），
  当前 `package.json` 版本以仓库实际为准。

## 7. 相关文档与证据

- 架构与运行形态：[`docs/zh-CN/architecture.md`](architecture.md)
- 验收清单：[`docs/zh-CN/delivery-checklist.md`](delivery-checklist.md)（B8）
- 企业 fixtures：[`examples/demo-enterprise/README.zh-CN.md`](../../examples/demo-enterprise/README.zh-CN.md)
- 模块文档：[`packages/steward-enterprise/README.md`](../../packages/steward-enterprise/README.md)
- 验收证据：[`docs/test-evidence/evidence-p3-2026-10-25_15-23-46/`](../test-evidence/evidence-p3-2026-10-25_15-23-46/)

_最后更新：2026-10-26（两阶段交付完成，v1.0.0 已发布；本模块随 v0.8.0 发布）。/ Last updated: 2026-10-26 (two-phase delivery complete; v1.0.0 released; this module shipped in v0.8.0)._
