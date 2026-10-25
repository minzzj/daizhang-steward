# demo-web · 真实浏览器演示站（零依赖，离线可跑）

> 状态：M0 演示素材，用于 **A2 真实浏览器验收** 与 **M1 编码回路**（修复预置缺陷）。
> 本目录全部为本地前端 + Node 内置模块服务器，**不加载任何外网资源**（无 CDN、无外网字体、无图片文件、无第三方 npm 依赖）。

## 1. 目录结构

| 文件 | 说明 |
|---|---|
| `server.mjs` | 静态资源 + JSON API 服务器（`node:http` 内置模块，只监听 `127.0.0.1`，默认端口 `4173`） |
| `index.html` | 单页界面：登录视图 + 提交项目视图（登录成功后同页切换） |
| `app.js` | 页面逻辑（原生 JS；**包含故意保留的登录超时缺陷**） |
| `style.css` | 纯本地样式（系统字体，无外网资源） |
| `README.zh-CN.md` | 本文档：启动方式、演示路径、缺陷说明、验收方式 |

## 2. 环境要求

- Node.js ≥ 22.18（仓库 `engines` 要求；本演示只用 Node 内置模块，无需 `npm install`）。
- 可用的 Chromium / Edge 浏览器（给 M1 之后的 `tests/e2e-browser` 真实浏览器用例使用）。

## 3. 启动与停止

```bash
# 在 examples/demo-web 目录下
node server.mjs
# → http://127.0.0.1:4173/
```

可选参数：

```bash
node server.mjs --port 4180   # 指定端口
PORT=4180 node server.mjs     # 用环境变量指定端口（Windows PowerShell：$env:PORT=4180; node server.mjs）
node server.mjs --help        # 查看帮助
```

停止：在启动终端按 `Ctrl+C`。若端口被占用，服务器会打印 `端口 4173 已被占用` 并以非 0 退出码结束；请先停止占用进程或换端口，**不要**改动默认端口以外的仓库配置。

## 4. 演示路径（登录 → 提交项目）

1. 浏览器打开 `http://127.0.0.1:4173/`（等价路径：`/login`）。
2. 在「账号」「密码」输入任意非空内容（例如账号 `demo`、密码 `demo`），点击「登录」或按回车。
3. 正常登录请求在约 `300ms` 后返回，页面切换到「提交项目」表单（同页切换，不跳转）。
4. 填写「项目名称」（必填）与「备注」（可选），点击「创建项目」。
5. 页面显示绿色成功提示：`已提交：<项目名称>`；数据写入服务器内存（可通过 `GET /api/projects` 核对，重启服务器即清空）。
6. 「返回登录」可回到登录视图，便于重复演示。

页面关键选择器（供 `tests/e2e-browser` 使用 **真实点击/输入**，禁止 `page.route` 与假 DOM）：

| 选择器 | 元素 | 说明 |
|---|---|---|
| `#account` | 账号输入框 | 任意非空值 |
| `#password` | 密码输入框 | 任意非空值 |
| `#submit` | 登录按钮 | 提交后进入 loading：禁用且文案变为「登录中…」 |
| `#login-error` | 登录错误提示 | 默认 `hidden`；正常流程不显示 |
| `#login-status` | 登录状态文案 | loading 时显示「正在登录，请稍候…」 |
| `#project-name` | 项目名称输入框 | 必填 |
| `#project-note` | 备注文本域 | 可选 |
| `#create` | 创建项目按钮 | 提交后短暂禁用并显示「提交中…」 |
| `#project-result` | 提交结果 | 成功后文本为 `已提交：<项目名称>` |
| `#project-error` | 项目错误提示 | 项目名称为空时显示 |
| `#back-to-login` | 返回登录按钮 | 重置到登录视图 |
| `#slow-mode` | 慢网模拟复选框 | 勾选后登录请求带 `?timeout=1`（见第 6 节） |

## 5. HTTP API

| 方法 | 路径 | 成功 | 失败 | 说明 |
|---|---|---|---|---|
| GET | `/health` | `200` | — | 健康检查，返回 `ok/status/service/uptime_ms/projects` |
| POST | `/api/login` | `200` | `400` 缺字段 / `504` 慢网 | 正常 **300ms** 后返回 `{ ok: true, token, account }`；URL 带 `?timeout=1` 时 **4000ms** 后返回 `504` + `{ ok: false, error: "request_timeout", message: "请求超时，请重试" }` |
| POST | `/api/projects` | `200` | `400` 项目名称为空 | 请求体 `{ "name": string, "note": string }`；返回 `{ ok: true, project: { id, name, note, created_at } }`，写入内存 |
| GET | `/api/projects` | `200` | — | 返回内存中的项目列表 `{ ok: true, projects: [...] }`，便于自检核对 |

请求/响应示例（虚构数据）：

```json
// POST /api/login
{ "account": "demo", "password": "demo" }

// 200
{ "ok": true, "token": "demo-***", "account": "demo", "display_name": "demo" }

// POST /api/projects
{ "name": "示例客户官网改版", "note": "虚构演示数据" }

// 200
{ "ok": true, "project": { "id": "<uuid>", "name": "示例客户官网改版", "note": "虚构演示数据", "created_at": "<ISO 8601>" } }
```

> 说明：演示数据一律为**虚构**内容；服务器无鉴权、无持久化、只监听 `127.0.0.1`，仅限本地演示。

## 6. 慢网演示开关

服务端慢网模式由登录接口的 URL 参数触发：`POST /api/login?timeout=1` → 等待 **4000ms** 后返回 **504**。
页面提供两种触发方式（二者等价）：

1. 勾选登录表单中的「模拟网络慢」复选框（`#slow-mode`），再点「登录」；
2. 直接打开带查询参数的页面：`http://127.0.0.1:4173/login?timeout=1`（页面载入后复选框自动勾选）。

页面侧对登录请求使用 `AbortController`，在 **3000ms** 时主动中止（早于服务端的 4 秒返回）。正常产品逻辑应在中止后提示超时并恢复按钮；本演示站**故意没有实现**这段错误处理，见下一节。

## 7. ⚠️ 预置缺陷（故意保留，M1 编码回路修复目标）

- **文件**：`examples/demo-web/app.js`，登录表单 `submit` 监听函数中的 `catch` 分支（搜索注释「预置缺陷」）。
- **复现步骤**：
  1. `node server.mjs` 启动服务器；
  2. 浏览器打开 `http://127.0.0.1:4173/login?timeout=1`（或打开 `/` 后勾选 `#slow-mode`）；
  3. 在 `#account`、`#password` 输入任意非空内容；
  4. 点击 `#submit`（或按回车），等待 ≥ 4 秒。
- **实际（缺陷表现）**：
  - `#submit` 一直显示「登录中…」且保持 `disabled`，`#login-status` 一直显示「正在登录，请稍候…」；
  - `#login-error` 始终为 `hidden`，页面没有任何错误提示，也没有恢复可重试状态；
  - 只能刷新页面才能再次操作。
- **期望（修复后的正确行为）**：
  - 约 3 秒（客户端超时）后 `#login-error` 可见，文本包含「**请求超时，请重试**」；
  - `#submit` 恢复为「登录」且可点击，`#login-status` 清空，允许重新提交；
  - 不改动已有选择器、API 契约与正常登录/提交项目流程。
- **验收方式**：由 `tests/e2e-browser` 中的真实 Chromium/Edge（headed）用例验证——真实点击 `#submit`、真实等待、断言 `#submit` 的 disabled 状态与 `#login-error` 的可见性/文本，并逐步截图到 `runs/<id>/screenshots/`。
  **不得**用 `curl`/接口调用代替 UI 验收（`curl` 只能验证服务端 504 行为，不能证明页面提示）；**禁止** `page.route`、假 DOM、预录视频。
- **修复约束**：
  - 只改 `examples/demo-web/app.js` 中缺失的错误处理；不要删除 `#login-error` / `#submit` 等选择器；
  - 不要把缺陷或任何调试后门带入产品代码（`packages/`、`apps/`）；
  - 修复后缺陷消失属预期；如需再次演示缺陷，请从 git 历史取回本素材旧版本，不要在产品代码中复制。

## 8. 自检（不依赖浏览器 UI，验证服务端行为）

```bash
# 1. 启动服务器（另开一个终端或后台运行）
node server.mjs

# 2. 健康检查
curl -s http://127.0.0.1:4173/health

# 3. 正常登录（约 300ms 返回 200）
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" \
  -X POST -H "Content-Type: application/json" -d "{\"account\":\"demo\",\"password\":\"demo\"}" \
  http://127.0.0.1:4173/api/login

# 4. 慢网登录（约 4000ms 后返回 504）
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" \
  -X POST -H "Content-Type: application/json" -d "{\"account\":\"demo\",\"password\":\"demo\"}" \
  "http://127.0.0.1:4173/api/login?timeout=1"

# 5. 提交项目 + 核对内存列表
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"name\":\"示例项目\",\"note\":\"虚构数据\"}" http://127.0.0.1:4173/api/projects
curl -s http://127.0.0.1:4173/api/projects
```

> Windows 下没有 `curl` 时可用 `curl.exe`，或用 `Invoke-RestMethod`。以上接口自检**不能**替代第 7 节的真实浏览器 UI 验收。

## 9. 已知限制

- 数据仅存内存，服务器重启即清空；无鉴权、无 HTTPS、无并发保护，仅供本地演示。
- 只监听 `127.0.0.1`，不对外提供服务；端口默认 `4173`，被占用时请用 `--port` 指定。
- 界面为单页切换，不含验证码、真实身份校验；演示账号密码可任意填写。
- 冻结约定：`#account`、`#password`、`#submit`、`#project-name`、`#project-note`、`#create`、`#login-error`、`#project-result` 选择器与 API 路径/状态码在 M0 内保持稳定，供 `tests/e2e-browser` 与编码回路使用。
