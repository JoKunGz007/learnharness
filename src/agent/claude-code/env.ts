import { createHash } from "node:crypto";
import { externalCliEnv } from "../../core/auth-env.ts";

// Fork: variables that would silently move Claude Code off the learner's subscription.
const SCRUBBED_ENV = [
	"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_MODEL",
	"ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
	"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT",
];

/** Fork: externalCliEnv (no app-held keys) minus auth reroutes, so usage always bills the subscription.
 *  Used by every CLI call (turns and the version probe). */
export function claudeChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = externalCliEnv(base);
	// Case-insensitive: Windows env names are, so `anthropic_api_key` reaches the child as ANTHROPIC_API_KEY.
	const scrubbed = new Set(SCRUBBED_ENV);
	for (const key of Object.keys(env)) if (scrubbed.has(key.toUpperCase())) delete env[key];
	return env;
}

/** Fork: extra settings for turn processes. The app owns compaction and the tool surface;
 *  tool results reach the model whole, as on API connections. */
export const CLAUDE_TURN_ENV = { DISABLE_AUTO_COMPACT: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "0", MAX_MCP_OUTPUT_TOKENS: "200000" } as const;

/** Fork: stable --session-id per LearnHarness session. Claude Code writes its session id into the
 *  prompt, so a random one per process missed the prompt cache on every turn. */
export function claudeSessionId(key: string): string {
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key.toLowerCase();
	const h = createHash("sha256").update(`learnharness:${key}`).digest("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
