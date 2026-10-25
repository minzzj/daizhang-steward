# 测试证据 / Test Evidence

本目录保存**测试与发布证据索引**，不是截图本体：

```text
docs/test-evidence/
├── test-result-<YYYY-MM-DD_HH-MM-SS>.md      # 人读：离线证据包（npm run evidence 生成：build + 单测 + demo）
├── test-result-<YYYY-MM-DD_HH-MM-SS>.json    # 机读：步骤/退出码/demo run-id/证据文件清单
├── m1-acceptance-<stamp>.md / .json          # M1 本机有头真实浏览器验收（npm run acceptance 生成）
├── evidence-m1-<stamp>/                      # M1 验收证据副本：A2/A4/A5 三组截图 + 日志 + result.json
├── 2026-10-25-repo-publish.md                # GitHub 仓库发布验证记录
└── README.md
```

## 已有证据 / Existing evidence

| 文件 | 内容 |
|---|---|
| [test-result-2026-10-25_09-52-08.md](test-result-2026-10-25_09-52-08.md) · [.json](test-result-2026-10-25_09-52-08.json) | M0 离线证据包（`npm run evidence`）：build / unit-tests / steward-demo 三步退出码 0，**tests 30 / pass 30 / fail 0**；demo run-id `run-20261025-172017-eb9116`；无本机绝对路径。生成于 code-loop 测试加入前（当时 tests 30；M1 起为 34/34，以 `npm test` 与 M1 验收为准） |
| [m1-acceptance-2026-10-25_09-52-12.md](m1-acceptance-2026-10-25_09-52-12.md) · [.json](m1-acceptance-2026-10-25_09-52-12.json) | M1 验收（`npm run acceptance`，本机有头真实 Chrome）：build + A2 浏览器流程 + A4 编码回路 + A5 两轮升级全部 ✅；runs `run-20261025-175213-9ea8ab` / `run-20261025-175216-fe8759` / `run-20261025-175223-de0b95` |
| [evidence-m1-2026-10-25_09-52-12/](evidence-m1-2026-10-25_09-52-12/) | M1 验收证据副本（45 文件）：`A2-browser-flow/`（7 张真实截图 + result.json）、`A4-code-loop/`（patch.diff + code-loop-result.json + 4 张截图）、`A5-escalation/`（两轮失败日志 + 升级结果） |
| [2026-10-25-repo-publish.md](2026-10-25-repo-publish.md) | GitHub 公开发布验证（REST API + 真实浏览器 + CI #1/#2） |

- 截图与日志本体在 `runs/<run-id>/`（gitignored），测试结果文件引用其相对路径。
- 发布用的证据必须来自**干净中性路径**重跑，且不包含本机用户名/绝对路径。
- 每个数字必须能追溯到一份结果文件，禁止手填。
- 失败证据保留现场（截图 + 控制台日志 + 最小复现）。
- `test-result-*` 由 `npm run evidence`（`scripts/run-evidence.mjs`）自动生成，**不要手工编辑**。
- M1 验收由 `npm run acceptance`（`scripts/run-acceptance.mjs`，本机有头真实浏览器）生成
  `m1-acceptance-*` + `evidence-m1-*`；脚本会先删除旧的 acceptance bundle，仓库只保留最新一份。

_最后更新：2026-10-25（M1 完成）。_
