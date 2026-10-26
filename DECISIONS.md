# DECISIONS (append-only)

_Supersede an entry by adding a new one that references it; never edit old entries. Add every entry to the index._

## Index
- D-001 — 2026-10-26 — Claude via the local Claude Code CLI (upstream PR #151), not an API key or OAuth token
- D-002 — 2026-10-26 — Pull upstream PRs #163, #157, #139, #127; skip the rest for now
- D-003 — 2026-10-26 — Fork builds never auto-update from upstream
- D-004 — 2026-10-26 — Orchestrator setup: lh-investigator, lh-implementer, lh-checker
- D-005 — 2026-10-26 — Add the FSRS review page from fork wangdepin/MasteryHarness

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
