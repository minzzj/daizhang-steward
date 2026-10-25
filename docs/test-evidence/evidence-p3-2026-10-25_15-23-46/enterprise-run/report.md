# 运行报告 / Run Report — run-20261025-232357-2ce6f6

## 目标

- 目标：企业版：主体/授权/用印/对公/专票/双人复核/组织审批/30 条边界/B8 双模式一致性（AI 不代签、仅草稿）
- 分支：br-conductor-20261025232357-ccf1（conductor）
- 提示词：conductor@1.0.0

## 结果

- 状态：通过 (ok)
- 开始：2026-10-25T15:23:57.139Z
- 结束：2026-10-25T15:23:57.168Z
- 步骤数：3

## 步骤

| # | 工具 | 策略 | 结果 | 摘要 | 证据 |
|---|---|---|---|---|---|
| 1 | echo | allow | 成功 | 验收：B8 双模式各跑一单且 6 类不一致阻断；30 条边界双模式标注；双人复核 2 人才生效；AI 不代签；发票仅草稿 | — |
| 2 | enterprise.run | allow | 成功 | 企业版：主体校验=true；双人复核 1 人 applied=false/2 人 applied=true；发票草稿=draft_pending_human；B8 双模式=true（6 类不一致阻断=true）；边界 30 条（四类重点 4） | `runs/run-20261025-232357-2ce6f6/report.md`<br>`runs/run-20261025-232357-2ce6f6/boundary-table.md`<br>`runs/run-20261025-232357-2ce6f6/boundary-table.json`<br>`runs/run-20261025-232357-2ce6f6/dual-mode-orders.json`<br>`runs/run-20261025-232357-2ce6f6/dual-review.json`<br>`runs/run-20261025-232357-2ce6f6/seal-flow.json`<br>`runs/run-20261025-232357-2ce6f6/invoice-validation.json`<br>`runs/run-20261025-232357-2ce6f6/org-approval.json`<br>`runs/run-20261025-232357-2ce6f6/fixture-checks.json` |
| 3 | echo | allow | 成功 | 企业版证据已写入本次 run 目录（boundary-table/dual-mode-orders/dual-review/seal-flow/invoice/org-approval） | — |

## 审计事件

共 4 条事件（哈希链）。事件账本：`runs/run-20261025-232357-2ce6f6/events.jsonl`

| seq | 工具 | 策略 | 结果 |
|---|---|---|---|
| 1 | branch.start | allow | started |
| 2 | echo | allow | success |
| 3 | enterprise.run | allow | success |
| 4 | echo | allow | success |

## 证据清单

- `runs/run-20261025-232357-2ce6f6/prompt.md`
- `runs/run-20261025-232357-2ce6f6/patch.diff`
- `runs/run-20261025-232357-2ce6f6/test.log`
- `runs/run-20261025-232357-2ce6f6/console.log`
- `runs/run-20261025-232357-2ce6f6/events.jsonl`
- `runs/run-20261025-232357-2ce6f6/meta.json`
- `runs/run-20261025-232357-2ce6f6/screenshots/`（真实浏览器/桌面截图；M1 起由 E2E 生成）

---

证据齐全，可进入复核。
