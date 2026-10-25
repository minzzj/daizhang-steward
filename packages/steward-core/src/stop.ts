import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StopState {
  stopped: boolean;
  reason?: string;
  requestedAt?: string;
}

/** File-based global stop key. The runtime checks it before every step. */
export class StopSignal {
  constructor(public readonly file: string) {}

  async request(reason: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const body = JSON.stringify({ reason, requestedAt: new Date().toISOString() }, null, 2);
    await writeFile(this.file, body + "\n", "utf8");
  }

  async read(): Promise<StopState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as {
        reason?: string;
        requestedAt?: string;
      };
      const state: StopState = { stopped: true };
      if (parsed.reason !== undefined) state.reason = parsed.reason;
      if (parsed.requestedAt !== undefined) state.requestedAt = parsed.requestedAt;
      return state;
    } catch {
      return { stopped: false };
    }
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
