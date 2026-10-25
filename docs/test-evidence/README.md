# 测试证据 / Test Evidence

本目录保存**测试与发布证据索引**，不是截图本体：

```text
docs/test-evidence/
├── test-result-<YYYY-MM-DD_HH-MM-SS>.md      # 人读：环境、命令、通过数/失败数、耗时（npm run evidence 生成）
├── test-result-<YYYY-MM-DD_HH-MM-SS>.json    # 机读：步骤/退出码/demo run-id/证据文件清单
├── 2026-10-25-repo-publish.md                # GitHub 仓库发布验证记录
└── README.md
```

## 已有证据 / Existing evidence

| 文件 | 内容 |
|---|---|
| [test-result-2026-10-25_09-20-15.md](test-result-2026-10-25_09-20-15.md) · [.json](test-result-2026-10-25_09-20-15.json) | M0 证据包（`npm run evidence`）：build / unit-tests / steward-demo 三步退出码 0，**tests 30 / pass 30 / fail 0**；demo run-id `run-20261025-172017-eb9116`；无本机绝对路径 |
| [2026-10-25-repo-publish.md](2026-10-25-repo-publish.md) | GitHub 公开发布验证（REST API + 真实浏览器 + CI #1/#2） |

- 截图与日志本体在 `runs/<run-id>/`（gitignored），测试结果文件引用其相对路径。
- 发布用的证据必须来自**干净中性路径**重跑，且不包含本机用户名/绝对路径。
- 每个数字必须能追溯到一份结果文件，禁止手填。
- 失败证据保留现场（截图 + 控制台日志 + 最小复现）。
- 结果文件由 `npm run evidence`（`scripts/run-evidence.mjs`）自动生成，**不要手工编辑**；
  文件名固定为 `test-result-<stamp>.{md,json}`，由脚本时间戳决定。

_最后更新：2026-10-25（M0 完成）。_
