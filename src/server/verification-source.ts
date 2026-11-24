import type { GraphSnapshot, NodeVerification, VerificationSource } from "../core/contracts.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import { stores } from "./stores.ts";

/**
 * Fork (#806 D): turn a VerificationLine.sourceRef into the label the
 * verification badge shows. Kept out of the core fold on purpose: it reads
 * chunk files and chat titles. One resolver per request (the memo is its
 * cache), so a graph full of verified nodes reads each chunk at most once.
 */
export interface VerificationSourceDeps {
	graphStore: Pick<GraphStore, "readSources" | "readSourceChunk">;
	chatStore: Pick<ChatStore, "getChat">;
}

const CHUNK_REF = /^(.+)@(\d+)#(\d+)$/;
const range = (a: number, b: number, one: string, many: string) => (a === b ? `${one} ${a}` : `${many} ${a}–${b}`);

export function createSourceResolver(deps: VerificationSourceDeps): (ref: string | undefined) => VerificationSource | undefined {
	const memo = new Map<string, VerificationSource | undefined>();
	let paths: Map<string, string> | undefined;
	const resolve = (ref: string): VerificationSource | undefined => {
		if (/^https?:\/\//i.test(ref)) {
			try {
				return { label: new URL(ref).hostname, url: ref };
			} catch {
				return undefined;
			}
		}
		const chunk = CHUNK_REF.exec(ref);
		if (chunk) {
			const [, sourceId, importKey, index] = chunk as unknown as [string, string, string, string];
			paths ??= new Map(deps.graphStore.readSources().map((s) => [s.id, s.filePath]));
			const filePath = paths.get(sourceId);
			const view = filePath === undefined ? null : deps.graphStore.readSourceChunk(sourceId, importKey, Number(index));
			if (filePath === undefined || !view) return undefined;
			const file = filePath.split(/[\\/]/).pop() || filePath;
			const where = view.pageStart !== undefined
				? range(view.pageStart, view.pageEnd ?? view.pageStart, "p.", "p.")
				: range(view.lineStart, view.lineEnd, "line", "lines");
			return { label: `${file}, ${where}` };
		}
		const hash = ref.indexOf("#");
		if (hash > 0) return { label: deps.chatStore.getChat(ref.slice(0, hash))?.title || "this chat" };
		return undefined;
	};
	return (ref) => {
		if (!ref) return undefined;
		if (!memo.has(ref)) memo.set(ref, resolve(ref));
		return memo.get(ref);
	};
}

/** The snapshot with `verification.source` filled in on verified nodes. */
export function withVerificationSources(snapshot: GraphSnapshot, deps: VerificationSourceDeps = stores): GraphSnapshot {
	if (!snapshot.nodes.some((n) => n.verification?.sourceRef)) return snapshot;
	const resolve = createSourceResolver(deps);
	return {
		...snapshot,
		nodes: snapshot.nodes.map((n) => {
			const source = resolve(n.verification?.sourceRef);
			return n.verification && source ? { ...n, verification: { ...n.verification, source } as NodeVerification } : n;
		}),
	};
}
