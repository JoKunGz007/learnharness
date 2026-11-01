import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatFiveHourPct, formatChatShare, modelPrice, requestDollars, windowStart, WINDOW_MS } from "../src/core/chat-share.ts";

const H = "claude-code:claude-haiku-5-5";
const step = (inputTokens: number, cacheWriteTokens: number, cacheReadTokens: number, outputTokens: number) =>
	({ inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, reasoningTokens: undefined });
const now = Date.parse("2026-11-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("chat share of the 5h limit", () => {
	it("prices: Haiku 5.5 tier at 100k prompt", () => {
		assert.deepEqual(modelPrice(H, 100_000), [0.1, 0.01]);
		assert.deepEqual(modelPrice(H, 100_001), [0.5, 0.05]);
		assert.deepEqual(modelPrice("claude-opus-4-1", 0), [15, 1.5]);
		assert.deepEqual(modelPrice("claude-opus-5-5", 0), [4, 0.2]);
		assert.deepEqual(modelPrice("claude-sonnet-4-5", 0), [3, 0.3]);
		assert.deepEqual(modelPrice("<synthetic>", 0), [0, 0]);
	});
	it("request dollars: (p*(in+2w+5out)+read*r)/1e6", () => {
		// 0.1*(1000+20000+5000) + 0.01*50000 = 2600+500 = 3100 -> $0.0031
		assert.ok(Math.abs(requestDollars(H, step(1000, 10_000, 50_000, 1000)) - 0.0031) < 1e-12);
		assert.equal(requestDollars(H, {}), 0);
	});
	it("window start", () => {
		assert.equal(windowStart(now + 3600_000, now), now + 3600_000 - WINDOW_MS);
		assert.equal(windowStart(now - 1, now), now - WINDOW_MS);
		assert.equal(windowStart(null, now), now - WINDOW_MS);
	});
	it("counts turns and jobs in the window, CLI models only", () => {
		const since = now - WINDOW_MS;
		const s = step(1000, 10_000, 50_000, 1000); // $0.0031
		const turns = [
			{ at: iso(now - 1000), model: H, steps: [s, s] },           // counted: 0.0062
			{ at: iso(since - 1000), model: H, steps: [s] },            // before window
			{ at: iso(now - 1000), model: "anthropic:claude-haiku-5-5", steps: [s] }, // not CLI
		];
		const jobs = [
			{ updatedAt: iso(now - 500), usage: { model: H, ...s, steps: 1, calls: [s] } },  // counted: 0.0031
			{ updatedAt: iso(since - 5), usage: { model: H, ...s, steps: 1 } },              // before window
			{ updatedAt: iso(now), usage: undefined },
		];
		const pct = chatFiveHourPct(turns, jobs, since);
		assert.ok(Math.abs(pct - 0.0093 / 0.38) < 1e-9);
		assert.equal(chatFiveHourPct([], [], since), 0);
	});
	it("formats", () => {
		assert.equal(formatChatShare(0.049), "<0.1%");
		assert.equal(formatChatShare(0.05), "~0.1%");
		assert.equal(formatChatShare(3.04), "~3%");
		assert.equal(formatChatShare(3.26), "~3.3%");
	});
});
