import { describe, expect, test } from "bun:test";
import { composePlanSchema, composeRequestSchema } from "@/short-gen/schema";

describe("composePlanSchema", () => {
	test("accepts a valid plan", () => {
		expect(
			composePlanSchema.safeParse({
				hookText: "知らないと損する",
				clips: [{ segmentIndex: 2, order: 0, caption: "結論" }],
				ctaText: "保存してね",
				estimatedSeconds: 28,
			}).success,
		).toBe(true);
	});
	test("rejects empty clips", () => {
		expect(
			composePlanSchema.safeParse({
				hookText: "x",
				clips: [],
				ctaText: "y",
				estimatedSeconds: 10,
			}).success,
		).toBe(false);
	});
	test("rejects negative segmentIndex", () => {
		expect(
			composePlanSchema.safeParse({
				hookText: "x",
				clips: [{ segmentIndex: -1, order: 0, caption: "c" }],
				ctaText: "y",
				estimatedSeconds: 10,
			}).success,
		).toBe(false);
	});
});

describe("composeRequestSchema", () => {
	test("accepts a valid request", () => {
		expect(
			composeRequestSchema.safeParse({
				presetId: "conclusion-first",
				targetSeconds: 30,
				segments: [{ index: 0, start: 0, end: 5, text: "hi" }],
			}).success,
		).toBe(true);
	});
	test("rejects targetSeconds out of range", () => {
		expect(
			composeRequestSchema.safeParse({
				presetId: "x",
				targetSeconds: 1,
				segments: [{ index: 0, start: 0, end: 1, text: "a" }],
			}).success,
		).toBe(false);
	});
	test("rejects empty segments", () => {
		expect(
			composeRequestSchema.safeParse({
				presetId: "x",
				targetSeconds: 30,
				segments: [],
			}).success,
		).toBe(false);
	});
});
