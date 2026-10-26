# 配置中心与模型设置（v1.3）

> 代掌 Steward 的所有参数都在这里配置：运行模式、功能开关、预算、Token、支付/银行卡、**多模型与 API 密钥**、**系统提示词**、**系统动作策略**。

## 1. 入口

| 方式 | 命令 |
|---|---|
| 控制台（推荐） | `steward console --port 4180` → `http://127.0.0.1:4180/settings` |
| CLI | `steward config` / `steward config --action mode --mode personal` / `steward agents` |
| 配置文件 | `.steward/config.json`（本地，已在 `.gitignore`；**只存引用与掩码，不存明文密钥**） |

## 2. 三种运行模式

| | 体验模式 demo | 个人模式 personal | 企业模式 enterprise |
|---|---|---|---|
| 主体 | 无 | 个人 | 企业名称/执照/税号/法人/经办人 |
| 支付 | 仅演示记账 | **微信支付 / 支付宝 / 个人银行卡** | **对公账户** |
| 发票 | none | 个人收据（可选） | 增值税普票/专票 |
| 合同/用印 | 无 | **无合同、无签字**，AI 不代签 | 授权书/用印流程，AI 不代签 |
| 双人复核 | false | **false** | **true** |
| 默认 Token 上限 | 1,000,000 | 2,000,000 | 10,000,000 |

切换：控制台 `/settings` 三张模式卡，或 `steward config --action mode --mode personal`。

## 3. 功能开关（14 项，可逐项禁用）

browser / desktop / coding_loop / scout / content / research / payments / invoicing / notifications / auto_send / console / fault_drills / enterprise / demo_data。
禁用后内核拒绝执行并给出可读原因（`checkFeature`）。

## 4. 预算与 Token

- 三层预算：月 / 项目 / 单笔；**0 元极限模式**（任何支出拒绝，仅允许免费本地动作）。
- Token：上限 / 单步上限 / 超限策略（block / notify）；控制台显示已用与剩余。
- 0 元极限模式与 10,000,000 Token 的实测：见 `docs/test-evidence/evidence-limit-2026-10-26_22-17-54/`。

## 5. 支付与银行卡（位置明确）

控制台 `/settings` → **「支付与银行卡」高亮分组**：

- 个人模式渠道：微信支付、支付宝、个人银行卡；每渠道可启用/仅人工审批；**账户只显示掩码**（`**** **** **** 6789`、`wx_***89`、`ali***90`）。
- 收款账户：户名 / 开户行 / 卡号后 4 位 / 微信 / 支付宝掩码。
- 企业模式：对公账户、发票类型与抬头、税号掩码、双人复核、合同/授权书开关；**AI 不代签**固定徽章。
- **易支付（epay）**：启用、模式（demo/live）、网关、商户 ID、密钥引用、回调/返回 URL、支付方式（alipay/wxpay）。demo 不真实扣款；live 需真实商户信息。

密钥规则：`api_key_ref` 只接受 `env:NAME` 或 `file:secrets.json#id` 引用；本地密钥写入 `.steward/secrets.json`（gitignore）。**config.json 永不出现明文密钥。**

## 6. 多模型与 API 密钥

控制台 `/settings` →「模型与 API 密钥」：

- 内置 4 个 provider：DeepSeek（默认）、OpenAI 兼容、Anthropic、本地模型（Ollama 兼容）。
- 每个 provider 可配置：名称 / 类型 / base_url / 模型名 / 密钥引用 / 启用状态。
- **一键同步密钥**：同一密钥引用应用到所有 provider 与功能（`sync_mode=single_key_all`）。
- **每个智能体单独选模型**：supervisor / conductor / operator / harness / customer / finance / reviewer / backend / scout / content / research。
- 密钥从 `env:` 或本地 `secrets.json` 解析；界面只显示 `has_key` 与掩码，**不返回明文**。

CLI（模型/密钥）：

```bash
node dist/apps/cli/src/index.js config --json            # 查看（密钥仅引用/掩码）
node dist/apps/cli/src/index.js agents --json             # 各智能体模型与 Token 用量
```

## 7. 系统提示词（总调度可管理）

- 预置 11 份专业系统提示词：supervisor（系统总控）+ conductor（项目总调度）+ 9 专项智能体。
- 控制台 `/settings` →「系统提示词」可逐角色编辑；conductor 提示词必须含安全条款「不绕过」，所有提示词 ≥30 字符，保存升版本并写配置审计。
- 仓库源文件：`prompts/v2/*.md` + `prompts/manifest-v2.json`（sha256 校验）；默认值同步到 `packages/steward-config/src/prompts.ts`。

## 8. 系统动作策略（超级总调度）

控制台 `/settings` / `/system`：受管应用白名单（`managed_apps`）、受管插件目录（`plugins_dir`）、`allow_destructive`、`require_confirmation`（**危险动作强制二次确认**）、确认令牌 TTL（默认 120s）。

## 9. 数据与安全

- `steward data --action stats|reset`：运行时数据统计 / 清空（保留配置，删除前白名单校验、防路径穿越）。
- 审计：配置变更、密钥引用变更、提示词变更、系统动作全部追加审计（不含明文密钥）。
- 单机本地：只监听 `127.0.0.1`；写 API 需要 `X-Steward-Token`。
