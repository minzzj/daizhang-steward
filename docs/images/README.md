# 截图规范 / Screenshot Rules

- 截图必须由 **E2E 自动生成**（真实浏览器/真实桌面），禁止手截、重绘、生成式伪造。
- 默认浏览器视口 1280×800；桌面截图为目标窗口。
- 发布用截图在**中性路径**重新生成，不得出现：
  - 本机绝对路径（用户目录、外接盘符等）、用户名；
  - 聊天软件/Todo 列表、内网地址、真实个人隐私；
  - 任何密钥、Token、二维码。
- 每张截图配场景说明（哪个验收、哪一步、预期看到什么）。
- 文件命名：`<验收编号>-<场景>-<步骤>.png`，如 `A2-demo-web-login-03-submitted.png`。
- 封面/宣传片素材从这里的真实截图取用，不另做“漂亮版”UI。

_当前存放发布验证截图（`repo-home-2026-10-25.png`、`ci-actions-2026-10-25.png`）；
各里程碑的真实 E2E 截图为更好地归档与脱敏，保存在 `docs/test-evidence/`：_
- _M1：`evidence-m1-<stamp>/`（A2/A4/A5 三组，真实浏览器截图）；_
- _M2：`evidence-m2-<stamp>/A3-desktop-flow/`（20 张真实 Windows 桌面截图）；_
- _M3：Scout 以 JSON/日志证据为主（`evidence-m3-<stamp>/scout-run/`），无 UI 截图；_
- _M4：`evidence-m4-<stamp>/`（A10 dummy 分支运行产物；发布就绪检查）；_
- _P1：`evidence-p1-<stamp>/console-e2e/screenshots/`（本地 Web 控制台 9 张真实浏览器截图）+
  `console-cli/`（CLI 启动控制台的看板/账本截图）；_
_本目录只保留发布/文档用截图；演示录屏请按 `docs/demo-script.zh-CN.md` / `docs/demo-script.md` 用真实命令生成。_
