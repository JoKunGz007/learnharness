/**
 * Fork (#806 piece A, D-023): the verification ledger — fold at read time
 * (latest line wins, corrected text overrides the statement and keeps the
 * old one), node deletion clears the lines, mergeFindings reports the node
 * ids it created / linked. In-memory GraphStore: never touches data/graph.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ChatSummary,
	CoverageEntry,
	GraphChain,
	GraphNode,
	NotesSource,
	SessionCheckpoint,
	VerificationLine,
} from "../src/core/contracts.ts";
import type { ChatStore, GraphStore } from "../src/core/ports.ts";
import { getGraph, graphSnapshot, mergeFindings, recordVerification } from "../src/core/graph.ts";
import { deleteNodeTraces } from "../src/core/graph-deletion.ts";

function memoryStore(): GraphStore {
	const nodes: GraphNode[] = [];
	const chains: GraphChain[] = [];
	const checkpoints: SessionCheckpoint[] = [];
	const coverage: CoverageEntry[] = [];
	const verification: VerificationLine[] = [];
	const sources = new Map<string, NotesSource>();
	let positions: Record<string, { x: number; y: number }> = {};
	return {
		appendNode: (n) => void nodes.push({ ...n, aliases: [...n.aliases], provenance: [...n.provenance] }),
		readNodes: () => nodes.map((n) => ({ ...n, aliases: [...n.aliases], provenance: [...n.provenance] })),
		appendChain: (c) => void chains.push(c),
		readChains: () => chains.map((c) => ({ ...c, premises: [...c.premises], provenance: [...c.provenance] })),
		appendCheckpoint: (c) => void checkpoints.push(c),
		readCheckpoints: () => [...checkpoints],
		appendCoverage: (e) => void coverage.push(e),
		readCoverage: () => [...coverage],
		appendVerification: (l) => void verification.push({ ...l }),
		readVerification: () => verification.map((l) => ({ ...l })),
		upsertSource: (s) => void sources.set(s.id, s),
		readSources: () => [...sources.values()],
		deleteSources: () => 0,
		saveSourceChunks: () => {},
		readSourceChunk: () => null,
		deleteSourceChunks: () => {},
		appendSourceUsage: () => {},
		readPositions: () => positions,
		writePositions: (p) => void (positions = p),
		rewriteLedgers: (next) => {
			if (next.nodes) nodes.splice(0, nodes.length, ...next.nodes);
			if (next.chains) chains.splice(0, chains.length, ...next.chains);
			if (next.coverage) coverage.splice(0, coverage.length, ...next.coverage);
			if (next.checkpoints) checkpoints.splice(0, checkpoints.length, ...next.checkpoints);
			if (next.verification) verification.splice(0, verification.length, ...next.verification);
		},
	};
}

const node = (id: string, statement = `statement of ${id}`): GraphNode => ({
	id,
	name: id,
	statement,
	aliases: [],
	createdAt: "2026-01-01T00:00:00.000Z",
	provenance: [{ chatId: "c1", messageId: "" }],
});

describe("verification ledger fold", () => {
	it("a node with no line has no verification field", () => {
		const store = memoryStore();
		store.appendNode(node("n_a"));
		assert.equal(getGraph(store).nodes[0]!.verification, undefined);
	});

	it("latest line per node wins", () => {
		const store = memoryStore();
		store.appendNode(node("n_a"));
		store.appendNode(node("n_b"));
		recordVerification(store, { nodeId: "n_a", status: "doubtful", at: "2026-02-01T00:00:00.000Z", note: "unsure" });
		recordVerification(store, { nodeId: "n_a", status: "verified", at: "2026-03-01T00:00:00.000Z", sourceRef: "lecture 3" });
		const [a, b] = getGraph(store).nodes;
		assert.deepEqual(a!.verification, { status: "verified", at: "2026-03-01T00:00:00.000Z", sourceRef: "lecture 3" });
		assert.equal(b!.verification, undefined);
	});

	it("corrected overrides the statement and keeps the first-line text as oldText", () => {
		const store = memoryStore();
		store.appendNode(node("n_a", "Original claim."));
		// A later link-append line must not become the old text.
		store.appendNode({ ...node("n_a", "A phrasing."), createdAt: "2026-01-02T00:00:00.000Z" });
		recordVerification(store, {
			nodeId: "n_a",
			status: "corrected",
			at: "2026-02-01T00:00:00.000Z",
			correctedText: "Fixed claim.",
			sourceRef: "https://example.test",
			note: "was wrong",
		});
		const a = getGraph(store).nodes[0]!;
		assert.equal(a.statement, "Fixed claim.");
		assert.deepEqual(a.verification, {
			status: "corrected",
			at: "2026-02-01T00:00:00.000Z",
			oldText: "Original claim.",
			sourceRef: "https://example.test",
			note: "was wrong",
		});
		// The stored first line is untouched.
		assert.equal(store.readNodes()[0]!.statement, "Original claim.");
		// The snapshot carries it too.
		const chatStore = { getChat: () => null, listChats: () => [] as ChatSummary[] } as unknown as ChatStore;
		const snap = graphSnapshot({ chatStore, graphStore: store });
		assert.equal(snap.propositions[0]!.statement, "Fixed claim.");
		assert.equal(snap.propositions[0]!.verification?.status, "corrected");
	});

	it("a later verified line after a correction restores the stored statement", () => {
		const store = memoryStore();
		store.appendNode(node("n_a", "Original claim."));
		recordVerification(store, { nodeId: "n_a", status: "corrected", at: "t1", correctedText: "Fixed." });
		recordVerification(store, { nodeId: "n_a", status: "verified", at: "t2" });
		const a = getGraph(store).nodes[0]!;
		assert.equal(a.statement, "Original claim.");
		assert.equal(a.verification?.status, "verified");
	});

	it("lines for unknown nodes are ignored", () => {
		const store = memoryStore();
		store.appendNode(node("n_a"));
		recordVerification(store, { nodeId: "n_gone", status: "doubtful", at: "t" });
		assert.equal(getGraph(store).nodes.length, 1);
	});
});

describe("deleteNodeTraces", () => {
	it("removes the node's verification lines and keeps the others", () => {
		const store = memoryStore();
		store.appendNode(node("n_a"));
		store.appendNode(node("n_b"));
		recordVerification(store, { nodeId: "n_a", status: "verified", at: "t1" });
		recordVerification(store, { nodeId: "n_a", status: "doubtful", at: "t2" });
		recordVerification(store, { nodeId: "n_b", status: "verified", at: "t3" });
		assert.ok(deleteNodeTraces(store, "n_a"));
		assert.deepEqual(store.readVerification().map((l) => l.nodeId), ["n_b"]);
		assert.deepEqual(store.readNodes().map((n) => n.id), ["n_b"]);
	});
});

describe("mergeFindings returns node ids", () => {
	it("lists created and linked ids alongside the counts", () => {
		const store = memoryStore();
		const deps = { chatStore: {} as ChatStore, graphStore: store };
		const prop = (id: string, statement: string) => ({ id, name: id, statement, aliases: [] as string[] });
		const first = mergeFindings(
			"c1",
			{ propositions: [prop("p1", "Alpha holds.")], chains: [] },
			{ links: [] },
			deps,
			{ foldedAt: "2026-01-01T00:00:00.000Z" },
		);
		assert.equal(first.nodes, 1);
		assert.equal(first.createdNodeIds.length, 1);
		assert.deepEqual(first.linkedNodeIds, []);
		const existing = first.createdNodeIds[0]!;

		const second = mergeFindings(
			"c2",
			{ propositions: [prop("p1", "Alpha, reworded."), prop("p2", "Beta holds.")], chains: [] },
			{ links: [{ id: "p1", linkTo: existing }] },
			deps,
			{ foldedAt: "2026-01-02T00:00:00.000Z" },
		);
		assert.equal(second.nodes, 1);
		assert.deepEqual(second.linkedNodeIds, [existing]);
		assert.equal(second.createdNodeIds.length, 1);
		assert.notEqual(second.createdNodeIds[0], existing);
		assert.ok(store.readNodes().some((n) => n.id === second.createdNodeIds[0]));
	});
});
