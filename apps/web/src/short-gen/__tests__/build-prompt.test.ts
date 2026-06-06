import { describe, expect, test } from "bun:test";
import { buildShortPlanPrompt } from "@/short-gen/build-prompt";
import { getPreset } from "@/short-gen/presets";
import type { ComposeRequest } from "@/short-gen/schema";

const PRESET_ID = "conclusion-first";

function makeRequest(): ComposeRequest {
	return {
		presetId: PRESET_ID,
		targetSeconds: 30,
		segments: [
			{ index: 0, start: 0, end: 3, text: "最初のセグメント" },
			{ index: 1, start: 3, end: 6, text: "次のセグメント" },
		],
	};
}

describe("buildShortPlanPrompt", () => {
	test("system includes the preset label, its instruction, and the output contract", () => {
		const preset = getPreset(PRESET_ID);
		if (!preset) {
			throw new Error(`expected preset "${PRESET_ID}" to exist`);
		}
		const { system } = buildShortPlanPrompt({ request: makeRequest() });

		// preset label/instruction markers
		expect(system).toContain(preset.label);
		expect(system).toContain(preset.instruction);

		// output-contract wording
		expect(system).toContain("OUTPUT CONTRACT");
		expect(system).toContain("segmentIndex");
	});

	test("user includes the target length and a numbered segment line with its text", () => {
		const { user } = buildShortPlanPrompt({ request: makeRequest() });

		expect(user).toContain("目標尺: 30秒");
		expect(user).toContain("[0]");
		expect(user).toContain("最初のセグメント");
	});

	test("falls back to a generic instruction for an unknown preset", () => {
		const request: ComposeRequest = { ...makeRequest(), presetId: "nope" };
		const { system } = buildShortPlanPrompt({ request });

		expect(system).toContain("汎用テンプレート");
		expect(system).toContain("OUTPUT CONTRACT");
	});
});
