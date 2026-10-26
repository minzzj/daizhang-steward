# 代掌 Steward v1.3.0 发布说明

**发布日期**：2026-10-26 · 许可证：CC BY-NC-SA 4.0 · 仓库：https://github.com/minzzj/daizhang-steward

v1.3 是「能对话、能编排、能控系统、能真实调用模型」的大版本：把 v1.1 的三模式配置中心升级为**多模型可配置 + 两层总调度 + 系统总控 + 变现/易支付**，并全部接入真实引擎与真实浏览器验收。

## 新增能力

### 1. 多模型与 API 密钥（用户自配）
- 4 类 provider：DeepSeek（默认）、OpenAI 兼容、Anthropic、本地模型（Ollama 兼容）；base_url / 模型名 / 密钥引用 / 启停全部可配。
- **一键同步密钥**到所有功能；**每个智能体可单独选模型**（11 角色）。
- 密钥只存引用（`env:` / 本地 `.steward/secrets.json`，已 gitignore）；界面只显示 `has_key` 与掩码，**config.json 永不出现明文**。
- 真实模型调用适配器（OpenAI 兼容 fetch）+ 无 key/网络失败时**本地规则回退并明确标注 `local_fallback`**。

### 2. 两层总调度（超级总调度 + 项目总调度）
- **L1 系统总控（supervisor，第 11 个角色）**：受管程序/插件管理、切换模型与提示词、读取全部日志、委派项目；**危险动作强制二次确认**（风险 + 回收站备份 + 一次性确认令牌 + 「确认删除」）。
- **L2 项目总调度（conductor）**：拆计划、派发、预算/Token 控制、证据汇总与验收；可打断/恢复/审批。
- **L3 十个专项智能体**：operator / harness / customer / finance / reviewer / backend / scout / content / research。
- 每轮记录 `AgentTurn`（输入摘要 / 输出摘要 / 全文 / Token / 状态 / 证据 / 模型来源）；项目级证据目录可点开截图、report.md、日志。

### 3. 控制台 v1.3（真实浏览器验收：25 步 / 303 检查 / 30 张截图）
- `/chat`：与总调度对话、新建项目、计划卡、打断/恢复、审批。
- `/agents/:role`：每个智能体每轮对话摘要与详情；`/runs/:id`：全流程时间线 + 证据灯箱。
- `/money`：变现说明（为什么之前没收到钱、¥10 是测试金额）、收款请求、确认到账、**易支付配置与收银台链接**。
- `/system`：系统总控页（两层结构、受管程序/插件、危险动作二次确认、快捷命令、易支付）。
- `/settings`：模型与密钥、系统提示词、支付与银行卡（含易支付）分组。

### 4. 变现实收 + 易支付
- 收款请求 → 收款链接/二维码 → **人工确认到账** → 账本 6 要素 + 发票草稿；演示渠道不真实扣款。
- 易支付（彩虹易支付兼容 MD5 签名）：生成收银台链接、异步通知验签 + `TRADE_SUCCESS` 自动确认到账；demo/live 模式，密钥只存引用。

### 5. CLI
`steward chat` / `supervisor` / `project` / `system` / `money` / `config` / `agents` / `data`，全部支持 `--json`。

## 真实端到端验证（本机实测）
- **真实 DeepSeek API**（用户提供密钥，仅本地环境变量/`secrets.json`，不入库）：
  - 项目总调度：真实模型生成 4 步计划 → 派发 operator/harness/reviewer/finance → 交付物 + 质检 + 核查证据 → 审批后完成，Token 1,542，模型来源 `remote`。
  - 系统总控：真实启动受管程序（pid + 心跳）→ 读取日志 → 停止；真实禁用插件；**危险动作 `removePlugin`**：高风险暂停 → 审批通过 → 备份到 `.steward/system/recycle/<stamp>/` 并删除，审计含 backup_path。
- 0 元预算极限测试（个人模式）：¥1 外部支出被拒、Token 12,000/10,000,000、真实浏览器验收、收入 ¥10 记账（历史证据保留）。
- 全量单元测试 **290/290 通过**；`check-scaffold` / `check-secrets` 通过；控制台真实有头 Chrome E2E **25/25 步、303/303 检查**。

## 已知限制
- 模型需用户自配密钥；无 key 或网络失败走本地回退（明确标注）。
- 易支付 live 需真实商户信息；demo 不产生真实资金流；到账仍以人工确认/验签回调为准。
- 系统动作默认仅 Windows 真实执行（受管白名单内）；非 Windows 需注入执行器。
- 单用户本地单机（127.0.0.1），无登录/HTTPS；企业多席位后续版本。
- 演示数据与真实运行数据分开标注；运营页演示数据、管理页真实配置。

## 升级方式
```bash
git clone https://github.com/minzzj/daizhang-steward.git
cd daizhang-steward
npm run build && npm test          # 290/290
node dist/apps/cli/src/index.js console --port 4180
# 打开 http://127.0.0.1:4180 ；在 /settings 配置模型 API 密钥后即可真实调用
```

## 证据
- 控制台 E2E：`docs/test-evidence/evidence-console-v13-<时间戳>/`（result.json + 30 张截图）
- 真实集成：`docs/test-evidence/evidence-v13-real/`（真实模型会话、系统动作审计、易支付验签、截图）
- 0 元预算极限测试：`docs/test-evidence/evidence-limit-2026-10-26_22-17-54/`
