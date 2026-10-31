# v1.5.6 发布说明 / Release Notes — 名称与功能对齐 + 搜索关键词（引流）

> 发布日期：2026-10-31 · 版本：v1.5.6 · 基线：v1.5.5

## 1. 名称与功能对齐（不改项目名）

项目名仍是 **代掌 Steward**；把"功能和名字不匹配"的地方统一改名：

| 位置 | 旧名称 | 新名称 | 理由 |
|---|---|---|---|
| 左侧导航 `/chat` | 对话 | **AI 总控** | 它实际是调度 AI 公司的总控对话，不只是聊天 |
| 左侧导航 `/system` | 系统 | **系统管理** | 该页只做程序/插件/模型/日志管理（去重后无对话） |
| 左侧导航 `/agents` | 智能体 | **AI 团队** | 11 个 AI 员工/智能体（Agent）组成的团队 |
| 左侧导航 `/projects` | 项目 | **项目调度** | 该页是项目调度/时间线，不只是项目列表 |
| `/chat` 页面标题 | 对话 | **AI 总控** | 与功能一致 |
| `/agents` 页面标题 | 智能体中心 | **AI 团队（智能体中心）** | 同时保留"智能体/Agent"关键词 |
| 顶栏 | 本地控制台 | **AI 公司总控台** | 产品定位是 AI 公司操作系统 |
| 品牌副标 | LOCAL CONSOLE | **LOCAL AI COMPANY OS** | 对外定位更准确 |
| `/chat` 空态 | 开始新的对话 | **开始新的对话 · 调度你的 AI 公司** | 说明这个入口能做什么 |

## 2. 搜索关键词 / 引流（文档 + 仓库元数据）

### 2.1 文档内关键词（便于搜索引擎/GitHub 搜索）
- 新增 `docs/zh-CN/overview.md`、`docs/en/overview.md`：**项目简介（关键词版）**，包含中文/英文关键词表与"关键词→真实功能"对照，明确覆盖：
  - 中文：**AI 公司、AI 公司系统、AI 操作系统、AI 自动化、自动化工作流、AI 员工、AI 团队、多智能体、智能体团队、AI Agent、Agent 自动化、AI 总控、任务自动化、办公自动化、本地 AI、数字员工、DeepSeek Harness、代掌**
  - English：**AI company, AI company OS, AI operating system, AI automation, workflow automation, AI agents, agentic workflow, multi-agent, autonomous agents, AI employee, AI workforce, AI orchestration, local-first AI, self-hosted AI, business automation, digital worker, DeepSeek Harness, Steward**
- `README.md` / `README.zh-CN.md` 顶部新增**一句话定位 + 搜索关键词**区块；
- `docs/SEO.md`：关键词地图、建议的仓库 About/描述与 GitHub Topics；
- 控制台页面新增 `<meta name="description">` / `<meta name="keywords">`（含上述关键词）。

### 2.2 仓库元数据（需你在 GitHub 上生效）
本次通过 GitHub API 更新：
- 仓库 **About 描述**：本地优先 AI 公司操作系统 / AI Company OS，AI 总控 + 多智能体 Agent 自动化、产物/报告/审批、DeepSeek Harness；
- **GitHub Topics**：`ai` `ai-company` `ai-agents` `agent` `agents` `autonomous-agents` `multi-agent` `multi-agent-orchestration` `ai-automation` `automation` `workflow-automation` `agentic-workflow` `ai-employee` `digital-worker` `local-first-ai` `private-ai` `self-hosted-ai` `deepseek` `deepseek-harness` `llm` `ai-orchestration` `chinese-ai` `daizhang` `steward` `ai-os`。

## 3. 测试与证据（无截图）

- 单元测试：**414/414 通过**（无功能回归）。
- 全量回归 E2E：**38/38 步、415/415 检查、截图 0、退出码 0**。
- 对话 E2E：**10/10 步、42/42 检查、截图 0、退出码 0**。
- 证据：`docs/test-evidence/evidence-v15.6/`。

## 4. 兼容性

- 项目/版本名不变（代掌 Steward），仅页面/导航文案与文档元数据更新；URL 不变。
- 版本 1.5.6；控制台 health 返回 `1.5.6`。
