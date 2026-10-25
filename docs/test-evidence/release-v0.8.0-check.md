# 发布验证 / Release Verification — v0.8.0（阶段二 P2 + P3 / Phase-2 P2 + P3）

> 本文件记录 v0.8.0 发布的双通道验证（GitHub REST API + 真实浏览器），证据为真实截图。

## 1. 发布信息

| 项 | 值 |
|---|---|
| Tag | `v0.8.0` |
| Release 名称 | `v0.8.0 — 阶段二 P2 故障演练 + P3 企业版 / Phase-2 P2 + P3` |
| Release URL | https://github.com/minzzj/daizhang-steward/releases/tag/v0.8.0 |
| 目标提交 | `95b609a` |
| 状态 | Latest、非 draft、非 prerelease |
| Assets | GitHub 自动源码包（zip / tar.gz，2 个） |
| 发布说明 | 来自 `docs/RELEASE_NOTES_v0.8.0.md`（中英双语：P2 真实长跑数字、P3 企业版、B1–B8 验收对照、安装、已知限制、P4 计划） |

## 2. 验证方式

- **GitHub REST API**：`POST /repos/minzzj/daizhang-steward/releases` → tag v0.8.0、draft=false、prerelease=false
- **真实浏览器（dsh-browser + 本机 Chrome/Edge）**：打开 Release 页面核对：
  - 页面标题：`Release v0.8.0 — 阶段二 P2 故障演练 + P3 企业版 / Phase-2 P2 + P3 · minzzj/daizhang-steward · GitHub`
  - **Latest** 徽标、tag `v0.8.0`、提交 `95b609a`
  - 完整发布说明渲染：P2 真实长跑（B3 断网 120 分钟 / 1435 动作 / 0 重复；B4 封禁 15 分钟 / 0 成功动作 / 5 条替代方案）、P3 企业版（B8 + 30 条边界）、B1–B8 验收对照、安装、已知限制、P4 计划
  - 截图证据：[`docs/images/release-v0.8.0.png`](../images/release-v0.8.0.png)

## 3. 结论

v0.8.0 已创建并公开可访问，tag、Latest 状态、发布说明与 B1–B8 验收对照均经真实浏览器核对通过。
阶段二 P2（B3/B4 真实长跑）与 P3（B8 + 30 条边界）完成；下一阶段 P4：双语文档终审 + 真实截图宣传片 + Release v1.0.0。