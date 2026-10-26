# PLAN — current state and next work

_The current state only, not a log. Over ~200 lines: move finished entries to `docs/archive/PLAN-<date>.md` and leave a pointer._

## Current checkpoint (2026-10-26)

`main` = upstream `3dc8847` (0.3.8) + PR #151 + PRs #163, #157, #139, #127 + the MasteryHarness FSRS review page (`87a6e5a`, D-005) + fork fixes; pushed to `origin` (private), head `be5d453`.

- **Claude subscription backend works on Windows.** Dev server (`next dev`): Claude Code 2.1.302 detected (signed in, Pro, subscription auth); a Teach turn on `claude-haiku-4-5` returned a probe question. Packaged server (`dist/win-unpacked`, Electron's Node): two Teach turns; the second resumed the same CLI process (context 9.1k → 9.3k). Checked 2026-10-26 in the browser pane.
- **Windows installer builds and installs.** `dist/LearnHarness-0.3.8-x64-setup.exe` rebuilt 2026-10-26 from `be5d453` (build command in `CLAUDE.md` § Desktop app), installed silently (`/S`, exit 0) to `%LOCALAPPDATA%\Programs\learnharness` with a Start-menu shortcut. Launched from the shortcut: server up, `auto-update: fork build — updater disabled`, and no update check (fix `c7445a4`: the old build still queried GitHub and logged `update check failed: 404`). `%APPDATA%\LearnHarness\data` seeded with the dev `settings.json` + `local-agents.json` (claude-code on, Haiku 4.5 on all slots); not yet confirmed in the window.
- **Checks, 2026-10-26:** `npx tsc --noEmit` clean. 41 related test files: 582/586 pass. `pdf-reader` + `file-access`: 26/26 after the #157 merge fixes. Remaining failures are Windows-only; see `GOTCHAS.md`.
- **FSRS review page works (2026-10-26).** Live on `claude-code` Haiku 4.5 in the dev server: a Teach session (5 learner messages, then the manual Extract) gave 5 propositions; a 1-problem Practice session concluded `solved`; `/review` listed "Limit of a sequence" under Upcoming, due in 2 days (stability 2.3). Needed fix `cc4b0ad` (targets recorded by name; see `GOTCHAS.md`). Tests: `review` 52/52, `review-events` 30/30, `render-review` 19/19, `practice-record` 36/36, `render-sidebar` 15/15; `npx tsc --noEmit` clean.
- **Duplicate probe-handoff divider fixed** (`c240262`, `components/session-core.ts`): the view showed a server marker twice (React duplicate key `steer_probe_<chatId>`) until the idle sync. `session-core` 84/84 (the 2 new tests fail without the fix). Not re-checked live. Not fixed upstream as of 2026-10-26.
- **Not verified:** the Hard/re-check review paths live (unit tests only), a node reaching Due now, practice past one problem, a full teach session to its end, the background-use toggle, Sonnet/Opus models, a turn in the installed app, uninstall. `automatic-updates` 28/29 (the failure is upstream's POSIX-path assertion, fails on upstream's `main.cjs` too).

## Next
1. Owner uses the installed app (Start menu → LearnHarness). Done when a full Teach session runs there.
2. Owner choice: Teach sessions extract to the graph automatically only after ~4096 tokens of teacher prose (`GOTCHAS.md`). Options: lower `graph.extractionChunkTokens` in Settings (min 500), change the default in `src/core/settings.ts`, add a trigger at `probe_done`/session end, or keep it and use the manual Extract.
3. When upstream moves: `git fetch upstream && git merge upstream/main`, re-run typecheck + related tests, rebuild the installer. If #151 merges upstream, drop our copy.

## Later / ideas
- #142 (retry last reply): 4 conflicts. #150 (say tool): only if lessons collapse into one-line gists on the Claude path.
- Anki sync (AnkiConnect): nothing exists yet (upstream issues #11, #33).
- Make `tests/local-agents-*.test.ts` run on Windows (wrap the `.mjs` fakes in a `.cmd`/`.exe` launcher).
