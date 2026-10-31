/**
 * Claude Code provider catalog (src/agent/claude-code/provider.ts).
 *
 * Registered on a fresh pi model collection with a stub stream function, so
 * only the catalog and auth surface are under test here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { clampThinkingLevel, createAssistantMessageEventStream, createModels, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import { CLAUDE_CODE_PROVIDER } from "../src/agent/claude-code/constants.ts";
import { CLAUDE_CODE_MODELS, createClaudeCodeProvider } from "../src/agent/claude-code/provider.ts";

function createCollection() {
	const collection = createModels();
	collection.setProvider(createClaudeCodeProvider(() => createAssistantMessageEventStream()));
	return collection;
}

// Fork: pinned ids (pi-ai's Anthropic catalog minus dated snapshots), not aliases.
test("lists pinned claude-* ids, including the 5-5 generation, and no aliases or dated snapshots", () => {
	const ids = createCollection().getModels(CLAUDE_CODE_PROVIDER).map((m) => m.id);
	for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) assert(ids.includes(id), id);
	assert(ids.every((id) => id.startsWith("claude-") && !/-\d{8}$/.test(id)));
});

test("supports off, low through max thinking; minimal clamps to low", () => {
	for (const model of createCollection().getModels(CLAUDE_CODE_PROVIDER)) {
		assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "medium", "high", "xhigh", "max"]);
		assert.equal(clampThinkingLevel(model, "off"), "off"); // Fork: off is real
		assert.equal(clampThinkingLevel(model, "minimal"), "low");
	}
});

test("accepts text and image input", () => {
	for (const model of createCollection().getModels(CLAUDE_CODE_PROVIDER)) {
		assert.deepEqual(model.input, ["text", "image"]);
	}
});

test("every cost field is zero", () => {
	for (const model of createCollection().getModels(CLAUDE_CODE_PROVIDER)) {
		assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	}
});

test("auth resolves as configured without any key", async () => {
	const collection = createCollection();
	assert.ok(await collection.checkAuth(CLAUDE_CODE_PROVIDER));
	assert.equal((await collection.getAvailable(CLAUDE_CODE_PROVIDER)).length, CLAUDE_CODE_MODELS.length); // Fork: pinned list
});
