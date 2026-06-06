import { describe, expect, test } from "bun:test";
import type { ParamValues } from "@/params";
import { buildApplyStyleToTrackUpdates } from "@/short-gen/bulk-telop-style";
import type { TextTrack } from "@/timeline/types";

/**
 * Minimal fake text track: the builder only reads `track.id` and each
 * element's `id` / `params`, so the MediaTime-shaped timing fields are
 * irrelevant and cast away.
 */
const mkTrack = (
	elements: { id: string; params: Partial<ParamValues> }[],
): TextTrack =>
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	({ id: "track-1", type: "text", elements }) as unknown as TextTrack;

describe("buildApplyStyleToTrackUpdates", () => {
	test("produces one update per element, scoped to the track", () => {
		const track = mkTrack([
			{ id: "e1", params: { content: "one" } },
			{ id: "e2", params: { content: "two" } },
		]);

		const updates = buildApplyStyleToTrackUpdates({
			track,
			styleParams: { fontSize: 48 },
		});

		expect(updates).toHaveLength(2);
		expect(updates[0].trackId).toBe("track-1");
		expect(updates[0].elementId).toBe("e1");
		expect(updates[1].elementId).toBe("e2");
	});

	test("applies style params to every element", () => {
		const track = mkTrack([
			{ id: "e1", params: { content: "one", fontSize: 10 } },
			{ id: "e2", params: { content: "two", fontSize: 10 } },
		]);

		const updates = buildApplyStyleToTrackUpdates({
			track,
			styleParams: { fontSize: 48, color: "#ff0000", "transform.positionX": 5 },
		});

		for (const update of updates) {
			expect(update.patch.params?.fontSize).toBe(48);
			expect(update.patch.params?.color).toBe("#ff0000");
			expect(update.patch.params?.["transform.positionX"]).toBe(5);
		}
	});

	test("each element keeps its own content (propagate-selected invariant)", () => {
		const track = mkTrack([
			{ id: "e1", params: { content: "first", fontSize: 10 } },
			{ id: "e2", params: { content: "second", fontSize: 10 } },
			{ id: "e3", params: { content: "third", fontSize: 10 } },
		]);

		// Style sourced from the selected element e1 — it carries its own content,
		// which must NOT leak onto the other telops.
		const updates = buildApplyStyleToTrackUpdates({
			track,
			styleParams: { content: "first", fontSize: 48 },
		});

		expect(updates[0].patch.params?.content).toBe("first");
		expect(updates[1].patch.params?.content).toBe("second");
		expect(updates[2].patch.params?.content).toBe("third");
		expect(updates[0].patch.params?.fontSize).toBe(48);
		expect(updates[1].patch.params?.fontSize).toBe(48);
		expect(updates[2].patch.params?.fontSize).toBe(48);
	});

	test("leaves element params not present in the style untouched", () => {
		const track = mkTrack([
			{ id: "e1", params: { content: "keep", fontFamily: "Inter" } },
		]);

		const updates = buildApplyStyleToTrackUpdates({
			track,
			styleParams: { fontSize: 48 },
		});

		expect(updates[0].patch.params?.fontFamily).toBe("Inter");
		expect(updates[0].patch.params?.content).toBe("keep");
		expect(updates[0].patch.params?.fontSize).toBe(48);
	});

	test("returns no updates for an empty track", () => {
		expect(
			buildApplyStyleToTrackUpdates({
				track: mkTrack([]),
				styleParams: { fontSize: 48 },
			}),
		).toEqual([]);
	});
});
