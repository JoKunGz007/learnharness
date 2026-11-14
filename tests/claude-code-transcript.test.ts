/**
 * Claude Code transcript replay (src/agent/claude-code/transcript.ts).
 *
 * The CLI makes one model call per input user message, so earlier turns are
 * rendered as labelled text inside the single user message it receives.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, Message, SystemMessage, Tool, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

import { toClaudeInput, toStreamJsonLine } from "../src/agent/claude-code/transcript.ts";

const READ_TOOL: Tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } };
const WRITE_TOOL: Tool = { name: "write", description: "Write a file", parameters: { type: "object", properties: {} } };

function system(fields: Partial<SystemMessage>): SystemMessage {
	return { role: "system", content: "", timestamp: 0, ...fields };
}

function user(content: UserMessage["content"]): UserMessage {
	return { role: "user", content, timestamp: 0 };
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "claude-code-cli",
		provider: "claude-code",
		model: "opus",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

function toolResult(toolName: string, content: ToolResultMessage["content"], isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId: `${toolName}-1`, toolName, content, isError, timestamp: 0 };
}

test("system prompt joins all system content, then the live sections", () => {
	const messages: Message[] = [
		system({ content: "You are a tutor.", sections: { goals: "Teach TCP.", style: "Be brief." } }),
		user("hi"),
		system({ content: "The learner switched topics.", sections: { goals: "Teach TLS.", style: null } }),
		user("next"),
	];
	assert.equal(toClaudeInput(messages).systemPrompt, "You are a tutor.\n\nThe learner switched topics.\n\nTeach TLS.");
});

test("tools reflect toolsAdded minus toolsRemoved", () => {
	const messages: Message[] = [
		system({ content: "p", toolsAdded: [READ_TOOL, WRITE_TOOL] }),
		user("hi"),
		system({ toolsRemoved: [{ name: "read" }] }),
		user("next"),
	];
	assert.deepEqual(
		toClaudeInput(messages).tools.map((t) => t.name),
		["write"],
	);
});

test("single user message passes through as text", () => {
	const input = toClaudeInput([system({ content: "p" }), user("what is a socket?")]);
	assert.deepEqual(input.userContent, [{ type: "text", text: "what is a socket?" }]);
});

// Fork: the last re-sent history block carries a prompt-cache breakpoint; the newest message is its own block.
const CC = { cache_control: { type: "ephemeral", ttl: "1h" } } as const;

test("history renders user, assistant text, tool call name+JSON args and tool result text in order before the latest user message", () => {
	const messages: Message[] = [
		user([{ type: "text", text: "open notes.md" }]),
		assistant([
			{ type: "text", text: "Reading it." },
			{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "notes.md" } },
		]),
		toolResult("read", [{ type: "text", text: "# Notes" }]),
		assistant([{ type: "text", text: "It has a heading." }]),
		user("summarise it"),
	];
	const expected = [
		"[user]\nopen notes.md",
		"[assistant]\nReading it.",
		'[tool call read] {"path":"notes.md"}',
		"[tool result read]\n# Notes",
		"[assistant]\nIt has a heading.",
	].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected, ...CC }, { type: "text", text: "[user]\nsummarise it" }]);
});

test("error tool results are marked as errors in the replay", () => {
	const messages: Message[] = [
		user("open missing.md"),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "missing.md" } }]),
		toolResult("read", [{ type: "text", text: "ENOENT" }], true),
		user("why?"),
	];
	const expected = [
		"[user]\nopen missing.md",
		'[tool call read] {"path":"missing.md"}',
		"[tool result read error]\nENOENT",
	].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected, ...CC }, { type: "text", text: "[user]\nwhy?" }]);
});

test("images in user and tool-result content become base64 image blocks", () => {
	const messages: Message[] = [
		user([
			{ type: "text", text: "look" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]),
		assistant([{ type: "toolCall", id: "shot-1", name: "screenshot", arguments: {} }]),
		toolResult("screenshot", [{ type: "image", data: "BBBB", mimeType: "image/jpeg" }]),
		user("compare"),
	];
	assert.deepEqual(toClaudeInput(messages).userContent, [
		{ type: "text", text: "[user]\nlook" },
		{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
		{ type: "text", text: "[tool call screenshot] {}\n\n[tool result screenshot]" },
		{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" }, ...CC },
		{ type: "text", text: "[user]\ncompare" },
	]);
});

test("transcript ending on a tool result renders as history with no trailing user turn", () => {
	const messages: Message[] = [
		user("open notes.md"),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "notes.md" } }]),
		toolResult("read", [{ type: "text", text: "# Notes" }]),
	];
	const expected = ["[user]\nopen notes.md", '[tool call read] {"path":"notes.md"}'].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected, ...CC }, { type: "text", text: "[tool result read]\n# Notes" }]);
});

test("thinking blocks are omitted from replay", () => {
	const messages: Message[] = [
		user("hi"),
		assistant([
			{ type: "thinking", thinking: "secret plan" },
			{ type: "text", text: "Hello." },
		]),
		user("bye"),
	];
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: "[user]\nhi\n\n[assistant]\nHello.", ...CC }, { type: "text", text: "[user]\nbye" }]);
});

// Fork: a cache entry matches only on whole blocks, so full history chunks must reappear unchanged
// next turn, and the breakpoint must sit on a boundary that survives (the last full chunk).
test("full history chunks are stable across turns and carry the breakpoint", () => {
	// A lesson: one user message, then answers arrive as tool results.
	const lesson = (rounds: number): Message[] => [
		user("teach me"),
		...Array.from({ length: rounds }, (_, i) => [
			assistant([{ type: "toolCall", id: `q-${i}`, name: "quiz", arguments: { n: i } }]),
			toolResult("quiz", [{ type: "text", text: `answer ${i}` }]),
		]).flat(),
	];
	const strip = (blocks: object[]) => blocks.map((block) => ({ ...block, cache_control: undefined }));
	const marked = (blocks: { cache_control?: unknown }[]) => blocks.flatMap((block, i) => (block.cache_control ? [i] : []));

	const earlier = toClaudeInput(lesson(6)).userContent; // history 12 = one full chunk + 4
	const later = toClaudeInput(lesson(11)).userContent; // history 22 = two full chunks + 6
	assert.equal(earlier.length, 3);
	assert.deepEqual(marked(earlier), [0]);
	assert.equal(later.length, 4);
	assert.deepEqual(marked(later), [1]);
	assert.deepEqual(strip(later)[0], strip(earlier)[0]);
});

test('toStreamJsonLine emits {"type":"user","message":{"role":"user","content":[...]}}', () => {
	assert.deepEqual(JSON.parse(toStreamJsonLine([{ type: "text", text: "hi" }])), {
		type: "user",
		message: { role: "user", content: [{ type: "text", text: "hi" }] },
	});
});
