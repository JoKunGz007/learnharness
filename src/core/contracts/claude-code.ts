export const CLAUDE_CODE_PROVIDER = "claude-code";

/** Fork: `claude auth status --json`, shown in Settings only. `uncertain` = unparseable/slow/failed, never read as signed out. */
export interface ClaudeCodeAuth {
	state: "signed-in" | "signed-out" | "uncertain";
	account?: string;
	plan?: string;
	/** Signed in through a claude.ai subscription rather than an API account. */
	usesSubscription?: boolean;
}

/** Installation/version, plus (Fork) the Settings-only auth report. Never a quota or billing verdict. */
export interface ClaudeCodeStatus {
	state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
	version: string | null;
	minimumVersion: string;
	auth?: ClaudeCodeAuth;
}

// --permission-prompts none was added in 2.1.259. This is not an official
// minimum-version/stability contract for claudecode/toolUseId; admission fails closed.
export const CLAUDE_CODE_MINIMUM_VERSION = "2.1.259";
