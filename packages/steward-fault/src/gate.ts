/**
 * PromisesGate：断网期间禁止产生新的对外承诺（B3 核心红线）。
 *
 * 使用方式：每次准备对外承诺（对客户答应交付/退款/价格…）之前调用
 * `assertMayPromise(online)`；离线时抛 `OfflinePromiseError` 并计数，恢复后由 Outbox 补记。
 */

import { OfflinePromiseError } from "./errors.js";

export class PromisesGate {
  private blocked = 0;

  /** 被拦下的承诺次数（离线时每次调用 +1）。 */
  get blockedCount(): number {
    return this.blocked;
  }

  /**
   * 在线才允许承诺；离线直接抛 `OfflinePromiseError`。
   * @param online 最近一次真实探针/请求得出的网络状态
   */
  assertMayPromise(online: boolean): void {
    if (online) return;
    this.blocked += 1;
    throw new OfflinePromiseError(
      `断网期间不产生新承诺：已拦截第 ${this.blocked} 次对外承诺；恢复后由 Outbox 补记（幂等，账本不重复）。`,
      this.blocked,
    );
  }

  reset(): void {
    this.blocked = 0;
  }
}
