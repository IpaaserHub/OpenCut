import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/auth/rate-limit";
import { webEnv } from "@/env/web";
import { buildShortPlanPrompt } from "@/short-gen/build-prompt";
import { composePlanSchema, composeRequestSchema } from "@/short-gen/schema";

const byokSchema = z.object({ apiKey: z.string().optional() });

export async function POST(request: NextRequest) {
	const { limited } = await checkRateLimit({ request });
	if (limited) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}

	const body = await request.json();
	const parsed = composeRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid input" }, { status: 400 });
	}

	// BYOK: an optional per-request `apiKey` on the raw body overrides the
	// platform key. `composeRequestSchema` strips unknown keys, so read it from
	// the raw parsed JSON via its own schema, not from `parsed.data`.
	const byokKey = byokSchema.safeParse(body).data?.apiKey;
	const resolvedKey = byokKey ?? webEnv.ANTHROPIC_API_KEY;
	if (!resolvedKey) {
		return NextResponse.json(
			{ error: "ANTHROPIC_API_KEY が未設定です。APIキーを設定してください。" },
			{ status: 400 },
		);
	}

	const model = webEnv.ANTHROPIC_MODEL ?? "claude-opus-4-8";
	const client = new Anthropic({ apiKey: resolvedKey });
	const { system, user } = buildShortPlanPrompt({ request: parsed.data });

	let plan: unknown;
	try {
		const response = await client.messages.parse({
			model,
			max_tokens: 16000,
			thinking: { type: "adaptive" },
			output_config: {
				format: zodOutputFormat(composePlanSchema),
				effort: "medium",
			},
			system: [
				{ type: "text", text: system, cache_control: { type: "ephemeral" } },
			],
			messages: [{ role: "user", content: user }],
		});
		plan = response.parsed_output;
	} catch (error) {
		if (error instanceof Anthropic.AuthenticationError) {
			return NextResponse.json({ error: "APIキーが無効です" }, { status: 401 });
		}
		if (error instanceof Anthropic.RateLimitError) {
			return NextResponse.json({ error: "Too many requests" }, { status: 429 });
		}
		if (error instanceof Anthropic.APIError) {
			return NextResponse.json({ error: error.message }, { status: 502 });
		}
		return NextResponse.json(
			{ error: "ショート構成の生成中にエラーが発生しました" },
			{ status: 500 },
		);
	}

	if (plan === null || plan === undefined) {
		return NextResponse.json(
			{ error: "AIが有効な構成を返しませんでした" },
			{ status: 502 },
		);
	}

	const planParsed = composePlanSchema.safeParse(plan);
	if (!planParsed.success) {
		return NextResponse.json(
			{ error: "AIが有効な構成を返しませんでした" },
			{ status: 502 },
		);
	}

	// Drop clips whose segmentIndex isn't one of the provided segments, then
	// renumber `order` 0..n so the surviving clips stay contiguous.
	const validIndexes = new Set(parsed.data.segments.map((s) => s.index));
	const keptClips = planParsed.data.clips
		.filter((clip) => validIndexes.has(clip.segmentIndex))
		.map((clip, order) => ({ ...clip, order }));

	if (keptClips.length === 0) {
		return NextResponse.json(
			{ error: "AIが有効なセグメントを選びませんでした" },
			{ status: 502 },
		);
	}

	const filteredPlan = composePlanSchema.safeParse({
		...planParsed.data,
		clips: keptClips,
	});
	if (!filteredPlan.success) {
		return NextResponse.json(
			{ error: "AIが有効な構成を返しませんでした" },
			{ status: 502 },
		);
	}

	return NextResponse.json({ plan: filteredPlan.data }, { status: 200 });
}
