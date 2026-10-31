# SEO / 搜索关键词地图 — 代掌 Steward

> 目的：让外部用户通过搜索「AI 公司 / AI 自动化 / 智能体 / Agent / 多智能体 / 工作流自动化」等关键词找到本项目。
> 本文关键词均对应真实功能（见 `docs/zh-CN/overview.md`），不是堆词。

## 建议的 GitHub 仓库 About 描述

中文：
> 本地优先的 AI 公司操作系统（AI Company OS）：AI 总控对话 + 多智能体（AI Agents）自动化执行真实工作，产物/报告/审批可追溯，人类只签字。Local-first AI company OS with AI controller + multi-agent automation.

English：
> Local-first AI Company OS: a conversational AI controller dispatches multi-agent AI employees to automate real work (browser/desktop, coding, research, finance, reports) with visible thinking, artifacts and approvals. Chinese + English.

## 建议的 GitHub Topics

```
ai ai-company ai-agents ai-os agent agents autonomous-agents multi-agent
multi-agent-orchestration ai-automation automation workflow-automation
agentic-workflow ai-employee digital-worker local-first-ai private-ai
self-hosted-ai deepseek deepseek-harness llm ai-orchestration chinese-ai
daizhang steward
```

## 中文关键词 → 功能

| 关键词 | 对应功能 |
|---|---|
| AI 公司 / AI 公司系统 / AI 操作系统 / AI OS | 总览、项目调度、账本、审批、月报、接管 + AI 总控 + AI 团队 |
| AI 自动化 / 自动化工作流 / 工作流自动化 | 发送即执行（无需手动开始）、自动跑项目、真实浏览器/桌面操作、定时任务 |
| AI 员工 / AI 团队 / 数字员工 | `/agents` 11 个角色组成的 AI 团队，可点名发任务 |
| 多智能体 / 多智能体协作 / 智能体团队 / 智能体 | 系统总控/项目总调度/办公执行/编码代理/客户沟通/财务/核查/后台运维/线索/内容/调研 |
| AI Agent / Agent 自动化 | 每个 Agent 独立工作区/独立上下文，可点名发送，产物/报告回流对话 |
| AI 总控 / AI 调度 / 任务自动化 | `/chat` 一个入口：自己查系统、自己干、危险动作只给审批卡 |
| 本地 AI / 私有化 AI / 自托管 AI | 只监听 127.0.0.1；数据仅本机；密钥不进仓库、不注入 Harness |
| DeepSeek Harness | 专项 Agent 直接运行本机 `dsh --profile headless --json` 真实代理（思考/工具/产物/报告） |
| 办公自动化 / 业务流程自动化 | 办公执行（浏览器/文件/文档）、后台运维、财务对账、客户沟通草稿、内容创作 |

## English keywords → features

| Keyword | Feature |
|---|---|
| AI company / AI company OS / AI operating system | dashboard, project dispatch, ledger, approvals, monthly report, takeover + AI controller + AI team |
| AI automation / workflow automation / business automation | send-to-execute auto-run, real browser/desktop operations, scheduled tasks |
| AI agents / agentic workflow / multi-agent / autonomous agents | 11-role agent team with isolated contexts, named dispatch, artifacts/reports |
| AI employee / AI workforce / digital worker | `/agents` team page + named tasks + isolated memory |
| AI controller / AI orchestration | `/chat` self-querying, self-executing controller; risky actions require human approval |
| local-first AI / private AI / self-hosted AI | 127.0.0.1 only; data stays local; keys never committed/injected |
| DeepSeek Harness / LLM | specialist agents run local `dsh --profile headless --json` |
| office automation / digital worker | operator (browser/files/docs), backend, finance, customer comms, content |

## 发布时同步更新的位置

1. GitHub 仓库 About 描述 + Topics（API/网页均可）；
2. `README.md` / `README.zh-CN.md` 顶部关键词区块；
3. `docs/zh-CN/overview.md` / `docs/en/overview.md`（完整关键词页）；
4. 控制台页面 `<meta name="description"/>` + `<meta name="keywords"/>`；
5. Release Notes 中保留关键词段落。
