/**
 * v1.1：配置中心 / 智能体 / 数据管理 CLI（依赖 packages/steward-config）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../../packages/steward-core/src/index.js";
import {
  ConfigEngine,
  isFeatureName,
  isRunMode,
  type FeatureName,
  type RunMode,
} from "../../../packages/steward-config/src/index.js";

type Flags = Record<string, string | boolean>;
export interface ConfigArgs {
  flags: Flags;
}

const flag = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const printJson = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function configRoot(root: string, flags: Flags): string {
  return flag(flags, "root") ?? join(root, ".steward");
}

/** 应用一个配置补丁（按字段调用 ConfigEngine 的 setter，全部经过校验）。 */
function applyPatch(engine: ConfigEngine, patch: Record<string, unknown>): void {
  if (typeof patch.mode === "string") {
    if (!isRunMode(patch.mode)) throw new Error(`非法模式：${patch.mode}`);
    engine.setMode(patch.mode as RunMode);
  }
  if (patch.profile && typeof patch.profile === "object") engine.setProfile(patch.profile as Record<string, unknown>);
  if (patch.budgets && typeof patch.budgets === "object") engine.setBudgets(patch.budgets as never);
  if (patch.token_budget && typeof patch.token_budget === "object") engine.setTokenBudget(patch.token_budget as never);
  if (patch.approval && typeof patch.approval === "object") engine.setApprovalPolicy(patch.approval as never);
  if (patch.data && typeof patch.data === "object") engine.setData(patch.data as never);
  if (patch.features && typeof patch.features === "object") {
    for (const [name, value] of Object.entries(patch.features as Record<string, unknown>)) {
      if (!isFeatureName(name)) throw new Error(`非法功能名：${name}`);
      const toggle = (value ?? {}) as { enabled?: boolean; requiresApproval?: boolean; requires_approval?: boolean; note?: string };
      const update: { enabled: boolean; requiresApproval?: boolean; note?: string } = { enabled: toggle.enabled !== false };
      const requiresApproval = toggle.requiresApproval ?? toggle.requires_approval;
      if (typeof requiresApproval === "boolean") update.requiresApproval = requiresApproval;
      if (typeof toggle.note === "string") update.note = toggle.note;
      engine.setFeature(name as FeatureName, update);
    }
  }
  if (patch.payments && typeof patch.payments === "object") {
    const payments = patch.payments as Record<string, unknown>;
    if (payments.payout_account && typeof payments.payout_account === "object") engine.setPayoutAccount(payments.payout_account as never);
    if (payments.invoice && typeof payments.invoice === "object") engine.setInvoiceConfig(payments.invoice as never);
    const policy: { require_dual_review?: boolean; sign_contract?: boolean } = {};
    if (typeof payments.require_dual_review === "boolean") policy.require_dual_review = payments.require_dual_review;
    if (typeof payments.sign_contract === "boolean") policy.sign_contract = payments.sign_contract;
    engine.setPaymentsPolicy(policy);
    if (Array.isArray(payments.providers)) {
      for (const item of payments.providers as Array<Record<string, unknown>>) {
        if (typeof item.id !== "string") continue;
        const providerUpdate: { enabled?: boolean; mode?: never; note?: string } = {};
        if (typeof item.enabled === "boolean") providerUpdate.enabled = item.enabled;
        if (typeof item.mode === "string") providerUpdate.mode = item.mode as never;
        if (typeof item.name === "string") providerUpdate.note = item.name;
        engine.setPaymentProvider(item.id, providerUpdate);
      }
    }
  }
  if (Array.isArray(patch.agents)) {
    for (const item of patch.agents as Array<Record<string, unknown>>) {
      if (typeof item.role !== "string") continue;
      const agentUpdate: { enabled?: boolean; autonomy?: never; token_limit?: number } = {};
      if (typeof item.enabled === "boolean") agentUpdate.enabled = item.enabled;
      if (typeof item.autonomy === "string") agentUpdate.autonomy = item.autonomy as never;
      if (typeof item.token_limit === "number") agentUpdate.token_limit = item.token_limit;
      engine.setAgentConfig(item.role, agentUpdate);
    }
  }
}

function computeDataStats(dataRoot: string): { data_root: string; exists: boolean; dirs: number; files: number; bytes: number; entries: string[] } {
  let dirs = 0;
  let files = 0;
  let bytes = 0;
  const entries: string[] = [];
  if (!existsSync(dataRoot)) return { data_root: dataRoot, exists: false, dirs: 0, files: 0, bytes: 0, entries };
  const walk = (dir: string, depth = 0) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const st = statSync(path);
        if (st.isDirectory()) {
          dirs += 1;
          if (depth === 0) entries.push(name + "/");
          walk(path, depth + 1);
        } else {
          files += 1;
          bytes += st.size;
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk(dataRoot);
  return { data_root: dataRoot, exists: true, dirs, files, bytes, entries };
}

export async function cmdConfig(parsed: ConfigArgs): Promise<number> {
  const root = findRepoRoot();
  const engine = new ConfigEngine({ root: configRoot(root, parsed.flags) });
  const action = (flag(parsed.flags, "action") ?? "get").toLowerCase();
  const json = parsed.flags.json === true;
  try {
    switch (action) {
      case "get": {
        const config = engine.load();
        if (json) printJson({ ok: true, config });
        else {
          const modeLabel = config.profile.mode === "demo" ? "体验模式" : config.profile.mode === "personal" ? "个人模式" : "企业模式";
          console.log(`运行模式：${modeLabel}（${config.profile.mode}）`);
          console.log(`预算：月 ¥${config.budgets.month_cny} / 项目 ¥${config.budgets.project_cny} / 单笔 ¥${config.budgets.per_txn_cny}${config.budgets.zero_budget_mode ? "（0 元极限模式）" : ""}`);
          console.log(`Token：已用 ${config.token_budget.used_tokens.toLocaleString()} / 上限 ${config.token_budget.limit_tokens.toLocaleString()}`);
          console.log(`支付渠道：${config.payments.providers.map((p) => `${p.name}(${p.enabled ? p.mode : "禁用"})`).join("、")}`);
          console.log(`收款账户：${config.payments.payout_account.type === "personal" ? "个人" : "企业"} · ${config.payments.payout_account.bank_name} ${config.payments.payout_account.card_no_masked}`);
          console.log(`功能开关：${Object.entries(config.features).map(([k, v]) => `${k}=${v.enabled ? "开" : "关"}`).join(" ")}`);
        }
        return 0;
      }
      case "mode": {
        const raw = flag(parsed.flags, "mode") ?? "personal";
        if (!isRunMode(raw)) {
          console.error(`非法模式：${raw}（demo|personal|enterprise）`);
          return 2;
        }
        const diff = engine.setMode(raw);
        engine.save();
        if (json) printJson({ ok: true, mode: raw, changed: diff.changed });
        else console.log(`已切换运行模式：${raw}（变更 ${diff.changed.length} 项）`);
        return 0;
      }
      case "set": {
        const patchFile = flag(parsed.flags, "patch");
        if (!patchFile || !existsSync(patchFile)) {
          console.error("用法：steward config --action set --patch <config-patch.json>");
          return 2;
        }
        const patch = JSON.parse(readFileSync(patchFile, "utf8")) as Record<string, unknown>;
        applyPatch(engine, patch);
        const config = engine.save();
        if (json) printJson({ ok: true, config });
        else console.log("配置已更新并保存");
        return 0;
      }
      case "reset": {
        const raw = flag(parsed.flags, "mode") ?? "personal";
        if (!isRunMode(raw)) {
          console.error(`非法模式：${raw}`);
          return 2;
        }
        const config = engine.reset(raw);
        engine.save();
        if (json) printJson({ ok: true, config });
        else console.log(`已恢复默认配置（${raw}）`);
        return 0;
      }
      case "export": {
        console.log(engine.export());
        return 0;
      }
      case "import": {
        const file = flag(parsed.flags, "file");
        if (!file || !existsSync(file)) {
          console.error("用法：steward config --action import --file <config.json>");
          return 2;
        }
        const config = engine.import(readFileSync(file, "utf8"));
        engine.save();
        if (json) printJson({ ok: true, config });
        else console.log("配置已导入");
        return 0;
      }
      case "validate": {
        const result = engine.validate();
        if (json) printJson({ ok: result.ok, errors: result.errors });
        else console.log(result.ok ? "配置校验通过" : `配置校验失败：${result.errors.map((e) => e.message ?? String(e)).join("；")}`);
        return result.ok ? 0 : 1;
      }
      default:
        console.error(`未知 action：${action}（get|mode|set|reset|export|import|validate）`);
        return 2;
    }
  } catch (error) {
    console.error(`配置命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export async function cmdAgents(parsed: ConfigArgs): Promise<number> {
  const root = findRepoRoot();
  const engine = new ConfigEngine({ root: configRoot(root, parsed.flags) });
  const config = engine.load();
  const agents = engine.listAgents();
  const rows = agents.map((agent) => {
    const usage = engine.agentUsage(agent.role);
    return { ...agent, usage };
  });
  if (parsed.flags.json === true) {
    printJson({ ok: true, mode: config.profile.mode, agents: rows });
    return 0;
  }
  console.log(`智能体（运行模式：${config.profile.mode}）`);
  for (const row of rows) {
    const used = row.usage?.tokens ?? 0;
    console.log(`- ${row.name}（${row.role}）| ${row.enabled ? "启用" : "禁用"} | ${row.autonomy} | 工具 ${row.tools.length} | Token 限额 ${row.token_limit.toLocaleString()} | 已用 ${used.toLocaleString()}`);
  }
  return 0;
}

export async function cmdData(parsed: ConfigArgs): Promise<number> {
  const root = findRepoRoot();
  const engine = new ConfigEngine({ root: configRoot(root, parsed.flags) });
  const action = (flag(parsed.flags, "action") ?? "stats").toLowerCase();
  const dataRoot = flag(parsed.flags, "data-root") ?? join(root, ".steward", "data");
  try {
    if (action === "stats") {
      const stats = computeDataStats(dataRoot);
      if (parsed.flags.json === true) printJson({ ok: true, stats });
      else console.log(`数据统计：${stats.files} 文件 / ${stats.dirs} 目录 / ${(stats.bytes / 1024).toFixed(1)} KB（${stats.data_root}）`);
      return 0;
    }
    if (action === "reset") {
      if (parsed.flags.yes !== true) {
        console.error("清空数据需要显式 --yes 确认");
        return 2;
      }
      const result = engine.resetData(dataRoot);
      if (parsed.flags.json === true) printJson({ ok: true, result });
      else console.log(`已清空数据：删除 ${result.files_deleted} 个文件，释放 ${(result.bytes_freed / 1024).toFixed(1)} KB（保留配置）`);
      return 0;
    }
    console.error(`未知 action：${action}（stats|reset）`);
    return 2;
  } catch (error) {
    console.error(`数据命令失败：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
