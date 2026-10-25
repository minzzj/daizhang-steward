import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./redact.js";

export interface PromptManifestEntry {
  id: string;
  file: string;
  version: string;
  sha256: string;
}

export interface PromptManifest {
  version: string;
  updated: string;
  prompts: PromptManifestEntry[];
}

export interface LoadedPrompt {
  id: string;
  version: string;
  file: string;
  text: string;
  sha256: string;
}

/**
 * Loads versioned runtime prompts from prompts/ and validates their integrity.
 * Long prompts are never hard-coded in business code (see docs/en/runtime-prompts.md).
 */
export class PromptManager {
  private readonly cache = new Map<string, LoadedPrompt>();

  private constructor(
    private readonly dir: string,
    public readonly manifest: PromptManifest,
  ) {}

  static async load(promptsDir: string): Promise<PromptManager> {
    const manifestPath = join(promptsDir, "manifest.json");
    let manifest: PromptManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PromptManifest;
    } catch {
      throw new Error(`无法读取提示词清单：${manifestPath}`);
    }
    const manager = new PromptManager(promptsDir, manifest);
    const entries = manifest.prompts;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("提示词清单为空：prompts/manifest.json");
    }
    for (const entry of entries) {
      await manager.get(entry.id); // validates file exists + sha256 matches
    }
    return manager;
  }

  list(): PromptManifestEntry[] {
    return this.manifest.prompts;
  }

  async get(id: string): Promise<LoadedPrompt> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const entry = this.manifest.prompts.find((p) => p.id === id);
    if (!entry) throw new Error(`提示词不存在：${id}`);
    const file = join(this.dir, entry.file);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new Error(`提示词文件缺失：${entry.file}`);
    }
    const actual = sha256(text);
    if (actual !== entry.sha256) {
      throw new Error(
        `提示词校验失败：${entry.file} sha256=${actual}，清单记录=${entry.sha256}。运行 pnpm prompts:manifest 更新清单。`,
      );
    }
    const loaded: LoadedPrompt = {
      id: entry.id,
      version: entry.version,
      file: entry.file,
      text,
      sha256: actual,
    };
    this.cache.set(id, loaded);
    return loaded;
  }

  async render(id: string, vars: Record<string, string> = {}): Promise<string> {
    const prompt = await this.get(id);
    let out = prompt.text;
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{{${key}}}`).join(value);
    }
    const unresolved = out.match(/\{\{[a-z_]+\}\}/g);
    if (unresolved) throw new Error(`提示词变量未提供：${[...new Set(unresolved)].join(", ")}`);
    return out;
  }
}
