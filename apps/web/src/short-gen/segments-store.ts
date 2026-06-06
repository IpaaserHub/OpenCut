import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TranscriptionSegment } from "@/transcription/types";

/** How many per-video transcripts to keep cached (bounds localStorage usage). */
const MAX_CACHED_TRANSCRIPTS = 5;

interface TranscriptSegmentsStore {
	segments: TranscriptionSegment[];
	/**
	 * The media asset id the current segments were transcribed from, or `null`
	 * for a timeline transcription not tied to a picked asset. Lets the AI short
	 * flow detect a stale transcript when the source video changes.
	 */
	sourceMediaId: string | null;
	/**
	 * Per-media transcript cache (persisted to localStorage). A video that has
	 * been transcribed once is reused — even across page reloads or after
	 * switching sources — instead of being re-transcribed.
	 */
	cache: Record<string, TranscriptionSegment[]>;
	setSegments: (input: {
		segments: TranscriptionSegment[];
		sourceMediaId: string | null;
	}) => void;
	/** Load a cached transcript as the current one. Returns true on a cache hit. */
	loadCached: (input: { mediaId: string }) => boolean;
	clear: () => void;
}

export const useTranscriptSegments = create<TranscriptSegmentsStore>()(
	persist(
		(set, get) => ({
			segments: [],
			sourceMediaId: null,
			cache: {},
			setSegments: ({ segments, sourceMediaId }) =>
				set((state) => {
					if (!sourceMediaId) {
						return { segments, sourceMediaId };
					}
					// Re-insert at the end so it counts as most-recently-used, then drop
					// the oldest entries beyond the cap (object keys keep insertion order).
					const cache = { ...state.cache };
					delete cache[sourceMediaId];
					cache[sourceMediaId] = segments;
					const keys = Object.keys(cache);
					while (keys.length > MAX_CACHED_TRANSCRIPTS) {
						const oldest = keys.shift();
						if (oldest) delete cache[oldest];
					}
					return { segments, sourceMediaId, cache };
				}),
			loadCached: ({ mediaId }) => {
				const cached = get().cache[mediaId];
				if (cached && cached.length > 0) {
					set({ segments: cached, sourceMediaId: mediaId });
					return true;
				}
				return false;
			},
			// Resets only the current selection; the per-video cache is retained.
			clear: () => set({ segments: [], sourceMediaId: null }),
		}),
		{
			name: "ai-short-transcripts",
			// Only the cache is persisted; the "current" selection is per-session.
			partialize: (state) => ({ cache: state.cache }),
		},
	),
);
