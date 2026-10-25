# MockHarness fixtures

`steward demo` 使用 `@daizhang/steward-harness` 里的 **MockHarness** 生成示例补丁，
并把补丁写到 `runs/<run-id>/patch.diff`，同时写出 `test.log`。它不需要任何付费 API、
不需要网络，因此 CI 与离线演示都能跑通。

`steward code-loop` 使用这里存放的**真实 unified diff**，走完整编码回路：
CodeTask → Harness 返回补丁 → 在隔离 `git worktree` 应用 → 运行**真实浏览器**验收用例。

| 文件 | 用途 |
|---|---|
| `fixture.txt` | M0 空回路示例补丁的目标文件 |
| `fix-login-timeout.patch` | M1 真实修复补丁：恢复 demo-web 登录超时后的错误提示与按钮状态（`loginPending` / `setLoginLoading` / `showLoginError`） |
| `broken-login-timeout.patch` | 失败注入补丁：能应用但不改变行为，用于验证「连续两轮失败 → 停止升级人类」（A5） |

相关命令：

```bash
node dist/apps/cli/src/index.js demo        # M0 空回路（MockHarness）
node dist/apps/cli/src/index.js code-loop   # M1 编码回路：真实补丁 + 真实浏览器验收
node dist/apps/cli/src/index.js code-loop --fail  # A5：坏补丁两轮失败 → 升级
npm run acceptance                          # 本机有头真实浏览器跑 A2/A4/A5 并生成证据
```

**注意**：MockHarness 本身只负责“返回补丁 + 说明”，不代表真实模型能力；补丁的应用、
真实浏览器验收与两轮升级由 `steward code-loop`（`runCodeLoop`）负责，且全程留证。
