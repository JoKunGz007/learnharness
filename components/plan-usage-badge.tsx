"use client";

import { useEffect, useState } from "react";
import type { PlanUsage, UsageWindow } from "../src/agent/claude-code/plan-usage.ts";
import { chatFiveHourPct, formatChatShare, windowStart } from "../src/core/chat-share.ts";
import type { JobRecord, TurnUsage } from "../src/core/contracts.ts";

/** The cache-timer rule: red from 80, amber from 50, else green. */
export function usageColor(pct: number): string {
	return pct >= 80 ? "#E0664A" : pct >= 50 ? "#E0A04A" : "#7FB77E";
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function ago(at: number, now: number): string {
	const min = Math.floor((now - at) / 60_000);
	return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
}

export function usageTitle(usage: PlanUsage, now = Date.now()): string {
	const parts: string[] = [];
	if (usage.fiveHour) parts.push(`5-hour: ${Math.round(usage.fiveHour.pct)}%, resets ${hhmm(usage.fiveHour.resetsAt)}`);
	if (usage.sevenDay) parts.push(`weekly: ${Math.round(usage.sevenDay.pct)}%, resets ${new Date(usage.sevenDay.resetsAt).toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(usage.sevenDay.resetsAt)}`);
	parts.push(`as of ${ago(usage.at, now)}`);
	return parts.join(" · ");
}

function Pct({ label, window }: { label: string; window: UsageWindow }) {
	const pct = Math.round(window.pct);
	return <span>{label} <span style={{ color: usageColor(window.pct) }}>{pct}%</span></span>;
}

/** Pure view; renders nothing without a reading. `chat` = this chat's estimated 5-hour share, if known. */
export function PlanUsageView({ usage, now, chat }: { usage: PlanUsage | null; now?: number; chat?: { turns: readonly TurnUsage[]; jobs?: readonly JobRecord[] } }) {
	if (!usage || (!usage.fiveHour && !usage.sevenDay)) return null;
	const at = now ?? Date.now();
	const share = chat ? formatChatShare(chatFiveHourPct(chat.turns, chat.jobs ?? [], windowStart(usage.fiveHour?.resetsAt, at))) : null;
	return (
		<span data-testid="plan-usage" title={usageTitle(usage, now) + (share ? " · chat: estimated share of the 5-hour limit from this chat's requests (and its background jobs) in the current window" : "")} className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
			{usage.fiveHour && <Pct label="5h" window={usage.fiveHour} />}
			{usage.fiveHour && usage.sevenDay && <span aria-hidden> · </span>}
			{usage.sevenDay && <Pct label="7d" window={usage.sevenDay} />}
			{share && <><span aria-hidden> · </span><span data-testid="plan-usage-chat">chat {share}</span></>}
		</span>
	);
}

/** Claude plan usage: refetched when `refreshKey` changes (a turn finished) and every 60 s. */
export function PlanUsageBadge({ refreshKey, turns, jobs }: { refreshKey?: number; turns?: readonly TurnUsage[]; jobs?: readonly JobRecord[] }) {
	const [usage, setUsage] = useState<PlanUsage | null>(null);
	useEffect(() => {
		let live = true;
		const load = () => {
			fetch("/api/claude-code/usage", { cache: "no-store" })
				.then((res) => (res.ok ? res.json() : null))
				.then((body) => { if (live) setUsage(body?.["claude-code"] ?? null); })
				.catch(() => { if (live) setUsage(null); });
		};
		load();
		const timer = setInterval(load, 60_000);
		// The usage line arrives after message_stop (up to the 3 s fallback): read once more after it.
		const late = refreshKey === undefined ? undefined : setTimeout(load, 4000);
		return () => { live = false; clearInterval(timer); clearTimeout(late); };
	}, [refreshKey]);
	return <PlanUsageView usage={usage} chat={turns ? { turns, jobs } : undefined} />;
}
