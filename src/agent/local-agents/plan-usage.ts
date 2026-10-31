/**
 * Claude plan-usage readings, taken from the CLI's `rate_limit_event` stream
 * line (undocumented fields: parsed defensively). In memory only; a restart
 * clears it until the next turn reports again.
 */
export interface UsageWindow { /** 0–100 */ pct: number; /** epoch ms */ resetsAt: number }
export interface PlanUsageReading { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null }
export interface PlanUsage extends PlanUsageReading { /** epoch ms of receipt */ at: number }

function parseWindow(value: unknown): UsageWindow | null {
	if (!value || typeof value !== "object") return null;
	const { utilization, resetsAt } = value as Record<string, unknown>;
	if (typeof utilization !== "number" || !Number.isFinite(utilization) || typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return null;
	return { pct: Math.round(Math.min(100, Math.max(0, utilization * 100)) * 100) / 100, resetsAt: resetsAt * 1000 };
}

/** `rate_limit_info` → reading; null when neither window parses. Never throws. */
export function parseRateLimitInfo(info: unknown): PlanUsageReading | null {
	try {
		const windows = (info as { unifiedWindows?: Record<string, unknown> } | null | undefined)?.unifiedWindows;
		if (!windows || typeof windows !== "object") return null;
		const fiveHour = parseWindow(windows.five_hour);
		const sevenDay = parseWindow(windows.seven_day);
		return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
	} catch { return null; }
}

// On globalThis like state.ts: this module is bundled into several route chunks.
const KEY = Symbol.for("lh.localAgents.planUsage");
function store(): Map<string, PlanUsage> {
	const g = globalThis as typeof globalThis & { [KEY]?: Map<string, PlanUsage> };
	return (g[KEY] ??= new Map());
}

export function recordPlanUsage(provider: "claude-code", reading: PlanUsageReading, now = Date.now()): void {
	store().set(provider, { ...reading, at: now });
}

export function planUsage(provider: "claude-code"): PlanUsage | null {
	return store().get(provider) ?? null;
}

/** Test helper. */
export function clearPlanUsage(): void { store().clear(); }
