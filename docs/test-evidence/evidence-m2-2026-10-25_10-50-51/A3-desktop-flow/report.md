# 运行报告 / Run Report — run-20261025-185100-6a4d70

## 目标

- 目标：真实 Windows 桌面执行 demo-desktop 打开→填表→保存→校验→截图（A3）
- 分支：br-operator-20261025185100-9cf4（operator）
- 提示词：operator@1.0.0

## 结果

- 状态：通过 (ok)
- 开始：2026-10-25T10:51:00.624Z
- 结束：2026-10-25T10:51:06.000Z
- 步骤数：3

## 步骤

| # | 工具 | 策略 | 结果 | 摘要 | 证据 |
|---|---|---|---|---|---|
| 1 | echo | allow | 成功 | 验收：真实窗口+真实键鼠完成打开/填表/保存/校验，JSON 内容正确，每步截图 | — |
| 2 | desktop.flow | allow | 成功 | 真实桌面流程通过（真实键鼠），截图见 .\runs\run-20261025-185100-6a4d70\e2e-desktop | `runs/run-20261025-185100-6a4d70/test.log`<br>`runs/run-20261025-185100-6a4d70/e2e-desktop/result.json`<br>`runs/run-20261025-185100-6a4d70/e2e-desktop` |
| 3 | echo | allow | 成功 | 真实桌面证据已写入本次 run 目录的 e2e-desktop/ | — |

## 审计事件

共 4 条事件（哈希链）。事件账本：`runs/run-20261025-185100-6a4d70/events.jsonl`

| seq | 工具 | 策略 | 结果 |
|---|---|---|---|
| 1 | branch.start | allow | started |
| 2 | echo | allow | success |
| 3 | desktop.flow | allow | success |
| 4 | echo | allow | success |

## 证据清单

- `runs/run-20261025-185100-6a4d70/prompt.md`
- `runs/run-20261025-185100-6a4d70/patch.diff`
- `runs/run-20261025-185100-6a4d70/test.log`
- `runs/run-20261025-185100-6a4d70/console.log`
- `runs/run-20261025-185100-6a4d70/events.jsonl`
- `runs/run-20261025-185100-6a4d70/meta.json`
- `runs/run-20261025-185100-6a4d70/screenshots/`（真实浏览器/桌面截图；M1 起由 E2E 生成）

---

证据齐全，可进入复核。
