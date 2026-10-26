import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanUsageView, PlanUsageBadge, usageTitle } from "../components/plan-usage-badge.tsx";

const w = (pct: number) => ({ pct, resetsAt: 1793025600_000 });
const view = (fiveHour: ReturnType<typeof w> | null, sevenDay: ReturnType<typeof w> | null) => renderToStaticMarkup(<PlanUsageView usage={{ fiveHour, sevenDay, at: 0 }} now={30_000} />);

describe("plan usage badge", () => {
	it("colours at 49/50/79/80", () => {
		assert.match(view(w(49), null), /#7FB77E[^>]*>49%/);
		assert.match(view(w(50), null), /#E0A04A[^>]*>50%/);
		assert.match(view(w(79), null), /#E0A04A[^>]*>79%/);
		assert.match(view(w(80), null), /#E0664A[^>]*>80%/);
	});
	it("shows both windows, omits a null one", () => {
		const both = view(w(25), w(57));
		assert.match(both, /data-testid="plan-usage"/);
		assert.match(both, /5h/); assert.match(both, /7d/);
		const only5 = view(w(25), null);
		assert.ok(!only5.includes("7d"));
		const only7 = view(null, w(57));
		assert.ok(!only7.includes("5h"));
	});
	it("renders nothing without a reading", () => {
		assert.equal(renderToStaticMarkup(<PlanUsageView usage={null} />), "");
		assert.equal(view(null, null), "");
		assert.equal(renderToStaticMarkup(<PlanUsageBadge refreshKey={0} />), "");
	});
	it("title text", () => {
		const t = usageTitle({ fiveHour: w(25), sevenDay: w(57), at: 0 }, 3 * 60_000);
		assert.match(t, /^5-hour: 25%, resets \d\d:\d\d · weekly: 57%, resets \w{3} \d\d:\d\d · as of 3 min ago$/);
		assert.match(usageTitle({ fiveHour: w(1), sevenDay: null, at: 0 }, 5000), /as of just now$/);
		assert.match(usageTitle({ fiveHour: w(1), sevenDay: null, at: 0 }, 2 * 3600_000), /as of 2 h ago$/);
	});
});
