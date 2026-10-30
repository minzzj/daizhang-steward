/**
 * 代掌 Steward · 系统总控动作层（v1.4-D 扩展）· 公共类型契约。
 *
 * 在 v1.3-A 基础上**向后兼容**扩展：
 * - 风险分级新增 `medium`（默认需二次确认，`auto_approve_medium: true` 的 auto 模式下可直接执行）；
 * - 新增受管工作区文件/目录动作、打开应用、服务状态、定时任务（scheduler.json）、受管安装/卸载。
 *
 * 零第三方依赖；真实动作只在 Windows 上执行（非 Windows 抛出 `UnsupportedPlatformError`）。
 * 字段只增不减：新增字段一律可选。
 */

/** 风险分级：只读 / 低风险 / 中风险（默认确认，auto 可执行）/ 高风险 / 破坏性（确认+备份）。 */
export type RiskLevel = "readonly" | "low" | "medium" | "high" | "destructive";

/** 系统动作名（与 request.action 一一对应）。 */
export type ActionName =
  | "app.list"
  | "app.start"
  | "app.stop"
  | "app.restart"
  | "app.remove"
  | "app.open"
  | "plugin.list"
  | "plugin.enable"
  | "plugin.disable"
  | "plugin.remove"
  | "file.list"
  | "file.read"
  | "file.mkdir"
  | "file.write"
  | "file.copy"
  | "file.move"
  | "file.remove"
  | "service.status"
  | "task.list"
  | "task.create"
  | "task.remove"
  | "program.install"
  | "program.uninstall"
  | "system.info";

/** 受管应用类型：可执行程序 / 插件宿主 / 控制台程序。 */
export type AppKind = "program" | "plugin" | "console";

/**
 * 受管应用（**唯一允许被启动/停止/重启/打开/删除的对象**）。
 * 配置由用户/管理员维护；`program.install` 安装的程序会追加到受管清单。
 */
export interface ManagedApp {
  /** 稳定 id（字母数字开头，只含字母数字/._-）。 */
  id: string;
  name: string;
  /** 启动命令（如 `node` 或绝对路径 `C:\...\app.exe`）。 */
  command: string;
  args?: string[];
  /** 工作目录（必须存在）；建议在受管根目录内。 */
  cwd?: string;
  /**
   * 受管程序目录/文件（`app.remove` / `program.uninstall` 的备份与删除目标）。
   * 必须严格位于受管根目录 `root` 内，且不能是系统关键路径。
   */
  path?: string;
  kind: AppKind;
  allow_start: boolean;
  allow_stop: boolean;
  allow_remove: boolean;
  note?: string;
  /** 来源：`program.install` 安装的程序记录来源 id（可选，便于审计展示）。 */
  installed_from?: string;
}

/** 受管插件（由 `plugins_dir` 下的子目录 + `plugin.json` 发现）。 */
export interface ManagedPlugin {
  id: string;
  name: string;
  /** 插件目录绝对路径。 */
  path: string;
  enabled: boolean;
  version?: string;
  note?: string;
}

/** 一次动作请求（由用户/上层总调度 AI 下发；本层只做受管范围内的执行）。 */
export interface ActionRequest {
  /** 请求 id（确认令牌绑定它，保证「这一条命令」被确认）。 */
  id: string;
  action: ActionName;
  /** 目标：受管应用 id / 插件 id / `workspace`（文件动作）；task 动作也可用 params。 */
  target?: string;
  params?: Record<string, unknown>;
  /** 人类可读原因（写审计，会脱敏）。 */
  reason?: string;
  /** 中/高/破坏性动作必须有：plan() 下发的一次性令牌（TTL 120s）。 */
  confirmation_token?: string;
  /** 发起人（用户 id / 角色），写审计。 */
  requested_by?: string;
}

/** 动作计划：风险评估 + 是否允许 + 是否需要二次确认 + 一次性令牌 + 人类可读摘要。 */
export interface ActionPlan {
  request_id: string;
  action: ActionName;
  risk: RiskLevel;
  allowed: boolean;
  requires_confirmation: boolean;
  /** 仅当 `requires_confirmation === true && allowed` 时下发。 */
  confirmation_token?: string;
  summary: string;
  details: unknown;
}

/** 动作回执：执行结果 + 备份路径 + 审计 id。 */
export interface ActionReceipt {
  request_id: string;
  action: ActionName;
  risk: RiskLevel;
  ok: boolean;
  /** 是否真的执行了动作（策略拒绝时为 false）。 */
  executed: boolean;
  output: unknown;
  error?: string;
  at: string;
  /** 破坏性动作（或覆盖写）的备份路径。 */
  backup_path?: string;
  audit_id: string;
}

/** 审计条目：追加写入 `<state_dir>/system-audit.jsonl`，不含密钥/敏感明文。 */
export interface AuditEntry {
  audit_id: string;
  at: string;
  request_id: string;
  action: ActionName | string;
  target: string | null;
  risk: RiskLevel;
  ok: boolean;
  executed: boolean;
  /** 脱敏后的结果摘要（≤500 字符；文件内容只记大小/hash）。 */
  summary: string;
  backup_path?: string;
  requested_by?: string;
  /** 脱敏后的原因（≤200 字符）。 */
  reason?: string;
  /** 平台（win32/darwin/linux），便于跨机器审计。 */
  platform: string;
}

/** 进程信息（ProcessOps.list）。 */
export interface ProcessInfo {
  pid: number;
  name: string;
}

/** 启动结果（ProcessOps.start）。 */
export interface StartedProcess {
  pid: number;
  started_at?: string;
}

/**
 * 进程/删除执行器接口（可注入 mock 便于测试，也可替换成其它平台的实现）。
 * 默认实现 `WindowsProcessOps`：child_process 启动 + PowerShell（tasklist/Stop-Process）停止。
 */
export interface ProcessOps {
  start(app: ManagedApp): Promise<StartedProcess> | StartedProcess;
  stop(app: ManagedApp, pid?: number | null): Promise<boolean> | boolean;
  list(): Promise<ProcessInfo[]> | ProcessInfo[];
  /** 先备份到回收站目录再删除，返回备份路径（备份根内实际被复制的路径）。 */
  remove(app: ManagedApp): Promise<string> | string;
}

/** `app.open` 打开 URL 的执行器（测试可注入 mock；默认用 explorer.exe 交给默认浏览器）。 */
export type UrlOpener = (url: string) => Promise<{ pid?: number } | void> | { pid?: number } | void;

/** 一次性确认令牌记录（`lastConfirmation()` 可展示给 UI）。 */
export interface ConfirmationRecord {
  token: string;
  request_id: string;
  action: ActionName;
  target: string | null;
  risk: RiskLevel;
  summary: string;
  issued_at: string;
  expires_at: string;
  /** epoch 毫秒，测试可用注入的 `now()` 控制。 */
  expires_at_ms: number;
  used: boolean;
}

/** 恢复备份的结果。 */
export interface RestoreResult {
  backup_path: string;
  destination: string;
  restored: boolean;
}

/** 受管工作区目录中的条目（file.list workspace 模式）。 */
export interface WorkspaceFileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  modified_at: string;
}

/** 定时任务记录（持久化到 `<state_dir>/scheduler.json`；由上层调度器读取执行）。 */
export interface ScheduledTaskRecord {
  id: string;
  name: string;
  goal: string;
  enabled: boolean;
  /** 间隔秒数（60–86400）；与 cron 二选一。 */
  interval_seconds?: number;
  /** 5 段 cron（分 时 日 月 周）；与 interval_seconds 二选一。 */
  cron?: string;
  created_at: string;
  requested_by?: string;
}

/** scheduler.json 文件结构。 */
export interface SchedulerFile {
  version: 1;
  tasks: ScheduledTaskRecord[];
}

/** `program.install` 安装记录（持久化到 `<state_dir>/installed.json`）。 */
export interface InstalledProgramRecord {
  id: string;
  source_id: string;
  installed_at: string;
  app: ManagedApp;
}

/** installed.json 文件结构。 */
export interface InstalledFile {
  version: 1;
  programs: InstalledProgramRecord[];
}

/** `service.status` 的只读进程快照。 */
export interface ServiceSnapshot {
  platform: string;
  count: number;
  processes: ProcessInfo[];
  at: string;
}

/** `app.open` 的输出。 */
export interface AppOpenResult {
  mode: "managed-app" | "url";
  target: string;
  /** managed-app：真实/模拟启动的 pid。 */
  pid?: number;
  /** url：规范化后的 URL（仅输出给调用方，审计只记 host/path）。 */
  url?: string;
}

/** `SystemController` 构造参数（v1.4-D 扩展字段均可选，保持向后兼容）。 */
export interface SystemControllerOptions {
  /** 受管根目录（默认 process.cwd()）：`app.path`/安装目标必须严格位于其中。 */
  root?: string;
  /** 状态目录（审计 JSONL / recycle 回收站 / scheduler.json / installed.json）。 */
  state_dir?: string;
  /** 受管应用清单（唯一允许操作的应用集合）。 */
  apps: ManagedApp[];
  /** 受管插件根目录：只允许操作其直接子目录（含 plugin.json）。 */
  plugins_dir: string;
  /** 时间源注入（测试用），默认 Date。 */
  now?: () => Date;
  /** 进程/删除执行器注入（测试 mock 或其它平台替身）；缺省 WindowsProcessOps。 */
  processOps?: ProcessOps;
  /** 受管工作区（文件/目录动作只允许在其中）；默认 `<root>/workspace`。 */
  workspace_dir?: string;
  /** 受管安装源目录（program.install 只允许其中目录）；默认 `<root>/install-sources`。 */
  install_sources_dir?: string;
  /**
   * `app.open` 的 URL 白名单：域名（含子域）或完整前缀（`https://example.com/app`）。
   * 缺省/空数组 = 禁止打开任何 URL（只允许打开受管应用）。
   */
  allowed_urls?: readonly string[];
  /** auto 模式：medium 动作无需二次确认即可执行（默认 false = 默认需确认）。 */
  auto_approve_medium?: boolean;
  /** URL 打开器注入（测试 mock）；缺省 Windows 用 explorer.exe 打开默认浏览器。 */
  urlOpener?: UrlOpener;
}

/** `system.info` 输出（仅本地系统摘要，不含用户名等敏感信息）。 */
export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  node_version: string;
  cpu_count: number;
  total_memory_bytes: number;
  free_memory_bytes: number;
  uptime_seconds: number;
  /** 受管根目录（绝对路径）。 */
  root: string;
  state_dir: string;
  plugins_dir: string;
  /** 受管工作区（文件动作范围）。 */
  workspace_dir: string;
  /** 受管安装源目录。 */
  install_sources_dir: string;
  managed_apps: number;
  managed_plugins: number;
  scheduled_tasks: number;
  installed_programs: number;
  at: string;
}

/** 确认令牌有效期：120 秒。 */
export const CONFIRMATION_TTL_MS = 120_000;

/** 系统总控的最大受管应用数（防止配置异常膨胀）。 */
export const MAX_MANAGED_APPS = 200;

/** 审计摘要/原因截断长度。 */
export const AUDIT_SUMMARY_MAX = 500;
export const AUDIT_REASON_MAX = 200;

/** 受管工作区/安装源/已安装程序目录名（相对受管 root）。 */
export const WORKSPACE_DIR_NAME = "workspace";
export const INSTALL_SOURCES_DIR_NAME = "install-sources";
export const PROGRAMS_DIR_NAME = "programs";

/** 状态文件名（位于 state_dir 下）。 */
export const SCHEDULER_FILE = "scheduler.json";
export const INSTALLED_FILE = "installed.json";

/** 文件写入内容上限：256 KB（UTF-8 字节）。 */
export const MAX_FILE_WRITE_BYTES = 256 * 1024;
/** 文件读取上限：1 MiB（超过拒绝，避免把大文件塞进证据/上下文）。 */
export const MAX_FILE_READ_BYTES = 1024 * 1024;

/** 定时任务校验：interval 60–86400 秒；任务名 ≤80；goal ≤500。 */
export const MIN_TASK_INTERVAL_SECONDS = 60;
export const MAX_TASK_INTERVAL_SECONDS = 86_400;
export const TASK_NAME_MAX_LENGTH = 80;
export const TASK_GOAL_MAX_LENGTH = 500;
