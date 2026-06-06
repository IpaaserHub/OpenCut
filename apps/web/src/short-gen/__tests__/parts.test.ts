import { describe, expect, test } from "bun:test";
import { BODY_FRAMES, CTAS, HOOKS, getHook } from "@/short-gen/parts";
import { PRESETS, getPreset } from "@/short-gen/presets";

describe("parts", () => {
	test("part counts", () => {
		expect(HOOKS).toHaveLength(7);
		expect(BODY_FRAMES).toHaveLength(9);
		expect(CTAS).toHaveLength(4);
	});
	test("getHook returns null for unknown", () => {
		expect(getHook("nope")).toBeNull();
	});
});

describe("presets", () => {
	test("exactly 5 MVP presets", () => {
		expect(PRESETS).toHaveLength(5);
	});
	test("each preset references existing parts and has a non-trivial instruction", () => {
		for (const p of PRESETS) {
			expect(getHook(p.hook)).not.toBeNull();
			expect(p.instruction.length).toBeGreaterThan(40);
			expect(p.label).toBeTruthy();
			expect(p.description).toBeTruthy();
		}
	});
	test("getPreset returns null for unknown id", () => {
		expect(getPreset("nope")).toBeNull();
	});
});
