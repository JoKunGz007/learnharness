import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeSessionId } from "../src/agent/claude-code/env.ts";
import { toClaudeArgs } from "../src/agent/claude-code/stream.ts";
import { toClaudeInput } from "../src/agent/claude-code/transcript.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("claudeSessionId (stable --session-id per conversation key)", () => {
	it("derives a valid UUID from a chat id, the same one every turn", () => {
		const id = claudeSessionId("chat_mvp5xdp0_60fa4f5c");
		assert.match(id, UUID);
		assert.equal(claudeSessionId("chat_mvp5xdp0_60fa4f5c"), id);
	});
	it("gives different chats different ids", () => assert.notEqual(claudeSessionId("chat_a"), claudeSessionId("chat_b")));
	it("passes an existing UUID key through", () => {
		assert.equal(claudeSessionId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
	});
	it("toClaudeArgs adds --session-id only when a key is given, and uses empty --setting-sources", () => {
		const base = { model: "m", effort: "low" as const, systemPromptFile: "s", mcpConfigFile: "c", allowedTools: [] };
		const withId = toClaudeArgs({ ...base, sessionId: "chat_a" });
		assert.equal(withId[withId.indexOf("--session-id") + 1], claudeSessionId("chat_a"));
		assert.ok(!toClaudeArgs(base).includes("--session-id"));
		assert.equal(withId[withId.indexOf("--setting-sources") + 1], "");
	});
});

describe("toClaudeInput cache breakpoint", () => {
	it("marks the last history block, never the newest message", () => {
		const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const { userContent } = toClaudeInput([
			{ role: "user", content: "what is a prime?", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Two divisors." }], api: "x", provider: "x", model: "x", usage, stopReason: "stop", timestamp: 2 },
			{ role: "user", content: "is 9 prime?", timestamp: 3 },
		] as never);
		const marked = userContent.map((b, i) => (b.cache_control ? i : -1)).filter((i) => i >= 0);
		assert.deepEqual(marked, [userContent.length - 2]);
		assert.match((userContent.at(-1) as { text: string }).text, /is 9 prime\?/);
	});
	it("a first turn carries no breakpoint", () => {
		const { userContent } = toClaudeInput([{ role: "user", content: "hi", timestamp: 1 }] as never);
		assert.ok(userContent.every((b) => !b.cache_control));
	});
});
