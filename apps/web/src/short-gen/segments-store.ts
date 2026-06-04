import { create } from "zustand";
import type { TranscriptionSegment } from "@/transcription/types";

interface TranscriptSegmentsStore {
	segments: TranscriptionSegment[];
	setSegments: (segments: TranscriptionSegment[]) => void;
	clear: () => void;
}

export const useTranscriptSegments = create<TranscriptSegmentsStore>((set) => ({
	segments: [],
	setSegments: (segments) => set({ segments }),
	clear: () => set({ segments: [] }),
}));
