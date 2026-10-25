#!/usr/bin/env node
/**
 * 兼容入口：tests/e2e-browser/run.mjs
 *
 * 历史验收命令（`packages/steward-harness` 的 demoCodeTask.acceptance）写的是
 * `node tests/e2e-browser/run.mjs --case login-timeout`；实现与全部选项见 login-flow.mjs。
 * 本文件只转发参数与退出码，不额外增加逻辑。
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const target = join(dirname(fileURLToPath(import.meta.url)), "login-flow.mjs");
const child = spawn(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });

child.on("error", (error) => {
  console.error(`[e2e] 无法启动 login-flow.mjs：${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[e2e] login-flow.mjs 被信号终止：${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
