# 系统总控（超级总调度）（v1.3）

## 1. 它能做什么

系统总控（supervisor）是第 1 层、最高权限的智能体，接收你亲自下达的系统级命令：

- 查看 / 启动 / 停止 / 重启 / **删除（受管范围内，先备份到回收站）** 受管程序；
- 启用 / 禁用 / **删除（备份）** 受管插件；
- 查看全部日志与审计（`/system` 系统状态、审计记录）；
- **切换任意智能体的模型**、**修改任意角色系统提示词**（写配置审计，密钥只存引用）；
- **把项目委派给项目总调度**（生成 conductor 子会话，返回 session_id）；
- 危险动作**必须二次确认**：页面展示风险 + 回收站备份路径 + 确认令牌，输入「确认删除」并携带令牌才执行；令牌一次性、120s 过期。

## 2. 受管范围与安全边界

- 只允许操作 `system_policy.managed_apps` 白名单内的程序 + `plugins_dir` 的直接子目录插件；
- 清单外、路径穿越、系统关键路径 → 一律拒绝（`OutOfScopeError`）；
- 删除前备份到 `.steward/system/recycle/<时间戳>/`，审计记录 `backup_path`，可 `restoreBackup` 恢复；
- 停止进程只按 executor 记录的 pid（不按进程名批量杀）；
- 所有动作追加审计 JSONL（脱敏，不含密钥）。

## 3. 控制台 / 系统页

打开 `http://127.0.0.1:4180/system`：

- 两层结构可视化（L1 supervisor → L2 conductor → L3 专项智能体），可点进每个角色记录；
- 系统状态卡：受管程序、插件启用状态、各 agent 当前模型/Token、全部日志入口；
- 与 supervisor 对话（自然语言快捷命令：列程序/插件、启动 demo-app、启/禁插件、切换模型、委派项目）；
- 危险操作确认弹窗（风险 / 备份路径 / 确认令牌 / 必须输入「确认删除」）；
- 易支付配置入口。

## 4. CLI

```bash
node dist/apps/cli/src/index.js system --action info --json       # 系统信息/受管应用/插件
node dist/apps/cli/src/index.js system --action plan --op app.start --target demo-app --json
node dist/apps/cli/src/index.js system --action exec --op app.start --target demo-app --json
node dist/apps/cli/src/index.js system --action exec --op plugin.remove --target demo-plugin --json
#   危险动作会提示需要 --yes（二次确认；删除先备份到回收站）
node dist/apps/cli/src/index.js system --action audit --limit 20
node dist/apps/cli/src/index.js supervisor --goal "检查系统状态、禁用 demo-plugin，然后委派一个项目" --json
```

## 5. 实测证据（v1.3）

- 真实启动受管程序（pid + 心跳）→ 读取日志 → 停止；
- 真实禁用插件（写 `plugin.json`）；
- 危险动作：`removePlugin` 高风险 → 会话暂停等待确认 → 批准后备份到 `.steward/system/recycle/...` 并删除，审计含 `backup_path`；可从备份恢复。
- 证据：`docs/test-evidence/evidence-v13-real/`。
