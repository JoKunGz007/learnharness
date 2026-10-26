import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeSessionId } from "../src/agent/local-agents/claude.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("claudeSessionId (stable --session-id per conversation key)", () => {
	it("derives a valid UUID from a chat id, the same one every turn", () => {
		const id = claudeSessionId("chat_mvp5xdp0_60fa4f5c");
		assert.match(id, UUID);
		assert.equal(claudeSessionId("chat_mvp5xdp0_60fa4f5c"), id);
	});

	it("gives different chats different ids", () => {
		assert.notEqual(claudeSessionId("chat_a"), claudeSessionId("chat_b"));
	});

	it("passes an existing UUID key through (background jobs already use one)", () => {
		assert.equal(claudeSessionId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
	});
});

describe("renderTranscript cache bookmark", () => {
	it("marks the last history block, never the current turn's blocks", async () => {
		const { renderTranscript } = await import("../src/agent/local-agents/transcript.ts");
		const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const blocks = renderTranscript([
			{ role: "user", content: "what is a prime?", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Two divisors." }], api: "x", provider: "x", model: "x", usage, stopReason: "stop", timestamp: 2 },
			{ role: "user", content: "is 9 prime?", timestamp: 3 },
		] as never, { images: false });
		const marked = blocks.map((b, i) => (b.cacheBreak ? i : -1)).filter((i) => i >= 0);
		assert.deepEqual(marked, [blocks.length - 2], "the block before the current message");
		assert.equal((blocks.at(-1) as { text?: string }).text, "is 9 prime?");
	});

	it("a first turn (no history) carries no bookmark", async () => {
		const { renderTranscript } = await import("../src/agent/local-agents/transcript.ts");
		const blocks = renderTranscript([{ role: "user", content: "hi", timestamp: 1 }] as never, { images: false });
		assert.ok(blocks.every((b) => !b.cacheBreak));
	});
});
