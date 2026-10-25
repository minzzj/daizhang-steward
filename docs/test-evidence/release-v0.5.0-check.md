# 发布验证 / Release Verification — v0.5.0（阶段一 / Phase 1）

> 本文件记录 v0.5.0 阶段一发布的双通道验证（GitHub REST API + 真实浏览器），证据为真实截图。
> 生成：2026-10-25 ｜ 仓库：https://github.com/minzzj/daizhang-steward

## 1. 发布信息

| 项 | 值 |
|---|---|
| Tag | `v0.5.0` |
| Release 名称 | `v0.5.0 — 阶段一完成 / Phase 1 complete` |
| Release URL | https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0 |
| 目标提交 | `42f9573`（tag 指向同一提交） |
| 状态 | Latest、非 draft、非 prerelease |
| Assets | GitHub 自动源码包（zip / tar.gz，2 个） |
| 发布说明 | 来自 `docs/RELEASE_NOTES_v0.5.0.md`（中英双语：亮点、A1–A12 证据对照、安装、CLI 13 命令、许可证、已知限制、阶段二计划） |

## 2. 验证方式

### 2.1 GitHub REST API（真实网络请求）

- `POST /repos/minzzj/daizhang-steward/releases` → 201，返回 tag_name=v0.5.0、draft=false、prerelease=false
- `GET /repos/minzzj/daizhang-steward/actions/runs` → main 推送后 CI 运行记录（阶段一最后一次为 CI success）

### 2.2 真实浏览器（DSH dsh-browser + 本机 Chrome/Edge）

- 打开 `https://github.com/minzzj/daizhang-steward/releases/tag/v0.5.0`
- 页面标题：`Release v0.5.0 — 阶段一完成 / Phase 1 complete · minzzj/daizhang-steward · GitHub`
- 页面显示 **Latest** 徽标、tag `v0.5.0`、提交 `42f9573`
- 发布说明完整渲染：亮点（Operator 真实浏览器/桌面、Harness 编码回路、Scout、安全三模块、证据体系）、
  A1–A12 验收对照表、安装与 Quickstart、13 命令清单、CC BY-NC-SA 4.0 许可证、已知限制、English summary
- 截图证据：[`docs/images/release-v0.5.0.png`](../images/release-v0.5.0.png)

## 3. 结论

v0.5.0 阶段一发布已创建并公开可访问，发布说明、tag、Latest 状态、许可证与验收对照均经真实浏览器核对通过；
源码与证据归档在 `main` 分支（提交 `42f9573` 之后如有文档更新会继续提交）。
阶段一（A1–A12）完成，下一步进入阶段二 P1 个人版 MVP。