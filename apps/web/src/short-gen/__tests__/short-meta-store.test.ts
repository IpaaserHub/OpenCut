import { beforeEach, describe, expect, test } from "bun:test";
import { useShortMeta } from "@/short-gen/short-meta-store";

describe("short meta store", () => {
	beforeEach(() => {
		useShortMeta.getState().clear();
	});

	test("sets and reads back hook/cta keyed by sceneId", () => {
		useShortMeta
			.getState()
			.setMeta({ sceneId: "scene-1", hookText: "hook", ctaText: "cta" });

		expect(useShortMeta.getState().getMeta({ sceneId: "scene-1" })).toEqual({
			hookText: "hook",
			ctaText: "cta",
		});
	});

	test("returns undefined for an unknown sceneId", () => {
		expect(
			useShortMeta.getState().getMeta({ sceneId: "missing" }),
		).toBeUndefined();
	});

	test("keeps meta for multiple scenes independently", () => {
		const store = useShortMeta.getState();
		store.setMeta({ sceneId: "a", hookText: "ha", ctaText: "ca" });
		store.setMeta({ sceneId: "b", hookText: "hb", ctaText: "cb" });

		expect(useShortMeta.getState().getMeta({ sceneId: "a" })?.hookText).toBe(
			"ha",
		);
		expect(useShortMeta.getState().getMeta({ sceneId: "b" })?.ctaText).toBe(
			"cb",
		);
	});

	test("clears all meta", () => {
		useShortMeta
			.getState()
			.setMeta({ sceneId: "scene-1", hookText: "hook", ctaText: "cta" });
		useShortMeta.getState().clear();

		expect(useShortMeta.getState().metaByScene).toEqual({});
		expect(
			useShortMeta.getState().getMeta({ sceneId: "scene-1" }),
		).toBeUndefined();
	});
});
