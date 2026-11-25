# GOTCHAS

_Repeatable, non-obvious traps only. Each: symptom / cause / avoidance / verification._

## `npm test` fails immediately on Windows
- Symptom: `'NODE_ENV' is not recognized` or similar from `npm test`.
- Cause: the script uses POSIX env syntax and npm runs scripts in cmd.exe.
- Avoid: from Git Bash, `NODE_ENV=test npx tsx --test tests/<file>.test.ts`.
- Verify: the run prints `ℹ tests N`.

## Windows-only test failures
- Symptom: the full suite gives 15 failures (2026-11-08, v0.5.0 merge; 14 before it). The 15th: `learner-image-snapshots.test.ts` "uses the shared sensitive-path guard…" (`no such file` instead of `Access denied` for an alias path). `verify-release.test.ts` (6) and `data-dir-seam.test.ts` (1) fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`; `auth-store.test.ts`, `chatgpt-auth.test.ts` and `subscription-auth.test.ts` (2) fail owner-only file-mode assertions; `automatic-updates.test.ts` (1) fails a POSIX path assertion. In `claude-code-stream.test.ts`, "cwd is an empty temp dir…" (file mode 438 vs 0o600) and "normal completion escalates termination…" (`SIGTERM` vs `SIGKILL`) fail; the first stops before its workspace assertions run.
- 2026-11-14, v0.6.1 merge: 28 failures. New on top of the 15: `appearance-chrome` (1) and `desktop-platform` (1) path separators; `code-ligatures` (1), `plugin-api-reference` (1) and probably `themes` (1) CRLF; `session-identity` (4) `mkdtemp` under an undefined home; `plugin-install-local` (1) quoting; `safe-fetch-connector` (2) and `plugin-authoring-bundle` (1) not traced. None is in a file the fork modifies; this set was not run on plain upstream v0.6.1. `custom-provider-restart` (2) timed out in one of two runs.
- 2026-11-18, after the triage ports: 31 failures; 28 also fail at `506ada3c` (baseline worktree). The CRLF ones (`code-ligatures`, `themes`, `plugin-api-reference`, `plugin-authoring-bundle`) are traced: system git has `core.autocrlf=true`, so exact-text compares against committed files fail; the generated reference is current once line endings are normalised, so "regenerate" is a false alarm. `session-identity` (4): the wiped env makes `tmpdir()` return `undefined\temp`. Full-suite-only flakes (pass alone): `jobs` "a running record with a LIVE loop registration…" and `custom-provider-restart` (`spawnSync` ETIMEDOUT).
- 2026-11-22, v0.7.0 merge: 35 failures, all in the classes above (triage run). New: `claude-code-stream` "a late MCP compatibility error cannot restore a cancelled worker continuation" (its fake child ignores SIGTERM; Windows kills it at once); `session-identity` now 10 (upstream added 6, same `undefined\temp`); `subscription-auth` xai and github-copilot file modes.
- Cause: POSIX file modes, paths and signals don't hold on Windows, and a Windows absolute path passed to a child's `import()` isn't a `file://` URL. All 15 also fail on plain upstream v0.5.0 (2026-11-08 run in a temp worktree).
- Avoid: don't chase them unless that code changes. Run the full suite with quoted globs, `NODE_ENV=test npx tsx --test "tests/*.test.ts" "tests/*.test.tsx"`: unquoted, Git Bash expands them past Windows' command-line limit (`The command line is too long`). Don't edit source while it runs; a test file that loads the edited module mid-run fails for that reason.
- Verify: same failures on `main` before and after a change.

## Typecheck and Core plugins need the plugin setup (0.6+)
- Symptom: `npx tsc --noEmit` prints about 170 errors under `plugins/` (`Cannot find module 'learnharness-plugin-api'`, `@codemirror/*`); or the dev server has no Core plugins (no Flashcards under Settings → Core plugins).
- Cause: each plugin has its own `node_modules`, and Core plugins are built into `core-plugins/` by `npm run plugins:build-core`. `npm run dev` and `npm run build` do that build; a bare `npx next dev` (the `learnharness` preview config) or `npx next build` does not.
- Avoid: once per checkout, `npm run plugins:setup`. Before a bare `next dev`, `npm run plugins:build-core && npm run plugins:build-authoring`. Build the installer with `npm run build`.
- Verify: `tsc` prints nothing; Flashcards is listed under Core plugins.

## `next build` while `next dev` is running
- Symptom: a broken or half-written `.next`, or a dev server that dies mid-build.
- Cause: both use `.next`.
- Avoid: stop the dev server (`preview_stop`) before the installer build.
- Verify: the build log ends `EXIT=0`.

## Packaged window's API rejects curl
- Symptom: requests to the `.exe`'s server (random port in `main.log`) fail authorization.
- Cause: the window passes a per-launch `x-learnharness-desktop` secret (`src/server/desktop-access.ts`).
- Avoid: test the packaged server headless instead (`CLAUDE.md` § Desktop app), without `LH_DESKTOP_SERVER`.
- Verify: the headless server is reachable (`curl -s -o /dev/null -w "%{http_code}" localhost:3123/` → 200). `/api/claude-code` itself answers 403 "requires a same-origin LearnHarness request" to a bare curl or a hand-written fetch, headless or dev (`src/server/claude-code.ts`: it wants `x-learnharness-claude-code: 1` and no foreign origin; a curl with that header not tried). Read the status in Settings → Providers → Claude Code instead (2026-11-18).

## Browser-pane clicks on settings controls don't register
- Symptom: coordinate/ref clicks on "Set up your models", the model dropdowns or Connect do nothing.
- Cause: seen while the pane was hidden or another overlay had focus; not reproduced as an app bug.
- Avoid: use `find` refs with the pane visible, or copy `data/settings.json`. The Claude Code switch under External CLI can also look unchanged after a click while its `PUT /api/settings/claudeCode` succeeded (2026-11-18, packaged server); each further click sends another PUT, so read `GET /api/settings` (`claudeCode.enabled`) before clicking again. A fresh profile can't start a chat until Strong, Cheap and Vision are all set: sending opens "Set up your models" with Save disabled, and the message stays in the composer. Set all three before a scripted first turn.
- Verify: `GET /api/settings` shows `claudeCode.enabled` and `models.*` as intended.

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
- Cause, second half (found 2026-11-14): a cache entry matches only on a whole content block. Upstream merges the re-sent history into one text block, which grows every turn, so a fresh process matched only the system prompt and tools (7,816 on v0.6.1, Haiku 4.5). The experiments below sent the same input twice and never tested a growing history.
- Avoid: keep `--session-id` (derived from the chat key) and the fixed working folder in `src/agent/claude-code/stream.ts`, and the history chunks in `transcript.ts` (D-015): cut every `HISTORY_CHUNK` = 8 messages from the start, `cache_control` after the last full chunk. Don't cut at user messages: in a lesson the learner's answers are tool results, so everything after the first message is one growing run. Experiments: two processes, same input → fixed id + fixed folder read 11,356; either one random → read 0.
- Limits: each fresh process re-writes up to 7 messages past the last full chunk; a history under 8 messages gets nothing back; turn 1 sends the first message without its `[user]` label, so turn 2 re-writes it.
- Verify: restart the server before each of two turns in one chat (answering a pending question otherwise resumes the live process, which always reads its own cache). The second turn's first call has `cacheRead` above the first's and a small `cacheWrite` (2026-11-14: 7,816 / 1,359, then 9,081 / 223).
- Not checked: a flashcard worker request (3,762 input tokens, one call per task) had no cache read or write at all; whether that is the model's minimum cacheable size.
- TTL, from strings in CLI 2.1.331's `claude.exe` (2026-11-24, not live-tested): `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL` and the `promptCacheTtl` setting win; otherwise 1h only for a subscriber not on overage whose query source is on an allowlist (default `repl_main_thread*`, `sdk`, `auto_mode`, `memdir_relevance`; a server flag can replace it), else 5m. `env.ts` scrubs none of these. Risk: if the CLI sends 5m on its own blocks, the fork's 1h history marker follows a shorter TTL, which the API rejects, so the turn fails instead of missing the cache. After a CLI update: `LC_ALL=C grep -a -o 'return{ttl:"1h",reason:"subscriber"}' <claude.exe>` (about a minute), `tests/claude-code-transcript.test.ts`, then the restart test above. Live 2026-11-24 on 2.1.331: restart + 13-min gap read 9,759 / wrote 361, no error (1h in effect).
- `cacheRetention` (slot setting) does nothing on `claude-code`: `models.ts:189-192` passes it, `stream.ts` never reads it. `cli-events.ts` keeps only the total cache write, not the 5m/1h split.
- Where usage lives: chats `messages[].usage.cacheRead` / `cacheWrite`; jobs `usage.calls[].cacheReadTokens` / `cacheWriteTokens`. Measured hit rates 2026-11-24: 78–94% per chat; a return after a 408-min gap re-wrote 59k (about 1.6% of the 5-hour limit by `chat-share.ts`, vs 0.4% warm).

## Background jobs: refusal and delivery holds
- Symptom: a job refused while Claude Code background use was off stays "failed" after the toggle returns; a finished job's result sometimes appears only after the learner's next turn, even after reopening the chat.
- Cause: the refusal happens inside the run (`models.ts:210`), not at admission (`runner.ts:258-263` checks only installed + enabled), so the job is saved as "error"; respawn (`jobs.ts` ~791-805) only touches jobs still "running". Delivery: opening a chat pumps only pending, non-deferred markers; a wake that failed to start is `deferred` until a learner run (`registerLiveAgent`), an unanswered question blocks it (`waitForIdle`), and skip/question parks hold it (upstream design, tested in `job-delivery-recovery.test.ts:175`). Same code on plain upstream.
- Fixed for refusals 2026-11-24 (owner: "refuse at dispatch"): `jobDispatchRefusal` (`chat-handler.ts`) is passed as `JobToolContext.admit` and runs in `dispatch()` before `createJob`, so the tutor gets the refusal as a tool error that turn and no job record exists. Every job-context site in `chat-handler.ts` needs `admit: jobDispatchRefusal`, or its jobs only hit the in-run backstop (`models.ts`). Plugin background jobs are not gated (no model role). Delivery holds: kept as upstream (owner: leave as is); send any message to deliver a held result.
- Verify: `tests/claude-code-gate.test.ts` "job dispatch with background off is refused…" (5/5), `tests/job-delivery-recovery.test.ts` 18/18 (2026-11-24).

## Chat pages answer 500 in `next dev` after an upstream merge
- Symptom: `/chat/<id>` returns HTTP 500 on load although the page then renders and works; server log: `TypeError: Cannot add property changed, object is not extensible` at `components/chat.tsx`.
- Cause: upstream 0.6.1 adds a `.changed` property to `useRef` objects (`inputViewReader` in `Chat`; the native, practice and custom view readers in `DockOverlay`). React seals ref objects in development, so the server render throws.
- Avoid: the fork holds those four readers in `useState(() => ({ current: null }))`. A merge that brings the `useRef` lines back brings the 500 back.
- Verify: `curl -s -o /dev/null -w "%{http_code}" localhost:3000/chat/new` prints 200.
- Since 0.7 (2026-11-22) upstream uses `useState` readers itself, so a merge no longer brings the `useRef` lines back.
- Evidence (2026-11-14): `Object.seal` appears in `react-dom-server.node.development.js`, not in the production file; the sidebar route rendered while a direct load of `/chat/<id>` gave 500 (`inputViewReader.changed = …`); production build not checked. Also: restart the dev server after switching branches: it served a session list stuck on "Loading…".

## Claude desktop redirects AppData for everything it starts
- Symptom: the Start-menu app shows "Add a provider key" and Claude as "Connect" while `%APPDATA%\LearnHarness\data` read from a session says enabled; `main.log` seems frozen although the app is running.
- Cause: Claude desktop is an MSIX app. Processes it starts write `%APPDATA%` into `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming`, and session tools see those files over the real ones. An app opened from Explorer uses the real folder, a separate profile. Shadowed real files can't be read from a session.
- Avoid: 2026-11-08 the stale copy was renamed to `LearnHarness.bak-2026-11-08` (same Roaming folder), so `%APPDATA%\LearnHarness` read from a session is the real profile again. Keep it that way: never write under it from a session or launch LearnHarness from one; if reads look stale, check whether the Packages copy came back. The `.bak` folder can be deleted when the owner wants. Launch the app or installer with `explorer.exe <path>` to run outside the container (`/S` can't be passed that way).
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

## The installed server can't find a package the build has
- Symptom: the installed app's `logs\main.log` shows `Failed to load external module shiki-<hash>: Cannot find package '@shikijs/core'`, while the dev server, `smoke-server` and `dist/win-unpacked` are all fine.
- Cause: Next links each external package into `.next/node_modules/<name>-<hash>`. The installer ships those links as plain copies. `shiki` sits in a nested `node_modules` (`@streamdown/code/node_modules`) next to its dependencies, and a copy under `.next/node_modules` can't reach them. In the repo and in `win-unpacked` the links still resolve, so nothing there fails.
- Avoid: step 2d in `scripts/build-server.mjs` (fork) copies such a nested folder's packages to `standalone/node_modules` and refuses the build on a version clash. Keep it through merges.
- Verify: copy `.next/standalone` with links followed (`cp -rL`) to a folder outside the repo and run it there (recipe in `CLAUDE.md` § Desktop app); `/chat/new` returns 200 and the log has no `ERR_MODULE_NOT_FOUND`. A plain GET to the installed window's own server proves nothing: it rejects requests without its per-launch header. Seen fixed 2026-11-18: the reinstalled 17:03 build launched with no `ERR_MODULE_NOT_FOUND`, and its server (run headless) rendered a shiki-highlighted Python block in a reply.

## Output-cap fixes upstream don't apply to `claude-code`
- Symptom: upstream issues/PRs about `maxTokens` clamps (#642, #733, PR #757, PR #749) look relevant.
- Cause: the `claude-code` provider never passes pi's `maxTokens` to the CLI (`src/agent/claude-code/stream.ts` has none; `provider.ts` only lists it as metadata), so the CLI uses its own cap.
- Avoid: skip such ports unless the CLI launch starts passing a token limit.
- Verify: `grep -n maxTokens src/agent/claude-code/*.ts`.

## Triage tools for upstream PRs and issues
- `gh issue view N` (with or without `--comments`) fails with a "Projects (classic) deprecated" GraphQL error: use `gh issue view <N> -R amosblomqvist/learnharness --json title,body,comments -q …`.
- Conflict check without touching the tree: `gh pr diff N > .tmp/prN.diff && git apply --check .tmp/prN.diff`. A plain check can fail where `git apply --3way --check` is clean (CRLF/offsets; #689, #615, #446). `gh pr diff` of a stacked PR contains the whole stack (#772 includes #770 and #771): apply only the top one.
- `grep -r` from the repo root times out on `node_modules`: scope it to `src`, `app`, `components`, `plugins`.
- Upstream #760 ("`tex.wasm` missing") is a false alarm for us: rich-code-blocks ships `tex.wasm.gz` by design, present in `dist/win-unpacked` and the installed app (2026-11-18).
- Parallel subagents writing `.tmp/out.log` overwrite each other: give each its own file.
- `gh pr view N --comments` fails the same way: use `--json body,comments --jq …`.
- `git apply --3way` stages what it applies (only conflicted files stay unstaged) and refuses a file with working-tree edits ("does not match index"): commit or apply that file separately (`--include`, `--reject` + hand-merge the `.rej`).
- The Bash tool turns `\n` inside heredocs and inline scripts (a heredoc-fed `python -` script, `printf`) into real newlines, and mangles regex backslashes: edit TS with the Edit tool. It broke the build once (2026-11-25, #806 E1).
- Bugs about tool blocks sent with no tools list (e.g. #532's closing call) hit only API engines: the `claude-code` engine replays history as labelled text (`src/agent/claude-code/transcript.ts`), never as tool blocks.
- Upstream CI runs only the root `tests/*` on Ubuntu; `plugins/*/tests` and the Windows unit tests never run there, so Windows-only plugin test failures don't show upstream. Plugin tests: `cd plugins/<name> && npm test`. Skill tests: `python -B -m unittest discover -s tests/skills` (no pytest).

## esbuild test mocks don't load on Windows
- Symptom: drawing-pad tests fail with `document is not defined` or `reading 'contains'` in `appPalette`: the real module ran instead of the test's mock.
- Cause: esbuild `onLoad` filters like `/\/src\/sheet\.ts$/` never match, because on Windows `args.path` uses backslashes.
- Avoid: write path separators in such filters as `[\\/]` (fork fix `0a3434b2`); check new upstream plugin tests for the same pattern.
- Verify: `cd plugins/drawing-pad && npm test` passes 104/104.

## Tests that open `node:sqlite` databases can't clean up on Windows
- Symptom: a test file fails in its `after()` hook with `EPERM` from `rmSync` on a temp dir, though every test passed.
- Cause: a `DatabaseSync` left open keeps the file locked; Windows won't delete it.
- Avoid: track opened databases and `close()` them before `rmSync` (`tests/anki-export.test.ts`, `501fcba3`).
- Verify: the file passes alone with no hook failure.

## The bridge can be "pending" at the CLI's init line
- Symptom: a turn fails with "Claude Code could not reach the LearnHarness tool bridge" although the bridge works.
- Cause: from Claude Code 2.1.326 MCP servers connect without blocking (`MCP_CONNECTION_NONBLOCKING` defaults on); `-p` waits for them only up to a deadline, so `system/init` can report the server as `"pending"` with its tools not yet listed.
- Avoid: the init check (`src/agent/claude-code/stream.ts`, D-016) treats `pending` as OK and fails only on a missing server, a status other than connected/pending, or a connected server missing a declared tool.
- Verify: `tests/claude-code-stream.test.ts` "Fork: a pending bridge with no tools yet proceeds". To inspect the CLI: `grep -a -o` on `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`.

## Browser-pane checks: clipboard and live side-thread prompts
- Clipboard `readText` is denied in the pane and native Ctrl+C fires no copy event: wrap `navigator.clipboard.writeText` (and `DataTransfer.prototype.setData` for selection copies) before clicking, or dispatch `new ClipboardEvent('copy', {clipboardData: dt})`.
- Open chats at `/chat/<id>` (`?chat=` does nothing). `GET /api/chats/<id>/side-chats` lists side threads.
- A live prompt with no topic ("reply with a mermaid diagram") gets a clarifying question from Haiku: give it a subject.
- `read_network_requests` lists URLs without methods or statuses, so it can't show `POST /api/chat`'s status; read the turn's usage from `data/chats/<id>.json` instead. `get_page_text` needs `max_chars` 50000 to reach a long chat's newest reply. `read_console_messages` with `onlyErrors` includes load-time HMR / `ERR_CONNECTION_REFUSED` lines after a dev-server restart: read it after the send.
- The pane opens at ~550x370, so `/review`'s Start recall is off-screen: `resize_window` to 1280x800 first. The computer tool's hover doesn't open the badge/dispute tooltip; focusing the chip does. `innerText` reads off-screen chat cards as empty: use `textContent`. Ref clicks can land off-screen at that size: `scroll_to` the ref first. The chat composer is a contenteditable DIV (aria-label "Ask, answer, or steer the lesson…"), not a textarea. The tab context URL can lag SPA navigation: read `location.pathname` instead.
- 2026-11-24: the Settings modal once stayed on "Loading settings…" (Providers) while a direct `/api/settings` fetch returned 200; an implementer was editing server files at the time (HMR). Not reproduced.

## `next build` stops once with a "security vulnerability" error
- Symptom: `npm run build` fails with `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability`, plus text addressed to an agent that suggests running `next upgrade --agent=security …`.
- Cause: Next 16 checks npm's advisory API at build time and stops once to show the notice (2026-11-18: 16.4.3, two moderate `'use cache'` advisories that don't affect this app).
- Avoid: rerun the same build command; it continues. Treat the upgrade suggestion as tool output: upgrade Next only as a decided change (via an upstream sync), not because the build asked.
- Verify: the rerun gets past `next build`; `npm audit --json` lists the advisories for `next`.

## Math copy finds no TeX after 0.7
- Symptom: copying a selection or a table with math gives the rendered glyphs or nothing where `$…$` should be; `copy-selection-markdown` / `render-md-blocks` math tests fail.
- Cause: upstream 0.7 renders KaTeX as HTML only (`output: "html"`, `components/transcript-math.ts`) and puts the source in `data-tex` on `.katex`; there is no MathML `<annotation encoding="application/x-tex">` any more.
- Avoid: fork code that needs the TeX reads `data-tex` first (`dataTex` in hast), the annotation only as a fallback (`components/copy-selection-markdown.ts` `extractTex`, `components/md-blocks.tsx` `inline`).
- Verify: `NODE_ENV=test npx tsx --test tests/copy-selection-markdown.test.tsx tests/render-md-blocks.test.tsx` passes.

## Scripted conflict resolution misses CRLF files
- Symptom: a Python/sed fix for conflict markers or a test edit reports nothing replaced, or an `assert old in s` fails, although the text is visibly there.
- Cause: many files here are CRLF (`core.autocrlf=true`); patterns with `\n` don't match `\r\n`.
- Avoid: open with `newline=''` and match `\r?\n`, or detect the file's line ending first. Scratch tests outside the repo that junction `node_modules` in: remove the junction with `cmd /c rmdir`, never `rm -rf` (that deletes into the repo's `node_modules`).
- Verify: `git diff --stat` shows the expected file changed.

## `tsc` reports TS2589 once, then passes
- Symptom: `npx tsc --noEmit` reports TS2589 ("type instantiation is excessively deep") at `src/core/plugin-view-context.ts:67`; a re-run with identical code is clean.
- Cause: unknown; seen once (2026-11-24, welcome-back build).
- Avoid: re-run before debugging. A fresh `git worktree` of HEAD is no typecheck baseline: it fails on the plugin folders until `npm run plugins:setup` runs there.
- Verify: a second `npx tsc --noEmit` exits 0.

## Graph statements can't be edited in place
- Symptom: appending a node line with a new statement for an existing id doesn't change what the graph shows.
- Cause: `data/graph/nodes.jsonl` is append-only and the first line per id fixes name and statement; later lines only add aliases (`src/core/graph.ts` ~429–451). The API has DELETE only (`app/api/graph/nodes/[id]`).
- Avoid: corrections (D-023) need a separate ledger folded at read time, and `deleteNodeTraces` (`src/core/graph-deletion.ts`) must clear it too.
- Verify: `getGraph` returns the override text.

## Notes/PDF statements have no source passage
- Symptom: a statement from imported notes or a PDF can't be traced to the text it came from.
- Cause: notes extraction strips `messageId` (`extraction.ts` ~292–297); provenance is just the `src_` id and `NotesSource` keeps only `filePath`/`importedAt`. Chat statements keep `{chatId, messageId}`.
- Fixed for new imports (#806 B, 2026-11-24): provenance gets `chunk: {importKey, index}`; text lives in `<graph>/sources/<srcId>/<importKey>.json` (`importKey` = `String(Date.now())`, same instant as `importedAt`), read with `graphStore.readSourceChunk`, removed only by `deleteSources` (`src/server/source-deletion.ts`). Older imports stay without an anchor. Re-importing a path keeps the same `src_` id, so chunks are keyed per import, never per source.
- `samePoint` (`core/graph.ts`) must compare every provenance field, or `getGraph` dedupes distinct points away; it now includes `chunk`.
- Verify: a new import's node provenance carries a chunk anchor.

## Two FSRS stores share one key space
- Flashcards' graph cards use the graph node id as `propositionId`, the same key `/review` uses. Its state is `data/core-plugin-data/flashcards/flashcards.json`, with minute learning steps `[1,10]` (`store.cjs:52`) and only self-grades written. Kept off (D-023); turning it on gives a second, unrelated schedule.

## New `GraphStore` methods break three test fakes
- Symptom: `tsc` fails in `tests/extraction.test.ts`, `tests/notes-import-route.test.ts` and `tests/worker-admission-integration.test.ts` after a method is added to `GraphStore` (`src/core/ports.ts`).
- Cause: those tests build typed fakes; `graph-tools.test.ts` casts, so it doesn't break.
- Avoid: add the method to all three fakes in the same change.
- Verify: `npx tsc --noEmit` clean.

## "claude CLI refused a harness tool call before MCP admission" on Haiku 5.5
- Symptom: a `claude-code` subagent call (notes extractor, verifier) fails with that message (`src/agent/claude-code/stream.ts` ~:704). Seen 2026-11-24 on CLI 2.1.331, Haiku 5.5, dev server: 3 of 6 calls — both first imports after a server start, and one verifier passage check right after a successful extraction. Retrying the import succeeded.
- Cause: not proven. The CLI wrote its own `tool_result` for a prefixed bridge call: unknown tool (bridge not connected yet), a policy denial, or unparseable input. Before the mitigation below the refusal text was thrown away (`cli-events.ts` ~:203-207 kept ids only; it keeps `texts` now). Most likely the bridge wasn't connected yet: CLI 2.1.331 connects `--mcp-config` servers without waiting unless `MCP_CONNECTION_NONBLOCKING` is false or the entry has `alwaysLoad: true` (strings in `claude.exe`), and the fork accepts "pending" at init (`e457aebb`, since CLI 2.1.326). Not a process or port collision: each subagent run has its own session, process and bridge port.
- Grepping the 405 MB `claude.exe`: a fixed string plus `.\{N\}` context returns in seconds; a `[^\"]\{0,200\}` pattern times out.
- Effect: a failed import shows an error; a failed verifier call leaves its group pending (retried next batch).
- Mitigation 2026-11-24: the bridge entry has `alwaysLoad: true` (`tool-bridge.ts` `toMcpConfig`), and the stream logs `[claude-code] CLI refused a harness tool call: <text>` and `[claude-code] bridge unreachable at init: status=…, missing tools=…`. Live after it, Haiku 5.5: no refusals; 1 of 3 first-imports-after-start failed instead as "could not reach the tool bridge" (before the init log line existed); the next 2 imports and all verifier calls (passage and web) succeeded. If it recurs, read those log lines first.
- 2026-11-25: recurred once in a main tutor turn (not a subagent): the first `propose_grade` turn of a fresh recall chat, Haiku 5.5, dev server; the in-chat Retry succeeded, and the failed attempt's partial text stays in the transcript.
- Known Windows test failures in `tests/claude-code*.test.ts` before this change: 3 (empty temp cwd, late MCP compatibility error, SIGTERM escalation).

## Graph view looks empty right after an edit
- Symptom: `/` shows "Start a session to begin learning" and the sessions list stays on "Loading…", though `/api/graph` returns nodes.
- Cause: `next dev` recompiling (Fast Refresh took ~29 s after a stash/pop); the client's first `/api/graph` fetch waits on it. Not a data or render bug.
- Also: the built-in browser pane must be visible for the canvas to draw; the canvas can't be clicked open reliably by automation, so ask the owner to click a node.

## The name `recall` is taken twice
A teacher question tool is named `recall` (`src/agent/tools.ts` ~250, `pending.ts` ~58) and practice problems have a `mode: "recall"` (`practice-problems.ts` ~10). #806's recall grading tool and variant need other identifiers in tool names (the chat `variant:"recall"` value is a separate field and fine).

## `POST /api/chats` creates a real session
Even an empty `{}` body makes an "Untitled session" in the dev `data/` (seen 2026-11-25, checker probe). Probe chat routes with GET only.

## Two console 503s on any page with a composer
- `GET /api/stt/token` answers 503 when no `DEEPGRAM_API_KEY` is set; the composer pre-mints a dictation token at mount (`components/dictation.tsx:721`) and swallows the failure, but the browser still logs it. Doubled in `next dev` by Strict Mode. Expected; left as is (2026-11-25).

## Recall chats: record adoption and browser-check traps (#806 E)
- `syncFromServer` (`components/chat.tsx`) doesn't set messages itself; `readRecord`'s default replace does, and it returns undefined with no error while status is submitted/streaming, an image POST is open, or the read is stale. The grade route's `record-changed` starts a second sync beside `continueTurn`'s; ticket/epoch checks keep one. The saved grade is adopted one GET after the POST; the card's `local` and the summary's `pending` cover that gap (traced 2026-11-25, no bug).
- The rating card takes focus only once the turn settles (~2 s after it appears): a script must wait for `activeElement` to be the card before pressing keys. It doesn't take focus from a composer holding text.
- The disputed-chip tooltip (Radix) opens only on keyboard focus-visible: `focus()` and clicks don't open it; a Shift press then blur/refocus does.
- Saved cards keep `data-testid="recall-card"`; the last one also holds the summary ("Recall done…", no "Saved:"). Poll `turnInFlight` from the chat API, not the "thinking" label.
- Start recall takes ~5 s to navigate even in the packaged server (2026-11-25), while `POST /api/chats` and the `/chat/<id>` render each take ~0.25 s: the wait is client-side, in the shared `startDraftSession` → `router.push` path (Start review uses it too). Cause not traced. In `next dev` right after an edit to `components/chat.tsx` it took over 10 s (route recompile). Code read 2026-11-26 (upstream path; fork only adds `variant`): `startRecall` (`components/review-view.tsx` ~203) awaits one `POST /api/chats` then `router.push`; no `loading.tsx`, Suspense, `startTransition`, timer or polling on the way, so the push waits only on the RSC payload and route chunks. Needs browser timings (POST response → URL change → first paint); `curl -H "RSC: 1"` just 307s to `?_rsc`, and a made-up `_rsc` value 307s too.
- A recall card left un-keyed (the learner typed instead and the tutor sent a newer `propose_grade`) writes no review event: only `recall-grade` markers count (`src/core/review-events.ts` ~162), so the statement stays due and the summary may never show. The card still renders greyed keys, Dispute and the Enter hint (`components/recall-card.tsx` ~167-220); display choice open (owner). The grade route accepts a key for any clean ungraded call, not just the newest (`src/core/recall.ts` ~70-90); only the UI limits it.
- Checks without a browser: `GET /api/review` returns `{now, due, upcoming, sessionSize}` with each row's verification and dispute. Chips: `components/verification-badge.tsx`; tooltip is the custom `components/ui/tooltip.tsx` (portaled, so Tab from the chip may not reach its source link). A Remote Control session from `D:\Projects` has no browser pane, so `lh-checker` can't run there.

## The packaged server bundles the repo's `data/` (`build-server` refuses)
- Symptom: `scripts/build-server.mjs` stops with "standalone contains a data/ directory". `outputFileTracingExcludes` filters only app/pages route traces (`node_modules/next/dist/build/collect-build-traces.js` ~:437); `instrumentation.js.nft.json` is copied unfiltered (`build/utils.js` ~:1183).
- Cause (2026-11-25): a `path.join(<data dir>, dyn, `${x}.json`)` without `/* turbopackIgnore: true */` makes Turbopack glob every `*.json` in the repo. It was `src/store/graph.ts` `chunkFile` (#806 B, `5bebd273`); fixed, plus the two joins in `src/server/verifier-deps.ts`.
- Avoid: every data-path join carries `/* turbopackIgnore: true */` on its first argument (see `src/store/chats.ts`). Check after a build: no `"data/` entries outside `node_modules` in `.next/server/instrumentation.js.nft.json`.
- The same build once failed `smoke-server` with "never answered 200" though the server printed Ready; started by hand it answered in 5 s, and a rerun of the smoke passed. One-off.
