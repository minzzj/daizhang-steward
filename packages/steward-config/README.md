# `@daizhang/steward-config` — 配置中心（v1.1 三模式 + v1.2 多模型/密钥/提示词 + v1.3 supervisor/epay/系统策略 + v1.4 自动执行/审批策略 + v1.5 Harness 真实执行）

代掌 Steward 的配置中心核心：**全部参数可配置、三种运行模式、所有功能可逐项禁用、
银行卡/支付配置明确（含易支付 epay）、Token 预算可配置、0 元极限预算、数据可清空**；
v1.2 新增：**所有智能体使用可配置模型（各 agent 可不同模型/服务商）、用户自配 API 密钥引用
（env/本地 secrets 文件，密钥绝不入库）、一键同步同一密钥、专业系统提示词（核心设置由总调度管理）**；
v1.3 新增：**两层总调度（supervisor 系统总控 + conductor 总调度）、易支付（epay）、
系统动作策略（受管程序/插件/危险动作二次确认）**；
v1.4 新增：**运行时设置（发消息即自动执行、审批策略 auto_low_risk|auto_all|manual、
full_auto、单 run 步骤上限、自动返工次数、事件保留）**；
v1.5 新增：**Harness 真实执行设置（11 agent 走真实 DeepSeek Harness，supervisor 仅系统动作）、
每个 agent 的 harness 元数据（profile/workspace/tools）、HARNESS_AGENT_DIRECTIVE 与 composeHarnessPrompt**。

- 零第三方依赖；纯逻辑 + JSON 原子持久化（`<root>/config.json`）；无网络；
- 敏感字段只存掩码/引用（银行卡只留后 4 位、微信/支付宝 id 打码、税号/执照号打码、API 密钥只存 env/file 引用），**绝不存明文**；
- 所有变更、预算拒绝、Token 超限、模型/密钥引用/提示词/系统策略/运行时设置/Harness 设置变更都写审计（`<root>/config-audit.jsonl`，只追加，**不记录明文密钥**）。

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
| `models`（v1.2） | 多模型路由：`sync_mode` / `default_provider_id` / `providers[]` / `agent_models`（各 agent 可不同模型；密钥只存引用） |
| `orchestrator`（v1.2） | 总调度核心设置：`conductor_prompt` / `system_prompts[]` / `auto_plan` / `max_steps_per_run` / `ask_before_commit` |
| `system_policy`（v1.3） | 系统动作策略：`managed_apps[]` / `plugins_dir` / `allow_destructive` / `require_confirmation` / `confirmation_ttl_seconds` |
| `runtime`（v1.4） | 运行时设置：`auto_run` / `approval_mode`（auto_low_risk/auto_all/manual）/ `full_auto` / `max_auto_steps`(10–200) / `rework_limit`(0–3) / `event_retention`(100–5000) |
| `harness`（v1.5） | Harness 真实执行设置：`enabled` / `profile` / `dsh_bin` / `timeout_ms`(10–1800000) / `max_concurrency`(1–4) / `artifact_retention_days`(1–365) / `report_required` / `roles[]`（11 角色；supervisor 强制 enabled=false） |
| `agents[]` | **11 个代理**：supervisor（系统总控）/ conductor / operator / harness（写代码）/ customer / finance / reviewer（核查）/ backend（后台）/ scout / content / research；每项 enabled/autonomy/tools/token_limit/model_ref + v1.5 `harness?{profile,workspace,tools}`（supervisor 可空） |
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
| **模型路由**（v1.2） | `listModelProviders()` / `upsertModelProvider(provider)` / `removeModelProvider(id)` / `setDefaultProvider(id)` / `setModelSyncMode(mode)` / `syncApiKey(ref)` / `setProviderApiKeyRef(id, ref)` / `maskApiKeyRef(ref)` / `defaultModelRoutingFor(mode)` |
| **各 agent 模型**（v1.2） | `setAgentModel(role, binding)` / `resolveAgentModel(role)` → `{provider, model, binding, has_key, key_source}`（**不返回明文**） |
| **本地密钥**（v1.2） | `setLocalApiKey(providerId, plaintext)` / `clearLocalApiKey(providerId)` / `secretsFilePath()` / `getApiKeyForProvider(id)`（运行时解析，不落盘/不写日志） |
| **系统提示词**（v1.2） | `listSystemPrompts()` / `setSystemPrompt(role, prompt, opts?)` / `resetSystemPrompts()` / `getConductorPrompt()` / `setConductorPrompt(prompt)` / `getOrchestratorSettings()` / `setOrchestratorSettings(patch)` / `validateSystemPrompt(prompt)` |
| **易支付 epay**（v1.3） | `getEpayConfig()` / `setEpayConfig(patch)` / `maskEpayKeyRef()`（密钥只存引用；live 必须补齐商家信息） |
| **系统动作策略**（v1.3） | `getSystemPolicy()` / `setSystemPolicy(patch)`（受管应用白名单/插件目录/危险动作二次确认 TTL） |
| **运行时设置**（v1.4） | `getRuntimeSettings()` / `setRuntimeSettings(partial)`（auto_run/approval_mode/full_auto/max_auto_steps/rework_limit/event_retention；校验+审计 `runtime.update`） |
| **Harness 设置**（v1.5） | `getHarnessSettings()` / `setHarnessSettings(partial)`（roles 按角色合并、缺省补全；校验+回滚+审计 `harness.update`）/ `getHarnessRole(role)` |

纯函数/常量导出：`defaultsForMode`、`defaultAgents`、`defaultModelProviders`、`defaultModelRouting`、
`defaultAgentModels`、`defaultEpayConfig`、`defaultSystemPolicy`、`defaultRuntimeSettings`、`defaultHarnessSettings`、
`SUPERVISOR_TOKEN_LIMIT`、`HARNESS_DEFAULT_PROFILE`、`HARNESS_DEFAULT_TIMEOUT_MS`、`HARNESS_DEFAULT_MAX_TOKENS_PER_RUN`、
`validateConfig`、`maskAccount`、`maskBankCard`、`maskAccountId`、`maskTaxNo`、`maskLicenseNo`、
`maskApiKeyRef`、`isValidApiKeyRef`、`parseApiKeyRef`、`describeApiKeyRef`、`resolveApiKeyRef`、
`SECRETS_FILE_NAME`、`DEFAULT_CONDUCTOR_PROMPT`、`HARNESS_AGENT_DIRECTIVE`、`composeHarnessPrompt`、
`harnessArtifactRequirement`、`SYSTEM_PROMPT_ROLES`、`PROMPT_SAFETY_KEYWORDS`、
`PROMPT_V3_VERSION`、`PROMPT_V3_UPDATED_AT`、
`buildDefaultSystemPrompts`、`buildDefaultOrchestratorSettings`、`validateSystemPromptText`、
`hasSafetyKeyword`、`FEATURE_NAMES`、`AGENT_ROLES`、`CONFIG_VERSION`、`RESETTABLE_SUBDIRS`。
（类型 `RuntimeSettings` / `ApprovalMode` / `RuntimeSettingsUpdate` / `HarnessSettings` / `HarnessRoleSettings` /
`HarnessSettingsUpdate` / `AgentHarnessMeta` / `PromptV3Entry` 也可从包入口导入。）

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
node --test tests/unit/config.test.mjs   # 85 条（v1.1 三模式/开关/预算/Token/掩码/清空/审计 + v1.2 模型/密钥/提示词/迁移 + v1.3 supervisor/epay/系统策略 + v1.4 运行时设置/审批策略 + v1.5 Harness 设置/元数据/v3 提示词）
node --test tests/unit/prompts.test.mjs  # 9 条（v1 4 篇 + v2 11 篇 + v3 11 篇 manifest/v3 默认值/compose）
```

覆盖：三模式默认值差异、模式切换 diff、14 项功能禁用、0 元极限模式、预算三层拒绝、Token 累计/剩余/
单步/总量/按 agent/持久化、银行卡与微信/支付宝掩码（不出现明文）、支付渠道过滤、保存/加载/导入导出/
校验失败、reset、resetData（白名单 + 防穿越 + 统计）、审计追加、个人模式禁令、企业模式主体必填；
v1.2：默认模型路由/各 agent 不同模型、一键同步、per-provider 独立、密钥引用格式校验与掩码、
本地 secrets 写入（config.json 无明文）、has_key 解析不泄露、系统提示词修改/重置/校验、总调度核心提示词、
旧配置迁移、审计无明文；v1.3：supervisor 两层总调度（第 11 角色/权限/自治/Token）、epay 默认与
demo/live 校验、系统动作策略默认值与非法配置拒绝、v1.2→v1.3 旧配置迁移；v1.4：运行时设置默认值
（三模式步骤上限 10/20/50）、get/set、非法枚举与范围拒绝、full_auto×manual 冲突、旧配置迁移、
`runtime.update` 审计、validate、与 Token/预算并存、setMode 保留/重置；
v1.5：Harness 默认值（三模式一致/11 角色/supervisor 强制 false）、get/set 与持久化、roles 合并、
越界/重复/未知角色拒绝、旧配置迁移（含 roles 残缺补全）、`harness.update` 审计与回滚、validate、
composeHarnessPrompt 11 角色关键词、HARNESS_AGENT_DIRECTIVE、agent harness 元数据、导入导出往返、setMode 保留；
**v1.5 补充：默认 prompts = `prompts/v3/*.md`（11 篇 3.0.0 原文内嵌，`PROMPT_V3_VERSION`/`PROMPT_V3_UPDATED_AT`；
manifest-v3 sha256 由 `tests/unit/prompts.test.mjs` 校验；compose = v3 原文 + 简短统一指令 + 角色产物要求）**。

---

## 11. 模型与 API 密钥配置（v1.2）

```ts
const engine = new ConfigEngine({ root: join(process.cwd(), ".steward-data") });

// 1) 看/改模型服务商（4 个预置：DeepSeek 默认启用，OpenAI 兼容/Anthropic/本地默认关闭）
engine.listModelProviders();
engine.upsertModelProvider({
  id: "my-openai", name: "我的 OpenAI 兼容", kind: "openai_compatible",
  base_url: "https://api.example.com/v1",
  api_key_ref: "env:MY_OPENAI_KEY",       // 只存引用，不存明文
  enabled: true, default_model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o"],
});
engine.setDefaultProvider("deepseek");

// 2) 每个 agent 可绑定不同服务商/模型/温度/最大 token
engine.setAgentModel("conductor", { provider_id: "deepseek", model: "deepseek-reasoner", temperature: 0.3, max_tokens: 8192 });
engine.setAgentModel("operator",  { provider_id: "my-openai", model: "gpt-4o-mini" });
const resolved = engine.resolveAgentModel("operator");
// { provider, model, binding, has_key: true, key_source: "env" } ← 只给 has_key，不给明文

// 3) 运行时解析密钥（仅运行器内部使用；不写日志/审计/配置）
const key = engine.getApiKeyForProvider("my-openai");   // { ok, value, source: "env"|"file" }
```

`resolveAgentModel` 返回字段：`{role, provider_id, provider, binding, model, has_key, key_source}`；
`has_key=false` 时 `key_source="missing"`，调用方应提示用户配置密钥（而不是拿空 key 调模型）。

---

## 12. 一键同步同一密钥 / 独立密钥（v1.2）

- `sync_mode = "single_key_all"`：所有服务商/功能共用同一个密钥引用（个人/体验模式默认）；
- `sync_mode = "per_provider"`：各服务商独立密钥（企业模式默认，适合多团队/多账号）。

```ts
engine.syncApiKey("env:MY_SHARED_KEY");                 // 一键同步到所有功能
engine.setModelSyncMode("per_provider");                 // 切独立模式
engine.setProviderApiKeyRef("openai", "env:OPENAI_KEY"); // per_provider 只改单个
engine.setModelSyncMode("single_key_all");               // 切回一键：立即统一所有引用
```

`single_key_all` 模式下配置校验会拒绝引用不一致（`validate()` 报可读错误）；
模式切换（`setMode`）默认保留用户自配模型与密钥引用（`preserve_models:false` 才重置）。

---

## 13. 系统提示词（专业版，核心设置由总调度管理）（v1.2 / v1.5 接入 v3）

`orchestrator` 保存总调度负责的核心设置；**默认文本 = `prompts/v3/*.md`（version 3.0.0，真实 Harness 代理提示词，已内嵌于 `src/prompts-v3.ts`）**：

| 字段 | 说明 |
|---|---|
| `conductor_prompt` | 总调度核心系统提示词（v3/conductor.md：计划/调度/预算/审批/证据/失败升级/接管） |
| `system_prompts[]` | 11 个 agent 角色的 v3 专业提示词（`{role, title, system_prompt, updated_at}`；updated_at=`2026-10-30T00:00:00.000Z`） |
| `auto_plan` / `max_steps_per_run` / `ask_before_commit` | 自动规划 / 单次运行步数上限（demo 10 / personal 20 / enterprise 50）/ 提交前确认 |

```ts
engine.getConductorPrompt();                          // = prompts/v3/conductor.md
engine.setConductorPrompt("你是总调度：先计划后执行，所有结论附证据；支付/合同必须审批；不越界；失败升级人工。");
engine.listSystemPrompts();                          // 11 个 agent v3 提示词（含 supervisor）
engine.setSystemPrompt("operator", "…>20 字，含证据/审批/不越界/失败升级…");
engine.resetSystemPrompts();                         // 恢复 v3 默认（conductor_prompt 一并恢复）
engine.setOrchestratorSettings({ auto_plan: false, max_steps_per_run: 8, ask_before_commit: true });
engine.validateSystemPrompt(text);
// 版本常量：PROMPT_V3_VERSION="3.0.0"、PROMPT_V3_UPDATED_AT="2026-10-30T00:00:00.000Z"
```

- `prompts/v3/` 11 篇为默认来源（`prompts/manifest-v3.json` 记录 sha256）；`prompts/v2/`、`prompts/`（v1）与
  各自 manifest 保留为历史版本（旧测试仍校验哈希）。
- 修改默认提示词：改 `prompts/v3/*.md` → 重新生成 `src/prompts-v3.ts` + `manifest-v3.json`（`gen-v3-prompts.mjs` 不在仓库，由维护者本地执行）。

提示词修改会写审计（`prompt.update` / `orchestrator.conductor.update` / `prompt.reset`），不记录密钥。

---

## 14. 两层总调度：supervisor 系统总控 + conductor 总调度（v1.3）

`defaultAgents` 由 10 个角色扩展为 **11 个**：新增第 11 个角色 **`supervisor`（系统总控/超级总调度）**，
三模式默认均存在，默认配置：

```ts
{
  role: "supervisor", name: "系统总控", autonomy: "approval_required",
  tools: ["system.*", "agents.*", "models.*", "prompts.*", "project.delegate", "logs.read"],
  token_limit: 1_000_000, enabled: true,
}
```

| 层级 | 角色 | 职责 |
|---|---|---|
| 最高层（系统级） | **supervisor 系统总控** | 管理程序与插件（受管应用白名单/plugins 目录）、管理**所有 agent 的模型与系统提示词**、读全部日志（只读不删）、危险动作**二次确认**；系统级/跨 agent 核心设置 |
| 业务层 | **conductor 总调度** | 拆解目标、派发专项代理、预算/Token 管控、证据汇总、审批与接管（业务编排） |

约束（`validate()` 强制）：supervisor 必须存在且 `autonomy="approval_required"`、必须含
`system.* / agents.* / models.* / prompts.* / logs.read` 权限工具；默认 `token_limit=1,000,000`
（`SUPERVISOR_TOKEN_LIMIT`）。supervisor 默认系统提示词含“系统总控/证据/审批/不越界/失败升级/日志/二次确认”。

---

## 15. 易支付（epay）配置（v1.3）

`payments.epay`：

```ts
interface EpayConfig {
  enabled: boolean;
  gateway_url: string;   // 必须 https
  pid: string;           // 商户 ID（demo 可空；live 必填）
  key_ref: string;       // 商户密钥引用：env:EPAY_KEY / file:secrets.json#epay（绝不存明文）
  pay_types: Array<"alipay" | "wxpay">;
  notify_url: string;
  return_url: string;
  mode: "demo" | "live";
  sign_type: "MD5";
}
```

- 默认：`enabled=false`、`mode="demo"`、网关 `https://pay.example.com/submit.php`、
  `pay_types=["alipay","wxpay"]`、`sign_type="MD5"`（未填商家信息时 disabled）；
- 校验：`gateway_url` 必须 **https**；`key_ref` 只允许 `env:NAME` / `file:path#key`（拒绝明文）；
  `key_ref` 可通过 `maskEpayKeyRef()` 掩码展示；`mode="live"` 时必须补齐 `pid + key_ref + notify_url + return_url`；
- 配置方法：`getEpayConfig()` / `setEpayConfig(patch)`；变更写审计（`payment.epay.update`，reason 只含掩码引用）。
- 本地密钥：`setLocalApiKey("epay", plaintext)` 写 `<root>/secrets.json`，并把 `key_ref` 设为 `file:secrets.json#epay`。

---

## 16. 系统动作策略（受管程序/插件/危险动作二次确认）（v1.3）

`system_policy`（由 supervisor 使用）：

```ts
interface SystemPolicyConfig {
  managed_apps: Array<{ id; name; command; allow_start; allow_stop; allow_remove }>;
  plugins_dir: string;
  allow_destructive: boolean;
  require_confirmation: boolean;
  confirmation_ttl_seconds: number;
}
```

默认：受管应用=内置演示（`demo-node` Node 演示服务 / `notepad` 记事本）、`plugins_dir="plugins"`、
`allow_destructive=true` 但 `require_confirmation=true`、`confirmation_ttl_seconds=120`。
校验：受管应用 id/name/command 非空且 id 唯一；`plugins_dir` 必须是安全相对路径（不允许绝对路径/`..`）；
TTL 1–3600；**安全约束：`allow_destructive=true` 时 `require_confirmation` 必须为 true（危险动作强制二次确认）**。
方法：`getSystemPolicy()` / `setSystemPolicy(patch)`；变更写审计 `system.policy.update`。

---

## 17. 安全说明（密钥绝不入库）

1. **config.json 只存引用**：`model.providers[].api_key_ref` / `payments.epay.key_ref` 只允许
   `env:NAME` / `file:<相对路径>#<key>` / 空；任何像明文密钥的字符串都会被拒绝（`ConfigValidationError`）。
2. **明文只可能在两处**：进程环境变量；`<root>/secrets.json`（`setLocalApiKey` 写入，尽力 0600，
   `.gitignore` 已忽略 `secrets*`）。`setLocalApiKey` 后自动把引用设为 `file:secrets.json#<id>`。
3. **不落日志/审计**：`resolveAgentModel` 只返回 `has_key`；`getApiKeyForProvider` 返回的明文
   仅供运行时调用，引擎不写日志、不写审计、不落盘；审计 reason 只写掩码引用（`env:DE***EY`）。
4. **展示用掩码**：`maskApiKeyRef` / `describeApiKeyRef` / `maskEpayKeyRef` 可安全用于控制台；
   `setLocalApiKey` 在纯内存模式（无 root）会拒绝（没有安全落盘位置时不允许写明文）。
5. **路径安全**：`file:` 引用与 `plugins_dir` 只允许相对路径且禁止 `..`；解析时校验路径不出 root；
   受管应用/插件目录操作由系统动作执行器限定在受管目录内。

---

## 18. CLI / 控制台集成补充（v1.2 / v1.3）

```ts
// 模型与密钥
engine.listModelProviders();                              // 展示 api_key_ref masked + has_key
engine.syncApiKey("env:MY_SHARED_KEY");                   // 一键同步同一密钥到所有功能
engine.setProviderApiKeyRef("my-openai", "env:MY_OPENAI_KEY");
engine.setLocalApiKey("my-openai", readHiddenInput());    // 明文只写 secrets.json
engine.setAgentModel("supervisor", { provider_id: "deepseek", model: "deepseek-reasoner" });
engine.resolveAgentModel("conductor");                    // 校验并提示 has_key

// 系统提示词 / 总调度
engine.listSystemPrompts(); engine.setSystemPrompt("supervisor", promptText);
engine.setConductorPrompt(conductorPromptText); engine.resetSystemPrompts();

// 易支付
engine.getEpayConfig(); engine.setEpayConfig({ enabled: true, mode: "demo", pid: "10001", key_ref: "env:EPAY_KEY" });
engine.maskEpayKeyRef();

// 系统动作策略
engine.getSystemPolicy(); engine.setSystemPolicy({ plugins_dir: "plugins", confirmation_ttl_seconds: 120 });

// 双层设置页建议：系统级（supervisor：程序/插件/所有 agent 模型与提示词/系统策略）
// vs 业务级（conductor：预算/审批/业务提示词），两者数据都来自同一个 ConfigEngine。
```

控制台建议：设置页分「系统总控（supervisor）」与「业务总调度（conductor）」两栏；
模型/密钥区展示 `has_key` 徽标与掩码引用、一键同步按钮；系统动作区展示受管应用白名单与
“危险动作需二次确认”开关（关闭确认会被校验拒绝）；易支付区展示 demo/live 状态与掩码后的商户密钥引用。

---

## 19. 自动执行与审批策略（v1.4）

`runtime`（配置中心「自动执行/审批策略」；控制台 `/settings` 展示与修改；发消息即自动执行的基础）：

```ts
export type ApprovalMode = "auto_low_risk" | "auto_all" | "manual";
export interface RuntimeSettings {
  auto_run: boolean;          // 发消息后自动执行（默认 true）
  approval_mode: ApprovalMode;// 默认 auto_low_risk：仅 high/critical/requires_confirmation 暂停
  full_auto: boolean;         // 默认 false；true 时除 destructive 外全自动
  max_auto_steps: number;     // 单 run 自动步骤上限 10–200（默认 demo 10 / personal 20 / enterprise 50）
  rework_limit: number;       // 自动返工次数 0–3（默认 1）
  event_retention: number;    // 每 run 事件保留 100–5000（默认 1000）
}
```

三模式默认值（`defaultsForMode(mode).runtime` / `defaultRuntimeSettings(mode)`）：

| 字段 | demo | personal | enterprise |
|---|---|---|---|
| auto_run | true | true | true |
| approval_mode | auto_low_risk | auto_low_risk | auto_low_risk |
| full_auto | false | false | false |
| max_auto_steps | **10** | **20** | **50** |
| rework_limit | 1 | 1 | 1 |
| event_retention | 1000 | 1000 | 1000 |

```ts
const runtime = engine.getRuntimeSettings();
engine.setRuntimeSettings({ auto_run: true, approval_mode: "auto_low_risk", full_auto: false });
engine.setRuntimeSettings({ max_auto_steps: 60, rework_limit: 2, event_retention: 2000 });
// 校验：auto_run/full_auto 布尔；approval_mode 枚举；max_auto_steps 10–200；
//       rework_limit 0–3；event_retention 100–5000；full_auto=true 不能与 approval_mode=manual 同时使用。
```

- `setRuntimeSettings` 失败（枚举/范围/冲突）会回滚且不改变已有设置；成功写审计 `runtime.update`
  （reason 含 auto_run/approval_mode/full_auto/max_auto_steps/rework_limit/event_retention，**不含敏感信息**）。
- 旧 config 缺 `runtime` → 加载时自动补该模式默认值（迁移不丢已有字段）；`validate()` 覆盖类型/枚举/范围与
  full_auto×manual 一致性；`setMode` 默认保留用户 runtime 设置（`preserve_runtime:false` 才重置为目标模式默认值）。
- 与预算/Token 并存互不影响（修改 runtime 不会改 budgets/token_budget/used_tokens）。

---

## 20. Harness 真实执行设置（v1.5）

把各个 agent 换成**真实 DeepSeek Harness 代理**（v1.5-C 配置中心侧）：`harness` 保存总设置与 11 角色设置，
真实执行由运行时按该配置拉起 DSH；本包只做配置、校验、迁移（**不注入密钥、不发起模型调用**）。

### 20.1 HarnessSettings（`config.harness`）

```ts
export interface HarnessRoleSettings {
  role: string;               // 11 个 agent 角色之一（含 supervisor）
  enabled: boolean;           // 是否走真实 Harness（默认 true；supervisor 强制 false）
  workspace: string;          // 相对 runDir 的工作区子目录模板（默认 "workspace/<role>"）
  timeout_ms: number;         // 默认 300000（10–1800000）
  max_tokens_per_run: number; // 默认 200000（1000–2000000）
}
export interface HarnessSettings {
  enabled: boolean;                 // 总开关（默认 true；无 dsh 时运行时自动回退本地执行）
  profile: string;                  // 默认 "headless"
  dsh_bin: string;                  // 空 = 自动探测（STEWARD_DSH_BIN / node + APPDATA npm 全局路径）
  timeout_ms: number;               // 默认 300000（10–1800000）
  max_concurrency: number;          // 1–4，默认 2
  artifact_retention_days: number;  // 1–365，默认 30
  report_required: boolean;         // 默认 true：每个 agent 必须产出 report.md
  roles: HarnessRoleSettings[];     // 11 个角色各一条
}
```

默认值（三模式一致）：`enabled=true`、`profile="headless"`、`dsh_bin=""`、`timeout_ms=300000`、
`max_concurrency=2`、`artifact_retention_days=30`、`report_required=true`；
roles = 11 角色，`workspace="workspace/<role>"`、`timeout_ms=300000`、`max_tokens_per_run=200000`；
**supervisor.enabled 恒为 false（系统总控走系统动作层，不走 Harness 业务执行），其余 10 角色 enabled=true**。

```ts
const harness = engine.getHarnessSettings();
engine.setHarnessSettings({ enabled: true, profile: "headless", max_concurrency: 3 });
engine.setHarnessSettings({ roles: [{ role: "operator", enabled: true, workspace: "workspace/operator", timeout_ms: 600000 }] });
engine.getHarnessRole("operator");   // 单角色（只读副本）
// 校验：profile 非空；timeout 10–1800000；max_concurrency 1–4；artifact_retention_days 1–365；
//       roles 必须覆盖 11 角色且不重复；supervisor.enabled 必须 false；workspace 必须是相对 runDir 的安全相对路径；
//       失败回滚；成功写审计 harness.update（不含敏感信息）。
```

### 20.2 每个 agent 的 harness 元数据（`AgentConfig.harness`）

`defaultAgents` 为 10 个业务角色补 `{profile, workspace, tools}`（supervisor 不直接跑 Harness，保持为空）：

| 角色 | 默认 workspace | 默认 tools |
|---|---|---|
| conductor | workspace/conductor | read, glob, grep |
| operator | workspace/operator | read, write, edit, bash, browser |
| harness | workspace/harness | read, write, edit, bash, test |
| customer | workspace/customer | read, write |
| finance | workspace/finance | read, write |
| reviewer | workspace/reviewer | read, glob, grep |
| backend | workspace/backend | read, write, bash |
| scout | workspace/scout | web_search, web_fetch, write |
| content | workspace/content | read, write |
| research | workspace/research | web_search, web_fetch, write |

### 20.3 提示词接入：`HARNESS_AGENT_DIRECTIVE` + `composeHarnessPrompt(role)`（v3）

- 默认 `system_prompts` 11 篇 = `prompts/v3/*.md`（version 3.0.0，真实 Harness 代理版；内嵌于 `src/prompts-v3.ts`）；
- `HARNESS_AGENT_DIRECTIVE`：**简短**统一执行指令（真实使用工具、产物落盘到工作区、写 `report.md`、
  给出证据、不得声称未执行的操作、危险动作交人、不越界、失败升级）——v3 原文已含详细条款，此处只做叠加避免重复过重；
- `composeHarnessPrompt(role)` = **v3 角色原文** + 简短统一指令 + 角色专属产物要求 + 完成判定
  （operator 交付 HTML/截图，harness 交付 `patch.diff`/`test.log`，reviewer 交付 review 报告，
  finance 交付账本/开票草稿，scout 交付线索报告，content 交付内容草稿，research 交付调研报告，
  backend 交付数据报告，customer 交付客户草稿，conductor 交付项目计划/验收，supervisor 交付系统动作/审计记录）。
  运行时创建真实 Harness agent 时使用；`buildDefaultSystemPrompts` 仍输出 11 篇 v2 原文不受影响。

### 20.4 如何关闭 / 回退

- 全局关闭：`engine.setHarnessSettings({ enabled: false })` → 运行时回退到本地/模型输出执行（不再拉起 DSH）；
- 单角色关闭：`engine.setHarnessSettings({ roles: [{ role: "scout", enabled: false }] })`；
- **supervisor 不能开启**（只做系统动作，避免系统权限被 Harness 业务代理越界使用）；
- 配置损坏/缺 dsh 时运行时自动回退；配置中心始终可读、可改、可回退（`harness.update` 审计留痕）。

### 20.5 密钥安全

- Harness 设置**不存任何 API 密钥**：`harness` 只有 profile/dsh_bin/超时/并发等参数；
- 真实 Harness 使用**本机 DSH 凭据**（用户本机已登录/已配置），配置中心不注入、不转发、不记录密钥；
- 模型密钥仍走 v1.2 的 `models.providers[].api_key_ref`（env/file 引用，绝不入库）。

---

## 21. 非目标与限制

- 不做真实支付/开票/银行/易支付资金对接（只做配置、掩码与校验；真实资金动作由企业/财务模块人工执行）；
- 不提供 HTTP 服务（控制台在 apps/packages 层由 Lead 集成）；
- 配置为本地单机文件，不做多用户/权限（企业多席位后续版本）；
- 掩码只保证 UI/配置文件不出现明文；真实密钥/卡号请放环境变量或密钥存储（只存引用）；
- `checkBudget` 只做单层额度判断，不做跨层累计消耗（累计记账由经营域/企业引擎负责）；
- supervisor/system_policy 只做**配置与校验**；真实进程/插件操作由系统动作执行器按该策略执行（安全边界在配置层 + 执行器双层）；
- epay 默认仅 demo 模式；`live` 需要用户填入真实商户信息并由人工确认（本包不发起任何真实支付请求）；
- v1.5 `harness` 只做**配置/校验/迁移与提示词组合**；真实 DSH 拉起、执行、产物回收由运行时（steward-runtime）按该配置实现，
  `dsh_bin` 不检查存在性（空=自动探测），无 dsh 时运行时自动回退；本包不注入也不读取任何 API 密钥。
