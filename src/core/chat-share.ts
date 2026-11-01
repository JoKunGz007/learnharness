/** A chat's estimated share of the Claude 5-hour plan limit. Ported from claude-cache-timer's
 * `Spend` (CacheTimer.cs): the usage endpoint reports only the total, so each request is weighted
 * at API prices and converted with a fitted scale. An estimate; the plan's real weights are not published.
 * modelPrice is a deliberate exception to prices.ts's "no copied pricing table": DOLLARS_PER_PCT was fitted
 * against exactly these rates, so swapping in the catalog's would change the scale they calibrate. */
import type { CallUsage, JobRecord, TurnUsage } from "./contracts.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";

/** API-equivalent dollars per 1% of the 5-hour limit (fitted by claude-cache-timer, 2026-10). */
export const DOLLARS_PER_PCT = 0.38;
export const WINDOW_MS = 5 * 3600_000;

/** $ per million tokens: [input, cache read]. `prompt` = the request's whole input, cached or not
 * (Haiku 5.5 costs 5x above 100k). Output is 5x input. Mirrors Spend.Price. */
export function modelPrice(model: string, prompt: number): [input: number, read: number] {
	const m = (model ?? "").toLowerCase();
	if (m.startsWith("<")) return [0, 0];
	if (m.includes("haiku-5")) { const inp = prompt > 100_000 ? 0.5 : 0.1; return [inp, inp / 10]; }
	if (m.includes("fable-5-1") || m.includes("mythos-5-1")) return [10, 0.25];
	if (m.includes("fable") || m.includes("mythos")) return [10, 1];
	if (m.includes("opus-5-5")) return [4, 0.2];
	if (/opus-4-[01]|opus-4-2025|3-opus/.test(m)) return [15, 1.5];
	if (m.includes("opus")) return [5, 0.5];
	if (m.includes("sonnet-5")) return [2, 0.2];
	if (m.includes("sonnet")) return [3, 0.3];
	if (m.includes("haiku")) return [1, 0.1];
	return [5, 0.5];
}

/** Dollars at API prices for one request. Claude Code's usage does not split cache writes by TTL
 * (stored 1h = 0) and the app and CLI both write 1h breakpoints, so every write is priced at 2x. */
export function requestDollars(model: string, u: Partial<CallUsage>): number {
	const inp = u.inputTokens ?? 0, read = u.cacheReadTokens ?? 0, write = u.cacheWriteTokens ?? 0, out = u.outputTokens ?? 0;
	const [p, rd] = modelPrice(model, inp + read + write);
	return (p * (inp + 2 * write + 5 * out) + rd * read) / 1e6;
}

/** Window start: 5 hours before the 5-hour reset, else 5 hours ago (as Spend.WindowStart). */
export function windowStart(resetsAt: number | null | undefined, now: number): number {
	return resetsAt != null && resetsAt > now ? resetsAt - WINDOW_MS : now - WINDOW_MS;
}

const isCli = (model: string | undefined) => model?.startsWith(`${CLAUDE_CODE_PROVIDER}:`) === true;
const stamp = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Percent of the 5-hour limit used by this chat's Claude Code requests since `since` (epoch ms).
 * A turn counts at its persist time (`at`) and a job at its last update, whole, since neither
 * stores per-step times. Background jobs count; other providers do not. */
export function chatFiveHourPct(turns: readonly Pick<TurnUsage, "at" | "model" | "steps">[], jobs: readonly Pick<JobRecord, "updatedAt" | "usage">[], since: number): number {
	let usd = 0;
	for (const t of turns) {
		const at = stamp(t.at);
		if (!isCli(t.model) || at === null || at < since) continue;
		for (const s of t.steps) usd += requestDollars(t.model, s);
	}
	for (const j of jobs) {
		const u = j.usage, at = stamp(j.updatedAt);
		if (!u || !isCli(u.model) || at === null || at < since) continue;
		if (u.calls && u.calls.length === u.steps) for (const c of u.calls) usd += requestDollars(u.model, c);
		else usd += requestDollars(u.model, u);
	}
	return usd / DOLLARS_PER_PCT;
}

/** Null with no usage (nothing to claim), `<0.1%` under 0.05, else at most one decimal (as Spend.ResendText). */
export function formatChatShare(pct: number): string | null {
	if (pct <= 0) return null;
	return pct < 0.05 ? "<0.1%" : `~${Number(pct.toFixed(1))}%`;
}
