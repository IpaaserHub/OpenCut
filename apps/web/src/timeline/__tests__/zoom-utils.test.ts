import { describe, expect, test } from "bun:test";
import { getTimelineZoomMin } from "@/timeline/zoom-utils";
import { TICKS_PER_SECOND } from "@/wasm";

const seconds = (value: number) => value * TICKS_PER_SECOND;

describe("getTimelineZoomMin", () => {
	test("never magnifies short content past 1:1 to fill the width", () => {
		// A 4s clip fits comfortably at the base scale; the fit zoom must not
		// blow it up to span the whole panel.
		expect(
			getTimelineZoomMin({ duration: seconds(4), containerWidth: 1462 }),
		).toBe(1);
	});

	test("empty timeline does not start zoomed in", () => {
		expect(
			getTimelineZoomMin({ duration: 0, containerWidth: 1000 }),
		).toBe(1);
	});

	test("long content still fits by zooming out below 1", () => {
		const zoom = getTimelineZoomMin({
			duration: seconds(600),
			containerWidth: 1462,
		});
		expect(zoom).toBeLessThan(1);
		expect(zoom).toBeGreaterThan(0);
	});

	test("falls back to a default width when the container is unmeasured", () => {
		expect(
			getTimelineZoomMin({ duration: seconds(4), containerWidth: null }),
		).toBe(1);
	});
});
