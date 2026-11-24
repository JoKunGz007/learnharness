/**
 * Fork (#806 piece C, D-023): the background verifier core — cutoff, grouping,
 * the three steps, caps, single-flight. Fake model calls and an in-memory
 * ledger store; nothing touches data/ or a model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GraphNode, ProvenancePoint, SourceChunksFile, VerificationLine } from "../src/core/contracts/graph.ts";
import { getGraph } from "../src/core/graph.ts";
import {
	COURSE_INSTRUCTIONS, JUDGE_INSTRUCTIONS, PASSAGE_INSTRUCTIONS, RULES, createSearchImportsTool, searchImportTexts, withoutSources,
} from "../src/agent/subagents/verifier.ts";
import {
	isVerifying, MAX_RESEARCH_RUNS, MAX_STRONG_CALLS, runVerificationBatch, verifierPhase, type VerifierDeps,
} from "../src/server/verifier.ts";

const T0 = "2026-11-24T10:00:00.000Z";
const BEFORE = "2026-11-24T09:00:00.000Z";
const AFTER = (n: number) => new Date(Date.parse(T0) + (n + 1) * 1000).toISOString();

interface Fixture {
	deps: VerifierDeps;
	ledger: VerificationLine[];
	nodes: GraphNode[];
	logs: string[];
	calls: { passage: number; course: number; research: number; judge: number };
	cutoff: { since: string | null };
	flags: { researcherAllowed: boolean; verifierAllowed: boolean; search: boolean; course: boolean };
	passages: Map<string, string | null>;
}

const node = (id: string, createdAt: string, point: ProvenancePoint, statement = `Statement ${id}`): GraphNode =>
	({ id, name: id, statement, aliases: [], createdAt, provenance: [point] });
const chat = (messageId: string, chatId = "chat1"): ProvenancePoint => ({ chatId, messageId });

function fixture(nodes: GraphNode[], over: Partial<VerifierDeps> = {}): Fixture {
	const ledger: VerificationLine[] = [];
	const logs: string[] = [];
	const calls = { passage: 0, course: 0, research: 0, judge: 0 };
	const cutoff: { since: string | null } = { since: T0 };
	const flags = { researcherAllowed: true, verifierAllowed: true, search: true, course: true };
	const passages = new Map<string, string | null>();
	const deps: VerifierDeps = {
		graphStore: { readNodes: () => nodes, readVerification: () => [...ledger], appendVerification: (l) => void ledger.push(l) },
		readCutoff: () => cutoff.since,
		writeCutoff: (s) => void (cutoff.since = s),
		allowed: (role) => (role === "verifier" ? flags.verifierAllowed : flags.researcherAllowed),
		passageFor: (p) => passages.get(`${p.chatId}#${p.messageId}`) ?? (p.chunk ? passages.get(`${p.chatId}@${p.chunk.importKey}#${p.chunk.index}`) ?? null : null),
		courseSourcesAvailable: () => flags.course,
		searchAvailable: () => flags.search,
		passageCheck: async (_p, st) => (calls.passage++, st.map((s) => ({ id: s.id, verdict: "supported" as const }))),
		courseCheck: async (st) => (calls.course++, st.map((s) => ({ id: s.id, verdict: "inconclusive" as const }))),
		research: async () => (calls.research++, "Brief. See https://example.org/a for details."),
		judge: async (st) => (calls.judge++, st.map((s) => ({ id: s.id, verdict: "doubtful" as const, note: "sources conflict" }))),
		now: () => new Date("2026-11-24T12:00:00.000Z"),
		log: (m) => void logs.push(m),
		...over,
	};
	return { deps, ledger, nodes, logs, calls, cutoff, flags, passages };
}

describe("verifier: candidates", () => {
	it("persists the cutoff on the first run and skips the backlog", async () => {
		const f = fixture([node("old", BEFORE, chat("m1")), node("new", AFTER(0), chat("m1"))]);
		f.cutoff.since = null;
		f.passages.set("chat1#m1", "passage text");
		// deps.now() is 12:00, after both nodes: the first run sets since = 12:00 and nothing is a candidate.
		const first = await runVerificationBatch(f.deps);
		assert.equal(f.cutoff.since, "2026-11-24T12:00:00.000Z");
		assert.equal(f.ledger.length, 0);
		assert.equal(first.pending, 0);
		// With the cutoff at T0 the old node is still skipped, the new one verified.
		f.cutoff.since = T0;
		await runVerificationBatch(f.deps);
		assert.deepEqual(f.ledger.map((l) => l.nodeId), ["new"]);
	});

	it("skips nodes that already have a line and goes oldest first", async () => {
		const order: string[] = [];
		const f = fixture([node("b", AFTER(2), chat("m2")), node("a", AFTER(1), chat("m1")), node("c", AFTER(3), chat("m3"))], {
			passageCheck: async (_p, st) => (order.push(st[0]!.statement), st.map((s) => ({ id: s.id, verdict: "supported" as const }))),
		});
		for (const m of ["m1", "m2", "m3"]) f.passages.set(`chat1#${m}`, "p");
		f.ledger.push({ nodeId: "c", status: "doubtful", at: T0 });
		await runVerificationBatch(f.deps);
		assert.deepEqual(order, ["Statement a", "Statement b"]);
		assert.deepEqual(f.ledger.map((l) => l.nodeId), ["c", "a", "b"]);
	});
});

describe("verifier: passage step", () => {
	it("groups nodes by source passage: one call per message, statements together", async () => {
		const seen: string[][] = [];
		const f = fixture([node("a", AFTER(0), chat("m1")), node("b", AFTER(1), chat("m1")), node("c", AFTER(2), chat("m2"))], {
			passageCheck: async (_p, st) => (seen.push(st.map((s) => s.statement)), st.map((s) => ({ id: s.id, verdict: "supported" as const }))),
		});
		f.passages.set("chat1#m1", "p1");
		f.passages.set("chat1#m2", "p2");
		await runVerificationBatch(f.deps);
		assert.deepEqual(seen, [["Statement a", "Statement b"], ["Statement c"]]);
	});

	it("supported records verified with the passage sourceRef (chat and chunk)", async () => {
		const f = fixture([
			node("a", AFTER(0), chat("m1")),
			node("b", AFTER(1), { chatId: "src_x", messageId: "", chunk: { importKey: "1700", index: 3 } }),
		]);
		f.passages.set("chat1#m1", "p");
		f.passages.set("src_x@1700#3", "chunk text");
		const s = await runVerificationBatch(f.deps);
		assert.deepEqual(f.ledger.map((l) => [l.nodeId, l.status, l.sourceRef]), [["a", "verified", "chat1#m1"], ["b", "verified", "src_x@1700#3"]]);
		assert.equal(s.verified, 2);
		assert.equal(s.pending, 0);
	});

	it("a group with no passage is flagged without a passage call", async () => {
		const f = fixture([node("a", AFTER(0), { chatId: "chat1", messageId: "" }), node("b", AFTER(1), chat("gone"))]);
		f.flags.search = false;
		await runVerificationBatch(f.deps);
		assert.equal(f.calls.passage, 0);
		assert.equal(f.calls.course, 2); // both flagged → course step, one call per group
		assert.equal(f.ledger.length, 0);
	});
});

describe("verifier: course-file and web steps", () => {
	it("flagged → course corrected, keeping oldText; the fold shows the new statement", async () => {
		const nodes = [node("a", AFTER(0), chat("m1"), "The sky is green.")];
		const f = fixture(nodes, {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "contradicted" as const, note: "says blue" })),
			courseCheck: async (st, hints) => {
				assert.match(hints[st[0]!.id]!, /contradicted/);
				return st.map((s) => ({ id: s.id, verdict: "corrected" as const, correctedText: "The sky is blue.", sourceRef: "src_1@9#0" }));
			},
		});
		f.passages.set("chat1#m1", "p");
		const s = await runVerificationBatch(f.deps);
		assert.equal(s.corrected, 1);
		assert.deepEqual(f.ledger[0], { nodeId: "a", at: "2026-11-24T12:00:00.000Z", status: "corrected", oldText: "The sky is green.", correctedText: "The sky is blue.", sourceRef: "src_1@9#0" });
		const folded = getGraph({ readNodes: () => nodes, readChains: () => [], readVerification: () => f.ledger }).nodes[0]!;
		assert.equal(folded.statement, "The sky is blue.");
		assert.equal(folded.verification?.oldText, "The sky is green.");
	});

	it("a 'correction' equal to the statement counts as inconclusive", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"), "X is Y.")], {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })),
			courseCheck: async (st) => st.map((s) => ({ id: s.id, verdict: "corrected" as const, correctedText: "X is  Y. " })),
		});
		f.passages.set("chat1#m1", "p");
		await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, 1);
		assert.equal(f.ledger[0]?.status, "doubtful");
	});

	it("inconclusive → web → doubtful with the brief's URL; no course sources skips the course call", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"))], {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })),
		});
		f.passages.set("chat1#m1", "p");
		f.flags.course = false;
		const s = await runVerificationBatch(f.deps);
		assert.equal(f.calls.course, 0);
		assert.equal(f.calls.research, 1);
		assert.equal(f.calls.judge, 1);
		assert.deepEqual(f.ledger[0], { nodeId: "a", at: "2026-11-24T12:00:00.000Z", status: "doubtful", sourceRef: "https://example.org/a", note: "sources conflict" });
		assert.equal(s.doubtful, 1);
		assert.equal(s.strongCalls, 2); // passage + judge
	});

	it("no search provider: the web step is skipped and the node stays pending", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"))], {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })),
		});
		f.passages.set("chat1#m1", "p");
		f.flags.search = false;
		const s = await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, 0);
		assert.equal(f.ledger.length, 0);
		assert.equal(s.pending, 1);
	});

	it("researcher background off: the web step is skipped", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"))], {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })),
		});
		f.passages.set("chat1#m1", "p");
		f.flags.researcherAllowed = false;
		await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, 0);
		assert.equal(f.ledger.length, 0);
	});
});

describe("verifier: background gate", () => {
	it("verifier background off: nothing recorded, one log line across runs", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"))]);
		f.passages.set("chat1#m1", "p");
		f.flags.verifierAllowed = false;
		const s = await runVerificationBatch(f.deps);
		await runVerificationBatch(f.deps);
		assert.equal(s.skipped, "background-off");
		assert.equal(f.calls.passage, 0);
		assert.equal(f.ledger.length, 0);
		assert.equal(f.logs.length, 1);
		// Turned back on: the node is still a candidate.
		f.flags.verifierAllowed = true;
		await runVerificationBatch(f.deps);
		assert.equal(f.ledger.length, 1);
	});
});

describe("verifier: caps and safety", () => {
	it(`makes at most ${MAX_STRONG_CALLS} Strong calls; the rest stays pending`, async () => {
		const nodes = Array.from({ length: MAX_STRONG_CALLS + 2 }, (_, i) => node(`n${i}`, AFTER(i), chat(`m${i}`)));
		const f = fixture(nodes);
		for (let i = 0; i < nodes.length; i++) f.passages.set(`chat1#m${i}`, "p");
		const s = await runVerificationBatch(f.deps);
		assert.equal(f.calls.passage, MAX_STRONG_CALLS);
		assert.equal(s.strongCalls, MAX_STRONG_CALLS);
		assert.equal(s.verified, MAX_STRONG_CALLS);
		assert.equal(s.pending, 2);
		// Next batch picks the leftovers up.
		await runVerificationBatch(f.deps);
		assert.equal(f.ledger.length, MAX_STRONG_CALLS + 2);
	});

	it(`runs the researcher at most ${MAX_RESEARCH_RUNS} times per batch`, async () => {
		const nodes = Array.from({ length: MAX_RESEARCH_RUNS + 1 }, (_, i) => node(`n${i}`, AFTER(i), chat(`m${i}`)));
		const f = fixture(nodes, { passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })) });
		for (let i = 0; i < nodes.length; i++) f.passages.set(`chat1#m${i}`, "p");
		f.flags.course = false;
		const s = await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, MAX_RESEARCH_RUNS);
		assert.equal(s.researcherRuns, MAX_RESEARCH_RUNS);
		assert.equal(s.doubtful, MAX_RESEARCH_RUNS);
		assert.equal(s.pending, 1);
	});

	it("does not spend a researcher run when no Strong call is left for the judge", async () => {
		// 10 groups: 10 passage calls (unsupported) use the whole budget; the web step must not start a run.
		const nodes = Array.from({ length: MAX_STRONG_CALLS }, (_, i) => node(`n${i}`, AFTER(i), chat(`m${i}`)));
		const f = fixture(nodes, { passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const })) });
		for (let i = 0; i < nodes.length; i++) f.passages.set(`chat1#m${i}`, "p");
		f.flags.course = false;
		await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, 0);
	});

	it("never writes over a node that gained a line during the batch", async () => {
		const f = fixture([node("a", AFTER(0), chat("m1"))]);
		f.passages.set("chat1#m1", "p");
		f.deps.passageCheck = async (_p, st) => {
			f.ledger.push({ nodeId: "a", status: "doubtful", at: T0, note: "someone else" });
			return st.map((s) => ({ id: s.id, verdict: "supported" as const }));
		};
		await runVerificationBatch(f.deps);
		assert.deepEqual(f.ledger.map((l) => l.status), ["doubtful"]);
	});

	it("a failed model call leaves the group pending and the batch goes on", async () => {
		let n = 0;
		const f = fixture([node("a", AFTER(0), chat("m1")), node("b", AFTER(1), chat("m2"))], {
			passageCheck: async (_p, st) => {
				if (n++ === 0) throw new Error("boom");
				return st.map((s) => ({ id: s.id, verdict: "supported" as const }));
			},
		});
		f.passages.set("chat1#m1", "p");
		f.passages.set("chat1#m2", "p");
		await runVerificationBatch(f.deps);
		assert.deepEqual(f.ledger.map((l) => l.nodeId), ["b"]);
		assert.match(f.logs[0]!, /boom/);
	});
});

describe("verifier: single-flight", () => {
	it("a trigger during a run sets a rerun; one more batch runs, never two at once", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let active = 0, maxActive = 0, calls = 0;
		const nodes = [node("a", AFTER(0), chat("m1"))];
		const f = fixture(nodes, {
			passageCheck: async (_p, st) => {
				calls++;
				active++;
				maxActive = Math.max(maxActive, active);
				if (calls === 1) await gate;
				active--;
				return st.map((s) => ({ id: s.id, verdict: "supported" as const }));
			},
		});
		f.passages.set("chat1#m1", "p");
		f.passages.set("chat1#m2", "p");
		const first = runVerificationBatch(f.deps);
		assert.equal(isVerifying(), true);
		await new Promise((r) => setImmediate(r));
		assert.equal(verifierPhase(), "passage");
		const second = runVerificationBatch(f.deps); // sets rerun, same promise
		nodes.push(node("b", AFTER(1), chat("m2"))); // arrives while the first batch runs
		release();
		await Promise.all([first, second]);
		assert.equal(calls, 2);
		assert.equal(maxActive, 1);
		assert.deepEqual(f.ledger.map((l) => l.nodeId), ["a", "b"]);
		assert.equal(isVerifying(), false);
		assert.equal(verifierPhase(), "idle");
	});
});

describe("search_imports", () => {
	const file: SourceChunksFile = {
		sourceId: "src_1", importKey: "1700", importedAt: T0, filePath: "C:\\notes\\physics.md",
		text: "Intro line\nNewton's second law: F = m a.\nUnrelated\nForce and mass relate by Newton",
		chunks: [{ index: 0, start: 0, end: 11, lineStart: 1, lineEnd: 1 }, { index: 1, start: 11, end: 200, lineStart: 2, lineEnd: 4 }],
	};

	it("is case-insensitive, ranks by matched words and cites the chunk", () => {
		const hits = searchImportTexts([file], "NEWTON force");
		assert.equal(hits[0]?.sourceRef, "src_1@1700#1");
		assert.match(hits[0]!.snippet, /Force and mass/);
		assert.equal(hits[0]?.file, "physics.md");
		assert.equal(hits[0]?.lines, "lines 2-4");
		assert.equal(searchImportTexts([file], "zzz").length, 0);
	});
});

describe("verifier hooks and status (#806 C part 2)", () => {
	it("onRunStart ensures the cutoff once (retrying after a failure); onMerged triggers without awaiting and swallows errors", async () => {
		const { verifierExtractionHooks } = await import("../src/server/verifier-deps.ts");
		let ensures = 0, triggers = 0;
		const logs: string[] = [];
		let failEnsure = true;
		const hooks = verifierExtractionHooks({
			ensureCutoff: () => { ensures++; if (failEnsure) throw new Error("disk"); },
			trigger: () => { triggers++; return Promise.reject(new Error("batch")); },
			log: (m) => void logs.push(m),
		});
		hooks.onRunStart(); // fails, logged
		failEnsure = false;
		hooks.onRunStart(); // retried, succeeds
		hooks.onRunStart(); // cached
		assert.equal(ensures, 2);
		hooks.onMerged();
		hooks.onMerged();
		await new Promise((r) => setImmediate(r));
		assert.equal(triggers, 2);
		assert.equal(logs.length, 3); // one cutoff failure + two batch failures
	});

	it("verifierStatus reports a row only while a batch does model work, and announces phase changes", async () => {
		const { verifierStatus } = await import("../src/server/verifier.ts");
		const { subscribe } = await import("../src/core/events.ts");
		let announces = 0;
		const off = subscribe((e) => { if (e.type === "activity-changed") announces++; });
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const f = fixture([node("a", AFTER(0), chat("m1"))], {
			passageCheck: async (_p, st) => { await gate; return st.map((s) => ({ id: s.id, verdict: "supported" as const })); },
		});
		f.passages.set("chat1#m1", "p");
		assert.equal(verifierStatus(), null);
		const run = runVerificationBatch(f.deps);
		await new Promise((r) => setImmediate(r));
		assert.equal(verifierStatus()?.phase, "passage");
		release();
		await run;
		off();
		assert.equal(verifierStatus(), null);
		assert.ok(announces >= 2, `phase change + finish announced (got ${announces})`);
	});

	it("a batch with nothing to do shows no status row", async () => {
		const { verifierStatus } = await import("../src/server/verifier.ts");
		const f = fixture([]);
		const run = runVerificationBatch(f.deps);
		assert.equal(verifierStatus(), null);
		await run;
	});
});

describe("verifier: own-source exclusion and conflicts", () => {
	const importFile = (sourceId: string, text: string): SourceChunksFile =>
		({ sourceId, importKey: "1", importedAt: T0, filePath: `${sourceId}.md`, text, chunks: [{ index: 0, start: 0, end: text.length, lineStart: 1, lineEnd: 1 }] });

	it("the statement's own import is not offered to search_imports", async () => {
		const files = [importFile("src_own", "Krebs cycle: cytoplasm"), importFile("src_other", "Krebs cycle: matrix")];
		const kept = withoutSources(files, ["src_own"]);
		assert.deepEqual(kept.map((f) => f.sourceId), ["src_other"]);
		const tool = createSearchImportsTool(() => kept);
		const out = await tool.execute("c1", { query: "krebs" } as never, undefined as never);
		const text = JSON.stringify(out.content);
		assert.match(text, /src_other/);
		assert.doesNotMatch(text, /src_own/);
	});

	it("the batch passes every provenance source id of the group's nodes as the exclusion", async () => {
		const own: GraphNode = { ...node("a", AFTER(0), { chatId: "src_own", messageId: "", chunk: { importKey: "1", index: 0 } }), provenance: [
			{ chatId: "src_own", messageId: "", chunk: { importKey: "1", index: 0 } }, { chatId: "chat9", messageId: "m" },
		] };
		let asked: string[] = [], got: string[] = [];
		const f = fixture([own], {
			courseSourcesAvailable: (ex) => ((asked = ex), true),
			courseCheck: async (st, _h, ex) => ((got = ex), st.map((s) => ({ id: s.id, verdict: "inconclusive" as const }))),
		});
		f.passages.set("src_own@1#0", "p");
		f.deps.passageCheck = async (_p, st) => st.map((s) => ({ id: s.id, verdict: "unsupported" as const }));
		await runVerificationBatch(f.deps);
		assert.deepEqual(asked.sort(), ["chat9", "src_own"]);
		assert.deepEqual(got.sort(), ["chat9", "src_own"]);
	});

	const conflictFixture = () => {
		const f = fixture([node("a", AFTER(0), chat("m1"), "The Krebs cycle runs in the mitochondrial matrix.")], {
			passageCheck: async (_p, st) => st.map((s) => ({ id: s.id, verdict: "contradicted" as const })),
			courseCheck: async (st) => st.map((s) => ({ id: s.id, verdict: "conflict" as const, note: "your notes say cytoplasm; standard sources say matrix" })),
		});
		f.passages.set("chat1#m1", "p");
		return f;
	};

	it("conflict with no search provider is recorded doubtful with the note", async () => {
		const f = conflictFixture();
		f.flags.search = false;
		const s = await runVerificationBatch(f.deps);
		assert.deepEqual(f.ledger, [{ nodeId: "a", at: "2026-11-24T12:00:00.000Z", status: "doubtful", note: "your notes say cytoplasm; standard sources say matrix" }]);
		assert.equal(s.doubtful, 1);
		assert.equal(f.calls.research, 0);
	});

	it("conflict with a search provider goes to the web and the judge sees the note", async () => {
		const f = conflictFixture();
		let hintsSeen: Record<string, string> = {};
		f.deps.judge = async (st, _b, hints) => ((hintsSeen = hints), st.map((s) => ({ id: s.id, verdict: "verified" as const, note: "textbooks agree" })));
		await runVerificationBatch(f.deps);
		assert.deepEqual(hintsSeen, { s1: "your notes say cytoplasm; standard sources say matrix" });
		assert.equal(f.ledger[0]?.status, "verified");
		assert.equal(f.ledger[0]?.sourceRef, "https://example.org/a");
	});

	it("conflict with the caps exhausted stays pending; plain inconclusive without search stays pending", async () => {
		const f = conflictFixture();
		f.flags.researcherAllowed = true;
		const calls = { research: 0 };
		f.deps.research = async () => (calls.research++, "brief");
		// No Strong call left for the judge after passage + course (cap pretend: 2 groups would exceed) — emulate by 10 other groups first.
		const others = Array.from({ length: MAX_STRONG_CALLS - 2 }, (_, i) => node(`o${i}`, AFTER(i + 1), chat(`x${i}`)));
		for (let i = 0; i < others.length; i++) f.passages.set(`chat1#x${i}`, "p");
		f.nodes.push(...others);
		await runVerificationBatch(f.deps);
		assert.equal(f.calls.research, 0, "no researcher run once no judge call is left");
		assert.equal(f.ledger.filter((l) => l.nodeId === "a").length, 0);
	});

	it("prompts carry the well-established-knowledge guard and the conflict verdict", () => {
		for (const p of [PASSAGE_INSTRUCTIONS, COURSE_INSTRUCTIONS, JUDGE_INSTRUCTIONS]) assert.match(p, /well-established knowledge/);
		assert.match(RULES, /Never correct a statement toward a claim that contradicts well-established knowledge/);
		assert.match(COURSE_INSTRUCTIONS, /conflict:/);
		assert.match(COURSE_INSTRUCTIONS, /own source is not independent evidence/);
		assert.match(JUDGE_INSTRUCTIONS, /Prefer doubtful over corrected/);
	});
});
