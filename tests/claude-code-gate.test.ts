// Fork: one background gate for claude-code (seam in subscription-connections), dispatch refusal, wake on toggle.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "lh-cc-gate-data-"));
process.env.LH_DATA_DIR = testData;
after(() => rmSync(testData, { recursive: true, force: true }));
const { connectionBackgroundAllowed, onSubscriptionChange } = await import("../src/agent/subscription-connections.ts");
const { PUT } = await import("../app/api/settings/[section]/route.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { automaticFollowUpAllowed } = await import("../src/server/jobs.ts"); // installs the gate
const { piEngineForSpec } = await import("../src/agent/models.ts");
const { CLAUDE_CODE_MODELS } = await import("../src/agent/claude-code/provider.ts");

const save = (body: unknown) => PUT(new Request("http://test/api/settings/claudeCode", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ section: "claudeCode" }) });
const REFUSAL = /Claude Code background use is off in this app\. Enable it in Providers to run this work\./;
const spec = { provider: "claude-code", id: CLAUDE_CODE_MODELS[0]!.id };
async function failure(engine: ReturnType<typeof piEngineForSpec>, signal?: AbortSignal): Promise<string | undefined> {
	const ctx = { systemPrompt: "s", messages: [{ role: "user" as const, content: "hi", timestamp: 0 }], tools: [] };
	const stream = engine.streamFn(engine.model, ctx as never, { signal } as never);
	for await (const event of stream) if (event.type === "error") return event.error.errorMessage;
	return undefined;
}

test("the gate follows the toggle; background refused at dispatch, foreground never", async () => {
	writeSettings({ version: 1, claudeCode: { enabled: true, allowBackgroundUse: false } });
	assert.equal(connectionBackgroundAllowed("claude-code"), false);
	assert.equal(automaticFollowUpAllowed("none", { state: { model: { provider: "claude-code" } } } as never), false);
	assert.match((await failure(piEngineForSpec(spec as never, true))) ?? "", REFUSAL);
	assert.match((await failure(piEngineForSpec(spec as never, () => true))) ?? "", REFUSAL);
	const aborted = AbortSignal.abort(); // no CLI is spawned; the foreground error must not be the refusal
	assert.doesNotMatch((await failure(piEngineForSpec(spec as never, false), aborted)) ?? "", REFUSAL);
	writeSettings({ version: 1, claudeCode: { enabled: true } });
	assert.equal(connectionBackgroundAllowed("claude-code"), true);
	assert.doesNotMatch((await failure(piEngineForSpec(spec as never, true), aborted)) ?? "", REFUSAL);
	assert.equal(connectionBackgroundAllowed("openrouter"), true);
});

test("steers on claude-code with the toggle off get the 403", async () => {
	const { chatStore } = await import("../src/store/chats.ts");
	const { handleChatInput } = await import("../src/server/chat-handler.ts");
	writeSettings({ version: 1, claudeCode: { enabled: true, allowBackgroundUse: false } });
	const chat = chatStore.createChat("gate");
	chatStore.saveSettings(chat.id, { model: spec } as never);
	const res = await handleChatInput(chat.id, { type: "steers", steers: [{ id: "s1", role: "user", content: "x", timestamp: 1 }] } as never);
	assert.equal(res.status, 403);
	chatStore.deleteChat(chat.id);
});

test("saving claudeCode settings notifies change listeners; unsubscribed listeners are not called", async () => {
	let calls = 0;
	const stop = onSubscriptionChange(() => { calls++; });
	await save({ enabled: true, allowBackgroundUse: false });
	assert.equal(calls, 1);
	await save({ enabled: true, allowBackgroundUse: true });
	assert.equal(calls, 2);
	stop();
	await save({ enabled: true });
	assert.equal(calls, 2);
});
