# @daizhang/steward-system · 系统总控动作层（v1.3-A）

> 状态：**v1.3-A 已实现**（27/27 单元测试通过，含 Windows 真实启动/停止/重启/删除演示）。
> 零第三方依赖；真实系统动作只在 **Windows** 上执行（默认 `WindowsProcessOps`，可注入替身）。
> 一句话：给「超级总调度」一套**受管、可审计、危险动作必须二次确认**的系统动作能力——
> **不是**无边界的管理员权限。

## 1. 职责与设计

`SystemController` 接收用户/总调度 AI 下发的 `ActionRequest`，分三步：

1. `plan()`：风险评估（readonly / low / high / destructive）+ 受管范围校验 +
   （高风险时）下发一次性确认令牌 + 人类可读摘要；
2. 用户/审批 UI 确认（高风险动作必须）；
3. `execute()`：在**受管范围**内真实执行 → 追加审计 JSONL → 返回 `ActionReceipt`
   （删除类动作带 `backup_path`）。

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 数据契约：ManagedApp / ManagedPlugin / ActionRequest / ActionPlan / ActionReceipt / AuditEntry / ProcessOps … |
| `src/controller.ts` | `SystemController`：plan/execute、风险评估、令牌、插件 manifest、审计 |
| `src/process-ops.ts` | `WindowsProcessOps`：child_process 启动 + PowerShell（Get-Process/Stop-Process）真实停止；`runPowerShell()` |
| `src/scope.ts` | 受管范围/路径安全：id 校验、`..` 穿越拒绝、系统关键路径判定、删除目标校验 |
| `src/recycle.ts` | 回收站备份/恢复：`backupToRecycle()` / `restoreBackup()` |
| `src/audit.ts` | JSONL 追加式审计 + 脱敏（API Key / Bearer / password=…） |
| `src/errors.ts` | `OutOfScopeError` / `ConfirmationRequiredError` / `UnsupportedPlatformError` / `SystemActionError` |

## 2. 受管范围（唯一允许操作的对象）

```ts
const controller = new SystemController({
  root: "H:\\daizhang-build\\workspace",       // 受管根目录：app.path 必须严格位于其中
  state_dir: "H:\\daizhang-build\\workspace\\.steward\\system", // 审计/回收站/状态
  plugins_dir: "H:\\daizhang-build\\workspace\\plugins",        // 受管插件根目录
  apps: MANAGED_APPS,                           // 受管应用清单（唯一允许启停删的应用）
});
```

- **应用**：只能在 `apps` 清单内按 `app.id` 操作；`allow_start/allow_stop/allow_remove`
  三个开关逐动作授权。清单外 app id → `plan().allowed=false`，`execute()` 抛 `OutOfScopeError`。
- **插件**：只能操作 `<plugins_dir>/<id>` 的**直接子目录**（`plugin.json` 发现）；
  插件 id 必须是安全 id（字母数字开头、字母数字/`._-`、≤64），`..`、绝对路径、`a/b` 一律拒绝。
- **文件**：`file.list` 只能列受管应用目录（`path`/`cwd`）或受管插件目录，`params.path`
  只接受相对子路径；`..`、绝对路径、盘符路径、通配符一律拒绝。
- **删除**：`app.remove` / `plugin.remove` 的目标必须**严格位于受管 root 内**、
  不能是 `root` 本身、不能位于 `state_dir`（审计/回收站）内、不能是 `plugins_dir` 根本身、
  不能是系统关键路径（`C:\Windows`、`Program Files`、`ProgramData`、盘符根、POSIX 系统目录…）。
- 环境变量与状态文件都在 `root` 与 `state_dir` 内；本层**不访问网络、不读取凭据**。

## 3. 快速开始

```ts
import { SystemController } from "../../packages/steward-system/src/index.js";

const controller = new SystemController({
  root,
  state_dir: join(root, ".steward", "system"),
  plugins_dir: join(root, "plugins"),
  apps: [
    {
      id: "demo-app",
      name: "演示程序",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: join(root, "programs", "demo-app"),
      path: join(root, "programs", "demo-app"), // app.remove 的备份/删除目标
      kind: "program",
      allow_start: true,
      allow_stop: true,
      allow_remove: true,
    },
  ],
});

// 1) 低风险动作：直接执行
const started = await controller.execute({ id: "req-1", action: "app.start", target: "demo-app" });
console.log(started.ok, started.output); // true { app_id: "demo-app", pid: 12345, ... }

// 2) 重启（high）：先 plan 拿一次性令牌 → 用户确认 → execute
const plan = controller.plan({ id: "req-2", action: "app.restart", target: "demo-app", reason: "按用户要求重开" });
//   plan.risk === "high"; plan.requires_confirmation === true; plan.confirmation_token = "…"
const receipt = await controller.execute({
  id: "req-2",
  action: "app.restart",
  target: "demo-app",
  confirmation_token: plan.confirmation_token,
});
console.log(receipt.ok, receipt.output);

// 3) 删除（destructive）：二次确认 + 先备份
const removePlan = controller.plan({ id: "req-3", action: "app.remove", target: "demo-app" });
const removed = await controller.execute({
  id: "req-3",
  action: "app.remove",
  target: "demo-app",
  confirmation_token: removePlan.confirmation_token,
});
console.log(removed.backup_path); // <state_dir>/recycle/<stamp>/app-demo-app/demo-app

// 4) 审计（追加只读）
console.log(controller.auditTrail(10));

// 5) 恢复（可选）
await controller.restoreBackup(removed.backup_path, join(root, "restored-app"));
```

其它动作：`app.list` / `app.stop` / `plugin.list` / `plugin.enable` / `plugin.disable` /
`plugin.remove` / `file.list` / `system.info`。

## 4. 风险分级与二次确认

| 动作 | 风险 | 需要二次确认 | 说明 |
|---|---|---|---|
| `app.list` / `plugin.list` / `file.list` / `system.info` | `readonly` | 否 | 只读观察 |
| `app.start` / `app.stop` | `low` | 否 | 受管应用启停 |
| `plugin.enable` / `plugin.disable` | `low` | 否 | 写插件 `plugin.json` 的 `enabled` |
| `app.restart` | `high` | **是** | 会中断程序；stop → start |
| `app.remove` / `plugin.remove` | `destructive` | **是** | 先备份到回收站 → 删除 |

**令牌规则**（`plan()` 下发，`execute()` 校验）：

- **一次性**：用过即失效（重复使用 → `ConfirmationRequiredError`）；
- **TTL 120 秒**：过期拒绝（过期后 `listPendingConfirmations()` 不再展示）；
- **绑定 request_id + action + target**：拿 A 命令的令牌执行 B 命令/别的目标一律拒绝；
- 缺少令牌 → `ConfirmationRequiredError`（提示先 `plan()` 并由用户确认）；
- 每次拒绝/缺失都会写入审计（`executed:false`）。

UI 对接：`controller.lastConfirmation()` 取最近一次待确认请求（token / 风险 / 摘要 / `expires_at`），
`controller.listPendingConfirmations()` 取全部待确认项。

## 5. 真实执行（Windows）与平台限制

- **默认执行器 `WindowsProcessOps`**：
  - `start`：`child_process.spawn(command, args, { cwd, windowsHide })` 真实启动并返回 pid；
  - `stop`：只停止**本执行器记录过的 pid**（`Stop-Process -Id <pid> -Force`，轮询确认退出）；
    **绝不按进程名批量杀**，避免误杀同名系统进程；
  - `list`：PowerShell `Get-Process | Select Id,ProcessName | ConvertTo-Json` 真实枚举；
  - `remove`：`assertRemovableTarget()` 二次范围校验 → 备份到 `<state_dir>/recycle/…` → 删除。
- **可注入 `processOps`**（`SystemControllerOptions.processOps`）：测试 mock、容器/其它平台替身，
  只需实现 `ProcessOps { start, stop, list, remove }`。
- **非 Windows**：默认执行器在构造/使用时抛 `UnsupportedPlatformError`（含平台名与替代方案提示）；
  只读动作（list/info/plan）仍可用。Linux/macOS 可注入基于 `systemd`/`launchd`/`kill` 的实现。

## 6. 备份与恢复

```
<state_dir>/recycle/<YYYYMMDD-HHMMSS-mmm>/<label>/<被备份项原名>
```

- `app.remove` → `label = app-<appId>`；`plugin.remove` → `label = plugin-<pluginId>`；
- 备份用复制（原件删除前保留一份），目录递归复制、文件复制；
- 回执与审计都记录 `backup_path`；
- `controller.restoreBackup(backupPath, destination, { force? })` 只允许恢复**本控制器回收站内**的
  备份（越界抛 `SystemActionError`），目标已存在时默认拒绝覆盖（`force:true` 才覆盖）。

## 7. 审计

- 文件：`<state_dir>/system-audit.jsonl`（**只追加**，无删除/改写 API）；
- 每次 `execute()` 都写一条：成功、执行失败、策略拒绝、确认缺失**全部留痕**；
- 字段：`audit_id / at / request_id / action / target / risk / ok / executed / summary /
  backup_path? / requested_by? / reason? / platform`；
- **脱敏**：`sk-*` API Key、`Bearer …`、`password=`/`token=`/`api_key=` 等值、
  换行/控制字符；`summary` ≤500 字符、`reason` ≤200 字符；不记录 `params` 原文，无密钥明文；
- `auditTrail(limit?)` 只读最近 N 条（跳过损坏行，不因单行损坏整体失败）。

## 8. 安全边界（必须遵守）

1. **只操作受管范围**：清单外应用、插件目录外路径、路径穿越、系统关键路径 → 默认拒绝；
2. **危险动作必须人工二次确认**：`high` / `destructive` 无有效令牌一律拒绝，不做「自动确认」；
3. **删除前必须备份**：没有备份路径的删除路径不允许（`app.remove` 需要 `path`/`cwd`）；
4. **不按进程名批量杀进程**：只停本执行器记录过的 pid；
5. **不接触凭据/密钥**：不读环境密钥、不读凭据文件、不联网；
6. **未知 ≠ 成功**：越界/确认缺失抛错；执行失败返回 `ok:false` 回执并写审计；
7. 本层不是「系统管理员权限」：不做服务/注册表/驱动/系统目录/用户账户操作，也不支持通配符批量操作。

## 9. 测试

```bash
npm run build
node --test tests/unit/system.test.mjs
```

**实测（2026-10-26，Windows 10 Pro 22H2 build 19045，Node v24）**：

```
ℹ tests 27
ℹ pass 27
ℹ fail 0
ℹ duration_ms 834.67
```

覆盖：listApps/listPlugins/systemInfo；四档风险分级；清单外 app/插件/路径穿越/系统关键路径
拒绝；high 动作无 token 拒绝；token 一次性/过期/错绑拒绝；**真实启动 node 短进程并真实停止、
真实重启（旧 pid 退出/新 pid 存活）**；注入 mock 验证 restart 调用顺序；plugin.enable/disable
真实写 manifest；plugin.remove / app.remove 备份+删除+回执 `backup_path`；restoreBackup 恢复；
审计 JSONL 追加/跨实例持久化/拒绝留痕/不含密钥明文；ProcessOps 注入。

## 10. 给 supervisor / CLI 的对接片段（Lead 集成用）

```ts
// 1) 初始化（每个 run / 每个受管工作区一个控制器实例）
import { SystemController } from "../../packages/steward-system/src/index.js";
const systemctl = new SystemController({
  root: runRoot,
  state_dir: join(runRoot, ".steward", "system"),
  plugins_dir: join(runRoot, "plugins"),
  apps: MANAGED_APPS, // 从配置中心/管理员配置读取的受管应用清单
});

// 2) 总调度 AI 产出步骤 → 先 plan（只读、无副作用）
const plan = systemctl.plan({
  id: `req-${Date.now()}`,
  action: "app.restart",
  target: "demo-app",
  reason: goalText,
  requested_by: "conductor",
});
if (!plan.allowed) return { ok: false, summary: plan.summary }; // 越界：直接拒绝并上报
if (plan.requires_confirmation) {
  // 3) 生成审批卡（复用 steward-core ApprovalCard 语义）
  return {
    ok: false,
    pending_approval: true,
    card: {
      action: plan.action,
      target: plan.details,
      risk_level: plan.risk,
      evidence: [],
      options: ["approve", "revise", "reject"],
      expires_at: systemctl.lastConfirmation()?.expires_at,
      confirmation_token: plan.confirmation_token, // 由 UI 持有，用户点「确认」后回传
      summary: plan.summary,
    },
  };
}
// 4) 用户确认后执行（令牌一次性 + 120s 过期 + 绑定 request_id/action/target）
const receipt = await systemctl.execute({ ...request, confirmation_token: approvedToken });
// 5) 审计：把 receipt.audit_id / backup_path 写进 events.jsonl 或报告
```

CLI 建议（由 Lead 实现，本包不修改 `apps/cli`）：

```bash
steward system list                              # app.list + plugin.list + system.info（readonly）
steward system start  --app <id>                 # low：直接执行
steward system stop   --app <id>                 # low：直接执行
steward system restart --app <id>                # high：交互式二次确认（或 --confirm-token）
steward system remove --app <id>                 # destructive：强制二次确认 + 打印 backup_path
steward system audit --limit 50                  # 读审计 JSONL
```

注册为工具时建议 `ToolSpec.risk` 映射：readonly→`low`、low→`low`、high→`medium`、
destructive→`high`，并让 `requiresApproval = plan.requires_confirmation`；证据字段写回执与审计 id。

## 11. 已知限制

- **Windows 专属真实执行**：Linux/macOS 需注入自定义 `ProcessOps`（接口简单，未内置实现）；
- **pid 记录为进程内状态**：控制器/进程重启后不记得之前启动的 pid（不会按名字猜测停止；
  需要跨进程恢复时请自行持久化 pid 并在 App 配置中恢复）；
- **stop 只停记录 pid**：外部启动的同名进程不会被停止（安全优先）；
- **插件 manifest 只写 `plugin.json`**：不改插件代码/依赖；`enabled` 是否被插件宿主真正尊重由宿主负责；
- **恢复不覆盖已有目标**（除非 `force:true`），避免误覆盖；
- **审计为单文件追加**：并发写同一文件由操作系统追加语义保证（单进程场景；多进程请串行化）；
- **无 UI/审批队列**：本层只提供 plan/receipt/audit 原语，审批交互由 console/CLI 实现（见第 10 节）。
