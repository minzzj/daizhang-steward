# `@daizhang/steward-config` — 配置中心（v1.1-A · 三模式）

代掌 Steward v1.1 的配置中心核心：**全部参数可配置、三种运行模式、所有功能可逐项禁用、
银行卡/支付配置明确、Token 预算可配置、0 元极限预算、数据可清空**。

- 零第三方依赖；纯逻辑 + JSON 原子持久化（`<root>/config.json`）；无网络；
- 敏感字段只存掩码/引用（银行卡只留后 4 位、微信/支付宝 id 打码、税号/执照号打码），**绝不存明文**；
- 所有变更、预算拒绝、Token 超限都写审计（`<root>/config-audit.jsonl`，只追加）。

---

## 1. 三种运行模式（差异表）

| 维度 | demo 体验模式 | personal 个人模式 | enterprise 企业模式 |
|---|---|---|---|
| 用途 | 内置演示数据、零配置体验 | 个人接单（无需签字/法务条款/双人复核） | 企业接单（对公/专票/授权书/用印/复核） |
| operator_type | individual | individual | **company（必填）** |
| 主体信息 | 无 | 无 | **企业名称/执照号掩码/税号掩码/法人/经办人必填** |
| 默认支付渠道 | 人工确认（演示） | **微信支付 / 支付宝 / 个人银行卡** | **对公银行账户** + 财务人工确认 |
| 收款账户类型 | personal（演示） | personal（银行卡 + 微信/支付宝掩码） | **corporate（对公）** |
| 发票默认 | none | none（可改 personal_receipt） | **增值税专用发票（vat_special）** |
| 合同签署 sign_contract | false | **false** | **true** |
| 双人复核 require_dual_review | false | **false** | **true** |
| ai_may_sign | false | false | false（AI 永远不代签） |
| 预算（月/项目/单笔） | 50,000 / 20,000 / 5,000 | 5,000 / 2,000 / 500 | 50,000 / 20,000 / 5,000 |
| Token 上限 | 1,000,000 | 2,000,000 | **10,000,000**（本次测试值，可配） |
| 演示数据 demo_data | **开启** | 关闭 | 关闭 |
| 企业能力 enterprise | 关闭 | 关闭（切模式才有） | **开启** |
| auto_send 自动外发 | 关闭 | 关闭 | 关闭（默认安全；可显式开启） |
| 审批超时（分钟） | 1,440 | 120 | 60 |
| 数据保留（天） | 7 | 30 | 90 |

切换：`engine.setMode("enterprise")` → 应用目标模式的支付/发票/审批/主体/代理默认值并返回 diff；
预算与 Token 预算默认保留用户自定义值（`{preserve_budgets:false}`/`{preserve_token_budget:false}` 可重置），
功能开关默认按目标模式重置（`{preserve_features:true}` 保留）。

---

## 2. 配置字段总览（`<root>/config.json`）

| 字段 | 说明 |
|---|---|
| `version` | 配置结构版本（当前 1） |
| `profile` | 运行模式、主体类型、语言、币种、时区、授权人；企业模式含 `company{name, license_no_masked, tax_no_masked, legal_representative, agent_name}` |
| `features` | **14 个** FeatureToggle（enabled/requires_approval/note）：browser、desktop、coding_loop、scout、content、research、payments、invoicing、notifications、auto_send、console、fault_drills、enterprise、demo_data |
| `budgets` | 三层预算 `month_cny/project_cny/per_txn_cny` + `zero_budget_mode` + `allow_free_local_actions` |
| `token_budget` | `limit_tokens`（可配 10,000,000）/ `per_action_limit` / `used_tokens` / `on_exceed: block\|notify` |
| `payments.providers[]` | 支付渠道（wechat_pay/alipay/personal_bank_card/corporate_account/manual；enabled/mode/account_masked） |
| `payments.payout_account` | **银行卡/微信/支付宝配置位置**：holder/bank_name/card_no_masked/type/wechat_id_masked?/alipay_id_masked? |
| `payments.invoice` | 发票默认类型（none/personal_receipt/vat_general/vat_special）、抬头、税号掩码、draft_only |
| `payments.require_dual_review` / `sign_contract` / `ai_may_sign:false` | 企业复核/签署/不代签硬约束 |
| `agents[]` | 10 个代理：conductor / operator / harness（写代码）/ customer / finance / reviewer（核查）/ backend（后台）/ scout / content / research；每项 enabled/autonomy/tools/token_limit/model_ref |
| `approval` | 审批超时分钟、auto_approve 恒 false（超时挂起不自动放行）、双人复核金额阈值、接管快捷键 |
| `data` | retention_days、telemetry 恒 false（无遥测） |
| `updated_at` | 最后更新时间（ISO 8601） |

持久化：`<root>/config.json`（tmp+rename 原子写）、`<root>/config-audit.jsonl`（审计只追加）、
`<root>/token-usage.jsonl`（Token 用量历史只追加）。

**银行卡/支付配置位置（明确）**：
1. 渠道开关 → `payments.providers[]`（`setPaymentProvider(id, {enabled, mode, account})`）；
2. 收款银行卡/微信/支付宝 → `payments.payout_account`（`setPayoutAccount({card_no, wechat_id, alipay_id, ...})`，**自动掩码**）；
3. 发票 → `payments.invoice`（`setInvoiceConfig`）。

---

## 3. 功能逐项禁用

```ts
const engine = new ConfigEngine({ root: process.cwd() });   // 默认 personal
engine.setFeature("scout", { enabled: false });              // 逐项禁用
engine.setFeature("auto_send", { enabled: true, requiresApproval: true }); // 需审批
const check = engine.checkFeature("scout");
// { allowed:false, feature:"scout", requires_approval:false,
//   reason:"该功能已被用户禁用：scout（…）" }

engine.assertFeature("scout");   // 禁用时抛 FeatureDisabledError
```

14 项功能名：`browser`、`desktop`、`coding_loop`、`scout`、`content`、`research`、`payments`、
`invoicing`、`notifications`、`auto_send`、`console`、`fault_drills`、`enterprise`、`demo_data`。
`auto_send` 默认关闭（对外发送需人工确认）；`enterprise` 在非企业模式下即使开启也会被模式限制。

---

## 4. 预算：三层 + 0 元极限模式

```ts
engine.setBudgets({ month_cny: 50000, project_cny: 20000, per_txn_cny: 5000 });
engine.checkBudget("per_txn", 6000);
// { allowed:false, requiresHuman:true, reason:"预算超限（单笔）：本次 ¥6000 > 单笔额度 ¥5000" }

engine.setBudgets({ zero_budget_mode: true });  // 0 元极限模式（冻结/断网/演示）
engine.checkBudget("per_txn", 1);     // allowed:false，reason 含“0 元极限模式”
engine.checkBudget("per_txn", 0);     // allow_free_local_actions=true → 免费本地动作放行
engine.assertBudget("per_txn", 1);    // 抛 BudgetLimitError
```

约束：`单笔 ≤ 项目 ≤ 月`（非法关系拒绝保存/导入）；`checkBudget` 为单层额度校验（不累计消耗，
消耗预算由上层业务引擎记账）；负金额/非法层级抛 `ConfigValidationError`。

---

## 5. Token 预算（可配置上限）

```ts
engine.setTokenBudget({ limit_tokens: 10_000_000, per_action_limit: 200_000, on_exceed: "block" });
engine.tokenBudget.remaining();                                    // 10_000_000
engine.tokenBudget.consume(1500, { agentRole: "conductor", action: "browser.flow" });
// { ok:true, used_tokens:1500, remaining_tokens:9_998_500, ... }
engine.tokenBudget.usageByAgent();                                 // 按代理统计 calls/tokens
engine.tokenBudget.history();                                      // 用量历史（持久化）
engine.tokenBudget.consumeOrThrow(200_001, { ... });               // 超限抛 TokenLimitError
```

- 单步超 `per_action_limit` 或累计超 `limit_tokens` → `{ok:false, reason}`，**不扣减**；
- `on_exceed="block"` 时结果 `blocked:true`；`consumeOrThrow` 抛 `TokenLimitError`（含 layer: total/per_action）；
- `used_tokens` 持久化在 `config.json`，用量历史在 `<root>/token-usage.jsonl`，重启恢复。

---

## 6. 数据清空（`resetData`，白名单 + 防穿越）

```ts
const result = engine.resetData(join(root, "runs"));   // 通常是仓库根/数据根
// { data_root, deleted:[绝对路径...], missing:[...], files_deleted, bytes_freed, preserved:[...] }
```

- 只删除白名单子目录：`runs`、`domain`、`evidence`、`ledger`、`events`、`notifications`、
  `drills`、`fault`、`console`、`logs`、`temp`；
- **保留** `config.json`、审计/Token 日志、以及所有非白名单目录/文件；
- 路径安全：目标必须严格位于 `dataRoot` 内；符号链接跳过；拒绝磁盘根目录；`dataRoot` 不存在返回 missing 统计；
- 操作写审计（`data.reset`）。

---

## 7. 校验规则（`validate()` / 保存/导入时强制）

- 模式与主体：非企业模式 `operator_type` 必须 individual；企业模式必须 company 且企业主体字段齐全；
- 个人模式禁令：**不允许增值税专用发票、不允许对公账户收款**、无需双人复核/合同签署；
- 企业模式要求：**必须启用对公账户渠道 + 选择发票类型 + 双人复核 + 合同签署流程**；
- 支付：至少一个启用渠道；渠道 id 唯一；银行卡/对公账号必须是掩码（疑似明文拒绝）；
- 预算：非负且 `单笔 ≤ 项目 ≤ 月`；Token：非负、`used ≤ limit`、`on_exceed` 合法；
- 审批：`auto_approve` 恒 false（超时挂起，不自动放行）；数据：`telemetry` 恒 false、保留天数 ≥1；
- 代理：10 个角色齐全（可 disabled 但保留配置）、自主度合法、至少一个启用。

错误类：`ConfigValidationError`（含 field）、`FeatureDisabledError`、`BudgetLimitError`、
`TokenLimitError`、`ConfigIOError`。

---

## 8. API 摘要（`ConfigEngine`）

| 分组 | 方法 |
|---|---|
| 三模式 | `defaultsForMode(mode)` / `setMode(mode, options?)` → `ModeDiff` / `mode` / `config` |
| 持久化 | `load()` / `save()` / `export(): string` / `import(json)` / `reset(mode?)` |
| 功能开关 | `setFeature(name, {enabled, requiresApproval?, note?})` / `checkFeature(name)` / `assertFeature(name)` |
| 预算 | `setBudgets(partial)` / `checkBudget(kind, amount)` / `assertBudget(kind, amount)` |
| Token | `setTokenBudget(partial)` / `tokenBudget.consume/remaining/usageByAgent/history/resetUsage` / `consumeTokens` |
| 支付银行 | `paymentProviders({enabledOnly?})` / `setPaymentProvider(id, update)` / `setPayoutAccount(update)` / `maskAccount(value)` / `setInvoiceConfig` / `setPaymentsPolicy` |
| 代理 | `agents.listAgents()` / `listAgents()` / `setAgentEnabled(role, enabled)` / `setAgentConfig(role, update)` / `agentUsage(role)` / `defaultAgents(mode)` |
| 其他参数 | `setProfile(partial)` / `setApprovalPolicy(partial)` / `setData(partial)` |
| 数据/审计 | `resetData(dataRoot)` / `auditTrail(limit?)` / `tokenUsageHistory()` / `validate()` |

纯函数/常量导出：`defaultsForMode`、`defaultAgents`、`validateConfig`、`maskAccount`、`maskBankCard`、
`maskAccountId`、`maskTaxNo`、`maskLicenseNo`、`FEATURE_NAMES`、`AGENT_ROLES`、`CONFIG_VERSION`、
`RESETTABLE_SUBDIRS`。

---

## 9. CLI / 控制台集成建议（给 Lead）

```ts
// apps/cli/src/index.ts（示意，接入现有命令表）
import { ConfigEngine, ConfigValidationError } from "../../../packages/steward-config/src/index.js";
const configEngine = () => new ConfigEngine({ root: findRepoRoot() });

case "config": {
  const engine = configEngine();
  const sub = positionals[0] ?? "get";
  if (sub === "get") {
    const key = positionals[1];                       // 如 profile.mode / features.scout / budgets
    console.log(JSON.stringify(key === undefined ? engine.config : dig(engine.config, key), null, 2));
    return 0;
  }
  if (sub === "set") {                                // steward config set features.scout.enabled false
    const [path, raw] = [positionals[1], positionals[2]];
    applyConfigPath(engine, path, raw);               // 内部按路径调用 setFeature/setBudgets/... 并校验
    engine.save();
    return 0;
  }
  if (sub === "reset") { engine.reset(flagString(flags, "mode")); console.log("已恢复默认配置"); return 0; }
  if (sub === "export") { console.log(engine.export()); return 0; }
  if (sub === "import") { engine.import(readFileSync(flagString(flags, "file"), "utf8")); return 0; }
  if (sub === "validate") { const v = engine.validate(); console.log(JSON.stringify(v, null, 2)); return v.ok ? 0 : 1; }
  return 2;
}

// 三模式切换 / Toggle / 预算
case "mode": {
  const engine = configEngine();
  const diff = engine.setMode(flagString(flags, "set") ?? "personal");
  console.log(JSON.stringify({ from: diff.from, to: diff.to, changed: diff.changed }, null, 2));
  return 0;
}
case "agents": {
  const engine = configEngine();
  console.log(JSON.stringify(engine.listAgents(), null, 2));
  return 0;
}
case "data-reset": {
  const engine = configEngine();
  const result = engine.resetData(join(findRepoRoot(), "runs"));
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
case "budget": {
  const result = configEngine().checkBudget("per_txn", Number(positionals[0] ?? 0));
  console.log(JSON.stringify(result, null, 2));
  return result.allowed ? 0 : 2;
}
```

控制台（`packages/steward-console`）建议：用 `ConfigEngine` 提供设置页（三模式单选、14 个功能开关、
支付/银行卡（只显示掩码）、预算与 Token 预算、`resetData` 二次确认）；卡片展示 `checkFeature` 的
禁用原因、`checkBudget` 的层级拒绝原因与 `auditTrail`。

---

## 10. 测试

```bash
npm run build
node --test tests/unit/config.test.mjs   # 34 条（三模式/开关/预算/Token/掩码/导入导出/清空/审计）
```

覆盖：三模式默认值差异、模式切换 diff、14 项功能禁用、0 元极限模式、预算三层拒绝、Token 累计/剩余/
单步/总量/按 agent/持久化、银行卡与微信/支付宝掩码（不出现明文）、支付渠道过滤、保存/加载/导入导出/
校验失败、reset、resetData（白名单 + 防穿越 + 统计）、审计追加、个人模式禁令、企业模式主体必填。

---

## 11. 非目标与限制

- 不做真实支付/开票/银行对接（只做配置与掩码；真实资金动作由企业/财务模块人工执行）；
- 不提供 HTTP 服务（控制台在 apps/packages 层由 Lead 集成）；
- 配置为本地单机文件，不做多用户/权限（企业多席位后续版本）；
- 掩码只保证 UI/配置文件不出现明文；真实密钥/卡号请放环境变量或密钥存储（只存引用）；
- `checkBudget` 只做单层额度判断，不做跨层累计消耗（累计记账由经营域/企业引擎负责）。
