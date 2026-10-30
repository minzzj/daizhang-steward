/**
 * packages/steward-console — 代掌 Steward 本地 Web 控制台（v1.4 专业版）
 *
 * 零第三方依赖（Node 内置 http + 原生 HTML/CSS/JS），只监听 127.0.0.1。
 * 运营页：总览 / 对话（发送即执行 + SSE 实时流）/ 项目 / 账本（6 要素）/ 审批卡 / 月报 / 接管键 / 变现（含易支付）；
 * 管理页：系统总控（supervisor + 危险动作二次确认）/ 智能体中心 / 后台时间线 / 配置中心（三模式+支付银行卡+模型提示词）/ 数据管理。
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
export * from "./chat.js";
export * from "./pages.js";
export * from "./pages-admin.js";
export * from "./pages-chat.js";
export * from "./system.js";
export * from "./runtime.js";
export * from "./pages-system.js";
export * from "./server.js";
export { BASE_CSS, CLIENT_JS } from "./assets.js";
export { PRO_CSS, ADMIN_JS } from "./assets-admin.js";
export { CHAT_CSS, CHAT_JS } from "./assets-chat.js";
export { SYSTEM_CSS, SYSTEM_JS } from "./assets-system.js";
