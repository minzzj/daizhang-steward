# Assumptions & Known Gaps / 假设与未覆盖清单

> 本文件是**诚实边界**清单：实现前先写下“不知道就不猜”的部分。随里程碑更新。
> 最后更新：2026-10-25（M4 / 阶段一完成，v0.5.0 发布）

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
7. **真实桌面适配器**：需要 **Python ≥ 3.8** 在 `PATH`（本机 3.11.9 实测；可用 `STEWARD_PYTHON`
   指定），且必须在**真实交互 Windows 桌面会话**（未锁屏）运行——`SendInput`/`BitBlt` 依赖前台会话，
   Session 0 / 托管 CI / RDP 断开 / UAC 安全桌面会失败。侧车是 Per-Monitor V2 DPI 感知进程，
   点击坐标使用屏幕物理像素，操作 DPI 未感知程序需按 `clientRect.width / 逻辑宽度` 换算。

## 二、产品假设

1. 阶段二先用**仿真业务线**（仿真客户对话、交付物、收款与发票状态），不接真实资金通道与真实客户。
2. 模型默认 DeepSeek；无可用 key 时全链路走 **MockHarness**，演示与 CI 不需要付费 API。
3. 对外平台动作只针对**演示站点/本地页面**；真实平台遇到验证码、风控即停止交人。
4. AI 不是法律主体：不签约、不开票、不报税、不担任法代/股东/董事/监事/高管。
5. 30 条法律边界中，“已实现”指程序行为可拦截；“人工/不适用”按文档要求逐条标注。
6. 通知通道阶段一用桌面通知 + 邮件 + 审批队列；短信/电话待合规评估后再接。

## 三、已知未覆盖（截至 M4 / 阶段一完成）

> 阶段一（M0–M4）已全部完成并以 **v0.5.0** 发布；以下未覆盖项保留为**阶段二输入**。

- [x] M0 内核最小闭环：AgentRuntime / BranchSpec / PolicyEngine / ArtifactBus / PromptManager /
  EventLog / BudgetGuard / StopSignal、CLI 7 命令（+2 占位）、MockHarness、prompts v1、
  30 条单元+集成测试、证据脚本（2026-10-25 完成并验证）。
- [x] M1 真实浏览器回路：`steward-browser`（Playwright 有头默认 / `chrome→msedge` 回退 / 每 run 独立
  userDataDir / 逐步截图、DOM、console / 5 类失败分类 / 风控停交人）、`patch.ts` + `loop.ts`
  （隔离 git worktree、两轮升级）、`tests/e2e-browser`、CLI `browser-flow`/`code-loop`、
  A2/A4/A5/A6 通过（2026-10-25）。
- [x] 真实浏览器 E2E 已实现（M1 完成，A2/A4/A5 通过；`tests/e2e-browser/`）。
- [x] M2 真实桌面：`steward-desktop`（Python ctypes 侧车：窗口枚举/聚焦、BitBlt 截图、SendInput
  真实鼠标 + Unicode 真实键盘、白名单默认拒绝、DPI 感知、5 类失败分类、每步截图、凭据提示停止
  交人）、`tests/e2e-desktop/` 真实桌面 E2E、A3 通过（36/36 检查、20 张截图，2026-10-25）。
- [x] 停止键 ≤5s、检查点恢复、分支隔离已实现（M2 完成：`stop-controller` / `checkpoint` /
  `isolation` + runtime 集成；A8/A9 通过；`run --resume` 跳过已完成步骤不重复执行）。
- [x] HarnessAdapter：MockHarness ✅ M0；脚本化真实补丁 + 隔离 worktree + 两轮升级 ✅ M1；
  DSH headless / DeepSeek API 两种真实实现仍规划（阶段二）。
- [x] M3 Scout 客户分支：`packages/steward-scout` 的 `ScoutEngine`（ICP + 3 个高价值场景、四因子评分
  40/20/20/20、来源硬校验与去重、≤150 字草稿且引用信号、审批队列默认 pending、每日每渠道 ≤10、
  退订/回复/会议统计、ScoutReport；纯逻辑零网络）、`examples/scout-fixtures/`（14 条纯虚构线索）、
  CLI `scout`、`npm run acceptance:m3`；A7 通过（14 → 丢弃 4 → 合格 8 → 3 条草稿待审、0 发送，
  2026-10-25）。
- [x] M4 开源发布收尾（阶段一完成）：A10 只读 `dummy-branch`（配置 + 已有 reviewer 提示词，不改核心）、
  A11 发布就绪（CC BY-NC-SA 4.0 许可证全文 + 非商用、NOTICE/COMMERCIAL、中英双语文档配对、
  源码无遥测、版本一致、发布文档齐全）、`npm run acceptance:m4`、`docs/good-first-issues.md`（5 个）、
  中英演示脚本、`docs/RELEASE_NOTES_v0.5.0.md`；测试 **80/80**（12 个测试文件）、CLI **13 命令 + 2 占位**、
  **v0.5.0 Release** 已发布（2026-10-25）。
- [ ] 桌面适配器的次要能力尚未实现：UIA 可访问性树、右键菜单语义、拖拽、滚轮/触控板手势、
  剪贴板、多窗口批处理会话编排（M2 契约内后续迭代项）。
- [ ] 故障演练尚未实现：断网、强杀恢复、账本损坏、封号、72h 失联、循环超限（`tests/fault/`，
  后续里程碑/阶段二）。
- [ ] Scout 的真实来源抓取与真实发送通道尚未实现（按产品边界：M3 只做 fixture 驱动、只起草不发送；
  真实发送必须由审批后的人工流程完成，留给后续里程碑/阶段二）。
- [ ] 经营域数据模型、30 条边界规则、控制台尚未实现（Phase 2）。
- [ ] IoT 适配器只有契约计划，无实现（Phase 2 stub）。
- [ ] 宣传片尚未产出（阶段二 P4）；阶段一以真实命令演示脚本
  `docs/demo-script.zh-CN.md` / `docs/demo-script.md` 替代。

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
- [x] “第一阶段发布平台”（GitHub public 仓库已发布；v0.5.0 Release 已创建）
- [ ] 正式商用联系方式（`COMMERCIAL.md` 占位）
- [ ] 是否在阶段一即产出预热短片（阶段一以真实命令演示脚本替代；正式宣传片计划阶段二 P4）
