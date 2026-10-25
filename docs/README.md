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
| [zh-CN/delivery-checklist.md](zh-CN/delivery-checklist.md) · [en/delivery-checklist.md](en/delivery-checklist.md) | 验收 × 证据映射（A1–A12 / B1–B8 / U1–U8；**阶段一 A1–A12 全部通过；阶段二 P1 B1/B2/B5/B6/B7 通过、P2 短跑通过/长跑进行中、P3 B8 通过**） |
| [zh-CN/enterprise.md](zh-CN/enterprise.md) · [en/enterprise.md](en/enterprise.md) | **P3 企业版**：企业增量总览、**30 条边界双模式标注表（完整 30 行）**、B8 双模式一致性、双人复核/组织审批链/用印（AI 不代签）/发票与申报草稿、安全边界与已知限制 |
| [test-evidence/README.md](test-evidence/README.md) | 测试证据归档规范；`test-result-*`（离线证据包）、`m1-acceptance-*` + `evidence-m1-*`（M1 本机有头验收）、`m2-acceptance-*` + `evidence-m2-*`（M2 真实桌面 + 安全验收）、`m3-acceptance-*` + `evidence-m3-*`（M3 Scout 验收）、`m4-acceptance-*` + `evidence-m4-*`（M4 发布就绪）、`p1-acceptance-*` + `evidence-p1-*`（P1 个人版 MVP）、`p2-acceptance-*` + `evidence-p2-*`（P2 故障演练短跑）、`p3-acceptance-*` + `evidence-p3-*`（P3 企业版）与发布验证记录 |
| [RELEASE_NOTES_v0.5.0.md](RELEASE_NOTES_v0.5.0.md) · [RELEASE_NOTES_v0.6.0.md](RELEASE_NOTES_v0.6.0.md) | v0.5.0 阶段一 / v0.6.0 P1 发布说明（中英双语） |
| [demo-script.zh-CN.md](demo-script.zh-CN.md) · [demo-script.md](demo-script.md) | 3 分钟真实命令演示脚本（分镜式，中英对照） |
| [good-first-issues.md](good-first-issues.md) | 5 个 good-first-issue 文案（中英双语，均可离线验证） |
| [../runs/](../runs/) | 每次运行的产物本体（gitignored；证据在此，不在文档目录） |
| [images/README.md](images/README.md) | 截图规范（E2E 自动生成、中性路径） |

> 当前状态（2026-10-25）：**阶段二 P3 企业版 MVP 完成（v0.8.0 待发版）；P2 故障演练短跑通过、长跑
> 进行中** — **A1–A12 全部通过**，阶段二 **B1/B2/B5/B6/B7/B8 通过**；**151/151** 测试、
> **19 命令 + 0 占位**。M0 证据见
> [test-evidence/test-result-2026-10-25_09-52-08.md](test-evidence/test-result-2026-10-25_09-52-08.md)；
> M1 证据见 [test-evidence/m1-acceptance-2026-10-25_09-52-12.md](test-evidence/m1-acceptance-2026-10-25_09-52-12.md)
> 与 [test-evidence/evidence-m1-2026-10-25_09-52-12/](test-evidence/evidence-m1-2026-10-25_09-52-12/)（A2/A4/A5 共 45 文件）；
> M2 证据见 [test-evidence/m2-acceptance-2026-10-25_10-50-51.md](test-evidence/m2-acceptance-2026-10-25_10-50-51.md)
> 与 [test-evidence/evidence-m2-2026-10-25_10-50-51/](test-evidence/evidence-m2-2026-10-25_10-50-51/)（A3/A8/A9 共 34 文件）；
> M3 证据见 [test-evidence/m3-acceptance-2026-10-25_12-04-47.md](test-evidence/m3-acceptance-2026-10-25_12-04-47.md)
> 与 [test-evidence/evidence-m3-2026-10-25_12-04-47/](test-evidence/evidence-m3-2026-10-25_12-04-47/)（A7 共 15 文件）；
> M4 证据见 [test-evidence/m4-acceptance-2026-10-25_13-43-07.md](test-evidence/m4-acceptance-2026-10-25_13-43-07.md)
> 与 [test-evidence/evidence-m4-2026-10-25_13-43-07/](test-evidence/evidence-m4-2026-10-25_13-43-07/)（A10/A11 共 7 文件）；
> P1 证据见 [test-evidence/p1-acceptance-2026-10-25_14-18-54.md](test-evidence/p1-acceptance-2026-10-25_14-18-54.md)
> 与 [test-evidence/evidence-p1-2026-10-25_14-18-54/](test-evidence/evidence-p1-2026-10-25_14-18-54/)（B1/B2/B5/B6/B7 共 39 文件）；
> P2 短跑证据见 [test-evidence/p2-acceptance-2026-10-25_15-02-52.md](test-evidence/p2-acceptance-2026-10-25_15-02-52.md)
> 与 [test-evidence/evidence-p2-2026-10-25_15-02-52/](test-evidence/evidence-p2-2026-10-25_15-02-52/)（B3/B4 短跑共 10 文件；
> 长跑证据待 Lead 入库）；
> P3 证据见 [test-evidence/p3-acceptance-2026-10-25_15-23-46.md](test-evidence/p3-acceptance-2026-10-25_15-23-46.md)
> 与 [test-evidence/evidence-p3-2026-10-25_15-23-46/](test-evidence/evidence-p3-2026-10-25_15-23-46/)（B8 + 30 条边界共 18 文件）。

## 写作规则 / Writing rules

1. 不写“未来会做”，只写“当前如何”+“边界在哪”；计划放 ROADMAP。
2. 每个数字带口径：哪次测试、多久、什么环境。
3. 每个截图配场景说明，图片由 E2E 自动生成。
4. 文档之间的链接与截图在发布前用脚本检查。
5. 内部资料、本机绝对路径、真实个人信息不进仓库。
