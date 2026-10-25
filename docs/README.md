# Docs / 文档索引

> 每个文档提供中英两份：中文在 `zh-CN/`，英文在 `en/`。两者内容保持一致；如有差异以中文为准并尽快修正英文。
> Every doc ships in both Chinese (`zh-CN/`) and English (`en/`). Keep them in sync; if they differ,
> the Chinese version prevails until the English one is corrected.

| 文档 | 内容 |
|---|---|
| [zh-CN/architecture.md](zh-CN/architecture.md) · [en/architecture.md](en/architecture.md) | 总体架构、分层、运行形态、扩展点 |
| [zh-CN/contracts.md](zh-CN/contracts.md) · [en/contracts.md](en/contracts.md) | 核心契约：BranchSpec / CodeTask / CodeResult / Lead / ApprovalCard / TakeoverPack / Event |
| [zh-CN/threat-model.md](zh-CN/threat-model.md) · [en/threat-model.md](en/threat-model.md) | 威胁模型与默认拒绝清单 |
| [zh-CN/adapters.md](zh-CN/adapters.md) · [en/adapters.md](en/adapters.md) | 浏览器/桌面/线索来源（Scout）/模型/通知/IoT 适配器契约 |
| [zh-CN/runtime-prompts.md](zh-CN/runtime-prompts.md) · [en/runtime-prompts.md](en/runtime-prompts.md) | 运行时提示词的版本、测试与替换规则 |
| [zh-CN/delivery-checklist.md](zh-CN/delivery-checklist.md) · [en/delivery-checklist.md](en/delivery-checklist.md) | 验收 × 证据映射（A1–A12 / B1–B8 / U1–U8；M3 已完成 A1/A2/A3/A4/A5/A6/A7/A8/A9/A12） |
| [test-evidence/README.md](test-evidence/README.md) | 测试证据归档规范；`test-result-*`（离线证据包）、`m1-acceptance-*` + `evidence-m1-*`（M1 本机有头验收）、`m2-acceptance-*` + `evidence-m2-*`（M2 真实桌面 + 安全验收）、`m3-acceptance-*` + `evidence-m3-*`（M3 Scout 验收）与发布验证记录 |
| [../runs/](../runs/) | 每次运行的产物本体（gitignored；证据在此，不在文档目录） |
| [images/README.md](images/README.md) | 截图规范（E2E 自动生成、中性路径） |

> 当前状态（2026-10-25）：**M3 完成** — A1 / A2 / A3 / A4 / A5 / A6 / A7 / A8 / A9 / A12 通过。M0 证据见
> [test-evidence/test-result-2026-10-25_09-52-08.md](test-evidence/test-result-2026-10-25_09-52-08.md)；
> M1 证据见 [test-evidence/m1-acceptance-2026-10-25_09-52-12.md](test-evidence/m1-acceptance-2026-10-25_09-52-12.md)
> 与 [test-evidence/evidence-m1-2026-10-25_09-52-12/](test-evidence/evidence-m1-2026-10-25_09-52-12/)（A2/A4/A5 共 45 文件）；
> M2 证据见 [test-evidence/m2-acceptance-2026-10-25_10-50-51.md](test-evidence/m2-acceptance-2026-10-25_10-50-51.md)
> 与 [test-evidence/evidence-m2-2026-10-25_10-50-51/](test-evidence/evidence-m2-2026-10-25_10-50-51/)（A3/A8/A9 共 34 文件）；
> M3 证据见 [test-evidence/m3-acceptance-2026-10-25_12-04-47.md](test-evidence/m3-acceptance-2026-10-25_12-04-47.md)
> 与 [test-evidence/evidence-m3-2026-10-25_12-04-47/](test-evidence/evidence-m3-2026-10-25_12-04-47/)（A7 共 15 文件）。

## 写作规则 / Writing rules

1. 不写“未来会做”，只写“当前如何”+“边界在哪”；计划放 ROADMAP。
2. 每个数字带口径：哪次测试、多久、什么环境。
3. 每个截图配场景说明，图片由 E2E 自动生成。
4. 文档之间的链接与截图在发布前用脚本检查。
5. 内部资料、本机绝对路径、真实个人信息不进仓库。
