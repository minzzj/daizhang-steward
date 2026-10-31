# Conversational Control & Memory (v1.5.1)

One entry controls everything: talk to the AI controller like ChatGPT — it queries the system itself, executes tasks itself, and shows thinking/tools/artifacts/reports/data inline in the conversation.

## Usage

Open `http://127.0.0.1:4180/chat` and just talk: "how is the system now?", "list recent runs", "where are the artifacts?", "show me the latest report", "how many tokens did this project use?", "build me a quotation page". Query intents are answered directly from the system (near-zero token cost); task intents execute automatically (small tasks via Harness agents, projects dispatched to specialists) with live thinking/tools/artifacts/reports/data. Humans only approve dangerous actions (delete program/plugin, payments, external sends, legal signing).

## What one entry can query / control

System (programs/plugins/services/logs/audit), runs/projects/steps/events, artifacts (preview/download), reports (markdown), metrics (tokens/tools/duration/steps/budget), config/models (masked), ledger/payments, agents/harness metadata.

## Memory

- Conversation history: multiple conversations (new/switch/rename/delete), persisted, restored on refresh/restart.
- Long-term memory: auto-extracted facts (preferences, project facts, decisions, run summaries, artifact refs); view/search/delete in the Memory panel; recalled automatically when relevant.
- Short-term context: recent messages + tool results, summarized beyond limits.
- Stored locally in `.steward/chat/` (gitignored).

## Data source

Real Harness runs and demo fixtures are both supported; the page shows `Data source: real/demo/mixed`; demo cards are labeled. Tests keep a mix of real samples and fake data.

## Cost control

Simple queries are answered by rule/query tools without model calls; only task intents use Harness agents, with per-step token/timeout caps (default 2M tokens/step). Actual token usage is shown per step.

## Safety

Dangerous actions require inline approval; the AI never signs/auto-pays/sends externally; local-only 127.0.0.1, write APIs require token; keys are never injected into Harness; all actions/approvals/tool calls are audited and recorded in the conversation.

## 7. Presentation rules (v1.5.2)

- By default only: **your input + collapsible thinking process + final result**;
- Expanded thinking shows: thinking chunks, tool calls (single merged card with status/duration/result preview), query data, memory references;
- Reports/artifacts are **deliverable cards** under the final result (max 3 shown; the rest collapsed);
- Approval cards and errors are **always visible** (never collapsed);
- Awaiting approval = paused (not failed); after approval the run continues and progress is pushed into the chat;
- Pure queries no longer create artifact/report-level memory noise.

## 8. Unified entry (v1.5.3)

- Conversation / dispatch / project delegation / approval have exactly one entry: **AI controller `/chat`**;
- `/system` is management-only (programs/plugins/models/tokens/logs) and no longer contains a second chat box;
- Legacy `/chat/:id` is a read-only run-detail (historical) page; use `/runs/:id` for the new run detail;
- System-page quick queries use `/chat?prompt=...`, which auto-sends the question and shows the final result.
