# 项目简介（搜索关键词版） / Overview

> 代掌 Steward（Daizhang Steward）是一个**本地优先的 AI 公司操作系统（Local-first AI Company OS）**：用 AI 总控对话调度一支多智能体（AI Agents）团队，自动化完成真实工作，过程可见、产物可核对、人类只负责审批与签字。

## 它是什么（一句话）

**AI 公司 OS**：一句话下发目标 → AI 总控拆解/派发 → 多个 AI 员工（Agent）在独立上下文里自动执行（浏览器/桌面操作、编码、调研、财务、客户沟通、内容、报告）→ 产出真实文件/报告/数据 → 人类只审批危险动作。

## 适合谁 / 解决什么

- 想用 AI 自动化经营与办公的小团队/个人：**用 AI 员工替代重复劳动**；
- 需要「能真正执行」而不是只聊天的 AI：**真实浏览器/桌面自动化 + 真实文件产物 + 可审计**；
- 想要**本地部署、数据不出本机**的 AI 公司/自动化工作流；
- 需要多智能体协作（multi-agent orchestration）且不想被上下文污染：每个 Agent 独立工作区/独立记忆。

## 你可以用这些关键词找到本项目

### 中文
AI 公司、AI 公司系统、AI 公司操作系统、AI 操作系统、AI 自动化、自动化工作流、AI 员工、AI 团队、多智能体、多智能体协作、智能体团队、AI Agent、Agent 自动化、AI 总控、AI 调度、任务自动化、办公自动化、业务流程自动化、本地 AI、私有化 AI、AI 经营、AI 托管、数字员工、DeepSeek Harness、代掌、Steward。

### English
AI company, AI company OS, AI operating system, AI automation, workflow automation, AI agents, agentic workflow, multi-agent, multi-agent orchestration, autonomous agents, AI employee, AI workforce, AI orchestration, AI controller, local-first AI, private AI, self-hosted AI, business automation, office automation, digital worker, DeepSeek Harness, Steward.

## 关键词对应的实际功能（不是堆词）

| 关键词 | 对应功能 |
|---|---|
| AI 公司 / AI Company OS | 总览/项目/账本/审批/月报/接管等经营模块 + AI 总控 + AI 团队 |
| 多智能体 / Multi-Agent | 11 个角色：系统总控、项目总调度、办公执行、编码代理、客户沟通、财务、核查、后台运维、线索、内容、调研 |
| AI 自动化 / Automation | 发送即执行（无需手动开始）、真实浏览器/桌面操作、定时任务、自动化跑项目 |
| AI Agent / 智能体 | 每个 Agent 独立上下文/工作区，可点名发送任务，产物/报告回到对话 |
| AI 员工 / Digital Worker | `/agents` AI 团队页 + 点名发任务 + 独立记忆 |
| 本地 AI / Local-first | 只监听 127.0.0.1、数据仅本机、密钥不落仓库/不进 Harness |
| AI 总控 / AI Controller | `/chat` 对话式总控：自己查系统、自己干、危险动作只给审批卡 |
| DeepSeek Harness | 专项 Agent 直接运行本机 `dsh --profile headless --json` 真实代理 |
| 工作流自动化 / Workflow | 项目调度 → 拆解 → 派发 → 执行 → 核查 → 产出/报告 |

## 快速入口

- 控制台：`steward console --port 4180` → http://127.0.0.1:4180/chat
- 文档：[对话式总控](conversation.md) · [Harness 真实智能体](harness.md) · [配置中心](configuration.md) · [运行/自动执行](runtime.md)
