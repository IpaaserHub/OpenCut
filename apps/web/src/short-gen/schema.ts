import { z } from "zod";

export const composeClipSchema = z.object({
	segmentIndex: z.number().int().min(0),
	order: z.number().int().min(0),
	caption: z.string(),
});

export const composePlanSchema = z.object({
	hookText: z.string(),
	clips: z.array(composeClipSchema).min(1),
	ctaText: z.string(),
	estimatedSeconds: z.number().min(0),
});
export type ComposePlan = z.infer<typeof composePlanSchema>;

export const composeRequestSchema = z.object({
	presetId: z.string(),
	targetSeconds: z.number().int().min(5).max(180),
	segments: z
		.array(
			z.object({
				index: z.number().int().min(0),
				start: z.number().min(0),
				end: z.number().min(0),
				text: z.string(),
			}),
		)
		.min(1),
});
export type ComposeRequest = z.infer<typeof composeRequestSchema>;
