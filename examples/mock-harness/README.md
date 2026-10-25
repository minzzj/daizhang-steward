# MockHarness fixtures

`steward demo` 使用 `@daizhang/steward-harness` 里的 **MockHarness** 生成一个示例补丁，
并把补丁写到 `runs/<run-id>/patch.diff`，同时写出 `test.log`。它不需要任何付费 API、
不需要网络，因此 CI 与离线演示都能跑通（对应文档 1 验收 A1/A4 的骨架部分）。

- `fixture.txt`：示例补丁的目标文件。
- 真实补丁应用与真实测试将在 M1 使用 `DshHeadlessHarness` + 隔离 worktree 完成。
- MockHarness 的失败模式（`simulateFailure`）用于验证「连续失败两轮后升级人类」，不会无限重试。

**注意**：MockHarness 的补丁只用于演示回路形状，不代表真实修复；真实浏览器验收仍是硬要求。
