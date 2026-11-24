/**
 * Fork (#806 E1, D-023): the recall loop's server/core half — the recall event
 * fold (min rule, self-rate, disputes, conclude ignored, R2), the propose_grade
 * tool's validation, POST /api/chats variant handling, and the silent
 * POST /api/chats/[id]/grade route. Runs under an isolated LH_DATA_DIR (the
 * seam is set before any config-loading import, so app imports are dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-recall-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { newGraphContextMessage, newRecallGradeMessage, RECALL_GRADE_TOOL } = await import("../src/core/native-messages.ts");
const { recallEventsFromMessages } = await import("../src/core/review-events.ts");
const { foldReviews, gradeOf, reviewPayload } = await import("../src/core/review.ts");
const { proposeGradeProblems, parseGradeBody } = await import("../src/core/recall.ts");
const { proposeGradeTool, recallTools } = await import("../src/agent/tools/practice.ts");
const { composeRecallInstructions } = await import("../src/agent/teacher-agent.ts");
const { call, conclude, pose } = await import("./review-fixtures.ts");
const { stores } = await import("../src/server/stores.ts");
const { POST: createChatRoute } = await import("../app/api/chats/route.ts");
const { POST: gradeRoute } = await import("../app/api/chats/[id]/grade/route.ts");
const { Rating } = await import("ts-fsrs");

type LhMessage = import("../src/core/native-messages.ts").LhMessage;
type GraphContextPick = import("../src/core/native-messages.ts").GraphContextPick;
type RecallKey = import("../src/core/native-messages.ts").RecallKey;

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const PICKS: GraphContextPick[] = [
	{ id: "n_v", name: "Verified one", statement: "A verified statement", verification: "verified" },
	{ id: "n_c", name: "Corrected one", statement: "A corrected statement", verification: "corrected" },
	{ id: "n_d", name: "Doubtful one", statement: "A doubtful statement", verification: "doubtful" },
	{ id: "n_u", name: "Unchecked one", statement: "An unchecked statement", verification: "none" },
];

const propose = (id: string, nodeId: string, rating: string | undefined, at: number, isError = false): LhMessage[] =>
	call(RECALL_GRADE_TOOL, id, { nodeId, ...(rating ? { rating } : {}) }, at, isError);

function keyed(toolCallId: string, nodeId: string, key: RecallKey, at: number, tutorRating?: "again" | "hard" | "good", reason?: string): LhMessage {
	return { ...newRecallGradeMessage({ toolCallId, nodeId, key, ...(tutorRating ? { tutorRating } : {}), ...(reason ? { reason } : {}) }), timestamp: at } as LhMessage;
}

describe("recallEventsFromMessages", () => {
	const effectiveOf = (tutor: "again" | "hard" | "good" | undefined, key: "again" | "hard" | "good") =>
		recallEventsFromMessages([...propose("g1", "n_v", tutor, T0), keyed("g1", "n_v", key, T0 + 5_000, tutor)], "chat_r").events[0]!.effective;

	it("takes the lower of the tutor's rating and the learner's key", () => {
		assert.equal(effectiveOf("good", "hard"), Rating.Hard);
		assert.equal(effectiveOf("hard", "good"), Rating.Hard);
		assert.equal(effectiveOf("again", "good"), Rating.Again);
		assert.equal(effectiveOf("good", "good"), Rating.Good);
		assert.equal(effectiveOf("hard", "again"), Rating.Again);
	});

	it("uses the learner's key alone when the tutor gave no rating (self-rate)", () => {
		assert.equal(effectiveOf(undefined, "good"), Rating.Good);
		assert.equal(effectiveOf(undefined, "again"), Rating.Again);
	});

	it("stamps the key press time, the chat id and the call's node", () => {
		const { events } = recallEventsFromMessages([...propose("g1", "n_v", "good", T0), keyed("g1", "n_v", "good", T0 + 5_000, "good")], "chat_r");
		assert.deepEqual(events, [{ kind: "recall", nodeId: "n_v", at: T0 + 5_000, session: "chat_r", effective: 3 }]);
	});

	it("a dispute makes no event and comes back as a flag with its reason", () => {
		const r = recallEventsFromMessages([...propose("g1", "n_v", "good", T0), keyed("g1", "n_v", "dispute", T0 + 9_000, "good", "the question was ambiguous")], "chat_r");
		assert.deepEqual(r.events, []);
		assert.deepEqual(r.disputes, [{ nodeId: "n_v", chatId: "chat_r", at: T0 + 9_000, reason: "the question was ambiguous" }]);
	});

	it("ignores conclude calls, unkeyed proposals, errored calls, unknown ids and a second key", () => {
		const messages = [
			...pose("p1", ["n_v"], T0),
			...conclude("c1", { outcome: "surrendered", rung: "R5" }, T0 + 10),
			...propose("g_unkeyed", "n_c", "good", T0 + 20),
			...propose("g_err", "n_u", undefined, T0 + 30, true),
			keyed("g_err", "n_u", "good", T0 + 31),
			keyed("g_missing", "n_u", "good", T0 + 32),
			...propose("g1", "n_v", "good", T0 + 40),
			keyed("g1", "n_v", "hard", T0 + 50, "good"),
			keyed("g1", "n_v", "again", T0 + 60, "good"),
		];
		const { events } = recallEventsFromMessages(messages, "chat_r");
		assert.deepEqual(events.map((e) => [e.nodeId, e.effective]), [["n_v", 2]]);
	});
});

describe("recall events in the scheduler", () => {
	it("gradeOf returns a recall event's effective grade", () => {
		assert.equal(gradeOf({ kind: "recall", nodeId: "n", at: 0, session: "s", effective: 2 }), Rating.Hard);
	});

	it("R2 applies unchanged: a recall Again on an established card is provisional", () => {
		const practice = (at: number) => ({ nodeId: "n_a", at, outcome: "solved" as const, rung: null, missClass: null, session: `s${at}` });
		const established = [practice(T0), practice(T0 + 2 * DAY), practice(T0 + 13 * DAY)];
		const again = { kind: "recall" as const, nodeId: "n_a", at: T0 + 30 * DAY, session: "r1", effective: 1 as const };
		const [node] = foldReviews([...established, again], new Set(["n_a"]));
		assert.equal(node!.verifying, true);
		assert.equal(node!.dueAt, T0 + 31 * DAY);
		assert.equal(node!.lapses, 0);
	});
});

describe("reviewPayload with recall chats", () => {
	const node = (id: string) => ({ id, name: id, statement: `s ${id}`, aliases: [], createdAt: "2026-01-01", provenance: [] });
	function payload(messages: LhMessage[], variant?: "recall", base: LhMessage[] = []) {
		const chats: Record<string, { messages: LhMessage[]; variant?: "recall" }> = { chat_r: { messages, ...(variant ? { variant } : {}) }, chat_p: { messages: base } };
		return reviewPayload({
			chatStore: {
				listChats: () => Object.keys(chats).map((id) => ({ id, kind: "practice" }) as never),
				getChat: (id) => ({ id, kind: "practice", ...chats[id] }) as never,
			},
			graphStore: { readNodes: () => [node("n_v"), node("n_c")], readChains: () => [] },
		}, T0 + 10 * DAY);
	}
	const messages = [
		...pose("p1", ["n_c"], T0), ...conclude("c1", { outcome: "solved", rung: null }, T0 + 10),
		...propose("g1", "n_v", "good", T0 + 20), keyed("g1", "n_v", "good", T0 + 30, "good"),
		...propose("g2", "n_c", "good", T0 + 40), keyed("g2", "n_c", "dispute", T0 + 50, "good", "wrong text"),
	];

	it("a recall chat reads grades, not conclude events; disputes ride the item", () => {
		const p = payload(messages, "recall");
		assert.deepEqual(p.due.map((i) => i.id), ["n_v"]);
		assert.equal(p.due[0]!.disputes, undefined);
		assert.deepEqual(p.upcoming, []);
	});

	it("a disputed node that has other events carries the flag until a later review", () => {
		const base = [...pose("p0", ["n_c"], T0 - DAY), ...conclude("c0", { outcome: "solved", rung: null }, T0 - DAY + 10)];
		const item = payload(messages, "recall", base).due.find((i) => i.id === "n_c")!;
		assert.deepEqual(item.disputes, [{ nodeId: "n_c", chatId: "chat_r", at: T0 + 50, reason: "wrong text" }]);
	});

	it("the same record WITHOUT the variant is read as practice (conclude counts)", () => {
		assert.deepEqual(payload(messages).due.map((i) => i.id), ["n_c"]);
		assert.deepEqual(payload(messages, "recall").due.map((i) => i.id), ["n_v"]);
	});
});

describe("propose_grade", () => {
	it("accepts a rating for verified/corrected ids and none for the others", () => {
		assert.deepEqual(proposeGradeProblems(PICKS, { nodeId: "n_v", rating: "good" }), []);
		assert.deepEqual(proposeGradeProblems(PICKS, { nodeId: "n_c", rating: "hard" }), []);
		assert.deepEqual(proposeGradeProblems(PICKS, { nodeId: "n_d" }), []);
		assert.deepEqual(proposeGradeProblems(PICKS, { nodeId: "n_u" }), []);
		assert.deepEqual(proposeGradeProblems(PICKS, { nodeId: "Verified one", rating: "again" }), [], "names resolve like targets");
	});

	it("refuses a foreign id and a rating on doubtful or unchecked statements", () => {
		assert.equal(proposeGradeProblems(PICKS, { nodeId: "n_zzz" }).length, 1);
		assert.equal(proposeGradeProblems(PICKS, { nodeId: "n_d", rating: "good" }).length, 1);
		assert.equal(proposeGradeProblems(PICKS, { nodeId: "n_u", rating: "good" }).length, 1);
		assert.equal(proposeGradeProblems(PICKS, { nodeId: "n_v", rating: "easy" }).length, 1);
		assert.equal(proposeGradeProblems(PICKS, {}).length, 1);
	});

	const recallChat = (messages: LhMessage[]) => ({ getChat: () => ({ messages }) });
	const ctxMessages = [newGraphContextMessage(PICKS, []) as LhMessage];

	it("the tool returns an error result the model can correct, and a terminating ack when valid", async () => {
		const tool = proposeGradeTool({ chatId: "c", chatStore: recallChat(ctxMessages) });
		const bad = await tool.execute("t1", { nodeId: "n_d", rating: "good" } as never);
		assert.equal(bad.isError, true);
		const ok = await tool.execute("t2", { nodeId: "n_v", rating: "good" } as never);
		assert.notEqual(ok.isError, true);
		assert.equal(ok.terminate, true);
	});

	it("the tool normalizes a name to its id before the call is recorded", () => {
		const tool = proposeGradeTool({ chatId: "c", chatStore: recallChat(ctxMessages) });
		assert.equal((tool.prepareArguments!({ nodeId: "Verified one", rating: "good" } as never) as { nodeId: string }).nodeId, "n_v");
	});

	it("the recall registry is propose_grade alone, and the recall prompt is its own", () => {
		assert.deepEqual(Object.keys(recallTools({ chatId: "c", chatStore: recallChat([]) })), [RECALL_GRADE_TOOL]);
		const prompt = composeRecallInstructions();
		assert.match(prompt, /propose_grade/);
		assert.doesNotMatch(prompt, /`conclude`/);
	});
});

describe("parseGradeBody", () => {
	it("validates key and reason", () => {
		assert.deepEqual(parseGradeBody({ toolCallId: "t", key: "good" }), { toolCallId: "t", key: "good" });
		assert.ok("error" in parseGradeBody({ key: "good" }));
		assert.ok("error" in parseGradeBody({ toolCallId: "t", key: "easy" }));
		assert.ok("error" in parseGradeBody({ toolCallId: "t", key: "good", reason: "x" }), "reason only with dispute");
		assert.deepEqual(parseGradeBody({ toolCallId: "t", key: "dispute", reason: "  why  " }), { toolCallId: "t", key: "dispute", reason: "why" });
		assert.deepEqual(parseGradeBody({ toolCallId: "t", key: "dispute", reason: "   " }), { toolCallId: "t", key: "dispute" });
		const long = parseGradeBody({ toolCallId: "t", key: "dispute", reason: "x".repeat(900) }) as { reason: string };
		assert.equal(long.reason.length, 500);
	});
});

describe("POST /api/chats variant", () => {
	const post = (body: unknown) => createChatRoute(new Request("http://localhost/api/chats", { method: "POST", body: JSON.stringify(body) }));

	it("stores the recall variant on a practice chat and stamps verification + the effective statement", async () => {
		const at = new Date().toISOString();
		const n = (id: string, statement: string) => ({ id, name: id, statement, aliases: [], createdAt: at, provenance: [] });
		stores.graphStore.appendNode(n("r_ok", "ok statement")); stores.graphStore.appendNode(n("r_fix", "old wording"));
		stores.graphStore.appendNode(n("r_none", "plain"));
		stores.graphStore.appendVerification({ nodeId: "r_ok", status: "verified", at });
		stores.graphStore.appendVerification({ nodeId: "r_fix", status: "corrected", at, correctedText: "new wording" });
		const propositions = ["r_ok", "r_fix", "r_none", "r_gone"].map((id) => ({ id, name: id, statement: "picked text" }));
		const res = await post({ kind: "practice", variant: "recall", title: "Recall", graphContext: { propositions } });
		assert.equal(res.status, 200);
		const { id } = await res.json() as { id: string };
		const record = stores.chatStore.getChat(id)!;
		assert.equal(record.kind, "practice"); assert.equal(record.variant, "recall");
		assert.equal(stores.chatStore.listChats().find((c) => c.id === id)?.variant, "recall");
		const marker = record.messages[0] as { details: { propositions: GraphContextPick[] }; content: string };
		assert.deepEqual(marker.details.propositions.map((p) => [p.id, p.verification, p.statement]), [
			["r_ok", "verified", "ok statement"], ["r_fix", "corrected", "new wording"], ["r_none", "none", "plain"], ["r_gone", "none", "picked text"],
		]);
		assert.match(marker.content, /\[r_fix\] r_fix \(corrected\): new wording/);
	});

	it("caps a recall chat's picks at 10", async () => {
		const propositions = Array.from({ length: 14 }, (_, i) => ({ id: `cap_${i}`, name: `cap_${i}`, statement: "s" }));
		const { id } = await (await post({ kind: "practice", variant: "recall", graphContext: { propositions } })).json() as { id: string };
		assert.equal((stores.chatStore.getChat(id)!.messages[0] as { details: { propositions: unknown[] } }).details.propositions.length, 10);
	});

	it("refuses the variant on a non-practice chat or with an unknown value, creating nothing", async () => {
		const before = stores.chatStore.listChats().length;
		assert.equal((await post({ variant: "recall" })).status, 400);
		assert.equal((await post({ kind: "practice", variant: "other" })).status, 400);
		assert.equal(stores.chatStore.listChats().length, before);
	});

	it("a plain practice chat carries no variant", async () => {
		const { id } = await (await post({ kind: "practice" })).json() as { id: string };
		assert.equal(stores.chatStore.getChat(id)!.variant, undefined);
	});
});

describe("POST /api/chats/[id]/grade", () => {
	const grade = (id: string, body: unknown) =>
		gradeRoute(new Request(`http://localhost/api/chats/${id}/grade`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
	function recallChat(extra: LhMessage[] = []) {
		const chat = stores.chatStore.createChat("recall", "practice", "recall");
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(PICKS, []) as LhMessage, ...propose("g1", "n_v", "good", T0), ...extra]);
		return chat.id;
	}

	it("404 for an unknown chat; 400 for a teach chat and a plain practice chat", async () => {
		assert.equal((await grade("chat_nope", { toolCallId: "g1", key: "good" })).status, 404);
		const teach = stores.chatStore.createChat("teach");
		assert.equal((await grade(teach.id, { toolCallId: "g1", key: "good" })).status, 400);
		const practice = stores.chatStore.createChat("practice", "practice");
		assert.equal((await grade(practice.id, { toolCallId: "g1", key: "good" })).status, 400);
	});

	it("saves the key silently as a recall-grade marker carrying the call's node and tutor rating", async () => {
		const id = recallChat();
		const res = await grade(id, { toolCallId: "g1", key: "hard" });
		assert.equal(res.status, 200);
		const last = stores.chatStore.getChat(id)!.messages.at(-1) as { customType: string; details: Record<string, unknown> };
		assert.equal(last.customType, "recall-grade");
		assert.deepEqual(last.details, { toolCallId: "g1", nodeId: "n_v", tutorRating: "good", key: "hard" });
	});

	it("400 for an unknown or non-propose_grade toolCallId; 409 for a duplicate", async () => {
		const id = recallChat([...pose("p1", ["n_v"], T0)]);
		assert.equal((await grade(id, { toolCallId: "nope", key: "good" })).status, 400);
		assert.equal((await grade(id, { toolCallId: "p1", key: "good" })).status, 400);
		assert.equal((await grade(id, { toolCallId: "g1", key: "good" })).status, 200);
		assert.equal((await grade(id, { toolCallId: "g1", key: "again" })).status, 409);
	});

	it("reason rules: only with dispute, trimmed, capped at 500", async () => {
		const id = recallChat();
		assert.equal((await grade(id, { toolCallId: "g1", key: "good", reason: "x" })).status, 400);
		assert.equal((await grade(id, { toolCallId: "g1", key: "nope" })).status, 400);
		assert.equal((await grade(id, { toolCallId: "g1", key: "dispute", reason: `  ${"y".repeat(800)}  ` })).status, 200);
		const last = stores.chatStore.getChat(id)!.messages.at(-1) as { details: { reason?: string; key: string } };
		assert.equal(last.details.key, "dispute");
		assert.equal(last.details.reason, "y".repeat(500));
	});
});
