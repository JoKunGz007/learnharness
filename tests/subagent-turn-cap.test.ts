import { test } from "node:test";
import assert from "node:assert/strict";
import { addLiveProcess, getLiveProcess, killLiveProcessesForSession, removeLiveProcess, type LiveProcess } from "../src/agent/claude-code/live-processes.ts";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { isModelCall, runSubagent } from "../src/agent/subagents/pi-run.ts";

const usage = (output: number) => ({ input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

test("claude-code tool-batch slices don't spend maxTurns", () => {
	assert.equal(isModelCall({ provider: "claude-code", usage: usage(347) }), true);
	assert.equal(isModelCall({ provider: "claude-code", usage: usage(0) }), false);
});

test("the failed job's 12 slices count as 4 model calls", () => {
	const outputs = [347, 0, 0, 308, 0, 0, 571, 0, 0, 506, 0, 0];
	assert.equal(outputs.filter((output) => isModelCall({ provider: "claude-code", usage: usage(output) })).length, 4);
});

test("a provider reporting no usage still hits the cap", () => {
	assert.equal(isModelCall({ provider: "openrouter", usage: usage(0) }), true);
});

test("ending a run kills only that session's live process", () => {
	const owner = Symbol("owner");
	const killed: string[] = [];
	const live = (sessionId: string, toolCallIds: string[]): LiveProcess => ({ owner, sessionId, toolCallIds, kill: () => killed.push(sessionId) });
	const ended = live("ended", ["a"]);
	const other = live("other", ["b"]);
	addLiveProcess(ended);
	addLiveProcess(other);
	killLiveProcessesForSession("ended");
	assert.deepEqual(killed, ["ended"]);
	assert.equal(getLiveProcess(["a"], owner, "ended"), null);
	assert.equal(getLiveProcess(["b"], owner, "other"), other);
	removeLiveProcess(other);
});

test("a claude-code run that never reports usage still stops", async () => {
	let requests = 0;
	const model = { api: "faux", provider: "claude-code", id: "faux", contextWindow: 8192 } as never;
	const stop = new AbortController();
	const streamFn = (() => {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = { role: "assistant", content: [{ type: "toolCall", id: `c${++requests}`, name: "noop", arguments: {} }], api: "faux", provider: "claude-code", model: "faux", usage: usage(0), stopReason: "toolUse", timestamp: 0 };
		if (requests > 200) stop.abort();
		queueMicrotask(() => { stream.push({ type: "done", reason: "toolUse", message }); stream.end(); });
		return stream;
	}) as never;
	const noop = { name: "noop", label: "noop", description: "noop", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) } as never;
	await runSubagent([noop], { role: "researcher", engine: { model, streamFn } as never, systemPrompt: "Fixture", prompt: "Fixture", maxTurns: 3, abortSignal: stop.signal }).catch(() => {});
	assert.ok(requests <= 12, `stopped after ${requests} messages`);
});
