#!/usr/bin/env node
// Task placeholder runner for scaffold stage.
// Each milestone replaces its own script with a real implementation (see ROADMAP.md).

const TASKS = {
  dev: "启动开发环境（M0 实现：本地 demo-web + steward CLI）",
  demo: "一键演示（M0 实现：空回路 → M1 真实浏览器 → M2 真实桌面）",
  test: "全量测试（M0 起逐步实现：unit / contract / e2e-browser / e2e-desktop / fault）",
  lint: "代码检查（M0 实现：tsc --noEmit + eslint/prettier）",
};

const task = process.argv[2];
if (!task || !(task in TASKS)) {
  console.error(`usage: node scripts/task.mjs <${Object.keys(TASKS).join("|")}>`);
  process.exit(1);
}

console.log(`[scaffold] 任务 "${task}" 尚未实现：${TASKS[task]}`);
console.log("[scaffold] 当前可运行：pnpm check / pnpm check:secrets");
console.log("[scaffold] 里程碑与实现顺序见 ROADMAP.md；功能命令将在 M0 后替换为真实实现。");
process.exit(0);
