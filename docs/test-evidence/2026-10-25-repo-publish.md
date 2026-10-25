# 发布验证 / Publish Verification — 2026-10-25

## 1. 仓库

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/minzzj/daizhang-steward |
| 可见性 | Public |
| 默认分支 | `main` |
| 当前提交 | `cbf6e7d`（验证时；后续证据提交见仓库历史） |
| 提交数 | 2 |
| 许可证识别 | `NOASSERTION / Other`（CC BY-NC-SA 4.0 非 OSI，GitHub 识别库不含 NC，属预期） |
| Topics | ai-agent, browser-automation, computer-use, deepseek-harness, non-commercial, open-source, operating-ai, windows |

## 2. 验证方式

### 2.1 GitHub REST API（真实网络请求）

- `GET /repos/minzzj/daizhang-steward` → public=true, default_branch=main, license.spdx_id=NOASSERTION
- `GET /repos/minzzj/daizhang-steward/readme` → README.md 存在且可读
- `GET /user` → 认证成功（login=minzzj），用于创建仓库与推送，令牌不落盘、不打印

### 2.2 真实浏览器（DSH `dsh-browser` + 本机 Chrome/Edge）

- 打开 `https://github.com/minzzj/daizhang-steward`
- 页面标题：`GitHub - minzzj/daizhang-steward: 代掌 Steward — 可组合的操作型 AI 内核…`
- README 正常渲染（英文首页、What it is / Two phases / Architecture / License 等章节可见）
- 侧栏显示 License / Code of conduct / Contributing / Security 链接
- 文件夹列表与 2 次提交记录正常；Topics 侧栏可见
- 截图证据：[`docs/images/repo-home-2026-10-25.png`](../images/repo-home-2026-10-25.png)

### 2.3 GitHub Actions（CI）

- 工作流 `CI`（Windows + Ubuntu 矩阵：scaffold check + secret scan）
- Run **#1**（commit `35c12e2`）：**completed / success**，耗时 45s
- Run **#2**（commit `cbf6e7d`）：**completed / success**
- 真实浏览器验证 Actions 页面显示两条运行记录（见下方截图，截图时 #2 仍在跑，随后 API 确认成功）
- 截图证据：[`docs/images/ci-actions-2026-10-25.png`](../images/ci-actions-2026-10-25.png)

## 3. 未完成 / 后续

- [x] CI（GitHub Actions，Windows + Ubuntu：scaffold check + secret scan）—— #1/#2 均 success
- [ ] Release（计划 M4/v0.1.0 时创建）
- [ ] 阶段一功能开发：低峰期启动；已完成的 M0 部分代码保存在本地 `wip/m0-core` 分支（**未推送**）

## 4. 结论

仓库已创建并公开可访问，README/LICENSE/治理文件/双语文档骨架可见；发版功能开发按计划等低峰期开始。
