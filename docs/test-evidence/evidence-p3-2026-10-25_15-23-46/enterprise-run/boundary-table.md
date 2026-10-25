# 30 条边界规则双模式标注表（个人 / 企业）

> 由 `packages/steward-enterprise` 的 `boundaryRules30()` 生成：每条规则在个人、企业两种模式都标注「已实现 / 人工 / 不适用」。
> 四类重点越界（EB-01 无证业务、EB-02 借用资质、EB-03 陌生外呼、EB-04 超预算）在个人 + 企业两种模式都 **deny**，理由可读并留痕。

| 规则 | 触发 | 必须行为 | 用户文案 | 模式 | 个人 | 企业 | 测试 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EB-01 | 无证业务：requires_license=true，或请求涉及无证/资质不全仍要接单 | deny（拒绝） | 该业务需要经营资质，个人/企业模式下均不承接无证业务。已拒绝；请先取得对应资质，或改做无需资质的业务线。 | 双模式 | 已实现 | 已实现 | EB-01-no-license | tests/unit/enterprise.test.mjs#EB-01 |
| EB-02 | 借用资质：借用/挂靠/租用他人营业执照、资质证书或许可证 | deny（拒绝） | 借用、挂靠或租用他人资质接单属于违法经营，个人/企业模式都拒绝。请以自己或授权主体的真实资质开展业务。 | 双模式 | 已实现 | 已实现 | EB-02-borrowed-license | tests/unit/enterprise.test.mjs#EB-02 |
| EB-03 | 陌生外呼/陌生名单触达（is_unknown_outreach=true，或 outreach 含陌生名单/群发意图） | deny（拒绝） | 陌生外呼、购买名单与群发触达属于骚扰与高风险行为，个人/企业模式都拒绝。只允许对明确同意的客户触达，且需人工确认。 | 双模式 | 已实现 | 已实现 | EB-03-unknown-outreach | tests/unit/enterprise.test.mjs#EB-03 |
| EB-04 | 超预算：请求金额超过当前预算/委托额度 | deny（拒绝） | 该请求金额超出预算，已拒绝并留痕。如确需继续，请先由负责人调整预算或改为分期小额方案。 | 双模式 | 已实现 | 已实现 | EB-04-over-budget | tests/unit/enterprise.test.mjs#EB-04 |
| EB-05 | 代实名/刷单/刷评/水军/冒用身份等违规操作 | deny（拒绝） | 代实名、刷单刷评、水军或冒用身份属于违规甚至违法行为，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-05-identity-fraud | tests/unit/enterprise.test.mjs#EB-05 |
| EB-06 | 垫资/垫付/借贷/贷款/过桥等资金风险行为 | deny（拒绝） | 垫资、借贷或对外融资不在代理授权范围内，个人/企业模式都拒绝。资金安排请由主体负责人本人处理。 | 双模式 | 已实现 | 已实现 | EB-06-funds | tests/unit/enterprise.test.mjs#EB-06 |
| EB-07 | 未授权对外承诺（无对话原文与委托/授权条款支撑） | deny（拒绝） | 该承诺没有可追溯的对话原文与授权条款，属未授权承诺，已拒绝。请先由授权人确认后再记录承诺。 | 双模式 | 已实现 | 已实现 | EB-07-unauthorized-promise | tests/unit/enterprise.test.mjs#EB-07 |
| EB-08 | 虚开发票/阴阳合同/发票内容与实际不符 | deny（拒绝） | 虚开发票、阴阳合同与票实不符属于严重涉税违法，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-08-invoice-fraud | tests/unit/enterprise.test.mjs#EB-08 |
| EB-09 | 企业业务走私账/个人账户收企业款（主体与收款账户不一致） | deny（拒绝） | 企业业务必须走对公账户：个人账户收企业款会造成主体/收款不一致，个人/企业模式都拒绝。 | 双模式 | 已实现 | 已实现 | EB-09-private-account | tests/unit/enterprise.test.mjs#EB-09 |
| EB-10 | 商业贿赂/回扣/返点/好处费 | deny（拒绝） | 回扣、返点、好处费等商业贿赂行为违法，个人/企业模式都拒绝并留痕。 | 双模式 | 已实现 | 已实现 | EB-10-bribery | tests/unit/enterprise.test.mjs#EB-10 |
| EB-11 | 社保挂靠/代缴社保（无真实劳动关系） | deny（拒绝） | 无真实劳动关系的社保挂靠/代缴属违规，个人/企业模式都拒绝。用工必须依法建立劳动关系。 | 双模式 | 已实现 | 已实现 | EB-11-social-insurance | tests/unit/enterprise.test.mjs#EB-11 |
| EB-12 | 虚假宣传/保过承诺/绝对化用语 | deny（拒绝） | 保过、包过、绝对有效等虚假宣传违反广告法，个人/企业模式都拒绝。只能提供可核验的真实能力说明。 | 双模式 | 已实现 | 已实现 | EB-12-false-advertising | tests/unit/enterprise.test.mjs#EB-12 |
| EB-13 | 绕过平台规则/风控/验证，或抓取登录后页面 | deny（拒绝） | 绕过平台规则、风控或抓取登录后页面属于违规，个人/企业模式都拒绝。只做公开允许范围内的只读操作。 | 双模式 | 已实现 | 已实现 | EB-13-platform-bypass | tests/unit/enterprise.test.mjs#EB-13 |
| EB-14 | 超出登记经营范围的业务（out_of_scope=true 或明确超出经营范围） | deny（拒绝） | 该业务超出主体登记经营范围，已拒绝。请先依法变更经营范围，或转人工评估合规路径。 | 企业 | 不适用 | 已实现 | EB-14-out-of-scope | tests/unit/enterprise.test.mjs#EB-14 |
| EB-15 | 验证码/2FA/人脸/指纹等身份验证环节 | human（转人工） | 验证码、2FA、人脸/指纹验证必须由本人完成，AI 一律停下交人（不代过、不留存凭据）。 | 双模式 | 人工 | 人工 | EB-15-captcha | tests/unit/enterprise.test.mjs#EB-15 |
| EB-16 | 合同签署/盖章/用印（AI 不代签） | human（转人工） | 合同签署与盖章必须由本人完成；AI 只生成待签草案并定位签署页，不代签。已转人工处理。 | 双模式 | 人工 | 人工 | EB-16-seal | tests/unit/enterprise.test.mjs#EB-16 |
| EB-17 | 支付/退款/转账/大额资金动作 | human（转人工） | 支付、退款与转账必须由授权人本人在审批卡确认后执行，AI 不直接发起资金动作。已生成待办。 | 双模式 | 人工 | 人工 | EB-17-payment | tests/unit/enterprise.test.mjs#EB-17 |
| EB-18 | 账号权限/密码/管理员/授权登录/改绑 | human（转人工） | 账号权限、密码与管理操作必须由本人在受控环境完成，AI 不代管。已转人工处理。 | 双模式 | 人工 | 人工 | EB-18-account | tests/unit/enterprise.test.mjs#EB-18 |
| EB-19 | 导出客户名单/个人信息等隐私数据 | human（转人工） | 导出客户名单或个人信息涉及隐私合规，需本人确认用途与授权后处理。已转人工。 | 双模式 | 人工 | 人工 | EB-19-privacy | tests/unit/enterprise.test.mjs#EB-19 |
| EB-20 | 客户投诉/纠纷/维权/仲裁/诉讼 | human（转人工） | 客户投诉、纠纷与维权事项超出代理权限，已停下交人处理。请本人先沟通并留存证据。 | 双模式 | 人工 | 人工 | EB-20-complaint | tests/unit/enterprise.test.mjs#EB-20 |
| EB-21 | 税务申报/纳税申报提交（只出草稿，人确认提交） | human（转人工） | 税务申报只能生成草稿，必须由财务/负责人核对后在税务系统确认提交；AI 不自动申报。 | 双模式 | 人工 | 人工 | EB-21-tax-filing | tests/unit/enterprise.test.mjs#EB-21 |
| EB-22 | 增值税专用发票开具（需企业主体、对公账户与人工确认） | human（转人工） | 增值税专票开具需核对抬头、税号、合同一致并人工确认提交；AI 只生成草稿，不自动开票。 | 企业 | 不适用 | 人工 | EB-22-special-invoice | tests/unit/enterprise.test.mjs#EB-22 |
| EB-23 | 收款账户/对公账户变更（双人复核） | human（转人工） | 收款账户变更必须由两位不同角色复核批准后生效；AI 不自动变更账户。 | 企业 | 不适用 | 人工 | EB-23-account-change | tests/unit/enterprise.test.mjs#EB-23 |
| EB-24 | 组织级审批链（金额达到/超过组织阈值） | human（转人工） | 达到组织阈值的大额事项必须走组织级审批链（负责人/财务/法人），AI 只提交待审批，不越级执行。 | 企业 | 不适用 | 已实现 | EB-24-approval-chain | tests/unit/enterprise.test.mjs#EB-24 |
| EB-25 | 多代理/多账号并发操作（必须串行） | human（转人工） | 多代理/多账号必须串行操作，避免并发冲突与越权；AI 自动串行排队，跨账号动作转人工确认。 | 企业 | 不适用 | 已实现 | EB-25-multi-agent-serial | tests/unit/enterprise.test.mjs#EB-25 |
| EB-26 | 用工/劳务派遣/外包用工 | human（转人工） | 用工、劳务派遣与外包用工涉及劳动关系与派遣资质，必须转人工依法处理；AI 不代为招工或签约。 | 双模式 | 人工 | 人工 | EB-26-employment | tests/unit/enterprise.test.mjs#EB-26 |
| EB-27 | 资质代办/许可证代办/资质借用通道 | human（转人工） | 资质与许可证代办需人工审核合法路径与主体资格，AI 不代为承诺办证结果。已转人工。 | 双模式 | 人工 | 人工 | EB-27-qualification-agent | tests/unit/enterprise.test.mjs#EB-27 |
| EB-28 | 跨境支付/外汇/境外收款/结汇购汇 | human（转人工） | 跨境支付与外汇结算受外汇管理监管，必须由人工按合规路径办理；AI 不发起跨境资金动作。 | 双模式 | 人工 | 人工 | EB-28-cross-border | tests/unit/enterprise.test.mjs#EB-28 |
| EB-29 | 数据出境/敏感个人信息处理 | human（转人工） | 数据出境与敏感个人信息处理需做合规评估并取得授权，必须转人工处理；AI 不擅自传输。 | 双模式 | 人工 | 人工 | EB-29-data-export | tests/unit/enterprise.test.mjs#EB-29 |
| EB-30 | 对外报价/外联触达/私信/邮件（只出草稿） | draft_only（仅草稿） | 对外报价与触达只生成草稿，需本人确认收件人与内容后再发送；AI 不自动报价、不群发。 | 双模式 | 已实现 | 已实现 | EB-30-quote-draft | tests/unit/enterprise.test.mjs#EB-30 |

