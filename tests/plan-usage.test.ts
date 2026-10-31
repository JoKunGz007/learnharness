import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearPlanUsage, parseRateLimitInfo, planUsage, recordPlanUsage } from "../src/agent/claude-code/plan-usage.ts";

const event = (windows: unknown) => ({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: windows } });
const full = { five_hour: { utilization: 0.25, resetsAt: 1793025600 }, seven_day: { utilization: 0.57, resetsAt: 1793401200 } };

describe("plan usage", () => {
	beforeEach(() => clearPlanUsage());

	it("parses both windows (fraction → percent, seconds → ms)", () => {
		assert.deepEqual(parseRateLimitInfo(event(full).rate_limit_info), { fiveHour: { pct: 25, resetsAt: 1793025600_000 }, sevenDay: { pct: 57, resetsAt: 1793401200_000 } });
	});
	it("missing seven_day → sevenDay null", () => {
		const r = parseRateLimitInfo(event({ five_hour: full.five_hour }).rate_limit_info);
		assert.equal(r?.sevenDay, null);
		assert.equal(r?.fiveHour?.pct, 25);
	});
	it("garbage → null, no throw", () => {
		for (const bad of [null, undefined, 5, "x", {}, { unifiedWindows: 3 }, { unifiedWindows: { five_hour: { utilization: "a" } } }]) assert.equal(parseRateLimitInfo(bad), null);
	});
	it("store keeps the latest reading", () => {
		assert.equal(planUsage("claude-code"), null);
		recordPlanUsage("claude-code", parseRateLimitInfo(event(full).rate_limit_info)!, 5);
		assert.equal(planUsage("claude-code")?.at, 5);
		assert.equal(planUsage("claude-code")?.sevenDay?.pct, 57);
	});
});
