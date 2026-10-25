# 运行报告 / Run Report — run-20261025-175213-9ea8ab

## 目标

- 目标：真实浏览器执行 demo-web 登录→提交项目流程并留证（A2）
- 分支：br-operator-20261025175213-c18c（operator）
- 提示词：operator@1.0.0

## 结果

- 状态：通过 (ok)
- 开始：2026-10-25T09:52:13.739Z
- 结束：2026-10-25T09:52:16.777Z
- 步骤数：3

## 步骤

| # | 工具 | 策略 | 结果 | 摘要 | 证据 |
|---|---|---|---|---|---|
| 1 | echo | allow | 成功 | 验收：真实 Chrome/Edge 有头模式完成登录、填表、提交、校验，每步截图 | — |
| 2 | browser.flow | allow | 成功 | 真实浏览器流程通过（case=normal），截图见 .\runs\run-20261025-175213-9ea8ab\e2e | `runs/run-20261025-175213-9ea8ab/test.log`<br>`runs/run-20261025-175213-9ea8ab/e2e/result.json`<br>`runs/run-20261025-175213-9ea8ab/e2e` |
| 3 | echo | allow | 成功 | 真实浏览器证据已写入本次 run 目录的 e2e/ | — |

## 审计事件

共 4 条事件（哈希链）。事件账本：`runs/run-20261025-175213-9ea8ab/events.jsonl`

| seq | 工具 | 策略 | 结果 |
|---|---|---|---|
| 1 | branch.start | allow | started |
| 2 | echo | allow | success |
| 3 | browser.flow | allow | success |
| 4 | echo | allow | success |

## 证据清单

- `runs/run-20261025-175213-9ea8ab/prompt.md`
- `runs/run-20261025-175213-9ea8ab/patch.diff`
- `runs/run-20261025-175213-9ea8ab/test.log`
- `runs/run-20261025-175213-9ea8ab/console.log`
- `runs/run-20261025-175213-9ea8ab/events.jsonl`
- `runs/run-20261025-175213-9ea8ab/meta.json`
- `runs/run-20261025-175213-9ea8ab/screenshots/`（真实浏览器/桌面截图；M1 起由 E2E 生成）

---

证据齐全，可进入复核。
