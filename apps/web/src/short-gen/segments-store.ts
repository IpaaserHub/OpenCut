import { create } from "zustand";
import type { TranscriptionSegment } from "@/transcription/types";

interface TranscriptSegmentsStore {
	segments: TranscriptionSegment[];
	/**
	 * The media asset id these segments were transcribed from, or `null` for a
	 * timeline transcription not tied to a specific picked asset. Lets the AI
	 * short flow detect a stale transcript when the source video changes.
	 */
	sourceMediaId: string | null;
	setSegments: (input: {
		segments: TranscriptionSegment[];
		sourceMediaId: string | null;
	}) => void;
	clear: () => void;
}

export const useTranscriptSegments = create<TranscriptSegmentsStore>((set) => ({
	segments: [],
	sourceMediaId: null,
	setSegments: ({ segments, sourceMediaId }) => set({ segments, sourceMediaId }),
	clear: () => set({ segments: [], sourceMediaId: null }),
}));
