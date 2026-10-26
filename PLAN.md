# PLAN — current state and next work

_The current state only, not a log. Over ~200 lines: move finished entries to `docs/archive/PLAN-<date>.md` and leave a pointer._

## Current checkpoint (2026-10-26)

`main` = upstream `3dc8847` (0.3.8) + PR #151 + PRs #163, #157, #139, #127 + fork fixes; pushed to `origin` (private), head `d856cbf`.

- **Claude subscription backend works on Windows.** Dev server (`next dev`): Claude Code 2.1.302 detected (signed in, Pro, subscription auth); a Teach turn on `claude-haiku-4-5` returned a probe question. Packaged server (`dist/win-unpacked`, Electron's Node): two Teach turns; the second resumed the same CLI process (context 9.1k → 9.3k). Checked 2026-10-26 in the browser pane.
- **Windows installer builds.** `dist/LearnHarness-0.3.8-x64-setup.exe` (168 MB, unsigned), 2026-10-26, build command in `CLAUDE.md` § Desktop app. The window started its server and logged `auto-update: fork build — updater disabled`. The installer itself was not run (only `dist/win-unpacked/LearnHarness.exe`).
- **Checks, 2026-10-26:** `npx tsc --noEmit` clean. 41 related test files: 582/586 pass. `pdf-reader` + `file-access`: 26/26 after the #157 merge fixes. Remaining failures are Windows-only; see `GOTCHAS.md`.
- **Not verified:** practice flow, a full teach session past the probe, the background-use toggle, Sonnet/Opus models, installer install/uninstall.

## Next
1. Owner installs `dist/LearnHarness-0.3.8-x64-setup.exe` and uses it day to day. Done when a full Teach session runs from the Start-menu app.
2. Optional: try the FSRS review page from fork wangdepin/MasteryHarness (`9f0d8a7b`, adds `ts-fsrs`). Cherry-pick conflicts only in `src/core/index.ts` and `src/server/index.ts`, and the fork's tests haven't been run here. Needs the owner's go-ahead.
3. When upstream moves: `git fetch upstream && git merge upstream/main`, re-run typecheck + related tests, rebuild the installer. If #151 merges upstream, drop our copy.

## Later / ideas
- #142 (retry last reply): 4 conflicts. #150 (say tool): only if lessons collapse into one-line gists on the Claude path.
- Anki sync (AnkiConnect): nothing exists yet (upstream issues #11, #33).
- Make `tests/local-agents-*.test.ts` run on Windows (wrap the `.mjs` fakes in a `.cmd`/`.exe` launcher).
