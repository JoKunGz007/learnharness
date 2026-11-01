import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { LESSON_TEXT_REFUSAL, LESSON_TEXT_REFUSAL_MARKER, lessonTextRefusal } from "../src/agent/lesson-text-gate.ts";
import { createTeacherAgent, createProberAgent } from "../src/agent/teacher-agent.ts";

const engine = {
	model: { api: "faux", provider: "faux", id: "faux-model", contextWindow: 8192 } as never,
	streamFn: (async () => { throw new Error("not streamed in this test"); }) as never,
};
const user =(text: string) => ({ role: "user", content: text, timestamp: 0 }) as unknown as AgentMessage;
const asst = (content: unknown[]) => ({ role: "assistant", content, stopReason: "toolUse", timestamp: 0 }) as unknown as AgentMessage;
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({ type: "toolCall", id, name, arguments: args });
const text = (t: string) => ({ type: "text", text: t });
const thinking = (t: string) => ({ type: "thinking", thinking: t });
const sendMsg = (id: string, message: string) => call(id, "send_to_user", { message });
const answer = (id: string, name = "quiz") => ({
	role: "toolResult", toolCallId: id, toolName: name, isError: false, timestamp: 0,
	content: [{ type: "text", text: "{}" }],
	details: { kind: name === "quiz" ? "quiz" : "ask", questionText: "q", dontKnow: false, answers: [], answeredAt: "2026-11-01T00:00:00Z" },
}) as unknown as AgentMessage;
const refusal = (id: string, name = "quiz") => ({
	role: "toolResult", toolCallId: id, toolName: name, isError: true, timestamp: 0,
	content: [{ type: "text", text: LESSON_TEXT_REFUSAL }],
}) as unknown as AgentMessage;

/** Run the gate on the call `id` inside `current`, with `earlier` already in context. */
function gate(earlier: AgentMessage[], current: unknown[], id: string, name: string, args: Record<string, unknown> = {}, enforce = true) {
	const cur = asst(current);
	return lessonTextRefusal({ toolName: name, toolCallId: id, args, messages: [...earlier, cur], assistantContent: current as never, enforce: () => enforce });
}

test("refuses a check quiz when the turn holds only thinking", () => {
	const r = gate([user("hi")], [thinking("hmm"), call("q1", "quiz", { type: "check" })], "q1", "quiz", { type: "check" });
	assert.equal(r, LESSON_TEXT_REFUSAL);
	assert.ok(LESSON_TEXT_REFUSAL.startsWith(LESSON_TEXT_REFUSAL_MARKER));
	assert.match(LESSON_TEXT_REFUSAL, /send_to_user/);
});

test("an absent type counts as check", () => {
	assert.equal(gate([user("hi")], [call("q1", "quiz")], "q1", "quiz"), LESSON_TEXT_REFUSAL);
});

test("passes when a text block came before the call", () => {
	assert.equal(gate([user("hi")], [text("Here is the idea."), call("q1", "quiz", { type: "check" })], "q1", "quiz", { type: "check" }), undefined);
});

test("text AFTER the call in the same message does not count", () => {
	assert.equal(gate([user("hi")], [call("q1", "quiz"), text("late")], "q1", "quiz"), LESSON_TEXT_REFUSAL);
});

test("passes with send_to_user earlier in the same message", () => {
	assert.equal(gate([user("hi")], [sendMsg("s1", "Lesson."), call("q1", "quiz")], "q1", "quiz"), undefined);
});

test("passes with text or send_to_user in an earlier assistant message of the beat", () => {
	assert.equal(gate([user("hi"), asst([sendMsg("s1", "Lesson.")])], [call("q1", "quiz")], "q1", "quiz"), undefined);
	assert.equal(gate([user("hi"), asst([text("Lesson.")])], [call("q1", "ask_user_question")], "q1", "ask_user_question"), undefined);
});

test("blank text and blank send_to_user do not count", () => {
	assert.equal(gate([user("hi")], [text("  \n"), sendMsg("s1", "   "), call("q1", "quiz")], "q1", "quiz"), LESSON_TEXT_REFUSAL);
});

test("predict is exempt, including a debris-wrapped value", () => {
	assert.equal(gate([user("hi")], [call("q1", "quiz", { type: "predict" })], "q1", "quiz", { type: "predict" }), undefined);
	assert.equal(gate([user("hi")], [call("q1", "quiz", { type: '"predict"' })], "q1", "quiz", { type: '"predict"' }), undefined);
});

test("ask_user_question is refused without text", () => {
	assert.equal(gate([user("hi")], [thinking("x"), call("a1", "ask_user_question")], "a1", "ask_user_question"), LESSON_TEXT_REFUSAL);
});

test("other tools are never gated", () => {
	assert.equal(gate([user("hi")], [call("t1", "plan_init")], "t1", "plan_init"), undefined);
});

test("the second attempt in the same beat passes", () => {
	const first = asst([call("q1", "quiz")]);
	const r = lessonTextRefusal({
		toolName: "quiz", toolCallId: "q2", args: {}, enforce: () => true,
		messages: [user("hi"), first, refusal("q1"), asst([thinking("again"), call("q2", "quiz")])],
		assistantContent: [thinking("again"), call("q2", "quiz")],
	});
	assert.equal(r, undefined);
});

test("a refusal of an ask also lets a following quiz through", () => {
	const r = lessonTextRefusal({
		toolName: "quiz", toolCallId: "q2", args: {}, enforce: () => true,
		messages: [user("hi"), asst([call("a1", "ask_user_question")]), refusal("a1", "ask_user_question"), asst([call("q2", "quiz")])],
		assistantContent: [call("q2", "quiz")],
	});
	assert.equal(r, undefined);
});

test("the plan is only looked up for a call that needs lesson text", () => {
	let reads = 0;
	const enforce = () => { reads++; return true; };
	lessonTextRefusal({ toolName: "web_search", toolCallId: "w1", args: {}, enforce, messages: [user("hi")], assistantContent: [] });
	lessonTextRefusal({ toolName: "quiz", toolCallId: "q1", args: { type: "predict" }, enforce, messages: [user("hi")], assistantContent: [] });
	assert.equal(reads, 0);
	lessonTextRefusal({ toolName: "quiz", toolCallId: "q1", args: {}, enforce, messages: [user("hi")], assistantContent: [] });
	assert.equal(reads, 1);
});

test("enforcement is off before the plan exists", () => {
	assert.equal(gate([user("hi")], [call("q1", "quiz")], "q1", "quiz", {}, false), undefined);
});

test("a learner answer is a boundary: earlier text does not count", () => {
	const earlier = [
		user("hi"), asst([text("Lesson one."), call("q1", "quiz")]), answer("q1"),
	];
	assert.equal(gate(earlier, [thinking("next"), call("q2", "quiz")], "q2", "quiz"), LESSON_TEXT_REFUSAL);
	// ...and fresh text after the answer does.
	assert.equal(gate([...earlier, asst([text("Lesson two.")])], [call("q2", "quiz")], "q2", "quiz"), undefined);
});

test("a refusal's error result is not a boundary, and a new beat is refused afresh", () => {
	const msgs = [user("hi"), asst([call("q1", "quiz")]), refusal("q1"), asst([call("q2", "quiz")]), answer("q2")];
	assert.equal(gate(msgs, [call("q3", "quiz")], "q3", "quiz"), LESSON_TEXT_REFUSAL);
});

test("a steered user message is a boundary", () => {
	const earlier = [user("hi"), asst([text("Lesson.")]), user("steer: skip ahead")];
	assert.equal(gate(earlier, [call("q1", "quiz")], "q1", "quiz"), LESSON_TEXT_REFUSAL);
});

test("a failed send_to_user does not count as delivered", () => {
	const failed = { role: "toolResult", toolCallId: "s1", toolName: "send_to_user", isError: true, timestamp: 0, content: [{ type: "text", text: "bad" }] } as unknown as AgentMessage;
	assert.equal(gate([user("hi"), asst([sendMsg("s1", "Lesson.")]), failed], [call("q1", "quiz")], "q1", "quiz"), LESSON_TEXT_REFUSAL);
});

test("agents: only a teacher with a plan context installs the hook", () => {
	// Bare teacher (no ctx) and prober/practice-style agents carry no hook.
	assert.equal(createTeacherAgent(undefined, { engine }).beforeToolCall, undefined);
	const prober = createProberAgent({} as never, { tools: {}, engine });
	assert.equal(prober.beforeToolCall, undefined);
});

test("agents: a teacher with ctx refuses via the real hook, then lets the retry through", async () => {
	const ctx = { chatId: "c1", chatStore: { getChat: () => ({ tree: { nodes: [{ id: "n1" }] } }) } } as never;
	const agent = createTeacherAgent(ctx, { tools: {}, engine });
	const hook = agent.beforeToolCall!;
	assert.ok(hook);
	const quiz = call("q1", "quiz", { type: "check" });
	const msgs = [user("hi"), asst([quiz])];
	const mk = (messages: AgentMessage[], c: ReturnType<typeof call>, content: unknown[]) =>
		({ assistantMessage: { content }, toolCall: c, args: c.arguments, context: { messages } }) as never;
	const first = await hook(mk(msgs, quiz, [quiz]));
	assert.equal(first?.block, true);
	assert.equal(first?.reason, LESSON_TEXT_REFUSAL);
	const quiz2 = call("q2", "quiz", { type: "check" });
	const second = await hook(mk([...msgs, refusal("q1"), asst([quiz2])], quiz2, [quiz2]));
	assert.equal(second, undefined);
});
