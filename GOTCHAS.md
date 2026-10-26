# GOTCHAS

_Repeatable, non-obvious traps only. Each: symptom / cause / avoidance / verification._

## `npm test` fails immediately on Windows
- Symptom: `'NODE_ENV' is not recognized` or similar from `npm test`.
- Cause: the script uses POSIX env syntax and npm runs scripts in cmd.exe.
- Avoid: from Git Bash, `NODE_ENV=test npx tsx --test tests/<file>.test.ts`.
- Verify: the run prints `ℹ tests N`.

## Local-agent tests fail on Windows (8 of 44)
- Symptom: `tests/local-agents-*.test.ts` fail, e.g. "claude-code catalog has no model claude-haiku-4-5".
- Cause: they set `LH_CLAUDE_BIN` to a `.mjs` fake, which Windows can't execute, so the probe fails and the catalog is empty. Not a product bug: the real CLI works (see `PLAN.md`).
- Avoid: judge the backend by a live run, or wrap the fake in a launcher (`PLAN.md` § Later).
- Verify: the other 36 pass.

## Other Windows-only test failures
- Symptom: `chatgpt-auth.test.ts` / `subscription-auth.test.ts` owner-only file-mode assertions and a control-bridge test fail.
- Cause: POSIX file modes (and timing) don't hold on Windows. These tests weren't touched by fork changes, but they weren't confirmed against plain upstream either.
- Avoid: don't chase them unless that code changes.
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
- Verify: `curl localhost:3123/api/connections/local` returns statuses.

## Browser-pane clicks on settings controls don't register
- Symptom: coordinate/ref clicks on "Set up your models", the model dropdowns or Connect do nothing.
- Cause: seen while the pane was hidden or another overlay had focus; not reproduced as an app bug.
- Avoid: use `find` refs with the pane visible, or set state via the API (`POST /api/connections/local/claude-code {"action":"enable","enabled":true}`, copy `data/settings.json`).
- Verify: `GET /api/connections/local` shows `enabled:true, connected:true`.
