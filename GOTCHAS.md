# GOTCHAS

_Repeatable, non-obvious traps only. Each: symptom / cause / avoidance / verification._

## `npm test` fails immediately on Windows
- Symptom: `'NODE_ENV' is not recognized` or similar from `npm test`.
- Cause: the script uses POSIX env syntax and npm runs scripts in cmd.exe.
- Avoid: from Git Bash, `NODE_ENV=test npx tsx --test tests/<file>.test.ts`.
- Verify: the run prints `ℹ tests N`.

## Windows-only test failures
- Symptom: the full suite gives 15 failures (2026-11-08, v0.5.0 merge; 14 before it). The 15th: `learner-image-snapshots.test.ts` "uses the shared sensitive-path guard…" (`no such file` instead of `Access denied` for an alias path). `verify-release.test.ts` (6) and `data-dir-seam.test.ts` (1) fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`; `auth-store.test.ts`, `chatgpt-auth.test.ts` and `subscription-auth.test.ts` (2) fail owner-only file-mode assertions; `automatic-updates.test.ts` (1) fails a POSIX path assertion. In `claude-code-stream.test.ts`, "cwd is an empty temp dir…" (file mode 438 vs 0o600) and "normal completion escalates termination…" (`SIGTERM` vs `SIGKILL`) fail; the first stops before its workspace assertions run.
- Cause: POSIX file modes, paths and signals don't hold on Windows, and a Windows absolute path passed to a child's `import()` isn't a `file://` URL. All 15 also fail on plain upstream v0.5.0 (2026-11-08 run in a temp worktree).
- Avoid: don't chase them unless that code changes. Run the full suite with quoted globs, `NODE_ENV=test npx tsx --test "tests/*.test.ts" "tests/*.test.tsx"`: unquoted, Git Bash expands them past Windows' command-line limit (`The command line is too long`). Don't edit source while it runs; a test file that loads the edited module mid-run fails for that reason.
- Verify: same failures on `main` before and after a change.

## `next build` while `next dev` is running
- Symptom: a broken or half-written `.next`, or a dev server that dies mid-build.
- Cause: both use `.next`.
- Avoid: stop the dev server (`preview_stop`) before the installer build.
- Verify: the build log ends `EXIT=0`.

## Packaged window's API rejects curl
- Symptom: requests to the `.exe`'s server (random port in `main.log`) fail authorization.
- Cause: the window passes a per-launch `x-learnharness-desktop` secret (`src/server/desktop-access.ts`).
- Avoid: test the packaged server headless instead (`CLAUDE.md` § Desktop app), without `LH_DESKTOP_SERVER`.
- Verify: `curl localhost:3123/api/claude-code` returns the status.

## Browser-pane clicks on settings controls don't register
- Symptom: coordinate/ref clicks on "Set up your models", the model dropdowns or Connect do nothing.
- Cause: seen while the pane was hidden or another overlay had focus; not reproduced as an app bug.
- Avoid: use `find` refs with the pane visible, or copy `data/settings.json`.
- Verify: `GET /api/claude-code` shows the expected status.

## `npm ci` while `next dev` runs half-deletes `node_modules`
- Symptom: `npm error EPERM ... unlink ... lightningcss.win32-x64-msvc.node`; afterwards `npx tsc` fetches the bogus `tsc@2.0.4` package because `node_modules/.bin/tsc` is gone.
- Cause: the dev server holds native `.node` files open; Windows refuses to delete them mid-`npm ci`.
- Avoid: `preview_stop` the dev server (and close the packaged app) before `npm ci`; use `npx --no-install` so a missing binary fails instead of downloading.
- Verify: `npm ci` exits 0 and `npx --no-install tsc --noEmit` runs.

## Tool-call records keep the model's raw arguments
- Symptom: code reading `problem.target` from a chat record finds names like `"Limit of a sequence"` instead of ids `n_…` (seen live on `claude-code`).
- Cause: a tool's `prepareArguments` (e.g. name→id normalization in `src/agent/tools/practice.ts`) shapes only the executed call in pi-agent-core; the stored assistant message keeps what the model sent.
- Avoid: readers of records resolve targets themselves (`resolveTargetId` in `src/core/chains.ts`), as `src/core/review.ts` does.
- Verify: `tests/review.test.ts` "a target recorded by proposition NAME resolves to its id".

## Teach sessions don't build the graph for a while
- Symptom: after several Teach turns `GET /api/graph` still has no nodes and no extraction job appears.
- Cause: auto-extraction fires at turn end only once the uncovered teacher prose (assistant text + `send_to_user`, chars/4) reaches `graph.extractionChunkTokens` (default 4096, `src/core/settings.ts`). Probe questions, learner text and tool results don't count. Same on every provider.
- Avoid: press the manual Extract (`POST /api/graph/coverage/extract {"chatId":…}`) or lower the setting (`PLAN.md` § Next).
- Verify: the graph fills ~1–2 min after the trigger.

## `claude -p` processes don't share the prompt cache by default
- Symptom: every turn on `claude-code` re-writes the whole conversation to cache (a new process's first call reads only ~9k, the system prompt + tools).
- Cause: Claude Code puts its session id and its cwd into the prompt; a random id or a fresh temp folder per process changes the prompt text early, and nothing after it matches. Also, the app renders the last message differently once it becomes history, so the previous turn's own breakpoint never lines up.
- Avoid: keep `--session-id` (derived from the chat key) and the fixed working folder in `src/agent/claude-code/stream.ts`, and the `cache_control` on the last history block in `transcript.ts`. Experiments: two processes, same input → fixed id + fixed folder read 11,356; either one random → read 0.
- Verify: in a chat record, a later turn's first call has `cacheRead` ≫ 9k and a small `cacheWrite`.

## Claude desktop redirects AppData for everything it starts
- Symptom: the Start-menu app shows "Add a provider key" and Claude as "Connect" while `%APPDATA%\LearnHarness\data` read from a session says enabled; `main.log` seems frozen although the app is running.
- Cause: Claude desktop is an MSIX app. Processes it starts write `%APPDATA%` into `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming`, and session tools see those files over the real ones. An app opened from Explorer uses the real folder, a separate profile. Shadowed real files can't be read from a session.
- Avoid: 2026-11-08 the stale copy was renamed to `LearnHarness.bak-2026-11-08` (same Roaming folder), so `%APPDATA%\LearnHarness` read from a session is the real profile again. Keep it that way: never write under it from a session or launch LearnHarness from one; if reads look stale, check whether the Packages copy came back. Launch the app or installer with `explorer.exe <path>` to run outside the container (`/S` can't be passed that way).
- Verify: `logs\main.log` read from a session shows the owner's latest launch, and `...\LocalCache\Roaming\LearnHarness` does not exist.

## Claude Code's usage line arrives after `message_stop`
- Symptom: the plan-usage badge never appears; `/api/claude-code/usage` stays `{"claude-code":null}` after a turn that made no tool calls.
- Cause: on 2.1.314 `rate_limit_event` comes after the last `message_stop`, just before `result`. Closing the run at `message_stop` killed the child before that line was read.
- Avoid: a clean end in `src/agent/claude-code/stream.ts` finishes the reply but leaves the child up until `result` (3 s fallback).
- Verify: the stream-level test in `tests/claude-code-stream.test.ts`; the usage JSON is filled right after a one-reply turn.

## A `claude-code` turn can end with only hidden thinking
- Symptom: PROBING stays on screen with an empty "Agent's thinking", no reply and no error; no CLI process is running. The record has one empty `thinking` block and `stopReason: "stop"`.
- Cause: not proven; the failing stream wasn't captured. Seen on 2 of 5 Haiku 5.5 medium turns with the message `test`. Claude Code sends thinking with empty deltas, so nothing shows while it thinks, and `stream.ts` keeps text blocks, so the model probably stopped without replying.
- Avoid: `ClaudeTurn.finish` fails such a turn with a visible error when the learner spoke last. After tool results, a silent end stays normal.
- Verify: `tests/claude-code-stream.test.ts` "thinking alone after a learner message".

## `tests/jobs.test.ts` never exits
- Symptom: a test run containing it hangs past any timeout with no failure in the log; the file reports `fail 1` only when killed, while all 56 subtests pass. A leftover run can keep node processes alive into the next session.
- Cause: not traced; something keeps the process open after the last test. Same with the 2026-11-01 cap fix stashed, on the 0.4.1 port. Windows-only or not is unknown.
- Avoid: pass `--test-force-exit` (the full suite then finishes in about 3.5 minutes), or run the file alone under `timeout 60` and read the subtest counts.
- Verify: `NODE_ENV=test timeout 60 npx tsx --test tests/jobs.test.ts` shows `pass 56`, exit 124.
