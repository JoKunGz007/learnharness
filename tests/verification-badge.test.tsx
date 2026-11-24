/**
 * Fork (#806 D): the verification badge, its tooltip lines, the server-side
 * source-label resolver, and the badge's seats (graph card, review row).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeCardText } from "../components/graph-view.tsx";
import { ReviewBody } from "../components/review-view.tsx";
import { VerificationBadge, verificationTipLines } from "../components/verification-badge.tsx";
import type { ReviewItem } from "../src/core/index.ts";
import { createSourceResolver, withVerificationSources } from "../src/server/verification-source.ts";

const html = (v: Parameters<typeof VerificationBadge>[0]["verification"]) => renderToStaticMarkup(<VerificationBadge verification={v} />);

describe("VerificationBadge", () => {
	it("renders nothing without verification", () => assert.equal(html(undefined), ""));
	it("corrected: a 'corrected' chip, focusable button", () => {
		const out = html({ status: "corrected", oldText: "old" });
		assert.ok(out.includes("<button") && out.includes(">corrected<"));
	});
	it("doubtful: a 'doubtful' chip", () => assert.ok(html({ status: "doubtful", note: "n" }).includes(">doubtful<")));
	it("verified: a check icon labelled 'verified', no chip text", () => {
		const out = html({ status: "verified" });
		assert.ok(out.includes('aria-label="verified"') && out.includes("<svg") && !out.includes(">verified<"));
	});
	it("tip lines: corrected shows Was + note + source; link only with url", () => {
		assert.deepEqual(
			verificationTipLines({ status: "corrected", oldText: "old", note: "why", source: { label: "a.com", url: "https://a.com/x" } }),
			[{ text: "Was: old" }, { text: "why" }, { text: "Source: a.com", url: "https://a.com/x" }],
		);
		assert.deepEqual(verificationTipLines({ status: "verified", source: { label: "n.pdf, p. 2" } }), [{ text: "Source: n.pdf, p. 2" }]);
		assert.deepEqual(verificationTipLines({ status: "verified", oldText: "ignored" }), []);
	});
});

describe("badge seats", () => {
	it("NodeCardText shows the badge beside the name only when verified", () => {
		const plain = renderToStaticMarkup(<NodeCardText name="N" statement="S" />);
		const marked = renderToStaticMarkup(<NodeCardText name="N" statement="S" verification={{ status: "doubtful", at: "t" }} />);
		assert.ok(!plain.includes("verification-badge") && marked.includes("verification-badge-doubtful"));
	});
	it("review row shows the badge next to the name and keeps the checkbox and re-check", () => {
		const item: ReviewItem = { id: "a", name: "A", statement: "s", dueAt: 0, stability: 1, reps: 1, lapses: 0, verifying: true, verification: { status: "corrected", oldText: "o" } };
		const out = renderToStaticMarkup(<ReviewBody payload={{ now: 1, due: [item], upcoming: [], sessionSize: 8 }} selected={new Set(["a"])} busy={false} onToggle={() => {}} onStart={() => {}} />);
		assert.ok(out.includes("verification-badge-corrected") && out.includes('type="checkbox"') && out.includes("review-verifying-a"));
	});
});

describe("createSourceResolver", () => {
	const view = (o: object) => ({ text: "", lineStart: 3, lineEnd: 9, ...o });
	let reads = 0;
	const deps = {
		graphStore: {
			readSources: () => [{ id: "src_1", filePath: String.raw`C:\notes\Calc.pdf` }] as never,
			readSourceChunk: (_s: string, key: string, i: number) => {
				reads++;
				if (key !== "111") return null;
				return i === 0 ? view({ pageStart: 4, pageEnd: 6 }) : i === 1 ? view({ pageStart: 4, pageEnd: 4 }) : view({});
			},
		},
		chatStore: { getChat: (id: string) => (id === "c1" ? ({ title: "Limits chat" } as never) : null) },
	};
	const r = createSourceResolver(deps);
	it("page range", () => assert.deepEqual(r("src_1@111#0"), { label: "Calc.pdf, p. 4–6" }));
	it("single page", () => assert.deepEqual(r("src_1@111#1"), { label: "Calc.pdf, p. 4" }));
	it("lines when no pages", () => assert.deepEqual(r("src_1@111#2"), { label: "Calc.pdf, lines 3–9" }));
	it("web: hostname label and url", () => assert.deepEqual(r("https://www.example.org/a?b#c"), { label: "www.example.org", url: "https://www.example.org/a?b#c" }));
	it("chat: title, else 'this chat'", () => {
		assert.deepEqual(r("c1#m9"), { label: "Limits chat" });
		assert.deepEqual(r("gone#m9"), { label: "this chat" });
	});
	it("missing chunk, unknown source, empty ref -> undefined", () => {
		assert.equal(r("src_1@222#0"), undefined);
		assert.equal(r("src_x@111#0"), undefined);
		assert.equal(r(undefined), undefined);
	});
	it("caches chunk reads per resolver", () => {
		reads = 0;
		const c = createSourceResolver(deps);
		c("src_1@111#0"); c("src_1@111#0");
		assert.equal(reads, 1);
	});
	it("withVerificationSources fills verification.source", () => {
		const snap = { nodes: [{ id: "n", verification: { status: "verified", at: "t", sourceRef: "src_1@111#1" } }, { id: "m" }] } as never;
		const out = withVerificationSources(snap, deps) as { nodes: { verification?: { source?: unknown } }[] };
		assert.deepEqual(out.nodes[0]!.verification!.source, { label: "Calc.pdf, p. 4" });
		assert.equal(out.nodes[1]!.verification, undefined);
	});
});
