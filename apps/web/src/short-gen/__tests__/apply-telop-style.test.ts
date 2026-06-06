import { describe, expect, test } from "bun:test";
import type { ParamValues } from "@/params";
import { applyTelopStyle, stripContent } from "@/short-gen/apply-telop-style";
import type { CreateTextElement } from "@/timeline/types";

/**
 * Minimal fake text element: the helper only reads/writes `.params`, so the
 * MediaTime-shaped fields are irrelevant and cast away.
 */
const mkElement = (params: Partial<ParamValues>): CreateTextElement =>
	// The MediaTime fields need wasm to build; this pure test only touches
	// `.params`, so a structural fake is cast in.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	({ type: "text", params }) as unknown as CreateTextElement;

describe("applyTelopStyle", () => {
	test("merges style params (fontSize/color/transform.positionX) onto each element", () => {
		const elements = [
			mkElement({ content: "one", fontSize: 10 }),
			mkElement({ content: "two", fontSize: 10 }),
		];
		const result = applyTelopStyle({
			elements,
			styleParams: { fontSize: 48, color: "#ff0000", "transform.positionX": 5 },
		});

		expect(result[0].params.fontSize).toBe(48);
		expect(result[0].params.color).toBe("#ff0000");
		expect(result[0].params["transform.positionX"]).toBe(5);
		expect(result[1].params.fontSize).toBe(48);
		expect(result[1].params.color).toBe("#ff0000");
		expect(result[1].params["transform.positionX"]).toBe(5);
	});

	test("ignores the content key in styleParams (each element keeps its own text)", () => {
		const elements = [
			mkElement({ content: "first", fontSize: 10 }),
			mkElement({ content: "second", fontSize: 10 }),
		];
		const result = applyTelopStyle({
			elements,
			styleParams: { content: "STYLE TEXT", fontSize: 48 },
		});

		expect(result[0].params.content).toBe("first");
		expect(result[1].params.content).toBe("second");
		expect(result[0].params.fontSize).toBe(48);
		expect(result[1].params.fontSize).toBe(48);
	});

	test("leaves params not present in styleParams untouched", () => {
		const elements = [mkElement({ content: "keep", fontFamily: "Inter" })];
		const result = applyTelopStyle({
			elements,
			styleParams: { fontSize: 48 },
		});

		expect(result[0].params.fontFamily).toBe("Inter");
		expect(result[0].params.content).toBe("keep");
		expect(result[0].params.fontSize).toBe(48);
	});

	test("empty styleParams leaves element params unchanged", () => {
		const elements = [mkElement({ content: "unchanged", fontSize: 10 })];
		const result = applyTelopStyle({ elements, styleParams: {} });

		expect(result[0].params).toEqual({ content: "unchanged", fontSize: 10 });
	});
});

describe("stripContent", () => {
	test("removes the content key, keeps other params", () => {
		const result = stripContent({
			styleParams: { content: "STYLE TEXT", fontSize: 48, color: "#ff0000" },
		});

		expect(result).toEqual({ fontSize: 48, color: "#ff0000" });
		expect("content" in result).toBe(false);
	});

	test("returns an empty object for content-only params", () => {
		expect(stripContent({ styleParams: { content: "only" } })).toEqual({});
	});

	test("returns an equivalent object when there is no content key", () => {
		expect(stripContent({ styleParams: { fontSize: 24 } })).toEqual({
			fontSize: 24,
		});
	});

	test("does not mutate the input", () => {
		const input: Partial<ParamValues> = { content: "x", fontSize: 12 };
		stripContent({ styleParams: input });
		expect(input).toEqual({ content: "x", fontSize: 12 });
	});
});
