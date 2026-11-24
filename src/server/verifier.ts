/**
 * Fork (#806 C, D-023): the background verifier's batch logic. Pure over an
 * injected deps bag (the real wiring is src/server/verifier-deps.ts), so tests
 * run it with fake model calls and in-memory stores.
 *
 * One batch: candidates (nodes created at/after the persisted cutoff with no
 * verification line, oldest first) → grouped by source passage → passage
 * check (Strong, one call per group) → flagged groups: course-file check
 * (Strong, tools) → still inconclusive: researcher brief (Cheap) + Strong
 * judge. Caps per batch: MAX_STRONG_CALLS verifier calls, MAX_RESEARCH_RUNS
 * researcher runs; the rest stays pending for the next batch. A node that
 * already has a ledger line is never written over (re-checked per write).
 */

import { emit } from "../core/events.ts";
import { chunkSourceRef, recordVerification } from "../core/graph.ts";
import type { GraphNode, ProvenancePoint, VerificationLine } from "../core/contracts/graph.ts";
import type { GraphStore } from "../core/ports.ts";
import type { CourseVerdict, JudgeVerdict, PassageVerdict, VerdictRow, VerifyStatement } from "../agent/subagents/verifier.ts";
import { firstUrl } from "../agent/subagents/verifier.ts";

export const MAX_STRONG_CALLS = 10;
export const MAX_RESEARCH_RUNS = 2;

export type VerifierPhase = "idle" | "passage" | "course" | "web";

export interface VerifierDeps {
	graphStore: Pick<GraphStore, "readNodes" | "readVerification" | "appendVerification">;
	/** The persisted cutoff (ISO) or null when none yet; writeCutoff stores it. */
	readCutoff(): string | null;
	writeCutoff(since: string): void;
	/** Background use allowed (and a model set) for the role's provider. */
	allowed(role: "verifier" | "researcher"): boolean;
	/** The passage text a point anchors to; null = none (no anchor, deleted chat, missing chunk). */
	passageFor(point: ProvenancePoint): string | null;
	/** Any stored import or File-access tool to check against at all. */
	courseSourcesAvailable(): boolean;
	searchAvailable(): boolean;
	passageCheck(passage: string, statements: VerifyStatement[]): Promise<VerdictRow<PassageVerdict>[]>;
	courseCheck(statements: VerifyStatement[], hints: Record<string, string>): Promise<VerdictRow<CourseVerdict>[]>;
	research(statements: VerifyStatement[]): Promise<string>;
	judge(statements: VerifyStatement[], brief: string): Promise<VerdictRow<JudgeVerdict>[]>;
	now(): Date;
	log(message: string): void;
}

export interface BatchSummary {
	/** Why nothing was attempted ("background-off"), when so. */
	skipped?: "background-off";
	verified: number;
	corrected: number;
	doubtful: number;
	/** Candidates still without a line when the batch ended. */
	pending: number;
	strongCalls: number;
	researcherRuns: number;
}

interface PendingNode { id: string; statement: string; createdAt: string; point: ProvenancePoint | null }
interface Group { key: string; point: ProvenancePoint | null; sourceRef: string | null; nodes: PendingNode[] }
interface VerifierState { running: Promise<BatchSummary> | null; rerun: boolean; phase: VerifierPhase; startedAt: number; warnedOff: boolean }

/** globalThis: Next compiles each route as its own module (the mistakes queue's precedent). */
function state(): VerifierState {
	const g = globalThis as typeof globalThis & { __lhVerifier?: VerifierState };
	return (g.__lhVerifier ??= { running: null, rerun: false, phase: "idle", startedAt: 0, warnedOff: false });
}

export const verifierPhase = (): VerifierPhase => state().phase;
export const isVerifying = (): boolean => state().running !== null;

/** The status row for /api/graph/status: non-null only while a batch is doing model work. */
export function verifierStatus(): { startedAt: number; phase: Exclude<VerifierPhase, "idle"> } | null {
	const st = state();
	return st.running && st.phase !== "idle" ? { startedAt: st.startedAt, phase: st.phase } : null;
}

/** Move the phase and announce it (the graph view re-reads /api/graph/status on activity-changed). */
function setPhase(st: VerifierState, phase: VerifierPhase): void {
	if (st.phase === phase) return;
	st.phase = phase;
	emit("activity-changed", {});
}

/** First-run cutoff: persist `now` when absent; nodes older than it never enter the verifier. */
export function ensureVerifierCutoff(deps: Pick<VerifierDeps, "readCutoff" | "writeCutoff" | "now">): string {
	const existing = deps.readCutoff();
	if (existing) return existing;
	const since = deps.now().toISOString();
	deps.writeCutoff(since);
	return since;
}

/** Fold node lines by id (first line defines statement/createdAt, provenance unions); keep those at/after `since` with no ledger line. */
function pendingNodes(deps: VerifierDeps, since: string): PendingNode[] {
	const done = new Set(deps.graphStore.readVerification().map((l) => l.nodeId));
	const byId = new Map<string, GraphNode>();
	for (const line of deps.graphStore.readNodes()) if (!byId.has(line.id)) byId.set(line.id, line);
	const sinceMs = Date.parse(since);
	return [...byId.values()]
		.filter((n) => !done.has(n.id) && Date.parse(n.createdAt) >= sinceMs)
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
		.map((n) => ({ id: n.id, statement: n.statement, createdAt: n.createdAt, point: n.provenance[0] ?? null }));
}

function groupKey(point: ProvenancePoint | null): { key: string; sourceRef: string | null } {
	if (!point) return { key: "none", sourceRef: null };
	const chunk = chunkSourceRef(point);
	if (chunk) return { key: chunk, sourceRef: chunk };
	if (point.messageId) return { key: `${point.chatId}#${point.messageId}`, sourceRef: `${point.chatId}#${point.messageId}` };
	return { key: `${point.chatId}#`, sourceRef: null }; // chat-level / pre-anchor import: no passage
}

function groupByPassage(nodes: PendingNode[]): Group[] {
	const groups = new Map<string, Group>();
	for (const n of nodes) {
		const { key, sourceRef } = groupKey(n.point);
		const g = groups.get(key) ?? { key, point: n.point, sourceRef, nodes: [] };
		g.nodes.push(n);
		groups.set(key, g);
	}
	return [...groups.values()];
}

const asStatements = (nodes: PendingNode[]): VerifyStatement[] => nodes.map((n, i) => ({ id: `s${i + 1}`, statement: n.statement }));
const rowsById = <V extends string>(rows: VerdictRow<V>[]): Map<string, VerdictRow<V>> => new Map(rows.map((r) => [r.id, r]));
const sameText = (a: string, b: string): boolean => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

async function runBatch(deps: VerifierDeps, st: VerifierState): Promise<BatchSummary> {
	const summary: BatchSummary = { verified: 0, corrected: 0, doubtful: 0, pending: 0, strongCalls: 0, researcherRuns: 0 };
	// The cutoff is not a verdict: persist it even when background use is off,
	// so nodes made while it is off stay candidates once it is turned on.
	const since = ensureVerifierCutoff(deps);
	if (!deps.allowed("verifier")) {
		if (!st.warnedOff) {
			st.warnedOff = true;
			deps.log("[verifier] skipped: background use is off (or no model is set) for the verifier role's provider; nodes stay unverified.");
		}
		summary.skipped = "background-off";
		return summary;
	}
	st.warnedOff = false;

	const candidates = pendingNodes(deps, since);
	summary.pending = candidates.length;
	if (candidates.length === 0) return summary;

	const takeStrong = (): boolean => (summary.strongCalls < MAX_STRONG_CALLS ? (summary.strongCalls++, true) : false);
	/** Write one line unless the node already has one (re-read per write). */
	const write = (node: PendingNode, line: Omit<VerificationLine, "nodeId" | "at">): void => {
		if (deps.graphStore.readVerification().some((l) => l.nodeId === node.id)) return;
		recordVerification(deps.graphStore, { nodeId: node.id, at: deps.now().toISOString(), ...line });
		summary.pending--;
		if (line.status === "verified") summary.verified++;
		else if (line.status === "corrected") summary.corrected++;
		else summary.doubtful++;
	};
	const fail = (what: string, err: unknown): void => deps.log(`[verifier] ${what} failed: ${err instanceof Error ? err.message : String(err)}`);

	// ── 1. passage ──
	setPhase(st, "passage");
	const flagged: Array<{ group: Group; nodes: PendingNode[]; hints: Map<string, string> }> = [];
	for (const group of groupByPassage(candidates)) {
		const passage = group.point ? deps.passageFor(group.point) : null;
		if (!passage || !passage.trim()) {
			flagged.push({ group, nodes: group.nodes, hints: new Map(group.nodes.map((n) => [n.id, "no source passage available"])) });
			continue;
		}
		if (!takeStrong()) break; // the rest stays pending, not flagged
		const statements = asStatements(group.nodes);
		let rows: Map<string, VerdictRow<PassageVerdict>>;
		try { rows = rowsById(await deps.passageCheck(passage, statements)); } catch (err) { fail("passage check", err); continue; }
		const flag: PendingNode[] = [], hints = new Map<string, string>();
		group.nodes.forEach((node, i) => {
			const row = rows.get(statements[i]!.id);
			if (!row) return; // unanswered: stays pending
			if (row.verdict === "supported") write(node, { status: "verified", ...(group.sourceRef ? { sourceRef: group.sourceRef } : {}), ...(row.note ? { note: row.note } : {}) });
			else { flag.push(node); hints.set(node.id, `${row.verdict} by its source passage${row.note ? `: ${row.note}` : ""}`); }
		});
		if (flag.length) flagged.push({ group, nodes: flag, hints });
	}

	// ── 2. course files ──
	setPhase(st, "course");
	const inconclusive: Array<{ group: Group; nodes: PendingNode[] }> = [];
	const haveCourse = deps.courseSourcesAvailable();
	for (const f of flagged) {
		if (!haveCourse) { inconclusive.push({ group: f.group, nodes: f.nodes }); continue; }
		if (!takeStrong()) break;
		const statements = asStatements(f.nodes);
		const hints: Record<string, string> = {};
		f.nodes.forEach((n, i) => { const h = f.hints.get(n.id); if (h) hints[statements[i]!.id] = h; });
		let rows: Map<string, VerdictRow<CourseVerdict>>;
		try { rows = rowsById(await deps.courseCheck(statements, hints)); } catch (err) { fail("course-file check", err); continue; }
		const rest: PendingNode[] = [];
		f.nodes.forEach((node, i) => {
			const row = rows.get(statements[i]!.id);
			if (!row) return;
			if (row.verdict === "verified") write(node, { status: "verified", ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}), ...(row.note ? { note: row.note } : {}) });
			else if (row.verdict === "corrected" && row.correctedText && !sameText(row.correctedText, node.statement)) {
				write(node, { status: "corrected", oldText: node.statement, correctedText: row.correctedText, ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}), ...(row.note ? { note: row.note } : {}) });
			} else rest.push(node);
		});
		if (rest.length) inconclusive.push({ group: f.group, nodes: rest });
	}

	// ── 3. web ──
	setPhase(st, "web");
	if (inconclusive.length && deps.allowed("researcher") && deps.searchAvailable()) {
		for (const { nodes } of inconclusive) {
			if (summary.researcherRuns >= MAX_RESEARCH_RUNS || summary.strongCalls >= MAX_STRONG_CALLS) break;
			const statements = asStatements(nodes);
			summary.researcherRuns++;
			let brief: string;
			try { brief = await deps.research(statements); } catch (err) { fail("researcher run", err); continue; }
			if (!brief.trim()) continue;
			if (!takeStrong()) break;
			let rows: Map<string, VerdictRow<JudgeVerdict>>;
			try { rows = rowsById(await deps.judge(statements, brief)); } catch (err) { fail("web judgement", err); continue; }
			const url = firstUrl(brief);
			nodes.forEach((node, i) => {
				const row = rows.get(statements[i]!.id);
				if (!row) return;
				const sourceRef = row.sourceRef ?? url, note = row.note;
				const extra = { ...(sourceRef ? { sourceRef } : {}), ...(note ? { note } : {}) };
				if (row.verdict === "verified") write(node, { status: "verified", ...extra });
				else if (row.verdict === "corrected" && row.correctedText && !sameText(row.correctedText, node.statement)) {
					write(node, { status: "corrected", oldText: node.statement, correctedText: row.correctedText, ...extra });
				} else write(node, { status: "doubtful", ...extra });
			});
		}
	}
	return summary;
}

/**
 * Run one verification batch (single-flight). A call while a batch runs only
 * sets the rerun flag; the running batch loops once more when it ends, and
 * every caller gets the same promise (the last batch's summary).
 */
export function runVerificationBatch(deps: VerifierDeps): Promise<BatchSummary> {
	const st = state();
	if (st.running) {
		st.rerun = true;
		return st.running;
	}
	st.startedAt = Date.now();
	st.running = (async () => {
		try {
			let last: BatchSummary;
			do {
				st.rerun = false;
				st.phase = "idle"; // a batch with nothing to do shows no status row
				last = await runBatch(deps, st);
			} while (st.rerun);
			return last;
		} finally {
			st.running = null;
			st.phase = "idle";
			emit("activity-changed", {});
		}
	})();
	return st.running;
}
