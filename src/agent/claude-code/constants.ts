export { CLAUDE_CODE_PROVIDER } from "../../core/contracts/claude-code.ts";

export const CLAUDE_CODE_API = "claude-code-cli";

/** Fork: one refusal text for background work while the claude-code toggle is off (dispatch gate + in-run backstop). */
export const CLAUDE_CODE_BACKGROUND_OFF = "Claude Code background use is off in this app. Enable it in Providers to run this work.";

export enum ClaudeCodeError {
	CliNotFound = "claude CLI not found",
	NotSignedIn = "not signed in",
}
