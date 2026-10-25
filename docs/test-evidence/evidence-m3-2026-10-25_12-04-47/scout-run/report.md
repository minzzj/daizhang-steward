# 运行报告 / Run Report — run-20261025-200457-17b4e7

## 目标

- 目标：Scout：从本地合规 fixtures 产出 ICP/三场景/四因子评分/3 条外联草稿/审批队列（只起草，不发送）
- 分支：br-scout-20261025200457-0fe9（scout）
- 提示词：scout@1.0.0

## 结果

- 状态：通过 (ok)
- 开始：2026-10-25T12:04:57.258Z
- 结束：2026-10-25T12:04:57.305Z
- 步骤数：3

## 步骤

| # | 工具 | 策略 | 结果 | 摘要 | 证据 |
|---|---|---|---|---|---|
| 1 | echo | allow | 成功 | 验收：≥10 条线索（含来源+评分）、3 条草稿 ≤150 字且引用具体信号、全部待审批、0 发送、丢弃有记录 | — |
| 2 | scout.report | allow | 成功 | Scout：14 条线索 → 丢弃 4 → 合格 8 → 3 条草稿（全部待审批，0 发送） | `runs/run-20261025-200457-17b4e7/scout-report.md`<br>`runs/run-20261025-200457-17b4e7/scout-report.json`<br>`runs/run-20261025-200457-17b4e7/leads-scored.json`<br>`runs/run-20261025-200457-17b4e7/drafts.json`<br>`runs/run-20261025-200457-17b4e7/approval-queue.json`<br>`runs/run-20261025-200457-17b4e7/outreach-drafts` |
| 3 | echo | allow | 成功 | Scout 证据已写入本次 run 目录（scout-report.md/json、drafts.json、approval-queue.json、outreach-drafts/） | — |

## 审计事件

共 4 条事件（哈希链）。事件账本：`runs/run-20261025-200457-17b4e7/events.jsonl`

| seq | 工具 | 策略 | 结果 |
|---|---|---|---|
| 1 | branch.start | allow | started |
| 2 | echo | allow | success |
| 3 | scout.report | allow | success |
| 4 | echo | allow | success |

## 证据清单

- `runs/run-20261025-200457-17b4e7/prompt.md`
- `runs/run-20261025-200457-17b4e7/patch.diff`
- `runs/run-20261025-200457-17b4e7/test.log`
- `runs/run-20261025-200457-17b4e7/console.log`
- `runs/run-20261025-200457-17b4e7/events.jsonl`
- `runs/run-20261025-200457-17b4e7/meta.json`
- `runs/run-20261025-200457-17b4e7/screenshots/`（真实浏览器/桌面截图；M1 起由 E2E 生成）

---

证据齐全，可进入复核。
