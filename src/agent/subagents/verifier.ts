/**
 * Fork (#806 C, D-023): the verifier's model calls — passage check, course-file
 * check, web judge — plus the course-file keyword tool. Pure model/tool seams:
 * batching, caps and ledger writes live in src/server/verifier.ts.
 *
 * Every call is one structured submit (runSubmitAgent, like analyzeMistake).
 * Statements travel under local ids (s1, s2, …) so a verdict maps back to a
 * node without the model ever seeing node ids.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { runSubmitAgent } from "./submit-agent.ts";
import type { PiEngine } from "../models.ts";
import { serverExecute } from "../tool-execute.ts";
import type { SourceChunksFile } from "../../core/contracts/graph.ts";

export interface VerifyStatement { id: string; statement: string }

export type PassageVerdict = "supported" | "contradicted" | "unsupported";
export type CourseVerdict = "verified" | "corrected" | "inconclusive";
export type JudgeVerdict = "verified" | "corrected" | "doubtful";

export interface VerdictRow<V extends string> { id: string; verdict: V; correctedText?: string; note?: string; sourceRef?: string }

interface CallOpts { engine?: PiEngine; signal?: AbortSignal; onUsage?: (usage: Usage) => void }

const RULES = `Rules:
- Course or passage text outranks your own memory. Use memory only to judge an unsupported claim, and say so in the note.
- A correction is a MINIMAL edit of the statement: change only what is wrong, keep its wording, scope and any LaTeX ($...$).
- When unsure, do not correct: return the statement verbatim as correctedText (or pick the non-committal verdict).
- Keep every note to one short sentence. Never invent a source.`;

const row = <V extends string>(verdicts: readonly V[], extra: Record<string, ReturnType<typeof Type.Optional>> = {}) =>
	Type.Object({
		results: Type.Array(Type.Object({
			id: Type.String({ description: "The statement id (s1, s2, …) exactly as given." }),
			verdict: Type.Union(verdicts.map((v) => Type.Literal(v)) as never),
			correctedText: Type.Optional(Type.String({ description: "The statement with the minimal fix. Required when the verdict is corrected." })),
			note: Type.Optional(Type.String({ description: "One short sentence: what supports or contradicts it." })),
			...extra,
		}), { description: "Exactly one result per statement." }),
	});

const sourceRefProp = { sourceRef: Type.Optional(Type.String({ description: "The sourceRef or URL that backs the verdict, copied exactly." })) };

const trimmed = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function normalize<V extends string>(input: { results?: unknown }): VerdictRow<V>[] {
	const rows = Array.isArray(input.results) ? input.results : [];
	return rows.map((r) => {
		const o = r as Record<string, unknown>;
		const correctedText = trimmed(o.correctedText), note = trimmed(o.note), sourceRef = trimmed(o.sourceRef);
		return {
			id: String(o.id), verdict: o.verdict as V,
			...(correctedText ? { correctedText } : {}), ...(note ? { note } : {}), ...(sourceRef ? { sourceRef } : {}),
		};
	});
}

/** Every statement answered once, no stranger ids, corrected carries text. */
function checkRows<V extends string>(rows: VerdictRow<V>[], statements: readonly VerifyStatement[]): string | null {
	const want = new Set(statements.map((s) => s.id)), seen = new Set<string>();
	for (const r of rows) {
		if (!want.has(r.id)) return `Unknown statement id "${r.id}". Use only ${[...want].join(", ")}.`;
		if (seen.has(r.id)) return `Statement ${r.id} appears twice.`;
		seen.add(r.id);
		if (r.verdict === ("corrected" as string) && !r.correctedText) return `Statement ${r.id} is corrected but has no correctedText.`;
	}
	const missing = [...want].filter((id) => !seen.has(id));
	return missing.length ? `Missing a result for ${missing.join(", ")}.` : null;
}

const listing = (statements: readonly VerifyStatement[]): string => statements.map((s) => `${s.id}: ${s.statement}`).join("\n");

async function submit<V extends string>(
	opts: CallOpts & { role?: "verifier"; toolName: string; schema: ReturnType<typeof row>; instructions: string; prompt: string; statements: readonly VerifyStatement[]; extraTools?: Record<string, AgentTool<any>>; neverSubmitted: string },
): Promise<VerdictRow<V>[]> {
	return runSubmitAgent<VerdictRow<V>[]>({
		role: "verifier",
		toolName: opts.toolName,
		toolDescription: "Submit one result per statement.",
		parameters: opts.schema,
		fill: (input) => normalize<V>(input),
		validate: (rows) => checkRows(rows, opts.statements),
		systemPrompt: opts.instructions,
		prompt: opts.prompt,
		engine: opts.engine,
		signal: opts.signal,
		extraTools: opts.extraTools,
		onStep: (usage) => opts.onUsage?.(usage),
		neverSubmitted: opts.neverSubmitted,
	});
}

// ─── 1. passage ──────────────────────────────────────────────────────────────

const PASSAGE_INSTRUCTIONS = `You are a fact-checker inside a learning app. Statements were extracted from one source passage. For each statement decide against THAT PASSAGE ONLY:
- supported: the passage states or directly implies it.
- contradicted: the passage says something incompatible. Give correctedText.
- unsupported: the passage neither says nor implies it (the extractor may have added or distorted it). Give correctedText only if the passage makes the right version obvious.
Call submit_passage_check once.

${RULES}`;

export function verifyAgainstPassage(passage: string, statements: readonly VerifyStatement[], opts: CallOpts = {}): Promise<VerdictRow<PassageVerdict>[]> {
	return submit<PassageVerdict>({
		...opts, toolName: "submit_passage_check", instructions: PASSAGE_INSTRUCTIONS, statements,
		schema: row(["supported", "contradicted", "unsupported"] as const),
		prompt: `Passage:\n"""\n${passage}\n"""\n\nStatements:\n${listing(statements)}`,
		neverSubmitted: "The verifier never submitted a passage check.",
	});
}

// ─── 2. course files ─────────────────────────────────────────────────────────

const COURSE_INSTRUCTIONS = `You are a fact-checker inside a learning app. Each statement was flagged: its source passage did not back it up. Check it against the learner's COURSE FILES using your tools (search_imports first; read/grep when present). For each statement:
- verified: a course file states or directly implies it. Put that file's sourceRef in sourceRef.
- corrected: a course file contradicts it. Give correctedText and the sourceRef.
- inconclusive: the files say nothing relevant, or conflict. Do not guess.
Call submit_course_check once.

${RULES}`;

export function verifyAgainstCourseFiles(
	statements: readonly VerifyStatement[],
	tools: Record<string, AgentTool<any>>,
	opts: CallOpts & { hints?: Readonly<Record<string, string>> } = {},
): Promise<VerdictRow<CourseVerdict>[]> {
	const hint = (s: VerifyStatement) => (opts.hints?.[s.id] ? `${s.id}: ${s.statement}\n   (why flagged: ${opts.hints[s.id]})` : `${s.id}: ${s.statement}`);
	return submit<CourseVerdict>({
		...opts, toolName: "submit_course_check", instructions: COURSE_INSTRUCTIONS, statements, extraTools: tools,
		schema: row(["verified", "corrected", "inconclusive"] as const, sourceRefProp),
		prompt: `Statements:\n${statements.map(hint).join("\n")}`,
		neverSubmitted: "The verifier never submitted a course-file check.",
	});
}

// ─── 3. web ──────────────────────────────────────────────────────────────────

/** The researcher's brief request for one group (the researcher keeps its Cheap slot). */
export function researchPrompt(statements: readonly VerifyStatement[]): string {
	return [
		"Research question: Which of these statements are accurate? For each one, say whether reliable sources confirm it, contradict it (give the correct version), or do not settle it.",
		`Statements:\n${listing(statements)}`,
		"Context (what this is needed for): a fact-check of statements a tutoring app extracted from a lesson. Prefer authoritative sources, and cite every URL you rely on.",
		"Produce your final brief in the required format.",
	].join("\n\n");
}

const JUDGE_INSTRUCTIONS = `You are a fact-checker inside a learning app. A researcher fact-checked the statements on the web; you receive its brief. Make the final call per statement from the brief (not from memory):
- verified: the brief's sources confirm it. Put the best source URL in sourceRef.
- corrected: the sources show it is wrong. Give correctedText and the source URL.
- doubtful: the sources conflict, are weak, or do not settle it. The learner will see a warning badge.
Call submit_web_judgement once.

${RULES}`;

export function judgeWithBrief(statements: readonly VerifyStatement[], brief: string, opts: CallOpts = {}): Promise<VerdictRow<JudgeVerdict>[]> {
	return submit<JudgeVerdict>({
		...opts, toolName: "submit_web_judgement", instructions: JUDGE_INSTRUCTIONS, statements,
		schema: row(["verified", "corrected", "doubtful"] as const, sourceRefProp),
		prompt: `Statements:\n${listing(statements)}\n\nResearcher's brief:\n"""\n${brief}\n"""`,
		neverSubmitted: "The verifier never submitted a web judgement.",
	});
}

/** First http(s) URL in a brief — the fallback source when the judge names none. */
export function firstUrl(text: string): string | undefined {
	return /https?:\/\/[^\s)\]>"']+/.exec(text)?.[0]?.replace(/[.,;]+$/, "");
}

// ─── the course-file keyword tool ────────────────────────────────────────────

export interface ImportSnippet { sourceRef: string; file: string; lines: string; snippet: string }

const SNIPPET_CHARS = 320;

/** Case-insensitive keyword search over stored import texts: lines ranked by
 *  how many distinct query words they hold; at most two snippets per chunk. */
export function searchImportTexts(files: readonly SourceChunksFile[], query: string, limit = 8): ImportSnippet[] {
	const terms = [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2))];
	if (terms.length === 0) return [];
	const hits: Array<ImportSnippet & { score: number; order: number }> = [];
	let order = 0;
	for (const file of files) {
		let offset = 0;
		for (const line of file.text.split("\n")) {
			const start = offset;
			offset += line.length + 1;
			const lower = line.toLowerCase();
			const score = terms.filter((t) => lower.includes(t)).length;
			if (score === 0) continue;
			const chunk = file.chunks.find((c) => start >= c.start && start < c.end);
			const base = `${file.sourceId}@${file.importKey}`;
			hits.push({
				sourceRef: chunk ? `${base}#${chunk.index}` : base,
				file: file.filePath.split(/[\\/]/).pop() ?? file.filePath,
				lines: chunk ? `lines ${chunk.lineStart}-${chunk.lineEnd}${chunk.pageStart !== undefined ? `, pages ${chunk.pageStart}-${chunk.pageEnd ?? chunk.pageStart}` : ""}` : "",
				snippet: file.text.slice(start, start + SNIPPET_CHARS).trim(),
				score, order: order++,
			});
		}
	}
	hits.sort((a, b) => b.score - a.score || a.order - b.order);
	const perRef = new Map<string, number>(), out: ImportSnippet[] = [];
	for (const h of hits) {
		const n = perRef.get(h.sourceRef) ?? 0;
		if (n >= 2) continue;
		perRef.set(h.sourceRef, n + 1);
		const { score: _s, order: _o, ...snippet } = h;
		out.push(snippet);
		if (out.length >= limit) break;
	}
	return out;
}

const searchInput = Type.Object({ query: Type.String({ minLength: 1, description: "Keywords to look for (case-insensitive); lines holding more of them rank first." }) });

/** `search_imports(query)` over the learner's stored notes/PDF imports. */
export function createSearchImportsTool(load: () => readonly SourceChunksFile[]): AgentTool<typeof searchInput> {
	return {
		name: "search_imports",
		label: "search_imports",
		description: "Search the learner's imported course notes and PDFs by keywords (case-insensitive). Returns short snippets, each with a sourceRef to cite.",
		parameters: searchInput,
		execute: serverExecute("search_imports", searchInput, ({ query }) => {
			const hits = searchImportTexts(load(), query);
			return hits.length ? hits : "No matches in the imported course files.";
		}),
	};
}
