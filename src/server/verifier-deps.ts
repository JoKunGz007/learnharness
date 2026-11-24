/**
 * Fork (#806 C, D-023): the real wiring of the verifier's deps (stores,
 * settings-resolved engines, the web search provider, the File-access
 * policy). The batch logic is src/server/verifier.ts; part 2 calls
 * `triggerVerification()` after each extraction batch.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PATHS, SOURCE_CHUNKS_DIR } from "../../config.ts";
import type { ModelRole } from "../../config.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runResearcherAgent } from "../agent/subagents/researcher.ts";
import { createSearchImportsTool, judgeWithBrief, researchPrompt, verifyAgainstCourseFiles, verifyAgainstPassage } from "../agent/subagents/verifier.ts";
import { connectionBackgroundAllowed } from "../agent/subscription-connections.ts";
import { grepTool } from "../agent/tools/grep.ts";
import { readTool } from "../agent/tools/read.ts";
import { messageViewLines } from "../core/coverage.ts";
import type { ProvenancePoint, SourceChunksFile } from "../core/contracts/graph.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { fileAccessPolicy } from "./file-access.ts";
import { providerKeyPresent } from "./keys.ts";
import { searchProvider } from "./search.ts";
import { stores } from "./stores.ts";
import { ensureVerifierCutoff, runVerificationBatch, type BatchSummary, type VerifierDeps } from "./verifier.ts";

const CUTOFF_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "verifier.json");

function readCutoff(): string | null {
	try {
		const since: unknown = (JSON.parse(fs.readFileSync(CUTOFF_FILE, "utf-8")) as { since?: unknown }).since;
		return typeof since === "string" && Number.isFinite(Date.parse(since)) ? since : null;
	} catch { return null; }
}

function writeCutoff(since: string): void {
	fs.mkdirSync(path.dirname(CUTOFF_FILE), { recursive: true });
	writeFileAtomicSync(CUTOFF_FILE, JSON.stringify({ since }));
}

/** The role's engine, or undefined when no model is set or its key is missing. */
function engineFor(role: ModelRole): PiEngine | undefined {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	return spec && providerKeyPresent(spec.provider) ? piEngineForSpec(spec) : undefined;
}

function roleAllowed(role: ModelRole): boolean {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	return !!spec && providerKeyPresent(spec.provider) && connectionBackgroundAllowed(spec.provider);
}

const need = (role: ModelRole): PiEngine => engineFor(role) ?? (() => { throw new Error(`no model for the ${role} role`); })();

/** Every stored notes/PDF import text (piece B files), unreadable ones skipped. */
export function loadStoredImports(dir: string = SOURCE_CHUNKS_DIR): SourceChunksFile[] {
	const out: SourceChunksFile[] = [];
	let sources: string[] = [];
	try { sources = fs.readdirSync(dir); } catch { return out; }
	for (const sourceId of sources) {
		let files: string[] = [];
		try { files = fs.readdirSync(path.join(dir, sourceId)); } catch { continue; }
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			try {
				const v = JSON.parse(fs.readFileSync(path.join(dir, sourceId, f), "utf-8")) as Partial<SourceChunksFile>;
				if (typeof v.text === "string" && Array.isArray(v.chunks)) {
					out.push({ sourceId, importKey: f.slice(0, -5), importedAt: String(v.importedAt ?? ""), filePath: String(v.filePath ?? ""), text: v.text, chunks: v.chunks });
				}
			} catch { /* a torn file is skipped */ }
		}
	}
	return out;
}

/** The chat-message or import-chunk text a provenance point anchors to; null when gone or unanchored. */
export function passageFor(point: ProvenancePoint): string | null {
	if (point.chunk) return stores.graphStore.readSourceChunk(point.chatId, point.chunk.importKey, point.chunk.index)?.text ?? null;
	if (!point.messageId) return null;
	const msg = stores.chatStore.getChat(point.chatId)?.messages.find((m) => m.id === point.messageId);
	if (!msg) return null;
	return messageViewLines(msg, msg.id).join("\n\n") || null;
}

/** App read/grep, only when File access is restricted to chosen folders (the tools enforce the folders). */
function fileTools(): Record<string, AgentTool<any>> {
	try {
		const p = fileAccessPolicy();
		return p.restricted && p.folders.length > 0 ? { read: readTool, grep: grepTool } : {};
	} catch { return {}; }
}

export function defaultVerifierDeps(): VerifierDeps {
	let imports: SourceChunksFile[] | null = null;
	const loadImports = () => (imports ??= loadStoredImports());
	return {
		graphStore: stores.graphStore,
		readCutoff,
		writeCutoff,
		allowed: roleAllowed,
		passageFor,
		courseSourcesAvailable: () => loadImports().length > 0 || Object.keys(fileTools()).length > 0,
		searchAvailable: () => searchProvider() !== null,
		passageCheck: (passage, statements) => verifyAgainstPassage(passage, statements, { engine: need("verifier") }),
		courseCheck: (statements, hints) =>
			verifyAgainstCourseFiles(statements, { search_imports: createSearchImportsTool(loadImports), ...fileTools() }, { engine: need("verifier"), hints }),
		research: (statements) => runResearcherAgent(researchPrompt(statements), { engine: need("researcher"), search: searchProvider }),
		judge: (statements, brief) => judgeWithBrief(statements, brief, { engine: need("verifier") }),
		now: () => new Date(),
		log: (message) => console.warn(message),
	};
}

/** Part 2's entry point: run (or queue a rerun of) one verification batch on the live stores. */
export function triggerVerification(): Promise<BatchSummary> {
	return runVerificationBatch(defaultVerifierDeps());
}

/**
 * Fork (#806 C part 2): the extraction pipeline's two hooks. `onRunStart`
 * ensures the verifier cutoff before the run's first merge (cached after the
 * first success; a write failure is logged and retried next run, never thrown).
 * `onMerged` fires one verification batch without awaiting it.
 */
export function verifierExtractionHooks(
	opts: { ensureCutoff?: () => void; trigger?: () => Promise<unknown>; log?: (message: string, err: unknown) => void } = {},
): { onRunStart: () => void; onMerged: () => void } {
	const log = opts.log ?? ((message, err) => console.error(message, err));
	const ensure = opts.ensureCutoff ?? (() => void ensureVerifierCutoff(defaultVerifierDeps()));
	const trigger = opts.trigger ?? triggerVerification;
	let ensured = false;
	return {
		onRunStart: () => {
			if (ensured) return;
			try { ensure(); ensured = true; } catch (err) { log("[verifier] could not persist the cutoff:", err); }
		},
		onMerged: () => {
			try { void Promise.resolve(trigger()).catch((err) => log("[verifier] batch failed:", err)); }
			catch (err) { log("[verifier] batch failed:", err); }
		},
	};
}
