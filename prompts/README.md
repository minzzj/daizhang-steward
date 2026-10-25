# 运行时提示词 / Runtime Prompts

> 状态：**待 M0 实现**。目录结构与规则见 [`docs/zh-CN/runtime-prompts.md`](../docs/zh-CN/runtime-prompts.md) /
> [`docs/en/runtime-prompts.md`](../docs/en/runtime-prompts.md)。

M0 交付内容：

```text
prompts/
├── manifest.json      # 版本 / 日期 / sha256 / 适用角色
├── conductor.md       # 总调度（方向、拆单、预算、验收）
├── operator.md        # 操作型分支（浏览器/桌面、CodeTask、留证）
├── scout.md           # 客户分支（ICP、来源、评分、草稿）
├── reviewer.md        # 只读复核（证据、越界、失败归宿）
└── CHANGELOG.md       # 提示词版本记录
```

硬规则：

1. 提示词**版本化**（`operator@1.0.0`），由 `PromptManager` 加载；`BranchSpec.prompt_ref` 引用。
2. 业务代码里**禁止**出现长提示词。
3. 每个提示词有测试：安全条款、禁止项、输出格式、无密钥/本机路径。
4. 修改提示词必须更新版本与 manifest sha256，并跑通该角色契约测试与一条端到端用例。
