# 3-Minute Demo Script (v0.5.0)

> A 3-minute walkthrough of **代掌 Steward** phase-1 v0.5.0: real browser, real Windows desktop, the harness
> code loop, the Scout customer branch and the reviewable evidence system. Runs **fully offline**: no paid
> API, no real external network, nothing is ever sent.
> 中文版见 [`demo-script.zh-CN.md`](demo-script.zh-CN.md)。

## Prerequisites

- Node.js ≥ 22.18 + npm; repo already `npm install`-ed and `npm run build`-ed (below, `steward` means
  `node dist/apps/cli/src/index.js`).
- The browser shot needs a local Chrome or Edge installation (a headed window will really open).
- The desktop shot needs a **real interactive Windows desktop session** + Python ≥ 3.8. If your recording
  environment has no interactive desktop (RDP disconnected / headless CI), **skip 1:45–2:10** and show the
  20 archived real-desktop screenshots under
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/` instead.
- Recording setup: terminal font ≥ 16pt, window at least 1280×720; clean the old `runs/` folder first so the
  audience sees a fresh run directory; turn notifications off.
- Every artifact lands in `runs/<run-id>/` (gitignored); the published evidence index lives in
  `docs/test-evidence/`.

## Shot list

| Time | Shot | Command | Expected visible output / evidence | Narration (one line) | Budget |
|---|---|---|---|---|---|
| 0:00–0:10 | Cold open | `steward version` | `steward 0.5.0 (node v…)` | Steward is an evidence-first, composable operating-AI core; today: phase-1 v0.5.0. | 10s |
| 0:10–0:40 | Offline kernel loop (A1/A6) | `npm run demo` | new `runs/<run-id>/` with `prompt.md`, `report.md`, hash-chained `events.jsonl`; exit 0 | No network, no paid API — plan → act → observe → reflect → report works end-to-end. | 30s |
| 0:40–1:10 | Real browser (A2) | `steward browser-flow` | a real headed Chrome/Edge window performs login → submit → verify; `runs/<run-id>/e2e/normal/screenshots/001…007` | Every UI step is a real browser action with a screenshot as evidence. | 30s |
| 1:10–1:45 | Harness code loop (A4) | `steward code-loop` | `patch.diff`, `test.log`, `code-loop-result.json`, e2e `login-timeout` red→green (round 1) | A failing run becomes a reproducible CodeTask; the patch is applied in an isolated worktree and re-verified in a real browser. | 35s |
| 1:45–2:10 | Real desktop (A3, local) | `steward desktop-flow` | a real Windows window goes open → fill → save → validate; `e2e-desktop/screenshots/` 20 step screenshots + `result.json` | Real window + real mouse/keyboard (SendInput), not an API mock; fall back to archived screenshots when no desktop is available. | 25s |
| 2:10–2:35 | Scout customer branch (A7) | `steward scout --json` | `14 leads → 4 discarded → 8 qualified → 3 drafts`; `approval-queue.json` all `pending`, `sent_count=0` | Scout only drafts: everything waits in the human approval queue, 0 auto-sends. | 25s |
| 2:35–3:00 | Evidence & wrap-up | optional `npm test`; open `docs/test-evidence/`, `docs/RELEASE_NOTES_v0.5.0.md` | 80/80 tests pass; M0–M3 acceptance evidence index; release notes and good first issues | Every claim is backed by openable in-repo evidence; next is phase-2 personal-edition MVP. | 25s |

> Extra shots for longer cuts: `steward safety-check --json` (A8/A9 — stop key ≤5s, checkpoint resume,
> branch isolation) and `steward dummy-branch --json` (A10 — a new read-only branch via config + an existing
> prompt, no core change).

## Shot details

### 0:00–0:10 Cold open
- Command: `steward version`
- Expected: `steward 0.5.0 (node vXX.XX.X)`
- Narration: Steward is an evidence-first, composable operating-AI core; this is the phase-1 v0.5.0 walkthrough.
- Tip: put a title banner "Phase 1 · v0.5.0" in the corner.

### 0:10–0:40 Offline kernel loop (A1/A6)
- Command: `npm run demo`
- Expected: `run <run-id> … ok`; the terminal prints `runs/<run-id>/`; exit code 0.
- Camera: open `runs/<run-id>/report.md` and `events.jsonl`, point at `seq` and the hash chain.
- Narration: MockHarness makes the kernel runnable without a paid API, with evidence at every step.

### 0:40–1:10 Real browser (A2)
- Command: `steward browser-flow`
- Expected: a real browser window opens and drives demo-web; the terminal prints the run directory;
  screenshots land in `runs/<run-id>/e2e/normal/screenshots/001-open-login-page.png … 007-assert-project-submitted.png`.
- Narration: real headed Chromium/Chrome with real clicks and typing — not a mocked DOM.
- Tip: place the browser window next to the terminal so both are visible at once.

### 1:10–1:45 Harness code loop (A4)
- Command: `steward code-loop`
- Expected: `code-task.json`, `patch.diff`, `test.log`, `code-loop-result.json`; four screenshots under
  `e2e/login-timeout/`; the summary shows red→green on round 1.
- Camera: show `patch.diff` briefly, then the red→green result.
- Narration: a failure becomes a reproducible CodeTask; the patch is applied in an isolated worktree and
  re-verified with a real browser; more than two rounds escalates to a human.

### 1:45–2:10 Real desktop (A3, local)
- Command: `steward desktop-flow` (real interactive Windows desktop; requires Python ≥ 3.8)
- Expected: a real window goes open → fill → save → validate;
  `runs/<run-id>/e2e-desktop/screenshots/001…020` + `result.json` (36/36 checks);
  `e2e-desktop/project.json` holds the actually saved form content.
- Fallback: skip this shot and show
  `docs/test-evidence/evidence-m2-2026-10-25_10-50-51/A3-desktop-flow/`.
- Narration: real Windows windows + real mouse/keyboard (SendInput) + real screenshots, with an
  allowlist that denies everything else by default.

### 2:10–2:35 Scout customer branch (A7)
- Command: `steward scout --json`
- Expected: `14 leads → 4 discarded → 8 qualified → 3 drafts`; `scout-report.json`, `drafts.json`
  (110–113 chars, `cites_signal=true`), `approval-queue.json` (all three `pending`),
  `outreach-drafts/lead-001|004|006.md`.
- Camera: zoom in on `approval-queue.json`, emphasise `"sent_count": 0` and all `pending`.
- Narration: Scout only drafts — every message needs human approval, at most 10 per channel per day,
  unsubscribe is honoured, and the module performs zero network I/O.

### 2:35–3:00 Evidence & wrap-up
- Command (optional): `npm test` → show **80/80** passing; then open `docs/test-evidence/`
  (M0 test-result, M1/M2/M3 acceptance evidence index), `docs/RELEASE_NOTES_v0.5.0.md` and
  `docs/good-first-issues.md`.
- Narration: every acceptance claim has openable in-repo evidence; phase 1 is complete and phase 2
  (personal-edition MVP) is next.
- End card: https://github.com/minzzj/daizhang-steward

## Recording & publishing tips

1. Rehearse once end-to-end — `browser-flow` / `code-loop` open a real browser and take 1–2 minutes each.
2. Record the desktop shot separately and edit it in; do not touch the real mouse/keyboard while it runs.
3. Link `docs/RELEASE_NOTES_v0.5.0.md` and `docs/test-evidence/` in the video description.
4. For a silent version, drop the narration and keep subtitles. Never show real personal data or local
   absolute paths on screen.

_Last updated: 2026-10-25 (v0.5.0 release). / 最后更新：2026-10-25（v0.5.0 发布）。_
