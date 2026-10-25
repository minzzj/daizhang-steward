# Docs / 文档索引

> 每个文档提供中英两份：中文在 `zh-CN/`，英文在 `en/`。两者内容保持一致；如有差异以中文为准并尽快修正英文。
> Every doc ships in both Chinese (`zh-CN/`) and English (`en/`). Keep them in sync; if they differ,
> the Chinese version prevails until the English one is corrected.

| 文档 | 内容 |
|---|---|
| [zh-CN/architecture.md](zh-CN/architecture.md) · [en/architecture.md](en/architecture.md) | 总体架构、分层、运行形态、扩展点 |
| [zh-CN/contracts.md](zh-CN/contracts.md) · [en/contracts.md](en/contracts.md) | 核心契约：BranchSpec / CodeTask / CodeResult / Lead / ApprovalCard / TakeoverPack / Event |
| [zh-CN/threat-model.md](zh-CN/threat-model.md) · [en/threat-model.md](en/threat-model.md) | 威胁模型与默认拒绝清单 |
| [zh-CN/adapters.md](zh-CN/adapters.md) · [en/adapters.md](en/adapters.md) | 浏览器/桌面/模型/通知/IoT 适配器契约 |
| [zh-CN/runtime-prompts.md](zh-CN/runtime-prompts.md) · [en/runtime-prompts.md](en/runtime-prompts.md) | 运行时提示词的版本、测试与替换规则 |
| [zh-CN/delivery-checklist.md](zh-CN/delivery-checklist.md) · [en/delivery-checklist.md](en/delivery-checklist.md) | 验收 × 证据映射（A1–A12 / B1–B8 / U1–U8） |
| [test-evidence/README.md](test-evidence/README.md) | 测试证据归档规范 |
| [images/README.md](images/README.md) | 截图规范（E2E 自动生成、中性路径） |

## 写作规则 / Writing rules

1. 不写“未来会做”，只写“当前如何”+“边界在哪”；计划放 ROADMAP。
2. 每个数字带口径：哪次测试、多久、什么环境。
3. 每个截图配场景说明，图片由 E2E 自动生成。
4. 文档之间的链接与截图在发布前用脚本检查。
5. 内部资料、本机绝对路径、真实个人信息不进仓库。
