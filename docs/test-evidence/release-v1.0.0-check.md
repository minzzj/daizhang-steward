# 发布验证 / Release Verification — v1.0.0（两阶段交付完成 / Two-Phase Delivery Complete）

> 本文件记录 v1.0.0 最终发布的双通道验证（GitHub REST API + 真实浏览器），证据为真实截图与 Release Assets 实测。

## 1. 发布信息

| 项 | 值 |
|---|---|
| Tag | `v1.0.0` |
| Release 名称 | `v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete` |
| Release URL | https://github.com/minzzj/daizhang-steward/releases/tag/v1.0.0 |
| 目标提交 | `1e3b89f` |
| 状态 | **Latest**、非 draft、非 prerelease |
| 资产 | 宣传片 3 个（见下）+ GitHub 自动源码包 |
| 发布说明 | `docs/RELEASE_NOTES_v1.0.0.md`（中英双语：亮点、A1–A12 / B1–B8 验收对照、安装、已知限制、路线） |

## 2. Release Assets（真实截图宣传片，非重绘）

| 文件 | 大小 | 规格 |
|---|---|---|
| `daizhang-steward-promo-v1.0-bgm.mp4` | 12,947,989 B | 110.0s / 1280×720 / 30fps / H.264 + AAC 立体声 |
| `daizhang-steward-promo-v1.0-silent.mp4` | 10,169,266 B | 110.0s / 1280×720 / 30fps / 仅视频（无音轨） |
| `daizhang-steward-promo-v1.0-poster.jpg` | 85,200 B | 封面（冷开场帧） |

- 制作：HyperFrames（HTML/GSAP）+ 代码合成 BGM（120 BPM、无人声、无外部素材/字体/网络请求）
- 素材：M1 真实浏览器、M2 真实 Windows 桌面、P1 本地控制台的真实 E2E 截图（15 张，无生成/重绘 UI；隐私与本机路径已裁剪）
- 质量：`hyperframes check` ok:true（lint 0 error/0 warning、runtime 0、layout 0、motion 0、contrast 45/45 WCAG AA）
- 工程与分镜：`docs/media/promo/`（README/STORYBOARD/FACTS/poster.jpg）

## 3. 验证方式

- **GitHub REST API**：`POST /repos/minzzj/daizhang-steward/releases` → tag v1.0.0、draft=false、prerelease=false；3 个资产 `state=uploaded`，大小与本地渲染产物 SHA256 一致
- **真实浏览器（dsh-browser + 本机 Chrome/Edge）**：打开 Release 页面核对：
  - 页面标题：`Release v1.0.0 — 两阶段交付完成 / Two-Phase Delivery Complete · minzzj/daizhang-steward · GitHub`
  - **Latest** 徽标、tag `v1.0.0`、提交 `1e3b89f`、Assets 5（宣传片 3 + 源码包 2）
  - 完整双语发布说明渲染：两阶段说明、亮点（真实操作/安全治理/真实长跑/企业版/宣传片）、A1–A12 与 B1–B8 验收对照、安装 Quickstart、已知限制、路线
  - 截图证据：[`docs/images/release-v1.0.0.png`](../images/release-v1.0.0.png)

## 4. 结论

**v1.0.0 已公开发布**：两阶段交付完成（阶段一 A1–A12、阶段二 B1–B8 全部通过），含中英双语文档、CC BY-NC-SA 4.0 许可证、真实截图宣传片（Release Assets）。发布页、tag、Latest 状态、发布说明与资产均经真实浏览器/API 核对通过。