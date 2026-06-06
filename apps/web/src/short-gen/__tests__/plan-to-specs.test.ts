import { describe, expect, test } from "bun:test";
import { planToClipSpecs } from "@/short-gen/plan-to-specs";
import type { ComposePlan } from "@/short-gen/schema";

function segment({
	index,
	start,
	end,
	text,
}: {
	index: number;
	start: number;
	end: number;
	text: string;
}) {
	return { index, start, end, text };
}

describe("planToClipSpecs", () => {
	test("orders clips by `order`: first clip is the reordered late segment", () => {
		const plan: ComposePlan = {
			hookText: "",
			ctaText: "",
			estimatedSeconds: 10,
			clips: [
				// order 0 → late segment (index 1), order 1 → early segment (index 0)
				{ segmentIndex: 1, order: 0, caption: "second-source-first" },
				{ segmentIndex: 0, order: 1, caption: "first-source-second" },
			],
		};
		const segments = [
			segment({ index: 0, start: 0, end: 4, text: "early text" }),
			segment({ index: 1, start: 10, end: 16, text: "late text" }),
		];

		const { clips } = planToClipSpecs({ plan, segments });

		expect(clips).toHaveLength(2);
		expect(clips[0].sourceStartSec).toBe(10);
		expect(clips[1].sourceStartSec).toBe(0);
	});

	test("skips clips whose segmentIndex has no matching segment", () => {
		const plan: ComposePlan = {
			hookText: "",
			ctaText: "",
			estimatedSeconds: 5,
			clips: [
				{ segmentIndex: 0, order: 0, caption: "ok" },
				{ segmentIndex: 99, order: 1, caption: "dropped" },
			],
		};
		const segments = [segment({ index: 0, start: 0, end: 5, text: "only" })];

		const { clips } = planToClipSpecs({ plan, segments });

		expect(clips).toHaveLength(1);
		expect(clips[0].caption).toBe("ok");
	});

	test("lays clips back-to-back: clips[1].timelineStartSec === clips[0].durationSec", () => {
		const plan: ComposePlan = {
			hookText: "",
			ctaText: "",
			estimatedSeconds: 10,
			clips: [
				{ segmentIndex: 0, order: 0, caption: "a" },
				{ segmentIndex: 1, order: 1, caption: "b" },
			],
		};
		const segments = [
			segment({ index: 0, start: 2, end: 6, text: "first 4s" }), // 4s long
			segment({ index: 1, start: 20, end: 23, text: "second 3s" }), // 3s long
		];

		const { clips } = planToClipSpecs({ plan, segments });

		expect(clips[0].timelineStartSec).toBe(0);
		expect(clips[0].durationSec).toBe(4);
		expect(clips[1].timelineStartSec).toBe(clips[0].durationSec);
		expect(clips[1].timelineStartSec).toBe(4);
		expect(clips[1].durationSec).toBe(3);
	});

	test("skips zero/negative-duration segments", () => {
		const plan: ComposePlan = {
			hookText: "",
			ctaText: "",
			estimatedSeconds: 5,
			clips: [
				{ segmentIndex: 0, order: 0, caption: "zero" },
				{ segmentIndex: 1, order: 1, caption: "negative" },
				{ segmentIndex: 2, order: 2, caption: "good" },
			],
		};
		const segments = [
			segment({ index: 0, start: 5, end: 5, text: "zero length" }),
			segment({ index: 1, start: 10, end: 8, text: "negative length" }),
			segment({ index: 2, start: 0, end: 3, text: "good" }),
		];

		const { clips } = planToClipSpecs({ plan, segments });

		expect(clips).toHaveLength(1);
		expect(clips[0].caption).toBe("good");
		expect(clips[0].timelineStartSec).toBe(0);
	});

	test("emits hook + per-caption + cta in that order, with correct windows", () => {
		const plan: ComposePlan = {
			hookText: "Watch this!",
			ctaText: "Subscribe now",
			estimatedSeconds: 10,
			clips: [
				{ segmentIndex: 0, order: 0, caption: "caption one" },
				{ segmentIndex: 1, order: 1, caption: "caption two" },
			],
		};
		const segments = [
			segment({ index: 0, start: 0, end: 4, text: "a" }), // 4s
			segment({ index: 1, start: 10, end: 16, text: "b" }), // 6s → total 10s
		];

		const { texts } = planToClipSpecs({ plan, segments });

		// hook + 2 captions + cta = 4, in fixed order
		expect(texts.map((t) => t.role)).toEqual([
			"hook",
			"caption",
			"caption",
			"cta",
		]);

		const hook = texts[0];
		expect(hook.role).toBe("hook");
		expect(hook.text).toBe("Watch this!");
		expect(hook.startSec).toBe(0);
		// hook duration capped at min(3, total=10) = 3
		expect(hook.durationSec).toBe(3);

		expect(texts[1].text).toBe("caption one");
		expect(texts[1].startSec).toBe(0);
		expect(texts[1].durationSec).toBe(4);
		expect(texts[2].text).toBe("caption two");
		expect(texts[2].startSec).toBe(4);
		expect(texts[2].durationSec).toBe(6);

		const cta = texts[3];
		expect(cta.role).toBe("cta");
		expect(cta.text).toBe("Subscribe now");
		// cta is a standalone end card placed AFTER all clips (total=10), so it
		// never overlaps a caption in time.
		expect(cta.startSec).toBe(10);
		expect(cta.durationSec).toBe(3);
	});

	test("hook duration is capped at the total duration when total < endcap", () => {
		const plan: ComposePlan = {
			hookText: "short",
			ctaText: "",
			estimatedSeconds: 2,
			clips: [{ segmentIndex: 0, order: 0, caption: "c" }],
		};
		const segments = [segment({ index: 0, start: 0, end: 2, text: "a" })]; // total 2s < 3s endcap

		const { texts } = planToClipSpecs({ plan, segments });

		const hook = texts.find((t) => t.role === "hook");
		expect(hook?.durationSec).toBe(2);
	});

	test("skips empty hook, empty captions, and empty cta", () => {
		const plan: ComposePlan = {
			hookText: "",
			ctaText: "",
			estimatedSeconds: 10,
			clips: [
				{ segmentIndex: 0, order: 0, caption: "" },
				{ segmentIndex: 1, order: 1, caption: "kept" },
			],
		};
		const segments = [
			segment({ index: 0, start: 0, end: 4, text: "a" }),
			segment({ index: 1, start: 10, end: 16, text: "b" }),
		];

		const { texts } = planToClipSpecs({ plan, segments });

		// only the one non-empty caption survives — no hook, no cta
		expect(texts).toHaveLength(1);
		expect(texts[0].role).toBe("caption");
		expect(texts[0].text).toBe("kept");
	});
});
