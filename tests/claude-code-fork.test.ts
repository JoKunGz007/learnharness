// Fork: plan-usage route, auth-status parser and the background-use gate.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "lh-cc-fork-data-"));
process.env.LH_DATA_DIR = testData;
after(() => rmSync(testData, { recursive: true, force: true }));
const { GET } = await import("../app/api/claude-code/usage/route.ts");
const { recordPlanUsage, clearPlanUsage } = await import("../src/agent/claude-code/plan-usage.ts");
const { parseClaudeAuth, inspectClaudeAuth } = await import("../src/agent/claude-code/auth-status.ts");
const { PUT } = await import("../app/api/settings/[section]/route.ts");
const { claudeCodeBackgroundAllowed } = await import("../src/server/claude-code-config.ts");
const { automaticFollowUpAllowed } = await import("../src/server/jobs.ts");
const { sanitizeUserSettings } = await import("../src/core/settings.ts");
const { writeSettings, readSettings } = await import("../src/store/settings.ts");
const { claudeCodeAuthLines } = await import("../components/settings/claude-code-status.tsx");

test("usage route returns the latest reading keyed by provider, null before any", async () => {
	clearPlanUsage();
	assert.deepEqual(await (await GET()).json(), { "claude-code": null });
	recordPlanUsage("claude-code", { fiveHour: { pct: 12, resetsAt: 1000 }, sevenDay: null }, 5);
	assert.deepEqual(await (await GET()).json(), { "claude-code": { fiveHour: { pct: 12, resetsAt: 1000 }, sevenDay: null, at: 5 } });
	clearPlanUsage();
});

test("auth parser: signed in, signed out, uncertain; never throws", async () => {
	assert.deepEqual(parseClaudeAuth(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max_5x", email: "a@b.c" })),
		{ state: "signed-in", account: "a@b.c", plan: "Max 5x", usesSubscription: true });
	assert.equal(parseClaudeAuth(JSON.stringify({ loggedIn: true, authMethod: "api_key" })).usesSubscription, false);
	assert.deepEqual(parseClaudeAuth(JSON.stringify({ loggedIn: false })), { state: "signed-out" });
	for (const bad of ["", "not json", "null", "{}", '{"loggedIn":"yes"}']) assert.deepEqual(parseClaudeAuth(bad), { state: "uncertain" });
	assert.deepEqual(await inspectClaudeAuth("claude", async () => { throw new Error("timeout"); }), { state: "uncertain" });
	assert.deepEqual(await inspectClaudeAuth("claude", async (bin) => { assert.equal(bin, "claude"); return '{"loggedIn":false}'; }), { state: "signed-out" });
});

test("auth lines reuse the old wording", () => {
	assert.deepEqual(claudeCodeAuthLines({ state: "signed-in", account: "a@b.c", plan: "Pro", usesSubscription: true }), { text: "Signed in as a@b.c · Pro plan." });
	assert.match(claudeCodeAuthLines({ state: "signed-in", usesSubscription: false })!.warning ?? "", /billed to that account/);
	assert.match(claudeCodeAuthLines({ state: "signed-out" })!.text, /claude auth login/);
	assert.equal(claudeCodeAuthLines(undefined), null);
});

test("background use: needs the opt-in, defaults on, toggle off blocks automatic follow-ups; settings round-trip", async (t) => {
	const previous = readSettings();
	t.after(() => { if (previous) writeSettings(previous); });
	const save = (body: unknown) => PUT(new Request("http://test/api/settings/claudeCode", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ section: "claudeCode" }) });
	writeSettings({ version: 1 });
	assert.equal(claudeCodeBackgroundAllowed(), false); // not opted in
	assert.equal((await save({ enabled: true })).status, 200);
	assert.equal(claudeCodeBackgroundAllowed(), true); // old default: on
	assert.equal((await save({ enabled: true, allowBackgroundUse: false })).status, 200);
	assert.equal(claudeCodeBackgroundAllowed(), false);
	assert.equal(readSettings()?.claudeCode?.allowBackgroundUse, false);
	assert.equal((await save({ enabled: true, allowBackgroundUse: "no" })).status, 400);
	assert.deepEqual(sanitizeUserSettings({ version: 1, claudeCode: { enabled: true, allowBackgroundUse: 0 } })?.claudeCode, { enabled: true });
	// the wake pipeline resolves the provider from the chat's strong model when no agent is given
	const fake = { state: { model: { provider: "claude-code" } } } as never;
	assert.equal(automaticFollowUpAllowed("none", fake), false);
	await save({ enabled: true, allowBackgroundUse: true });
	assert.equal(automaticFollowUpAllowed("none", fake), true);
});
