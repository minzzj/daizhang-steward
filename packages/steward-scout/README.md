# @daizhang/steward-scout · 客户分支（Scout）核心模块

> 状态：**M3-A 已实现**（A7 验收：≥10 条来源可核的线索、3 条未发送草稿、全部待人工审批）。
> 契约见 [`docs/zh-CN/contracts.md` §4 Lead](../../docs/zh-CN/contracts.md)；运行时条款见
> [`prompts/scout.md`](../../prompts/scout.md)。**纯逻辑、零依赖、无网络**：所有“发送”类方法只记录状态，不真正外发。

## 1. 定位与职责

Scout 是「代掌 Steward」的**客户分支**：先写 ICP 与三个高价值场景，再对**只读公开来源**整理的线索做
来源硬校验 → 四因子评分 → 去重 → 起草外联（草稿）→ 进人工审批队列 → 产出 ScoutReport。

本模块只做**领域逻辑**（不抓页面、不调模型、不发请求）：

- `buildIcp()` / `listScenarios()`：ICP 与恰好 3 个高价值场景（先定方向，再找线索）；
- `scoreLead()` / `scoredLeads()` / `qualifiedLeads()`：四因子评分、来源硬校验、去重；
- `draftOutreach()` / `drafts()`：≤150 字符、引用具体 signal 片段、不冒充人类、不群发的草稿；
- `approvalQueue()` / `approve()` / `reject()`：默认全部 pending 的人工审批队列；
- `canSend()` / `markSent()`：**仅记录发送状态**的合规状态机（审批 + 每日每渠道限额 + 退订拦截）；
- `unsubscribe()` / `addReply()` / `addMeeting()`：退订与结果记录；
- `buildReport()`：数字与内部状态一致的 ScoutReport（周报/验收证据）。

```
packages/steward-scout/
├── src/
│   ├── types.ts        # 契约类型（Lead/ICP/Scenario/ScoredLead/OutreachDraft/ApprovalItem/ScoutReport）
│   ├── errors.ts       # ScoutComplianceError / ScoutValidationError（带 code）
│   ├── heuristics.ts   # 缺省评分启发式（纯函数）
│   ├── engine.ts       # ScoutEngine（评分/去重/起草/审批/频控/报告）
│   └── index.ts        # 唯一入口，re-export 全部公开 API
└── README.md
```

## 2. API 摘要

```ts
import {
  ScoutEngine, ScoutComplianceError, ScoutValidationError,
  DEFAULT_DAILY_LIMIT, DEFAULT_QUALIFIED_THRESHOLD,
  MAX_AUTO_DRAFTS, DRAFT_BODY_MAX_CHARS, DRAFT_SUBJECT_MAX_CHARS,
} from "../../packages/steward-scout/src/index.js";

const engine = new ScoutEngine({
  leads,                       // ScoutFixtureLead[]，必填
  now: () => new Date(),       // 可选：时钟注入（测试确定性）
  dailyPerChannelLimit: 10,    // 可选：每日每渠道上限，默认 10
  qualifiedThreshold: 0.5,     // 可选：合格阈值，默认 0.5
});
```

| 方法 | 说明 |
|---|---|
| `buildIcp(): ICP` | 理想客户画像（行业规模、痛点、预算、渠道、不合格项） |
| `listScenarios(): Scenario[]` | 恰好 3 个高价值场景（周报整理 / 客服重复录入 / 对账核对） |
| `scoreLead(lead): ScoredLead` | 四因子评分；显式字段优先，缺省走启发式；不合规线索 `qualified=false` |
| `scoredLeads(): ScoredLead[]` | 硬校验 + 去重后的评分结果（丢弃原因全部进 `rejected_reasons`） |
| `qualifiedLeads(): ScoredLead[]` | 合格线索，按 `fit_score` 降序 |
| `draftOutreach(lead): OutreachDraft` | 单条起草（同 `lead_id` 幂等）；正文 ≤150、引用 signal 片段 |
| `drafts(): OutreachDraft[]` | 仅合格线索、**最多 3 条**（A7） |
| `approvalQueue(): ApprovalItem[]` | 所有已起草条目，默认 `pending`；`approve/reject` 后反映人工决定 |
| `approve(lead_id, decided_by)` / `reject(lead_id, decided_by, reason?)` | 人工审批；记录 `decided_by`/`decided_at`（不发送） |
| `canSend(lead_id): boolean` | 已 approved 且未退订、未发送过 → true |
| `markSent(lead_id): void` | **只记录状态**：需已 approved、当日同渠道 < 上限、未退订、未重复发送，否则抛错 |
| `unsubscribe(lead_id, note?)` | 记录退订；此后 `canSend=false`，`markSent` 抛错 |
| `addReply(lead_id)` / `addMeeting(lead_id)` | 记录回复/会议（按线索去重计数） |
| `buildReport(): ScoutReport` | 报告；会物化 A7 的 3 条草稿，保证报告与草稿/审批队列一致 |

错误：`ScoutComplianceError`（合规拦截，**非重试类**，`code`: `NOT_APPROVED` / `UNSUBSCRIBED` /
`ALREADY_SENT` / `DAILY_LIMIT_EXCEEDED` / `DRAFT_LIMIT`）与 `ScoutValidationError`
（入参/状态非法，`code: INVALID_INPUT`）。CLI 可据此映射退出码与提示。

## 3. 评分口径（四因子加权，可复算）

```text
fit_score = 0.4 × need            // 需求强度
          + 0.2 × budget          // 预算/规模：low 0.3 / medium 0.6 / high 1；无 budget_range 时按 company_size
          + 0.2 × reachability    // 可触达性：显式优先，缺省 email 0.6 / platform_dm 0.7 / form 0.5
          + 0.2 × (1 − compliance_risk)  // 合规：显式优先，缺省按 consent_basis 质量
```

- `need`：显式 `needs_strength` 优先；缺省 = 0.3 + 长度（≤0.3）+ 关键词命中（`每周/每天/手动/麻烦/
  需要/求工具/自动化/重复/耗时/对账/报表/崩溃/加班/费时/人工`，每个 +0.08、封顶 +0.35）。
- 所有因子与 `fit_score` 均夹取到 `[0,1]`；`qualified = 无硬校验问题 && fit_score ≥ qualifiedThreshold`。
- 硬校验（任一不满足即丢弃并进 `rejected_reasons`）：缺 `lead_id`、`source_url` 缺失/非 http(s)、
  `signal` 为空、`consent_basis` 为空。
- 去重：`org + signal` 归一化（去首尾空白 → 小写 → 去空白/标点/符号）后相同只保留 `fit_score` 更高者，
  被丢弃条目计入 `leads_discarded` 与 `rejected_reasons`。
- **`status`（fixture 生命周期字段）不参与入库/评分判定**：`drafts()` 只按合格与分数选前 3 条。
  评分实现若与 fixture 文档的示例折算不同，以本模块重算结果为准（契约要求 `budget_range: low/medium/high → 0.3/0.6/1`）。

## 4. 起草与审批（草稿而非发送）

- 正文 ≤150 字符（Unicode 码点计，中文按 1 字）；标题 ≤30 字符。
- 正文必须引用 `signal` 的前 20–40 字（`cites_signal=true`）；无 `signal` 时抛 `ScoutValidationError`，**不编造**。
- 不出现“我是 AI/机器人”等冒充人类表述，不含“群发/批量”语义。若 `signal` 本身带此类话术，
  起草会自动缩短引用到安全前缀，绝不把违规话术复制进正文。
- 单条起草（`draftOutreach` 一次一条），没有群发接口。
- `drafts()` 自动起草仅取**合格线索的前 3 条**并进入审批队列（默认 all `pending`）；
  需要更多草稿时只能逐条 `draftOutreach()` 并逐条人工审批（仍受频控与合规约束）。
- `approve()` / `reject()` 必须传入人工 `decided_by`；模块**绝不自动 approve**。
  未 `approved` 的 `markSent()` 一律抛 `ScoutComplianceError(NOT_APPROVED)`。

## 5. 合规边界（产品底线，不随配置放宽）

1. **不自动发送**：`ScoutEngine` 无任何网络/IO 调用；`markSent` 只写内存状态。真实发送必须由
   审批后的人类流程（CLI/人工）执行，且不在本模块范围内。
2. **人类审批**：默认 `pending`；审批人 `decided_by` 必填并留痕（`decided_at`）。
3. **每日每渠道 ≤10**（`dailyPerChannelLimit`，按 UTC 日 + channel 计数）：超限抛
   `DAILY_LIMIT_EXCEEDED`；次日额度恢复。
4. **退订即停止**：`unsubscribe` 后该线索永久 `canSend=false`，`markSent` 抛 `UNSUBSCRIBED`，
   不做任何渠道例外。
5. **不重复骚扰**：同一线索 `markSent` 只能成功一次（`ALREADY_SENT`）。
6. **不冒充人类、不群发、不伪造来源**：见第 4 节；无来源/无合规依据的线索直接丢弃，不补造。
7. 线索只来自公开且允许的来源；真实运行时仍须遵守 robots / ToS，不抓登录后页面、不购买名单。

## 6. ScoutReport（周报 / 验收证据）

| 字段 | 说明 |
|---|---|
| `generated_at` | 生成时间（`now()` 注入，ISO） |
| `icp` / `scenarios` | 画像与恰好 3 个场景 |
| `leads_total` | 输入 fixture 总数 |
| `leads_discarded` | 丢弃数（= `rejected_reasons.length`，含重复去重） |
| `qualified_count` | 去重后合格线索数 |
| `drafts_count` | 已起草条数（正常流程 = 3；= `approvalQueue().length`） |
| `pending_approval` | 待人工审批数 |
| `sent_count` | 已记录发送数（**不是真实外发**；默认 0） |
| `replies` / `meetings` | 回复/会议线索数（按线索去重） |
| `rejected_reasons` | `{ lead_id?, reason }[]`：缺来源/非法 URL/空依据/重复等留证 |
| `channels` | 每渠道 `{ drafts, sent }`（按草稿与发送记录统计） |
| `daily_limit_per_channel` | 当前每日每渠道上限（默认 10） |

## 7. CLI 集成建议（`steward scout --json`）

CLI 侧只装配与写证据，合规判定全部交给引擎；**不要**在 CLI 里再写一套评分/发送逻辑：

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ScoutEngine,
  type ScoutFixtureLead,
} from "../../packages/steward-scout/src/index.js";

// 1) 读 fixture（examples/scout-fixtures/leads.json；真实使用时换成已核来源的线索）
const leads = JSON.parse(
  readFileSync("examples/scout-fixtures/leads.json", "utf8"),
) as ScoutFixtureLead[];

// 2) 构造引擎：默认阈值 0.5、每日每渠道 10；无需网络与外部服务
const engine = new ScoutEngine({ leads });

// 3) 生成报告与待审材料（全部为内存状态；不发送、不联网）
const report = engine.buildReport(); // 内部物化 A7 的 3 条草稿
const scored = engine.scoredLeads(); // 14 - 4（丢弃/去重）= 10 条
const drafts = engine.drafts();      // 3 条，status="drafted"
const queue = engine.approvalQueue();// 3 条，status="pending"

// 4) 写入本次 run 的证据目录（示例；实际用 ArtifactBus/run 目录）
const dir = join("runs", runId);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "scout-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
writeFileSync(join(dir, "leads-scored.json"), JSON.stringify(scored, null, 2) + "\n", "utf8");
writeFileSync(join(dir, "drafts.json"), JSON.stringify(drafts, null, 2) + "\n", "utf8");
writeFileSync(join(dir, "approval-queue.json"), JSON.stringify(queue, null, 2) + "\n", "utf8");
// 另按仓库既有约定写 scout-report.md（四段式）与 events.jsonl

// 5) `steward scout --json` 输出（供 acceptance 脚本读取）
// console.log(JSON.stringify({ ok: true, runId, artifacts: { dir } }));
```

`examples/scout-fixtures/leads.json`（14 条虚构线索）驱动下，引擎应给出：
`leads_total=14`、`leads_discarded=4`（缺来源/非法 URL/空依据/重复各 1）、`qualified_count=8`、
`drafts_count=3`、`pending_approval=3`、`sent_count=0`、`scenarios.length=3`。

审批动作由**人类命令**触发（不属于自动流程）：

```ts
const [item] = engine.approvalQueue();
engine.approve(item.lead_id, "human:cli"); // 留痕，不发送
engine.markSent(item.lead_id);             // 只记录状态：已批准 + 未超每日每渠道 10 + 未退订
engine.unsubscribe(item.lead_id, "客户回复退订"); // 之后 canSend=false，markSent 抛错
```

CLI 建议把 `ScoutComplianceError.code` 映射为明确的拒绝提示（而不是重试）：

```ts
try {
  engine.markSent(leadId);
} catch (error) {
  if (error instanceof ScoutComplianceError) {
    console.error(`合规拦截 [${error.code}]：${error.message}`); // NOT_APPROVED / UNSUBSCRIBED / ...
  } else throw error;
}
```

## 8. 测试

```bash
npm run build                                  # tsc（本包随 packages/*/src 一起编译到 dist/）
node --test tests/unit/scout.test.mjs          # 21 条，全绿
node --test "tests/unit/*.test.mjs"            # 全量套件（含既有 53 条）
```

测试全部使用**内存 fixture**（不读 `examples/`、不写仓库 `runs/`、无网络）：
ICP/三场景、四因子权重与范围、缺来源/非法 URL/空依据丢弃、去重保高分、合格阈值、
起草 ≤150 字符且引用 signal、subject ≤30、不冒充人类/不群发、默认 pending 且未批准不可发送、
第 11 条频控被拒（次日恢复）、退订拦截、报告计数一致、`markSent` 无网络调用、构造参数校验。

## 9. 已知限制

- 评分是**启发式**（关键词/长度/规模/渠道），不是语义模型判断；真实运行时按 `prompts/scout.md`
  仍需给出评分理由与证据。阈值可用 `qualifiedThreshold` 按客户场景校准。
- 频控按 **UTC 日期**分组；需要本地时区口径时由上层注入 `now()` 或扩展该字段（报告字段只增不减）。
- 起草模板是固定中文文案（单条、含退订提示），不支持多语言/多模板；个性化由上层扩展草稿后再审批。
- 本模块不负责抓取、留证截图与事件流写入（由 CLI/核心 runtime 负责）；`markSent` 之后真实外发
  仍必须由人工审批流程完成。
