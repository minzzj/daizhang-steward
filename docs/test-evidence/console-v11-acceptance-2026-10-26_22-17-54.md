# 控制台 v1.1 真实浏览器验收 / Console v1.1 Real-Browser Acceptance

- 日期：2026-10-26
- 浏览器：**真实有头 Chrome 155**（Playwright，非 mock DOM）
- 结果：**15/15 步、178/178 检查通过、15 张截图、退出码 0**
- 耗时：12.3s；measured_stop_ms=83；console_boot_ms=6；first_page_load_ms=355

## 覆盖项
1. 专业版布局：左侧导航（运营 6 + 管理 4）+ 顶部状态栏（模式/预算/Token/接管/最近事件）
2. 配置中心 `/settings`：体验/个人/企业三模式卡片；个人=微信/支付宝/个人银行卡；企业=对公/专票/双人复核/授权书；14 项功能开关（禁用 scout 刷新后仍生效）；预算（含 0 元极限）；Token 上限（10,000,000）+ 已用/剩余；**支付与银行卡分组高亮可见**（账户仅掩码）；保存校验错误提示
3. 智能体中心 `/agents`：11 个智能体（含写代码 Harness、核查 reviewer、后台 backend、找客户 scout）；状态/任务/Token/日志；企业专属在个人模式显示“该模式不适用”；详情展开
4. 后台 `/backend`：4 个 run / 19 条全流程事件（计划→行动→观察→验证→留证）+ 队列 + 过滤 + Token/预算 + 异常/接管 + 证据展开
5. 数据管理 `/data`：统计、二次确认清空（取消不执行→确认归零→空档案）、重置演示、导出配置
6. 安全：管理写操作无 token 401 且不改数据；0 JS 错误；0 外链

## 证据
- `evidence-console-v11-2026-10-26_22-17-54/result.json`（15 步 / 178 检查）
- `screenshots/001-open-console.png … 015-pro-sanity.png`（含 011-settings-config、012-agents-center、013-backend-flow、014-data-manage）
- `console-server.log`、`console.log`