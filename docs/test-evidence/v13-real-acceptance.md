# v1.3 真实集成验收 / Real Integration Acceptance（真实模型 + 真实系统动作 + 易支付）

- 日期：2026-10-26
- 模型：**DeepSeek 真实 API**（用户提供密钥，仅存本地环境变量/`.steward/secrets.json`，不入库；本目录已脱敏）
- 引擎：ConfigEngine + OrchestratorEngine + SystemController + MoneyEngine + EpayClient（全部真实调用，非 mock）
- 浏览器：控制台页面由真实引擎数据渲染（截图见 `screenshots/`）

## 1. 项目总调度（conductor）真实端到端
拓扑：`sessions-*.json`（会话 JSON）+ `runs/sess-*/`（交付物与证据）
- 真实模型生成 4 步计划：operator 交付 → harness 质检 → reviewer 核查 → finance 收款请求
- 中断/审批：finance 步骤挂起等待人工审批 → 批准后完成
- Token：1,542；模型来源：**remote**（真实模型）
- 证据：`deliverable.html`、`deliverable.md`、`quality-check.json`、`review.json`、`payment-request.json`、`ledger-record.json`
- 控制台 API 快照：`console-api-snapshot.json`（sessions/runs/evidence/system/money/models/prompts/epay）

## 2. 系统总控（supervisor）真实系统动作
- 真实启动受管程序（node demo-app，pid + 心跳文件）→ 读取全部日志 → 真实停止
- 真实禁用插件（写 `plugins/demo-plugin/plugin.json`）
- **危险动作** `removePlugin`（risk=destructive）：
  - 计划阶段标记需确认 → 会话 `paused` 等待人工；
  - 批准后执行：先备份到 `.steward/system/recycle/<stamp>/plugin-demo-plugin/demo-plugin`，再删除；
  - 审计 JSONL 含 `backup_path`；证据 `screenshots/`（系统页）+ `system-audit.jsonl`。
- 恢复：从回收站备份恢复并重新启用（仓库内 `plugins/demo-plugin` 保留演示用）。

## 3. 易支付（epay）验签到账
- demo 模式创建收款请求 → 生成易支付收银台链接（`pay_url`，demo 不真实扣款）；
- 异步通知（MD5 签名，`trade_status=TRADE_SUCCESS`）→ `epay-notify` 验签通过 → 自动确认到账 → 账本 6 要素条目；
- 证据：`epay-notify-demo.json`、`money-snapshot.json`、`console-api-snapshot.json`（money）。

## 4. 控制台真实浏览器 E2E（另见 evidence-console-v13-*）
- 25/25 步、303/303 检查、30 张截图、34.2s、退出码 0（有头 Chrome 155）。

## 5. 说明
- 密钥未入库；`config-snapshot.json` 中密钥只显示引用（`file:secrets.json#deepseek` 等），无明文。
- 演示资金渠道不真实扣款；真实资金需接商户网关/回调。