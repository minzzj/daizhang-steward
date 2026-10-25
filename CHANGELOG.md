# Changelog / 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned — Phase 1 (M0–M4)
- M0 骨架：仓库结构、`steward` CLI、ArtifactBus、MockHarness、demo-web、demo-desktop、prompts v1、CI
- M1 浏览器回路：Playwright Operator、CodeTask/CodeResult、补丁应用与测试证据
- M2 桌面与安全：Windows 桌面适配器、PolicyEngine、停止键、审计、检查点
- M3 客户分支：Scout、来源清单、评分、外联草稿、审批队列、ScoutReport
- M4 开源发布：双语文档、LICENSE/COMMERCIAL/NOTICE、CI 绿、Release、5 个 good-first-issue

### Planned — Phase 2 (personal → enterprise)
- 经营域：委托/预算/项目/任务/代理/证据/账本/墓碑 + 置信度 + L0/L1/L2 摘要
- 本地 Web 控制台：看板、审批卡、接管键、月报
- 通知与协助：Windows Toast / 邮件 / Webhook / 交接流程
- 30 条法律与合规边界规则 + 个人/企业两种模式
- IoT 适配器契约（stub）+ MCP server
- v1.0.0 发布 + 宣传片（BGM/静音双版本）

## [0.0.1] — 2026-10-25

### Added
- **GitHub 公开仓库发布**：https://github.com/minzzj/daizhang-steward（2026-10-25，public，许可证显示 Other 属预期）
- 发布验证证据：`docs/test-evidence/2026-10-25-repo-publish.md` + 真实浏览器截图 `docs/images/repo-home-2026-10-25.png`
- 仓库脚手架：目录结构、pnpm workspace、tsconfig、GitHub Actions CI 骨架
- 许可证 **CC BY-NC-SA 4.0**、`COMMERCIAL.md`、`NOTICE`（第三方 MIT 组件声明）
- 双语 README、ROADMAP、ASSUMPTIONS、HANDOFF、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT
- 双语文档骨架：architecture / contracts / threat-model / adapters / runtime-prompts / delivery-checklist
- 脚手架自检 `pnpm check`、密钥扫描 `pnpm check:secrets`、交付同步脚本 `scripts/sync-delivery.ps1`

[Unreleased]: https://github.com/minzzj/daizhang-steward/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/minzzj/daizhang-steward/releases/tag/v0.0.1
