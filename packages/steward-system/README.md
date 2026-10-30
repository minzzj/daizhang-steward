# @daizhang/steward-system · 系统总控动作层（v1.3-A 基线 + v1.4-D 扩展）

> 状态：**v1.4-D 已实现**（46/46 单元测试通过：v1.3-A 基线 27 条 + v1.4-D 扩展 19 条，
> 含 Windows 真实启动/停止/重启/删除、受管工作区真实文件操作、真实进程快照、受管安装/卸载）。
> 零第三方依赖；真实系统动作只在 **Windows** 上执行（默认 `WindowsProcessOps`，可注入替身）。
> 一句话：给「超级总调度」一套**受管、可审计、危险动作必须二次确认**的系统动作能力——
> 支持应用/插件、受管文件/目录、打开应用、服务状态、定时任务、受管安装/卸载；
> **不是**无边界的管理员权限。

## 1. 职责与设计

`SystemController` 接收用户/总调度 AI 下发的 `ActionRequest`，分三步：

1. `plan()`：风险评估（readonly / low / medium / high / destructive）+ 受管范围校验 +
   （需要确认时）下发一次性确认令牌 + 人类可读摘要；
2. 用户/审批 UI 确认（medium 默认需要，`high`/`destructive` 必须；`auto_approve_medium` 可放开 medium）；
3. `execute()`：在**受管范围**内真实执行 → 追加审计 JSONL → 返回 `ActionReceipt`
   （删除类/覆盖写动作带 `backup_path`）。

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 数据契约：ManagedApp / ManagedPlugin / ActionRequest / ActionPlan / ActionReceipt / AuditEntry / ScheduledTaskRecord / InstalledProgramRecord / ProcessOps … |
| `src/controller.ts` | `SystemController`：plan/execute、风险评估、令牌、插件 manifest、受管工作区文件、app.open、服务状态、定时任务、安装/卸载、审计 |
| `src/process-ops.ts` | `WindowsProcessOps`：child_process 启动 + PowerShell（Get-Process/Stop-Process）真实停止；`runPowerShell()` |
| `src/scope.ts` | 受管范围/路径安全：id 校验、`..` 穿越拒绝、系统关键路径判定、删除目标校验、**受管工作区路径/软链接逃逸校验** |
| `src/recycle.ts` | 回收站备份/恢复：`backupToRecycle()` / `restoreBackup()` |
| `src/audit.ts` | JSONL 追加式审计 + 脱敏（API Key / Bearer / password=…） |
| `src/errors.ts` | `OutOfScopeError` / `ConfirmationRequiredError` / `UnsupportedPlatformError` / `SystemActionError` |

## 2. 受管范围（唯一允许操作的对象）

```ts
const controller = new SystemController({
  root: "H:\\daizhang-build\\workspace",       // 受管根目录：app.path / 安装目标必须严格位于其中
  state_dir: "H:\\daizhang-build\\workspace\\.steward\\system", // 审计/回收站/scheduler.json/installed.json
  plugins_dir: "H:\\daizhang-build\\workspace\\plugins",        // 受管插件根目录
  apps: MANAGED_APPS,                           // 受管应用清单（唯一允许启停删/打开的应用）
  // ---- v1.4-D 可选扩展 ----
  workspace_dir: "H:\\daizhang-build\\workspace\\workspace",    // 受管工作区（文件动作只允许在其中；默认 <root>/workspace）
  install_sources_dir: "H:\\...\\install-sources",              // 受管安装源（program.install 只允许其中目录）
  allowed_urls: ["example.com", "https://intranet.example.com"], // app.open URL 白名单（空 = 禁止打开 URL）
  auto_approve_medium: false,                   // true = auto 模式下 medium 动作免二次确认（默认 false）
});
```

- **应用**：只能在 `apps` 清单内按 `app.id` 操作；`allow_start/allow_stop/allow_remove`
  三个开关逐动作授权。清单外 app id → `plan().allowed=false`，`execute()` 抛 `OutOfScopeError`。
- **插件**：只能操作 `<plugins_dir>/<id>` 的**直接子目录**（`plugin.json` 发现）；
  插件 id 必须是安全 id（字母数字开头、字母数字/`._-`、≤64），`..`、绝对路径、`a/b` 一律拒绝。
- **文件**：`file.list` 可列受管应用目录（`path`/`cwd`）或受管插件目录；v1.4-D 的
  `file.read/write/mkdir/copy/move/remove` 只允许在**受管工作区 `workspace_dir`** 内，
  `params.path/source/destination` 只接受相对子路径；`..`、绝对路径、盘符路径、通配符、
  工作区内软链接/联接点逃逸一律拒绝；`file.write` 内容上限 256KB、`file.read` 上限 1MB。
- **打开应用**：`app.open` 只允许受管清单内 app id（用其 command/args 真实启动，不经 shell），
  或 `allowed_urls` 白名单内的 http/https URL（注入 `urlOpener` 或 Windows explorer.exe，防命令注入）。
- **定时任务**：`task.*` 只读写 `<state_dir>/scheduler.json`（**不调用 Windows 任务计划**）；
  interval 60–86400 秒或 5 段 cron，任务名唯一。
- **安装/卸载**：`program.install` 只允许 `<install_sources_dir>/<source_id>`（含 `app.json`），
  复制到 `<root>/programs/<id>` 并写入 `<state_dir>/installed.json`；
  `program.uninstall` 只能卸载 installed.json 内、且位于 `<root>/programs` 内的程序。
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

// 6) v1.4-D：受管工作区文件（medium 默认需确认；下面统一用 helper 演示 plan→token→execute）
const confirmed = async (request) => {
  const p = controller.plan(request);
  if (!p.allowed) throw new Error(p.summary);
  return controller.execute(p.requires_confirmation ? { ...request, confirmation_token: p.confirmation_token } : request);
};
const written = await confirmed({
  id: "req-file-1",
  action: "file.write",
  params: { path: "reports/daily.md", content: "# 今日简报\n…" },
});
// 只读：file.read / file.list（target: "workspace"）/ service.status / task.list
const read = await controller.execute({ id: "req-file-2", action: "file.read", params: { path: "reports/daily.md" } });

// 7) v1.4-D：打开应用 / 打开白名单 URL（medium）
await confirmed({ id: "req-open-1", action: "app.open", target: "demo-app" });
await confirmed({ id: "req-open-2", action: "app.open", params: { target_url: "https://example.com/dashboard" } });

// 8) v1.4-D：定时任务（只写 scheduler.json，由上层调度器执行）
await confirmed({
  id: "req-task-1",
  action: "task.create",
  params: { name: "每日简报", interval_seconds: 3600, goal: "汇总今日进展并发给用户" },
});
console.log(controller.listTasks());

// 9) v1.4-D：受管安装 / 卸载（install 复制到 <root>/programs/<id>；uninstall destructive 备份+确认）
await confirmed({ id: "req-install-1", action: "program.install", params: { source_id: "sample-app" } });
const uninstalled = await confirmed({ id: "req-uninstall-1", action: "program.uninstall", target: "sample-app" });
console.log(uninstalled.backup_path);
```

其它动作：`app.list` / `app.stop` / `plugin.list` / `plugin.enable` / `plugin.disable` /
`plugin.remove` / `file.list`（应用/插件/工作区）/ `file.read` / `file.write` / `file.mkdir` /
`file.copy` / `file.move` / `file.remove` / `app.open` / `service.status` / `task.list` /
`task.create` / `task.remove` / `program.install` / `program.uninstall` / `system.info`。

## 4. 风险分级与二次确认

| 动作 | 风险 | 需要二次确认 | 说明 |
|---|---|---|---|
| `app.list` / `plugin.list` / `file.list` / `file.read` / `service.status` / `task.list` / `system.info` | `readonly` | 否 | 只读观察 |
| `app.start` / `app.stop` | `low` | 否 | 受管应用启停 |
| `plugin.enable` / `plugin.disable` | `low` | 否 | 写插件 `plugin.json` 的 `enabled` |
| `app.open` / `file.write` / `file.mkdir` / `file.copy` / `file.move` / `task.create` / `task.remove` / `program.install` | `medium` | **默认是**（`auto_approve_medium:true` 时否） | 有副作用但可恢复：写/复制/移动文件、打开应用或 URL、改 scheduler.json、安装程序 |
| `app.restart` | `high` | **是** | 会中断程序；stop → start（始终需确认） |
| `app.remove` / `plugin.remove` / `file.remove` / `program.uninstall` | `destructive` | **是** | 先备份到回收站 → 删除（始终需确认） |

> v1.4-D 规则：`medium` **默认需要二次确认**；配置 `auto_approve_medium: true` 后 medium 动作可免令牌
> 直接执行（供 auto/无人值守模式使用），但 `high`/`destructive` **永远**需要令牌，不受 auto 影响。

**令牌规则**（`plan()` 下发，`execute()` 校验）：

- **一次性**：用过即失效（重复使用 → `ConfirmationRequiredError`）；
- **TTL 120 秒**：过期拒绝（过期后 `listPendingConfirmations()` 不再展示）；
- **绑定 request_id + action + target**：拿 A 命令的令牌执行 B 命令/别的目标一律拒绝；
- 缺少令牌 → `ConfirmationRequiredError`（提示先 `plan()` 并由用户确认）；
- 每次拒绝/缺失都会写入审计（`executed:false`）。

UI 对接：`controller.lastConfirmation()` 取最近一次待确认请求（token / 风险 / 摘要 / `expires_at`），
`controller.listPendingConfirmations()` 取全部待确认项。

## 4.1 v1.4-D 受管工作区文件/目录（file.list / read / write / mkdir / copy / move / remove）

- 作用域：默认 `<root>/workspace`（`workspace_dir` 可覆盖）；**所有路径相对工作区**，
  经 `resolveWorkspaceEntry()` 校验：拒绝 `..`、绝对路径、盘符路径、通配符、控制字符；
  拒绝工作区内**软链接/联接点**（防逃逸）；删除目标还要求 realpath 复核在工作区内、
  不是工作区根、不是系统关键路径。
- 动作：

| 动作 | 风险 | 参数 | 行为 |
|---|---|---|---|
| `file.list`（`target: "workspace"`） | readonly | `path?`（相对子目录，默认根） | 列出条目 `{name,type,size,modified_at}`；工作区不存在返回空列表 |
| `file.read` | readonly | `path` | 返回 `{path,size,content,sha256}`；≤1MB、必须是普通文件 |
| `file.write` | medium | `path, content` | UTF-8 写入（自动建父目录、原子性由调用方保证）；**内容 ≤256KB**；回执 `{path,size,sha256,overwritten}` |
| `file.mkdir` | medium | `path` | 递归创建目录；回执 `{path,created}` |
| `file.copy` | medium | `source, destination, overwrite?` | 文件/目录递归复制；目标存在必须 `overwrite:true`（先备份到回收站） |
| `file.move` | medium | `source, destination, overwrite?` | 移动；目标存在必须 `overwrite:true`（先备份到回收站）；跨卷回退「复制+删除」 |
| `file.remove` | **destructive** | `path` | 递归删除；**必须先 plan 拿 token**；删除前备份到回收站，回执带 `backup_path`（可 restoreBackup 恢复） |

- 注意：`file.list` 的 `target` 仍可为受管应用 id / 插件 id（v1.3-A 兼容行为）；
  `target: "workspace"` 才是受管工作区。

## 4.2 v1.4-D 打开应用（app.open）

- 两种模式：
  1. `target` = 受管应用 id → 用其 `command/args` 直接 `spawn`（**不经 shell**，天然防命令注入），
     受 `allow_start` 授权；回执 `{mode:"managed-app", target, pid}`；
  2. `params.target_url` = http/https URL → 必须命中 `allowed_urls` 白名单（域名含子域，或完整前缀），
     拒绝内嵌 `user:pass`、非 http(s)、引号/尖括号/控制字符（防命令注入）；
     Windows 用 `explorer.exe <url>` 交给默认浏览器（argv 数组、无 shell），或注入 `urlOpener`（测试/其它平台）。
- 风险 `medium`（默认需确认；`auto_approve_medium` 可放开）。
- 审计只记 `protocol://host/path`，**URL query/fragment 不写审计**（防 token 泄露）。

## 4.3 v1.4-D 服务状态（service.status）

- 只读快照：通过注入的 `ProcessOps.list()`（默认 Windows `Get-Process`）返回
  `{platform, count, processes:[{pid,name}], at}`；风险 `readonly`，无需确认。
- 只返回 pid/进程名，不读命令行、不读环境变量（脱敏）。

## 4.4 v1.4-D 定时任务（task.list / create / remove）

- 持久化：`<state_dir>/scheduler.json`（`{version:1, tasks:[…]}`），**不调用 Windows 任务计划**；
  由上层 RunManager/调度器读取后自行执行（本层只做配置管理）。
- 记录字段：`id / name / goal / enabled / interval_seconds? / cron? / created_at / requested_by?`。
- 校验：`name` 非空 ≤80 且**唯一**；`goal` 非空 ≤500；`interval_seconds` 与 `cron` **二选一**；
  interval 为 60–86400 整数秒；cron 必须 5 段（分 时 日 月 周，支持 `*`/数字/范围/步长/列表）。
- `task.create` / `task.remove` 风险 `medium`（默认确认）；`task.remove` **只删 JSON 配置**，不备份（无破坏性）。
- 跨实例持久化：新 `SystemController` 实例会读取同一 `scheduler.json`。

## 4.5 v1.4-D 受管安装/卸载（program.install / program.uninstall）

- 安装源：`<install_sources_dir>/<source_id>/`（默认 `<root>/install-sources`），必须含 `app.json`：
  `{id,name,command,args?,kind?,allow_start?,allow_stop?,allow_remove?,note?}`；
  source_id 安全 id 校验 + realpath 复核（禁止逃逸/软链接）。
- `program.install`（risk `medium`）：复制安装源目录 → `<root>/programs/<id>`，
  追加受管清单（内存）并写 `<state_dir>/installed.json`；重复安装/目标已存在拒绝；
  安装后 `app.start/stop/open` 等立即可用。
- `program.uninstall`（risk **destructive**，必须 token）：只能卸载 `installed.json` 内、
  且位于 `<root>/programs` 内的程序；先尝试停止运行中进程（best-effort）→ 备份到回收站 →
  删除目录 → 从受管清单与 `installed.json` 移除；回执/审计带 `backup_path`，可用 restoreBackup 恢复。

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
- v1.4-D：`file.remove` → `label = file-<条目名>`；`program.uninstall` → `label = program-<appId>`；
  `file.copy`/`file.move` 覆盖已有目标时先备份 → `label = overwritten-<目标名>`；
- 备份用复制（原件删除前保留一份），目录递归复制、文件复制；文件级备份的 `backup_path`
  指向被备份的文件本身，目录级指向备份目录；
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
- v1.4-D：文件动作**只记录路径/大小/sha256 前 16 位**，绝不记录文件内容；
  `app.open` 的 URL 只记 `protocol://host/path`（**query/fragment 不落审计**）；
- `auditTrail(limit?)` 只读最近 N 条（跳过损坏行，不因单行损坏整体失败）。

## 8. 安全边界（必须遵守）

1. **只操作受管范围**：清单外应用、插件目录外路径、路径穿越、系统关键路径 → 默认拒绝；
2. **危险动作必须人工二次确认**：`medium` 默认 / `high` / `destructive` 无有效令牌一律拒绝，
   不做「自动确认」（`auto_approve_medium` 只放开 medium，high/destructive 永不放宽）；
3. **删除前必须备份**：没有备份路径的删除路径不允许（`app.remove` 需要 `path`/`cwd`）；
4. **不按进程名批量杀进程**：只停本执行器记录过的 pid；
5. **不接触凭据/密钥**：不读环境密钥、不读凭据文件、不联网；
6. **未知 ≠ 成功**：越界/确认缺失抛错；执行失败返回 `ok:false` 回执并写审计；
7. 本层不是「系统管理员权限」：不做服务/注册表/驱动/系统目录/用户账户操作，也不支持通配符批量操作。
8. **v1.4-D 文件动作**：只允许受管工作区内相对路径；拒绝 `..`/绝对路径/盘符/通配符/控制字符；
   拒绝工作区内软链接/联接点逃逸（`symlink-escape`）；`file.write` ≤256KB、`file.read` ≤1MB；
9. **v1.4-D 打开应用**：受管 app 用 command/args 直接 spawn（不经 shell）；URL 必须命中
   `allowed_urls` 且为 http/https、无内嵌凭据，含引号/尖括号/控制字符一律拒绝（防命令注入）；
10. **v1.4-D 安装/卸载**：安装源只允许 `install_sources_dir` 的直接子目录（含 app.json）；
    卸载只能针对 `installed.json` 内、位于 `programs/` 内的程序（备份+确认后删除）；
11. **定时任务不调系统调度器**：`scheduler.json` 只是配置，执行由上层 RunManager 负责。

## 9. 测试

```bash
npm run build
node --test tests/unit/system.test.mjs
```

**实测（2026-10-30，Windows 10 Pro 22H2 build 19045，Node v24，Python 无关）**：

```
ℹ tests 46          # v1.3-A 基线 27 + v1.4-D 扩展 19
ℹ pass 46
ℹ fail 0
ℹ duration_ms ~1870

# 全量单元回归（npm run test:unit，包含其它模块）
ℹ tests 339
ℹ pass 339
ℹ fail 0
ℹ duration_ms ~8600
```

覆盖：listApps/listPlugins/systemInfo；五档风险分级（readonly/low/medium/high/destructive）；
清单外 app/插件/路径穿越/系统关键路径 拒绝；high 动作无 token 拒绝；token 一次性/过期/错绑拒绝；
**真实启动 node 短进程并真实停止、真实重启（旧 pid 退出/新 pid 存活）**；注入 mock 验证 restart
调用顺序；plugin.enable/disable 真实写 manifest；plugin.remove / app.remove 备份+删除+回执
`backup_path`；restoreBackup 恢复；审计 JSONL 追加/跨实例持久化/拒绝留痕/不含密钥明文；
ProcessOps 注入；**v1.4-D**：受管工作区 file.list/read/write/mkdir/copy/move/remove
（remove 备份+回执+restoreBackup）、路径穿越/绝对路径/软链接逃逸拒绝、256KB 上限、
app.open（清单外拒绝 / mock ProcessOps / URL 白名单 / 命令注入拒绝 / 审计去 query）、
service.status（mock + Windows 真实进程快照）、task.create/list/remove（scheduler.json
持久化 / interval / cron / 重名 / 跨实例）、program.install/uninstall（安装源白名单 /
programs/<id> / installed.json 持久化 / 卸载备份+删除+restoreBackup）、medium 与
auto_approve_medium 语义、审计脱敏（文件内容只记大小/hash）。

## 10. 给 supervisor / CLI 的对接片段（Lead 集成用）

```ts
// 1) 初始化（每个 run / 每个受管工作区一个控制器实例）
import { SystemController } from "../../packages/steward-system/src/index.js";
const systemctl = new SystemController({
  root: runRoot,
  state_dir: join(runRoot, ".steward", "system"),
  plugins_dir: join(runRoot, "plugins"),
  apps: MANAGED_APPS,                                // 从配置中心/管理员配置读取的受管应用清单
  workspace_dir: join(runRoot, "workspace"),         // v1.4-D：文件动作范围
  install_sources_dir: join(runRoot, "install-sources"),
  allowed_urls: config.system_policy.allowed_urls,   // v1.4-D：app.open URL 白名单
  auto_approve_medium: false,                        // 无人值守模式可设 true（只放开 medium）
});

// 2) 总调度 AI 产出步骤 → 先 plan（只读、无副作用）
const plan = systemctl.plan({
  id: `req-${Date.now()}`,
  action: "app.restart", // 也可以是 file.write/file.remove/app.open/task.create/program.install…
  target: "demo-app",
  params: {},
  reason: goalText,
  requested_by: "conductor",
});
if (!plan.allowed) return { ok: false, summary: plan.summary }; // 越界：直接拒绝并上报
if (plan.requires_confirmation) {
  // 3) 生成审批卡（复用 steward-core ApprovalCard 语义；medium/high/destructive 默认都到这里）
  return {
    ok: false,
    pending_approval: true,
    card: {
      action: plan.action,
      target: plan.details,
      risk_level: plan.risk, // readonly/low/medium/high/destructive
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
//    v1.4-D 典型参数：
//      file.write    { params: { path: "reports/daily.md", content } }
//      file.list     { target: "workspace", params: { path: "reports" } }
//      file.remove   { params: { path: "reports/old" } }（destructive）
//      app.open      { target: "demo-app" } 或 { params: { target_url } }
//      task.create   { params: { name, goal, interval_seconds } } / { params: { name, goal, cron } }
//      program.install   { params: { source_id } }
//      program.uninstall { target: "<installed-app-id>" }（destructive）
```

CLI 建议（由 Lead 实现，本包不修改 `apps/cli`）：

```bash
steward system list                              # app.list + plugin.list + system.info（readonly）
steward system start  --app <id>                 # low：直接执行
steward system stop   --app <id>                 # low：直接执行
steward system open   --app <id> | --url <url>   # v1.4-D medium：默认二次确认（URL 需白名单）
steward system restart --app <id>                # high：交互式二次确认（或 --confirm-token）
steward system remove --app <id>                 # destructive：强制二次确认 + 打印 backup_path
steward system files list|read|write|mkdir|copy|move|remove --path <相对路径>  # v1.4-D 工作区
steward system service status                    # v1.4-D 只读进程快照
steward system task list|create|remove            # v1.4-D scheduler.json（不调 Windows 任务计划）
steward system program install --source <id> | uninstall --app <id>  # v1.4-D 受管安装/卸载
steward system audit --limit 50                  # 读审计 JSONL
```

注册为工具时建议 `ToolSpec.risk` 映射：readonly→`low`、low→`low`、medium→`medium`、
high→`medium`、destructive→`high`，并让 `requiresApproval = plan.requires_confirmation`；
证据字段写回执 `audit_id`/`backup_path` 与审计路径。

## 11. 已知限制

- **Windows 专属真实执行**：Linux/macOS 需注入自定义 `ProcessOps`（接口简单，未内置实现）；
- **pid 记录为进程内状态**：控制器/进程重启后不记得之前启动的 pid（不会按名字猜测停止；
  需要跨进程恢复时请自行持久化 pid 并在 App 配置中恢复）；
- **stop 只停记录 pid**：外部启动的同名进程不会被停止（安全优先）；
- **插件 manifest 只写 `plugin.json`**：不改插件代码/依赖；`enabled` 是否被插件宿主真正尊重由宿主负责；
- **恢复不覆盖已有目标**（除非 `force:true`），避免误覆盖；
- **审计为单文件追加**：并发写同一文件由操作系统追加语义保证（单进程场景；多进程请串行化）；
- **无 UI/审批队列**：本层只提供 plan/receipt/audit 原语，审批交互由 console/CLI 实现（见第 10 节）。
- v1.4-D **受管工作区禁止软链接/联接点**（防逃逸）；工作区根目录本身可以是符号链接，
  以其 realpath 作为比较基准；文件动作不接受绝对路径（调用方需自行换算到工作区相对路径）；
- v1.4-D **`app.open` URL 白名单是域名/前缀字符串匹配**（非完整 CSP）；打开 URL 会交给默认浏览器
  （进程沙箱外），请只把可信域名加入 `allowed_urls`；
- v1.4-D **`scheduler.json` 只是配置**：本层不执行、不触发定时任务，也不提供 missed-run 语义；
  由上层 RunManager/调度器读取并负责执行、并发与失败重试；
- v1.4-D **`program.install` 只复制文件**：不执行安装脚本、不解决依赖、不校验代码签名；
  安装源 `app.json` 是信任边界，`install_sources_dir` 必须由管理员维护；
- v1.4-D **`installed.json` 是跨进程持久清单**：多进程/多机器并发写同一 state_dir 请串行化；
  `installed.json` 损坏时忽略安装记录（不会崩溃，但需重新安装）；
- v1.4-D **`file.write` 直接覆盖写**（非事务性原子写）；需要原子性/并发写保护由上层负责；
- **向后兼容**：v1.3-A 的动作/字段/错误类保持不变；`RiskLevel` 新增 `medium` 为增量扩展，
  旧代码按 `"high" | "destructive"` 判断的地方不受影响。
