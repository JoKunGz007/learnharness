import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PlanUsageBadge } from "../components/plan-usage-badge.tsx";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

test("the badge reads the chat's jobs from its parent, not its own poll", async () => {
	const calls: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string) => { calls.push(url); return Response.json({}); }) as typeof fetch;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<PlanUsageBadge refreshKey={0} turns={[]} jobs={[]} {...{ chatId: "c1" }} />));
	await act(async () => root.unmount());
	host.remove();
	globalThis.fetch = originalFetch;
	assert.deepEqual(calls, ["/api/claude-code/usage"]);
});
