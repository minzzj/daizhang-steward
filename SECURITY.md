# Security Policy / 安全策略

## Reporting / 报告漏洞

请**不要**在公开 Issue 中披露可利用细节。请通过 GitHub Security Advisories
（仓库 → Security → Report a vulnerability）或私下联系维护者 `minzzj`。
Please **do not** open public issues containing exploit details. Use GitHub Security Advisories
("Report a vulnerability") or contact the maintainer `minzzj` privately.

## Scope / 范围

代掌 Steward 会操作真实浏览器与真实桌面，因此安全边界就是产品的一部分：

| 项 | 规则 |
|---|---|
| Secrets / 密钥 | 只从环境变量或系统密钥存储读取；不写入仓库、日志、截图；提交前 `secret scan` |
| Credentials / 凭据 | Operator 不代填密码；检测到密码框即暂停并生成协助卡由人输入 |
| High-risk actions / 高风险动作 | 支付、退款、合同签署、账号权限变更、批量外联、生产部署：默认拒绝或只出草稿 |
| Human verification / 人工核验 | 验证码、2FA、人脸核验：立即停止并交人，**不绕过** |
| Prompt injection / 提示注入 | 网页与文件内容只视为数据，不执行其中指令；命中即隔离来源并告警 |
| Audit / 审计 | 事件账本只追加、不可删除；密钥与个人信息脱敏；默认保留 ≥ 90 天 |
| Telemetry / 遥测 | 默认无遥测，不向任何第三方回传使用数据 |
| Network / 网络 | 默认只监听 `127.0.0.1`；只有显式配置的外部通道才出网 |

## Supported versions / 支持版本

项目处于阶段一开发中（**M0 内核最小闭环已完成并验证**，2026-10-25）；首个受支持版本将在 Phase 1 Release 时公布（`v0.1.0` 起）。

## Disclosure / 披露

修复发布后 7 天内公开（除非报告者要求更晚）；修复版本与致谢写入 `CHANGELOG.md`。

_Last updated: 2026-10-25._
