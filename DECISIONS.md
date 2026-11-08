# DECISIONS (append-only)

_Supersede an entry by adding a new one that references it; never edit old entries. Add every entry to the index._

## Index
- D-001 — 2026-10-26 — Claude via the local Claude Code CLI (upstream PR #151), not an API key or OAuth token
- D-002 — 2026-10-26 — Pull upstream PRs #163, #157, #139, #127; skip the rest for now
- D-003 — 2026-10-26 — Fork builds never auto-update from upstream
- D-004 — 2026-10-26 — Orchestrator setup: lh-investigator, lh-implementer, lh-checker
- D-005 — 2026-10-26 — Add the FSRS review page from fork wangdepin/MasteryHarness
- D-006 — 2026-10-26 — Plan usage from Claude Code's stream, shown next to the model picker
- D-007 — 2026-10-31 — Proposed: replace our #151 copy with upstream's `claude-code` provider plus a fork patch
- D-008 — 2026-10-31 — Web search through Tavily
- D-009 — 2026-10-31 — Accept D-007: upstream's `claude-code` provider plus fork patches
- D-010 — 2026-11-01 — Hold unanswered questions 55 minutes; fixes to D-009's consequences
- D-011 — 2026-11-01 — Lesson-text guard, chat usage share, answering while scrolled up
- D-012 — 2026-11-02 — Fixes from the review of the guard, chat share and research cap
- D-013 — 2026-11-08 — Upstream v0.5.0: take its #157, keep the lesson-text gate beside its narration guard

## D-001 — 2026-10-26 — Claude via the local Claude Code CLI (upstream PR #151), not an API key or OAuth token
Status: accepted
Decision: Base the fork on upstream PR #151 (pdomenico, `feat/local-agent-connections`), which spawns the installed `claude -p` with stream-json and exposes app tools through a loopback MCP server. Fork fix: also look for the native `claude.exe` inside an npm install of Claude Code (`src/agent/local-agents/claude.ts` `knownDirs`).
Rationale: Anthropic's support article says `claude -p` and the Agent SDK draw from plan limits. The Agent SDK docs forbid third-party apps offering claude.ai login. So rejected: pi-ai's Anthropic OAuth and `claude setup-token` (the app itself would hold claude.ai credentials). Also rejected: PR #94 (ACP adapters: needs a separate adapter install, conflicts with upstream, 85 files); writing our own adapter (duplicates #151).
Evidence: PR https://github.com/amosblomqvist/learnharness/pull/151; commits `f07238c`, `42a60e3`; live test in `PLAN.md` checkpoint.

## D-002 — 2026-10-26 — Pull upstream PRs #163, #157, #139, #127; skip the rest for now
Status: accepted
Decision: Merge #163 (exclude superseded compaction summaries), #157 (limit tutor file access), #139 (input column), #127 (question auto-collapse setting). For #157's conflict in `src/agent/subagents/pdf-reader.ts`, keep the PR's path guard and upstream's resolved-path results.
Rationale: Small, low-risk gains for a Pro-plan, Windows, Claude-only setup. Skipped: provider-specific PRs (#130, #131, #161, #165), Electron sign-in (#152), #156 i18n (14 conflicts), #142 (4 conflicts, deferred), #159 (already in upstream main as `769fc85`).
Evidence: merges `fe64b0a`, `49a3c1e`, `0c62e81`, `ebc67d1`; fixes `6c673fb`, `441ac95`.

## D-003 — 2026-10-26 — Fork builds never auto-update from upstream
Status: accepted
Decision: `setupAutoUpdater` in `electron/main.cjs` returns early (status "disabled") unless `LH_UPDATE_FEED` is set. `electron-builder.yml` `publish.owner` is `JoKunGz007`.
Rationale: Upstream releases lack the Claude connection; an auto-update would silently replace the fork. A private repo can't serve anonymous update downloads, so the fork has no feed of its own. Updating means rebuilding from the fork.
Evidence: `d856cbf`; `%APPDATA%\LearnHarness\logs\main.log` line "auto-update: fork build — updater disabled".

## D-004 — 2026-10-26 — Orchestrator setup: lh-investigator, lh-implementer, lh-checker
Status: accepted
Decision: `.claude/agents/lh-investigator.md` (session model, read-only), `lh-implementer.md` (Sonnet, `maxTurns: 60`), `lh-checker.md` (Sonnet, browser pane, edits nothing). Routing is in `CLAUDE.md` § Working as orchestrator.
Rationale: Heavy reads (upstream PRs, test output) and browser checks fill the main context. On a Pro plan, subagents draw the same limits, so the routine roles use Sonnet. Measured in claude-usage D-024 / PLAN step 12.
Evidence: `42a60e3`; `D:\Projects\claude-usage\DECISIONS.md` D-024.

## D-005 — 2026-10-26 — Add the FSRS review page from fork wangdepin/MasteryHarness
Status: accepted
Decision: Cherry-pick `9f0d8a7b` (FSRS-6 via `ts-fsrs`; `/review`, `GET /api/review`; state derived from practice `conclude` events, nothing stored). Barrel conflicts resolved by keeping ours and adding only the review exports (the fork's code-exercise/Python exports are not in this commit). Fork fix `cc4b0ad`: `reviewPayload` resolves recorded target names to ids.
Rationale: Upstream has no spaced repetition (parked in `docs/architecture.md`); this is self-contained and read-only. Cost: one more change to carry on upstream syncs.
Evidence: `87a6e5a`, `cc4b0ad`; design in `docs/review-plan.md`; live check in `PLAN.md` checkpoint.

## D-006 — 2026-10-26 — Plan usage from Claude Code's stream, shown next to the model picker
Status: accepted
Decision: Read the 5-hour and weekly utilization from the `rate_limit_event` line `claude -p` emits each turn (`rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`), keep the latest in memory (`src/agent/local-agents/plan-usage.ts`), serve it at `GET /api/connections/local/usage`, and show `5h N% · 7d N%` before the model picker (`components/plan-usage-badge.tsx`), coloured as the cache-timer mod does (green < 50, amber < 80, red ≥ 80; `#7FB77E` / `#E0A04A` / `#E0664A`). Hover gives reset times and the reading's age. Owner choices: placement, both windows, the cache-timer colours.
Rationale: No token handling, no extra calls: the CLI already reports it. Rejected: the undocumented `api/oauth/usage` endpoint with the CLI token (breaks D-001: the app would hold a claude.ai token); reading the cache-band mod's `usage.json` (only fresh while an interactive Claude Code session runs; LearnHarness's CLI runs load no plugins).
Consequences: The fields are undocumented: a CLI change hides the badge, nothing breaks. In memory only: empty after an app restart until the first turn. Account-wide (includes Claude Code and claude.ai use).
Evidence: `b857678`; `tests/plan-usage.test.ts`, `tests/render-plan-usage.test.tsx`; live dev-server turn showed `5h 31% · 7d 57%`.

## D-007 — 2026-10-31 — Proposed: replace our #151 copy with upstream's `claude-code` provider plus a fork patch
Status: proposed (owner agreed in principle, timing open: after the 1 Nov exam, or earlier in a separate worktree). Would supersede the #151 part of D-001, not its subscription-only rule.
Decision: Take upstream 0.4.1's `src/agent/claude-code/` and drop `src/agent/local-agents/`, porting the fork's fixes. Upstream shipped this provider itself; #151 remains open but unmerged.
Rationale: Keeping our copy means patching ~10 sites on every sync, and a clean merge leaves two `claude-code` catalog rows (`src/server/model-catalog.ts`), two settings UIs and our provider gated behind upstream's opt-in. Upstream's MCP bridge is also stricter. Upstream's PDF import, folder import and source organization are the reason to move.
Port to upstream's provider (it does not have these):
- Subscription-only env scrub. Upstream leaves ambient `ANTHROPIC_API_KEY` in place; `docs/claude-code.md` disclaims subscription-only use.
- `--setting-sources ""`. Upstream uses `user`, which probably loads the owner's plugins and `~/.claude/CLAUDE.md`; check with a canary.
- Windows lookup: `LH_CLAUDE_BIN` and the npm `node_modules` path. Upstream finds no binary on this machine.
- Prompt-cache fix `2dea6ab`, plan-usage badge `b857678` (D-006), `DISABLE_AUTO_COMPACT`, `MAX_MCP_OUTPUT_TOKENS`.
Merge notes (7 conflicts): `docs/architecture.md` take theirs and re-home the review section; `src/agent/models.ts` and `src/server/model-catalog.ts` take theirs, dropping local-agent branches; `src/agent/subscription-stream.ts` keep the capture import, drop the local import; `src/agent/tools/fs-shared.ts` combine anchor with `~`; `src/agent/tools/read.ts` use `createReadTool` and re-add `guardSourcePath` or #157 is bypassed; `src/server/index.ts` keep both. Survive unchanged: FSRS page, `c240262`, updater off, `publish.owner`. PRs #163, #157, #139, #127 stay (all open, none superseded).
Owner's calls still open: drop Antigravity (recommended unless used); keep `auth status` display and `allowBackgroundUse` (keep the latter only if background extraction runs on `claude-code`); model ids, aliases vs pinned (recommended pinned; either way existing `claude-*-5-5` settings need a migration, upstream offers only `opus`/`sonnet`/`haiku`).
Consequences: Work in a git worktree (e.g. `D:\Projects\learnharness-0.4`) with its own `.next`/`dist`. Run `dist/win-unpacked`, not the installer, with `LH_DATA_DIR` and `LH_AUTH_FILE` on a test folder. Estimate: one conflict pass, 150–250 LOC port, rebuild, Haiku live check.
Evidence: `git merge-tree` of `main` and `upstream/main` (`e69e852`), code reading and `docs/claude-code.md`, 2026-10-31. No typecheck, tests or live run of upstream's provider.

## D-008 — 2026-10-31 — Web search through Tavily
Status: accepted
Decision: Use a Tavily key (owner's, saved in the Start-menu app's Settings) for the researcher's `web_search`. No Brave key; Deepgram left unset.
Rationale: `--tools ""` turns off Claude Code's own search, so a search key is the only route. Tavily's free plan is 1,000 credits a month with no card; most sources say Brave now needs a card, with about $5 monthly credit (not confirmed on Brave's own page). The one independent benchmark found (AIMultiple, December 2025) put Brave about 1 point ahead, which doesn't outweigh that at personal volume.
Consequences: Basic searches, about 1,000 a month. `src/server/search.ts` prefers Tavily if both keys exist.
Evidence: live Teach turn in the installed app, 2026-10-31: `web_search` ran, 6 sources.

## D-009 — 2026-10-31 — Accept D-007: upstream's `claude-code` provider plus fork patches
Status: accepted (on branch `port/upstream-0.4.1`, merge `134d384`; not yet in `main`). Supersedes D-007 and the #151 part of D-001; D-001's subscription-only rule stands.
Decision: Owner chose to start before the 1 Nov exam, on a separate branch and worktree. Owner's four calls: drop Antigravity; pinned model ids (the 14 pi-ai Anthropic ids, no `opus`/`sonnet`/`haiku` aliases), so saved `claude-*-5-5` settings need no migration; keep the `auth status` display; keep `allowBackgroundUse`, now `settings.claudeCode.allowBackgroundUse` (absent = on).
Rationale: as D-007. Pinned ids stop a model changing under a saved setting.
Consequences: fork patches are marked `Fork:` in `src/agent/claude-code/`, `src/server/claude-code*.ts`, `components/settings/claude-code-status.tsx`. Changes from the old build: MCP tool timeout is upstream's 30 minutes (was 24 hours; a longer-held question gets a fresh process that replays it); old `local-agents.json` is not read; re-enabling background use doesn't wake parked follow-ups; the per-slot "Enable background use" button is gone.
Evidence: `PLAN.md` § Current checkpoint.

## D-010 — 2026-11-01 — Hold unanswered questions 55 minutes; fixes to D-009's consequences
Status: accepted. Corrects D-009: its "30 minutes" was wrong; retention was upstream's 10 minutes (`LIVE_PROCESS_IDLE_TIMEOUT_MS`).
Decision: Owner chose 55 minutes of retention, with `MCP_TOOL_TIMEOUT` raised to 60 to outlast it. Code review of the port also: `allowBackgroundUse` is one gate in `subscription-connections.ts`, enforced at dispatch in `src/agent/models.ts` so it covers helper agents; toggling it fires `onSubscriptionChange`, so parked follow-ups wake; thinking `off` passes no `--effort` and sets `MAX_THINKING_TOKENS=0`, as the old build did.
Rationale: past the history's 1-hour prompt cache a held process saves almost nothing, so 24 hours (the old build) only adds idle processes; inside the hour, a held process avoids a replay's cache rewrite.
Consequences: one idle CLI process per waiting chat, for up to 55 minutes; memory not measured. A steer to a disabled `claude-code` now gets the 403 rather than the 503. Cache and timeout numbers not measured live.
Evidence: `tests/claude-code-gate.test.ts`, `tests/claude-code-stream.test.ts`.

## D-011 — 2026-11-01 — Lesson-text guard, chat usage share, answering while scrolled up
Status: accepted (owner's choices, 2026-11-01).
Decision: Guard: teacher only, once the plan exists, a `check` quiz or `ask_user_question` with no lesson text since the learner's last input is refused once; a second try passes; `predict` is exempt. Usage: the badge adds this chat's estimated share, counting only requests in the current 5-hour window, background jobs included. Scrolled up: the answer field stays usable, a multiple-choice question becomes a collapsible row above it, and Return with nothing selected doesn't submit.
Rationale: Refusing once keeps a turn from looping or hanging, at the cost of a rare bare question getting through. Planning questions need no lesson. A window-only share is comparable with the 5h figure.
Consequences: All `claude-code` cache writes are priced at 2× (the 1-hour rate) because the stream reports only a total; only `claude-code:` models count. `explain` questions aren't guarded.
Evidence: `tests/lesson-text-gate.test.ts`, `tests/chat-share.test.ts`, `tests/render-cards.test.tsx`.

## D-012 — 2026-11-02 — Fixes from the review of the guard, chat share and research cap
Status: accepted (owner asked for all findings fixed, 2026-11-02). Narrows D-011's question-text repair. Applies to the turn-cap fix `8423ea6`.
Decision: Over-escaped question text is repaired only when the string has a code fence. `claude-code` subagent runs stop at `maxTurns × MAX_SLICES_PER_CALL` (4) messages as well as at `maxTurns` real calls. The chat share's price table in `src/core/chat-share.ts` stays, as a recorded exception to the "no copied pricing table" note in `src/core/prices.ts`. The badge takes a chat's jobs from the chat view instead of polling.
Rationale: A literal `\n` on one line can be the question's own (`print("a\nb")`); a fence can't sit on one line, so it marks the fault. No usage must not mean no cap. `DOLLARS_PER_PCT` was fitted against those rates, so catalog prices would change the scale.
Consequences: Over-escaped text with no fence shows a raw `\n`. A job averaging over 4 parallel calls per request can stop early; the failed job averaged 3. The table can go stale when prices change. Job delivery no longer moves `updatedAt`, so a job counts at its last worker write.
Evidence: `1a997ae`; `tests/subagent-turn-cap.test.ts`, `tests/question-core.test.ts`, `tests/job-delivery-recovery.test.ts`, `tests/plan-usage-jobs.test.tsx`, `tests/question-dock-keyboard.test.tsx`.

## D-013 — 2026-11-08 — Upstream v0.5.0: take its #157, keep the lesson-text gate beside its narration guard
Status: accepted (owner approved the merge plan, 2026-11-08). Extends D-009 and D-011.
Decision: Upstream's finished #157 folder restrictions replace our early merge of the PR (saved shape becomes `{restricted, folders}`). Our lesson-text gate (D-011) stays; `teacher-agent.ts` runs one `beforeToolCall` that calls the gate first, then upstream's narration guard (#434), and keeps the guard's `afterToolCall`. `stream.ts` keeps `--setting-sources ""` and the env scrub, and adds upstream's `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. Upstream tests that expect `--setting-sources user` or unscrubbed `ANTHROPIC_*` variables are changed to the fork's values.
Rationale: Our #157 side was the PR head, an ancestor of upstream's version. The narration guard only fires on a thinking signature containing "narration", which the `claude-code` stream never sets, so it cannot replace the gate there; a plain merge let our hook overwrite upstream's. The memory switch costs nothing: measured, `--setting-sources ""` already kept `CLAUDE.md` out, and a new process read the whole prefix from cache.
Consequences: An old `{folders}` setting would load as unrestricted (neither profile had one). #163/#139/#127 stay fork-only until upstream merges them.
Evidence: `7c35625`, `33a942d`; `tests/lesson-text-gate.test.ts` (chain test fails without the guard call); full suite 2026-11-08 (`PLAN.md` § Current checkpoint).
