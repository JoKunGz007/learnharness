import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createProvider, type Api, type Model, type Provider, type SimpleStreamOptions, type StreamFunction } from "@earendil-works/pi-ai";

import { CLAUDE_CODE_API, CLAUDE_CODE_PROVIDER } from "./constants.ts";

const SHARED_MODEL_FIELDS = {
	api: CLAUDE_CODE_API,
	provider: CLAUDE_CODE_PROVIDER,
	baseUrl: "",
	input: ["text", "image"],
	// Pi-required placeholders, not prices: the CLI's own auth/routing
	// determines charges. Server pricing and the client catalog report unpriced.
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: true,
	// Fork: off is supported (no --effort, MAX_THINKING_TOKENS=0; see stream.ts); minimal has no CLI effort and clamps to low.
	thinkingLevelMap: { minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
	contextWindow: 1_000_000,
	maxTokens: 128_000,
} satisfies Omit<Model<Api>, "id" | "name">;

// Fork: pinned ids instead of the opus/sonnet/haiku aliases, so saved `claude-code:claude-*-5-5`
// settings keep working. Same list the old local provider offered: pi-ai's Anthropic catalog minus dated snapshots.
export const CLAUDE_CODE_MODELS: readonly Model<Api>[] = (builtinProviders().find((provider) => provider.id === "anthropic")?.getModels() ?? [])
	.filter((model) => !/-\d{8}$/.test(model.id))
	.map((model) => ({ ...SHARED_MODEL_FIELDS, id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens }));

export function createClaudeCodeProvider(streamSimple: StreamFunction<Api, SimpleStreamOptions>): Provider {
	return createProvider({
		id: CLAUDE_CODE_PROVIDER,
		name: "Claude Code",
		auth: { apiKey: { name: "Claude Code CLI", resolve: async () => ({ auth: {}, source: "claude CLI" }) } },
		models: CLAUDE_CODE_MODELS,
		api: { stream: streamSimple, streamSimple },
	});
}
