# 发布验证 / Release Verification — v0.6.0（阶段二 P1 / Phase-2 P1）

> 本文件记录 v0.6.0（阶段二个人版 MVP）发布的双通道验证（GitHub REST API + 真实浏览器），证据为真实截图。

## 1. 发布信息

| 项 | 值 |
|---|---|
| Tag | `v0.6.0` |
| Release 名称 | `v0.6.0 — 阶段二 P1 完成 / Phase-2 P1 (Personal MVP)` |
| Release URL | https://github.com/minzzj/daizhang-steward/releases/tag/v0.6.0 |
| 目标提交 | `00b98da` |
| 状态 | Latest、非 draft、非 prerelease |
| Assets | GitHub 自动源码包（zip / tar.gz，2 个） |
| 发布说明 | 来自 `docs/RELEASE_NOTES_v0.6.0.md`（中英双语：P1 亮点、B1–B8 验收对照、安装、已知限制、P2/P3/P4 计划） |

## 2. 验证方式

- **GitHub REST API**：`POST /repos/minzzj/daizhang-steward/releases` → 201；tag_name=v0.6.0、draft=false、prerelease=false
- **真实浏览器（dsh-browser + 本机 Chrome/Edge）**：打开 Release 页面核对：
  - 页面标题：`Release v0.6.0 — 阶段二 P1 完成 / Phase-2 P1 (Personal MVP) · minzzj/daizhang-steward · GitHub`
  - **Latest** 徽标、tag `v0.6.0`、提交 `00b98da`
  - 完整发布说明渲染：P1 亮点（经营域引擎 8 概念、控制台、仿真业务线、5 新命令、真实浏览器验收、CI）、B1–B8 验收对照（B3/B4→P2、B8→P3）、安装 Quickstart、已知限制、下一步
  - 截图证据：[`docs/images/release-v0.6.0.png`](../images/release-v0.6.0.png)

## 3. 结论

v0.6.0 阶段二 P1 发布已创建并公开可访问，tag、Latest 状态、发布说明与验收对照均经真实浏览器核对通过。
阶段二 P1（B1/B2/B5/B6/B7）完成，下一步 P2 故障演练（B3/B4）→ P3 企业版（B8）→ P4 v1.0 + 宣传片。