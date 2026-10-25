/**
 * packages/steward-console — 代掌 Steward 本地 Web 控制台（阶段二 P1-C）
 *
 * 零第三方依赖（Node 内置 http + 原生 HTML/CSS/JS），只监听 127.0.0.1。
 * 页面：看板 / 项目时间线 / 账本（6 要素）/ 审批卡（批准/驳回）/ 接管键（6 类接管包）/ 月报。
 *
 * 用法（CLI 由 Lead 接入，建议命令 `steward console [--port 4180]`）：
 * ```ts
 * import { createConsoleServer, createDemoConsoleProvider } from "../../packages/steward-console/src/index.js";
 *
 * const provider = createDemoConsoleProvider();       // 后续替换为真实 domain 适配器
 * const consoleServer = await createConsoleServer({ provider, port: 4180 });
 * console.log(`本地控制台：${consoleServer.url}（只监听 ${consoleServer.host}）`);
 * // 退出前 await consoleServer.close();
 * ```
 */

export * from "./provider.js";
export * from "./pages.js";
export * from "./server.js";
export { BASE_CSS, CLIENT_JS } from "./assets.js";
