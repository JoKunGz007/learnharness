import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { claudeLineHandler } from "../src/agent/local-agents/claude.ts";
import { clearPlanUsage, parseRateLimitInfo, planUsage } from "../src/agent/local-agents/plan-usage.ts";

const event = (windows: unknown) => ({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: windows } });
const full = { five_hour: { utilization: 0.25, resetsAt: 1793025600 }, seven_day: { utilization: 0.57, resetsAt: 1793401200 } };

describe("plan usage", () => {
	beforeEach(() => clearPlanUsage());

	it("parses both windows (fraction → percent, seconds → ms)", () => {
		const r = parseRateLimitInfo(event(full).rate_limit_info);
		assert.deepEqual(r, { fiveHour: { pct: 25, resetsAt: 1793025600_000 }, sevenDay: { pct: 57, resetsAt: 1793401200_000 } });
	});

	it("missing seven_day → sevenDay null", () => {
		const r = parseRateLimitInfo(event({ five_hour: full.five_hour }).rate_limit_info);
		assert.equal(r?.sevenDay, null);
		assert.equal(r?.fiveHour?.pct, 25);
	});

	it("garbage → null, no throw", () => {
		for (const bad of [null, undefined, 5, "x", {}, { unifiedWindows: 3 }, { unifiedWindows: { five_hour: { utilization: "a" } } }]) assert.equal(parseRateLimitInfo(bad), null);
	});

	it("claudeLineHandler records a valid event and ignores garbage", () => {
		const handle = claudeLineHandler({} as never, false);
		handle({ type: "rate_limit_event", rate_limit_info: "junk" });
		handle({ type: "rate_limit_event" });
		assert.equal(planUsage("claude-code"), null);
		handle(event(full));
		const u = planUsage("claude-code");
		assert.equal(u?.fiveHour?.pct, 25);
		assert.equal(u?.sevenDay?.pct, 57);
		assert.ok(typeof u?.at === "number");
	});
});
