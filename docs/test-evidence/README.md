# 测试证据 / Test Evidence

本目录保存**测试证据索引**，不是截图本体：

```text
docs/test-evidence/
├── 测试结果-<YYYYMMDD-HHMMSS>.md      # 人读：环境、命令、通过数/失败数、耗时
├── 测试结果-<YYYYMMDD-HHMMSS>.json    # 机读：case id → result → evidence path
└── README.md
```

- 截图与日志本体在 `runs/<run-id>/`（gitignored），测试结果文件引用其相对路径。
- 发布用的证据必须来自**干净中性路径**重跑，且不包含本机用户名/绝对路径。
- 每个数字必须能追溯到一份结果文件，禁止手填。
- 失败证据保留现场（截图 + 控制台日志 + 最小复现）。

_目前为空（scaffold）；M0 后按 `pnpm test` 生成。_
