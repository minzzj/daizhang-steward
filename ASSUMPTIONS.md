# Assumptions & Known Gaps / 假设与未覆盖清单

> 本文件是**诚实边界**清单：实现前先写下“不知道就不猜”的部分。随里程碑更新。
> 最后更新：2026-10-25（M1 完成）

## 一、环境假设

1. 主要运行环境是 **Windows 10/11**（管理员权限），桌面适配器 Windows 优先；Linux/macOS 只文档化。
2. Node.js ≥ 22.18、npm（随 Node 附带）；权威工作区在 **H:（exFAT）**，工程为**单包布局**
   （无 pnpm workspace，exFAT 不支持符号链接）；`tsc -p tsconfig.json` 输出 `dist/`，命令一律用 npm。
3. 浏览器使用本机已安装的 **Chrome / Edge**（Playwright channel），不强制下载 Chromium。
4. 无 `gh` CLI；GitHub 发布走「真实浏览器 + REST API」，令牌只从环境变量读取。
5. 视频渲染需要完整 FFmpeg（image2pipe + libx264 + AAC）与 HyperFrames；建议在 NTFS 盘运行
   （H: 为 exFAT，写大文件/原子写受限）。
6. **CI 行尾**：Windows runner 曾把 `*.patch` 转成 CRLF 导致 `git apply` 失败；已用
   `.gitattributes` 全仓 `eol=lf`（`*.patch`/`*.diff` 也强制 LF）+ `patch.ts` 归一化 CRLF 修复
   （提交 `b4ed316`），并加 CRLF 回归测试。

## 二、产品假设

1. 阶段二先用**仿真业务线**（仿真客户对话、交付物、收款与发票状态），不接真实资金通道与真实客户。
2. 模型默认 DeepSeek；无可用 key 时全链路走 **MockHarness**，演示与 CI 不需要付费 API。
3. 对外平台动作只针对**演示站点/本地页面**；真实平台遇到验证码、风控即停止交人。
4. AI 不是法律主体：不签约、不开票、不报税、不担任法代/股东/董事/监事/高管。
5. 30 条法律边界中，“已实现”指程序行为可拦截；“人工/不适用”按文档要求逐条标注。
6. 通知通道阶段一用桌面通知 + 邮件 + 审批队列；短信/电话待合规评估后再接。

## 三、已知未覆盖（截至 M1）

- [x] M0 内核最小闭环：AgentRuntime / BranchSpec / PolicyEngine / ArtifactBus / PromptManager /
  EventLog / BudgetGuard / StopSignal、CLI 7 命令（+2 占位）、MockHarness、prompts v1、
  30 条单元+集成测试、证据脚本（2026-10-25 完成并验证）。
- [x] M1 真实浏览器回路：`steward-browser`（Playwright 有头默认 / `chrome→msedge` 回退 / 每 run 独立
  userDataDir / 逐步截图、DOM、console / 5 类失败分类 / 风控停交人）、`patch.ts` + `loop.ts`
  （隔离 git worktree、两轮升级）、`tests/e2e-browser`、CLI `browser-flow`/`code-loop`、
  **35/35** 测试、A2/A4/A5/A6 通过（2026-10-25）。
- [x] 真实浏览器 E2E 已实现（M1 完成，A2/A4/A5 通过；`tests/e2e-browser/`）。
- [ ] 桌面 E2E、故障演练尚未实现（M2）。
- [x] HarnessAdapter：MockHarness ✅ M0；脚本化真实补丁 + 隔离 worktree + 两轮升级 ✅ M1；
  DSH headless / DeepSeek API 两种真实实现仍规划（M2+）。
- [x] 停止键最小实现（StopSignal，每个动作前检查）已在 M0 落地。
- [ ] 分支隔离、检查点恢复尚未实现（M2）。
- [ ] Scout 线索来源清单与评分尚未实现（M3）。
- [ ] 经营域数据模型、30 条边界规则、控制台尚未实现（Phase 2）。
- [ ] IoT 适配器只有契约计划，无实现（Phase 2 stub）。
- [ ] 宣传片、GitHub Release、正式 LICENSE 发布验证尚未执行（M4/Phase 2）。

## 四、取证与合规边界

1. 截图必须来自**真实运行的界面**，禁止重绘/生成式伪造产品 UI；E2E 自动截图，不手截。
2. 发布前在**中性路径**重跑，避免泄露本机路径、用户名、内网资料。
3. 真实站点烟测只访问无需登录、robots 允许的公开页面，不抓取登录后内容。
4. 测试与演示中不使用真实个人隐私数据；fixture 一律为虚构。

## 五、会偏离文档的地方（已获用户确认的方向）

1. 文档 1 桌面适配器写“Linux 优先”，本项目按用户机器改为 **Windows 优先**（契约不变、适配器可替换）。
2. 文档 1 默认 Apache-2.0/MIT，本项目按用户要求改为 **CC BY-NC-SA 4.0**。
3. 阶段一不做复杂前端（文档 1 非目标），看板/审批卡/接管键放阶段二。
4. 文档 2 允许“真实或仿真业务线”，本项目阶段二 MVP 采用仿真业务线 + 真实系统操作。
5. 工程从 pnpm workspace 改为**单包布局 + npm**（H: exFAT 不支持符号链接）；`tsconfig.json` 编译
   `packages/*/src` + `apps/cli/src` → `dist/`，契约不变。
6. 测试命令用 glob 形式：`node --test "tests/unit/*.test.mjs"`（引号由 shell 处理，跨平台一致）。

## 六、待用户拍板后更新的项

- [x] 仓库名（`daizhang-steward`）、GitHub 认证方式（本机凭据，令牌未落盘）
- [x] “第一阶段发布平台”（GitHub public 仓库已发布，Release 留 M4）
- [ ] 正式商用联系方式（`COMMERCIAL.md` 占位）
- [ ] 是否在阶段一即产出预热短片（默认阶段二出正式片）
