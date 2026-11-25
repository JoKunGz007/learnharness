import { chainsForSelection, formatChainLine, RECALL_PICK_CAP } from "@/src/core";
import { getGraph } from "@/src/core/graph"; // Fork (#806 E): effective statement + verification for recall picks
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { compactionInFlight, createChat, isTurnRunning, listChats, readSettingsRecord, stores, titleFromPrompt } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; variant?: unknown; graphContext?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	// Fork (#806 E): "recall" is a practice-chat variant; anything else is refused.
	if (body.variant != null && (body.variant !== "recall" || kind !== "practice")) {
		return Response.json({ error: 'variant "recall" requires kind "practice"' }, { status: 400 });
	}
	const recall = body.variant === "recall";
	// Review fix: a recall chat with no statements could never be graded.
	const rawRecallPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	if (recall && !(Array.isArray(rawRecallPicks) && rawRecallPicks.length > 0)) {
		return Response.json({ error: 'variant "recall" needs graphContext.propositions' }, { status: 400 });
	}
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind, recall ? "recall" : undefined);
	// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
	// thinking level from birth — stamped verbatim from the STRONG slot,
	// the new-session default. From here the strong slot never reaches
	// this session again: in-session picks write the session's own record
	// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
	// boot) → no stamp; the turn gate's 503 models_not_configured envelope
	// refuses honestly until the setup flow fills the slot.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	let picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, recall ? RECALL_PICK_CAP : 64)
			: [];
	if (recall) {
		// Fork (#806 E): each pick carries its verification status and the effective
		// (corrected) statement from the current graph; ids the graph lacks stay "none".
		const live = new Map(getGraph(stores.graphStore).nodes.map((n) => [n.id, n]));
		picks = picks.map((p) => {
			const n = live.get(p.id);
			return { id: p.id, name: n?.name ?? p.name, statement: n?.statement ?? p.statement, verification: n?.verification?.status ?? "none" };
		});
	}
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	return Response.json({ id: chat.id, title: chat.title });
}
