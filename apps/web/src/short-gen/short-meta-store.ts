import { create } from "zustand";

/**
 * Hook / CTA text retained for a scene, keyed by sceneId. These are NOT burned
 * onto the timeline (see `specs-to-elements.ts`); they are kept as metadata so a
 * future thumbnail/title feature can reuse the AI-written hook and CTA.
 */
export type ShortMeta = { hookText: string; ctaText: string };

interface ShortMetaStore {
	metaByScene: Record<string, ShortMeta>;
	setMeta: (input: {
		sceneId: string;
		hookText: string;
		ctaText: string;
	}) => void;
	getMeta: (input: { sceneId: string }) => ShortMeta | undefined;
	clear: () => void;
}

export const useShortMeta = create<ShortMetaStore>((set, get) => ({
	metaByScene: {},
	setMeta: ({ sceneId, hookText, ctaText }) =>
		set((state) => ({
			metaByScene: {
				...state.metaByScene,
				[sceneId]: { hookText, ctaText },
			},
		})),
	getMeta: ({ sceneId }) => get().metaByScene[sceneId],
	clear: () => set({ metaByScene: {} }),
}));
