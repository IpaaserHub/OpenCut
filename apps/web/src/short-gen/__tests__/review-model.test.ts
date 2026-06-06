import { describe, expect, test } from "bun:test";
import {
	composePlanFromEditable,
	editableFromPlan,
	type EditableReview,
} from "@/short-gen/review-model";
import { composePlanSchema, type ComposePlan } from "@/short-gen/schema";

function plan(overrides: Partial<ComposePlan> = {}): ComposePlan {
	return {
		hookText: "hook",
		ctaText: "cta",
		estimatedSeconds: 42,
		clips: [
			{ segmentIndex: 5, order: 2, caption: "third" },
			{ segmentIndex: 1, order: 0, caption: "first" },
			{ segmentIndex: 3, order: 1, caption: "second" },
		],
		...overrides,
	};
}

describe("editableFromPlan", () => {
	test("sorts clips by order and marks every clip adopted", () => {
		const review = editableFromPlan({ plan: plan() });

		expect(review.hookText).toBe("hook");
		expect(review.ctaText).toBe("cta");
		expect(review.clips).toEqual([
			{ segmentIndex: 1, caption: "first", adopted: true },
			{ segmentIndex: 3, caption: "second", adopted: true },
			{ segmentIndex: 5, caption: "third", adopted: true },
		]);
	});
});

describe("composePlanFromEditable", () => {
	test("drops non-adopted clips and reindexes order 0,1,2", () => {
		const review: EditableReview = {
			hookText: "h",
			ctaText: "c",
			clips: [
				{ segmentIndex: 1, caption: "first", adopted: true },
				{ segmentIndex: 3, caption: "second", adopted: false },
				{ segmentIndex: 5, caption: "third", adopted: true },
				{ segmentIndex: 7, caption: "fourth", adopted: true },
			],
		};

		const result = composePlanFromEditable({ review });

		expect(result.hookText).toBe("h");
		expect(result.ctaText).toBe("c");
		expect(result.estimatedSeconds).toBe(0);
		expect(result.clips).toEqual([
			{ segmentIndex: 1, order: 0, caption: "first" },
			{ segmentIndex: 5, order: 1, caption: "third" },
			{ segmentIndex: 7, order: 2, caption: "fourth" },
		]);
	});

	test("produces a plan that passes composePlanSchema when >=1 clip adopted", () => {
		const result = composePlanFromEditable({
			review: editableFromPlan({ plan: plan() }),
		});

		expect(composePlanSchema.safeParse(result).success).toBe(true);
	});

	test("excluding a clip removes it and reindexes the rest", () => {
		const review = editableFromPlan({ plan: plan() });
		// Exclude the middle clip (segmentIndex 3).
		review.clips[1].adopted = false;

		const result = composePlanFromEditable({ review });

		expect(result.clips).toEqual([
			{ segmentIndex: 1, order: 0, caption: "first" },
			{ segmentIndex: 5, order: 1, caption: "third" },
		]);
	});
});

describe("round-trip editableFromPlan -> composePlanFromEditable", () => {
	test("all adopted, same order: clips equal in segmentIndex/caption with order 0..n-1", () => {
		const original = plan();
		const result = composePlanFromEditable({
			review: editableFromPlan({ plan: original }),
		});

		expect(result.hookText).toBe(original.hookText);
		expect(result.ctaText).toBe(original.ctaText);
		expect(result.clips).toEqual([
			{ segmentIndex: 1, order: 0, caption: "first" },
			{ segmentIndex: 3, order: 1, caption: "second" },
			{ segmentIndex: 5, order: 2, caption: "third" },
		]);
	});

	test("reordering the editable array is reflected in the output order", () => {
		const review = editableFromPlan({ plan: plan() });
		// Move the last clip (segmentIndex 5) to the front.
		const moved = review.clips.pop();
		if (!moved) {
			throw new Error("expected a clip to move");
		}
		review.clips.unshift(moved);

		const result = composePlanFromEditable({ review });

		expect(result.clips).toEqual([
			{ segmentIndex: 5, order: 0, caption: "third" },
			{ segmentIndex: 1, order: 1, caption: "first" },
			{ segmentIndex: 3, order: 2, caption: "second" },
		]);
	});
});
