# LearnHarness (personal fork)

Read `AGENTS.md` too: upstream's rules (Next.js 16 differs from training data; **no guessing** — ask the user on any design, naming, UX or default choice).

## What this is

Personal, private fork of [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness) (AGPL-3.0-only): an AI tutor (Next.js 16 + Electron, TypeScript) that probes, plans, teaches and practises, with a persistent knowledge graph. LLM calls go through `@earendil-works/pi-ai` / `pi-agent-core`.

Goal of the fork: run it on the owner's **Claude subscription** (Claude Code login, Pro plan), never an Anthropic API key.

## Remotes and branches

- `upstream` = amosblomqvist/learnharness. `origin` = JoKunGz007/learnharness (private). `pdomenico` = source of the Claude backend.
- `main` = upstream main + upstream PR #151 (pdomenico, `feat/local-agent-connections`) + upstream PRs #163, #157, #139, #127 + our fixes. Sync: `git fetch upstream && git merge upstream/main`. If #151 is merged upstream, drop our copy in favour of theirs.
- AGPL: if this is ever offered to others over a network, the source must be offered too. Personal use: no obligation.

## Claude subscription backend (from PR #151)

- `src/agent/local-agents/claude.ts` spawns the locally installed Claude Code: `claude -p --input-format stream-json --output-format stream-json`, `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--no-session-persistence`, empty temp cwd. App tools reach it through a loopback MCP server (`mcp-server.ts`, 127.0.0.1 + per-run bearer token). `ANTHROPIC_API_KEY` and other auth reroutes are scrubbed from the child env, so usage always bills the subscription.
- The app never sees a Claude token; Claude Code uses its own `claude auth login`. This is the route Anthropic's support article allows (`claude -p`/Agent SDK draw from plan limits); don't switch to pi-ai's Anthropic OAuth or `claude setup-token` (that makes the app itself a claude.ai-login client, which Anthropic's terms forbid for third-party apps).
- Fork fix: on Windows, npm installs only put `claude.cmd` on PATH; `knownDirs()` also searches `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin` for the native `claude.exe`. `LH_CLAUDE_BIN` overrides.
- Live runs spend Pro limits. Test on Haiku, one or two turns.

## Run on Windows

```bash
npm ci
npx next dev            # http://localhost:3000 (or the browser pane: preview_start "learnharness")
```

Then Settings → Providers → Subscriptions → **Claude (local)** → enable, and pick `claude-code:*` models. Status API: `curl -s localhost:3000/api/connections/local`.

- `npm test` uses POSIX env syntax; from Git Bash run `NODE_ENV=test npx tsx --test tests/<file>.test.ts`. Typecheck: `npx tsc --noEmit`.
- Known Windows test failures: `tests/local-agents-*.test.ts` (8) use `.mjs` fakes as the CLI binary, which Windows can't execute; plus upstream's POSIX file-mode assertions.
- App data: `data/` (gitignored). Long command output → `.tmp/out.log` (gitignored), then grep/tail.

## Desktop app (Windows installer)

Build from Git Bash (~10 min; stop any `next dev` first, it shares `.next`):

```bash
rm -rf dist .next/standalone && npx next build && node scripts/smoke-provider-runtime.mjs && node scripts/build-server.mjs && node scripts/smoke-server.mjs --electron && npx electron-builder --win --x64 --publish never
```

- Output: `dist/LearnHarness-<ver>-x64-setup.exe` (unsigned: SmartScreen → More info → Run anyway). Data lives in `%APPDATA%\LearnHarness` (log: `logs\main.log`), separate from the dev server's `data/`.
- **Auto-update is off in fork builds** (`setupAutoUpdater` in `electron/main.cjs`): upstream releases lack the Claude connection and would replace it. Update = pull upstream, rebuild, reinstall. `LH_UPDATE_FEED` opts back in. `electron-builder.yml` `publish.owner` points at the fork so a manual publish never targets upstream.
- Test the packaged server without the window: from `dist/win-unpacked/resources/server/standalone`, `ELECTRON_RUN_AS_NODE=1 PORT=3123 LH_DATA_DIR=<tmp>/data LH_AUTH_FILE=<tmp>/auth.json ../../../LearnHarness.exe server.js`. (The window's own server needs a per-launch secret header.)
- Upstream PR #159 (auto-update toggle) is already in upstream main (`769fc85`); don't merge it.
- Verified 2026-10-26: packaged server ran two Teach turns on `claude-code` Haiku 4.5 (second turn resumed the same CLI process); the window started, server up, updater disabled.

## Working as orchestrator (usage limits)

This session plans, decides, talks to the user and integrates. Subagents do the heavy reading and settled edits (claude-usage D-024).

- **Investigation → `lh-investigator`** (session model, read-only): upstream PRs/forks, code tracing, test/log output. One question per run, name the starting files or PR numbers.
- **Settled edits → `lh-implementer`** (Sonnet, `maxTurns: 60`): name files, exact change, checks to run. Settle every user-visible choice first. Stuck or turned into debugging → re-route to the investigator, or re-run one model up with `[re-run]` / `[opus]` at the start of the description. Partial return at the cap: check `git diff` first.
- **Browser checks → `lh-checker`** (Sonnet, edits nothing): name 1–2 flows and the URL of a server you started. One run at a time (shared browser pane). Live Claude turns: Haiku, a stated turn count.
- **"Where is X" → built-in `Explore`.**
- ~20–40 tool calls per delegation; split bigger work. `SendMessage` for a follow-up to the same agent.
- Inline: small edits, short commands, reading one known file, anything needing the user.
- Subagents don't edit docs or commit; record findings here yourself.

## Owner

CEDT student (Chulalongkorn), Windows 11, GitHub JoKunGz007. Wants concise, arithmetic-first answers, no lecturing. Separate from the coursework repo `D:\Projects\cedt` — never touch it from here.
