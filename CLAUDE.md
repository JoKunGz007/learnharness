# LearnHarness (personal fork)

Read `AGENTS.md` too: upstream's rules (Next.js 16 differs from training data; **no guessing** — ask the user on any design, naming, UX or default choice).

## What this is

Personal, private fork of [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness) (AGPL-3.0-only): an AI tutor (Next.js 16 + Electron, TypeScript) that probes, plans, teaches and practises, with a persistent knowledge graph. LLM calls go through `@earendil-works/pi-ai` / `pi-agent-core`.

Goal of the fork: run it on the owner's **Claude subscription** (Claude Code login, Pro plan), never an Anthropic API key.

## Remotes and branches

- `upstream` = amosblomqvist/learnharness. `origin` = JoKunGz007/learnharness (private).
- This branch = upstream 0.6.1 (merged 2026-11-14, D-014) + upstream PRs #163, #139, #127 (still open upstream; #157 is now upstream's own) + our fixes (D-009). Sync: `git fetch upstream && git merge upstream/main`.
- AGPL: if this is ever offered to others over a network, the source must be offered too. Personal use: no obligation.

## Claude subscription backend (upstream's provider + fork patches)

- `src/agent/claude-code/stream.ts` spawns the locally installed Claude Code in stream-json mode, with `--tools ""`, `--setting-sources ""` and a fixed empty cwd. App tools reach it through `tool-bridge.ts`. `ANTHROPIC_API_KEY` and other auth reroutes are scrubbed from the child env (`env.ts`), so usage always bills the subscription. Fork patches are marked `Fork:`.
- The app never sees a Claude token; Claude Code uses its own `claude auth login`. This is the route Anthropic's support article allows (`claude -p`/Agent SDK draw from plan limits); don't switch to pi-ai's Anthropic OAuth or `claude setup-token` (that makes the app itself a claude.ai-login client, which Anthropic's terms forbid for third-party apps).
- Fork fix: on Windows, npm installs only put `claude.cmd` on PATH; `binary.ts` also searches `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin` for the native `claude.exe`. `LH_CLAUDE_BIN` overrides.
- Live runs spend Pro limits. Test on Haiku, one or two turns.

## Run on Windows

```bash
npm ci
npm run plugins:setup   # once per checkout: plugin deps (tsc and Core plugin builds need them)
npx next dev            # http://localhost:3000 (or the browser pane: preview_start "learnharness")
```

Then Settings → Providers → External CLI → **Claude Code** → enable, and pick `claude-code:*` models. Status API: `curl -s localhost:3000/api/claude-code`.

- `npm test` uses POSIX env syntax; from Git Bash run `NODE_ENV=test npx tsx --test tests/<file>.test.ts`. Typecheck: `npx tsc --noEmit`.
- Known Windows test failures: POSIX file-mode and signal assertions (`GOTCHAS.md`).
- App data: `data/` (gitignored). Long command output → `.tmp/out.log` (gitignored), then grep/tail.

## Desktop app (Windows installer)

Build from Git Bash (~10 min; stop any `next dev` first, it shares `.next`). `npm run build` also builds the Core plugins (upstream 0.6); a bare `npx next build` leaves them out of the installer. Once per checkout, after `npm ci`: `npm run plugins:setup`.

```bash
rm -rf dist .next/standalone && npm run build && node scripts/smoke-provider-runtime.mjs && node scripts/build-server.mjs && node scripts/smoke-server.mjs --electron && npx electron-builder --win --x64 --publish never
```

- Output: `dist/LearnHarness-<ver>-x64-setup.exe` (unsigned: SmartScreen → More info → Run anyway). Data lives in `%APPDATA%\LearnHarness` (log: `logs\main.log`), separate from the dev server's `data/`; session tools see a redirected copy of it (`GOTCHAS.md`).
- **Auto-update is off in fork builds** (`setupAutoUpdater` in `electron/main.cjs`): upstream releases lack the Claude connection and would replace it. Update = pull upstream, rebuild, reinstall. `LH_UPDATE_FEED` opts back in. `electron-builder.yml` `publish.owner` points at the fork so a manual publish never targets upstream.
- Test the packaged server without the window: from `dist/win-unpacked/resources/server/standalone`, `ELECTRON_RUN_AS_NODE=1 PORT=3123 LH_DATA_DIR=<tmp>/data LH_AUTH_FILE=<tmp>/auth.json ../../../LearnHarness.exe server.js`. (The window's own server needs a per-launch secret header.)
- Upstream PR #159 (auto-update toggle) is already in upstream main (`769fc85`); don't merge it.
- Verified 2026-10-26: packaged server ran two Teach turns on `claude-code` Haiku 4.5 (second turn resumed the same CLI process); the window started, server up, updater disabled.

## Working as orchestrator (usage limits)

This session plans, decides, talks to the user and integrates. Subagents do the heavy reading and settled edits (claude-usage D-024).

- **Investigation → `lh-investigator`** (Opus, medium effort, read-only): upstream PRs/forks, code tracing, test/log output. One question per run, name the starting files or PR numbers.
- **Settled edits → `lh-implementer`** (Sonnet, `maxTurns: 60`): name files, exact change, checks to run. Settle every user-visible choice first. Stuck or turned into debugging → re-route to the investigator, or re-run one model up with `[re-run]` / `[opus]` at the start of the description. Partial return at the cap: check `git diff` first.
- **Browser checks → `lh-checker`** (Sonnet, edits nothing): name 1–2 flows and the URL of a server you started; a longer list is several runs, one after another (the 51–70-call runs each bundled more, claude-usage D-030). One run at a time (shared browser pane). Live Claude turns: Haiku, a stated turn count.
- **"Where is X" → built-in `Explore`.**
- ~20–40 tool calls per delegation; split bigger work. `SendMessage` for a follow-up to the same agent.
- Inline: small edits, short commands, reading one known file, anything needing the user.
- Subagents don't edit docs or commit; record findings here yourself.

## Continuity docs

Start at `PLAN.md` § Current checkpoint, then `DECISIONS.md` / `GOTCHAS.md` as the task needs. Each fact has one home; link, don't copy. No `HANDOFF.md`: session handoffs are `/handoff` notes in the temp folder. After substantive work, run `/sync-continuity`. (Upstream's `docs/plan.md` is the maintainer's, not ours.)

## Owner

CEDT student (Chulalongkorn), Windows 11, GitHub JoKunGz007. Wants concise, arithmetic-first answers, no lecturing. Separate from the coursework repo `D:\Projects\cedt` — never touch it from here.
