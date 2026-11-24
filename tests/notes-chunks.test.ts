/**
 * #806 piece B: stored notes imports + chunk anchors. Real graph store under
 * an isolated LH_DATA_DIR (set before any config-loading import); the
 * pipeline runs on scripted faux engines.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-notes-chunks-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { SOURCE_CHUNKS_DIR } = await import("../config.ts");
const { graphStore } = await import("../src/store/graph.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { createExtractionPipeline } = await import("../src/agent/subagents/extraction.ts");
const { chunkSourceRef, getGraph } = await import("../src/core/graph.ts");
const { deleteSourcesTraces } = await import("../src/core/graph-deletion.ts");
const { joinPages, textPages } = await import("../src/agent/subagents/pdf-markdown.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const FINDINGS = {
	propositions: [{ id: "p1", name: "Vim normal mode", statement: "Vim starts in Normal mode.", aliases: [] }],
	chains: [],
} as const;

function engine(name: string, input: unknown): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses([() => fauxAssistantMessage([fauxToolCall(name, input as ToolCall["arguments"], { id: `${name}-call` })], { stopReason: "toolUse" })]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** A pipeline that emits one node per chunk (fresh engines per call via engineFor). */
function pipeline(chunkTokens: number) {
	return createExtractionPipeline({
		chatStore,
		graphStore,
		engineFor: (role) => (role === "extractor" ? engine("submit_findings", FINDINGS) : engine("submit_review", { links: [] })),
		getChunkTokens: () => chunkTokens,
	});
}

const sourceIdOf = (filePath: string) => graphStore.readSources().find((s) => s.filePath === filePath)!.id;
const keyOf = (filePath: string) => String(Date.parse(graphStore.readSources().find((s) => s.filePath === filePath)!.importedAt));
const lineText = (i: number) => `note line ${i}: ${"x".repeat(30)}`; // 43 chars
const TEXT = Array.from({ length: 8 }, (_, i) => lineText(i)).join("\n");
const readStored = (id: string, key: string) => JSON.parse(fs.readFileSync(path.join(SOURCE_CHUNKS_DIR, id, `${key}.json`), "utf-8"));

describe("store: chunk files", () => {
	it("round-trips a chunk and returns null for anything missing", () => {
		graphStore.saveSourceChunks({
			sourceId: "src_rt", importKey: "1700000000000", importedAt: "x", filePath: "a.md", text: "abc\ndef\nghi",
			chunks: [{ index: 0, start: 0, end: 7, lineStart: 1, lineEnd: 2 }, { index: 1, start: 8, end: 11, lineStart: 3, lineEnd: 3, pageStart: 4, pageEnd: 5 }],
		});
		assert.deepEqual(graphStore.readSourceChunk("src_rt", "1700000000000", 0), { text: "abc\ndef", lineStart: 1, lineEnd: 2 });
		assert.deepEqual(graphStore.readSourceChunk("src_rt", "1700000000000", 1), { text: "ghi", lineStart: 3, lineEnd: 3, pageStart: 4, pageEnd: 5 });
		assert.equal(graphStore.readSourceChunk("src_rt", "1700000000000", 2), null);
		assert.equal(graphStore.readSourceChunk("src_rt", "1700000000001", 0), null);
		assert.equal(graphStore.readSourceChunk("src_none", "1700000000000", 0), null);
	});

	it("validates ids before building any path", () => {
		const bad = { importedAt: "x", filePath: "a", text: "t", chunks: [] };
		for (const [sourceId, importKey] of [["../evil", "1"], ["src_a", "../1"], ["src_a", "1:2"], ["a/b", "1"], ["", "1"], ["src_a", ""]] as const) {
			assert.throws(() => graphStore.saveSourceChunks({ ...bad, sourceId, importKey }), /Unsafe/);
			assert.equal(graphStore.readSourceChunk(sourceId, importKey, 0), null);
		}
		assert.equal(fs.existsSync(path.join(TMP_DATA, "evil")), false);
	});
});

describe("chunkSourceRef / samePoint", () => {
	it("formats the ref, undefined without a chunk", () => {
		assert.equal(chunkSourceRef({ chatId: "src_a", messageId: "", chunk: { importKey: "17", index: 3 } }), "src_a@17#3");
		assert.equal(chunkSourceRef({ chatId: "src_a", messageId: "" }), undefined);
	});

	it("keeps two chunks of one source distinct, and chunk-less points working", () => {
		const node = { id: "n_samept", name: "n", statement: "s", aliases: [], createdAt: "t" };
		graphStore.appendNode({ ...node, provenance: [{ chatId: "src_sp", messageId: "", chunk: { importKey: "1", index: 0 } }] });
		graphStore.appendNode({
			...node,
			provenance: [
				{ chatId: "src_sp", messageId: "", chunk: { importKey: "1", index: 1 } },
				{ chatId: "src_sp", messageId: "", chunk: { importKey: "1", index: 0 } },
				{ chatId: "src_sp", messageId: "" },
			],
		});
		const merged = getGraph(graphStore).nodes.find((n) => n.id === "n_samept")!;
		assert.deepEqual(merged.provenance.map((p) => p.chunk?.index ?? "none"), [0, 1, "none"]);
	});
});

describe("import: chunk offsets, anchors, re-import", () => {
	it("stores text + exact offsets/line ranges and anchors each node to its chunk", async () => {
		const file = "/vault/chunks.md";
		await pipeline(30).importNotes({ filePath: file, text: TEXT });
		const id = sourceIdOf(file), key = keyOf(file);
		const stored = readStored(id, key);
		assert.equal(stored.text, TEXT);
		assert.equal(stored.sourceId, id);
		assert.equal(stored.importKey, key);
		assert.equal(stored.filePath, file);
		assert.equal(stored.chunks.length, 4, "2 lines per chunk at budget 30 tokens");
		stored.chunks.forEach((c: { index: number; start: number; end: number; lineStart: number; lineEnd: number; pageStart?: number }, i: number) => {
			assert.equal(c.index, i);
			assert.equal(c.lineStart, 2 * i + 1);
			assert.equal(c.lineEnd, 2 * i + 2);
			assert.equal(TEXT.slice(c.start, c.end), `${lineText(2 * i)}\n${lineText(2 * i + 1)}`);
			assert.equal(c.pageStart, undefined, "text imports carry no pages");
		});
		const nodes = graphStore.readNodes().filter((n) => n.provenance.some((p) => p.chatId === id));
		assert.deepEqual(nodes.map((n) => n.provenance), [0, 1, 2, 3].map((index) => [{ chatId: id, messageId: "", chunk: { importKey: key, index } }]));
		assert.deepEqual(graphStore.readSourceChunk(id, key, 2), { text: `${lineText(4)}\n${lineText(5)}`, lineStart: 5, lineEnd: 6 });
	});

	it("PDF pages: page ranges come from the pages structure", async () => {
		const pdfPages = [
			{ kind: "text" as const, number: 1, markdown: "alpha one\nalpha two" },
			{ kind: "image-only" as const, number: 2 },
			{ kind: "text" as const, number: 3, markdown: "gamma one\ngamma two\ngamma three" },
			{ kind: "text" as const, number: 4, markdown: "delta one" },
		];
		const text = joinPages(pdfPages), pages = textPages(pdfPages);
		assert.equal(pages.map((p) => p.text).join("\n\n"), text, "pages join to the exact same text");
		const file = "/vault/book.pdf";
		await pipeline(15).importNotes({ filePath: file, text, pages });
		const id = sourceIdOf(file), key = keyOf(file);
		const chunks = readStored(id, key).chunks as { start: number; end: number; pageStart: number; pageEnd: number }[];
		assert.ok(chunks.length > 1);
		for (const c of chunks) assert.ok(c.pageStart <= c.pageEnd);
		assert.equal(chunks[0]!.pageStart, 1);
		assert.equal(chunks.at(-1)!.pageEnd, 4);
		assert.ok(!chunks.some((c) => c.pageStart === 2 || c.pageEnd === 2), "the image-only page never appears");
		// A chunk covering only gamma lines sits on page 3.
		const gamma = chunks.find((c) => text.slice(c.start, c.end).includes("gamma two") && !text.slice(c.start, c.end).includes("---"));
		if (gamma) assert.deepEqual([gamma.pageStart, gamma.pageEnd], [3, 3]);
	});

	it("re-import keeps the older file; each import has its own key", async () => {
		const file = "/vault/chunks.md";
		const id = sourceIdOf(file), first = keyOf(file);
		await new Promise((r) => setTimeout(r, 5));
		await pipeline(30).importNotes({ filePath: file, text: TEXT });
		const second = keyOf(file);
		assert.notEqual(first, second);
		const names = fs.readdirSync(path.join(SOURCE_CHUNKS_DIR, id)).sort();
		assert.deepEqual(names, [`${first}.json`, `${second}.json`].sort());
		assert.ok(graphStore.readSourceChunk(id, first, 0));
		assert.ok(graphStore.readSourceChunk(id, second, 0));
	});
});

describe("deletion", () => {
	it("source delete removes the chunk folder and prunes verification lines of deleted nodes", async () => {
		const file = "/vault/doomed.md";
		await pipeline(4096).importNotes({ filePath: file, text: "one line of notes" });
		const id = sourceIdOf(file);
		const node = graphStore.readNodes().find((n) => n.provenance.some((p) => p.chatId === id))!;
		graphStore.appendVerification({ nodeId: node.id, status: "verified", at: "t", sourceRef: chunkSourceRef(node.provenance[0]!) });
		graphStore.appendVerification({ nodeId: "n_other", status: "doubtful", at: "t" });
		assert.ok(fs.existsSync(path.join(SOURCE_CHUNKS_DIR, id)));

		deleteSourcesTraces(graphStore, new Set([id]), "delete-nodes");
		graphStore.deleteSources(new Set([id]));
		graphStore.deleteSourceChunks(new Set([id]));

		assert.equal(fs.existsSync(path.join(SOURCE_CHUNKS_DIR, id)), false);
		assert.deepEqual(graphStore.readVerification().map((l) => l.nodeId), ["n_other"]);
		assert.equal(graphStore.readNodes().some((n) => n.id === node.id), false);
	});
});
