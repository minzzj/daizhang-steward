/**
 * packages/steward-console — 代掌 Steward 本地 Web 控制台（v1.1 专业版）
 *
 * 零第三方依赖（Node 内置 http + 原生 HTML/CSS/JS），只监听 127.0.0.1。
 * 运营页：总览 / 项目 / 账本（6 要素）/ 审批卡 / 月报 / 接管键（6 类接管包）；
 * 管理页：智能体中心 / 后台全流程时间线 / 配置中心（体验·个人·企业三模式 + 支付银行卡 + Token 预算）/ 数据管理（清空/重置/导出）。
 *
 * 用法（CLI 由 Lead 接入，建议命令 `steward console [--port 4180]`）：
 * ```ts
 * import {
 *   createConsoleServer,
 *   createDemoConsoleProvider,
 *   createDemoAdminProvider,
 * } from "../../packages/steward-console/src/index.js";
 *
 * const provider = createDemoConsoleProvider();     // 后续替换为真实 domain 适配器
 * const adminProvider = createDemoAdminProvider();  // 后续替换为 steward-config 的 ConfigEngine 适配器
 * const consoleServer = await createConsoleServer({ provider, adminProvider, port: 4180 });
 * console.log(`本地控制台：${consoleServer.url}（只监听 ${consoleServer.host}）`);
 * // 退出前 await consoleServer.close();
 * ```
 */

export * from "./provider.js";
export * from "./admin.js";
export * from "./pages.js";
export * from "./pages-admin.js";
export * from "./server.js";
export { BASE_CSS, CLIENT_JS } from "./assets.js";
export { PRO_CSS, ADMIN_JS } from "./assets-admin.js";
