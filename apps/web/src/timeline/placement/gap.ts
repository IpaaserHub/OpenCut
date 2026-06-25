import type { SceneTracks, TimelineTrack } from "@/timeline";
import { addMediaTime, type MediaTime, subMediaTime } from "@/wasm";

export interface TrackGap {
	startTime: MediaTime;
	duration: MediaTime;
}

// Empty spans between a track's elements (sorted by start). A running max-end
// keeps overlapping/nested elements from reporting phantom gaps.
export function findTrackGaps({ track }: { track: TimelineTrack }): TrackGap[] {
	const sorted = [...track.elements].sort(
		(left, right) => left.startTime - right.startTime,
	);
	const gaps: TrackGap[] = [];
	if (sorted.length === 0) {
		return gaps;
	}

	let runningEnd = addMediaTime({
		a: sorted[0].startTime,
		b: sorted[0].duration,
	});
	for (let index = 1; index < sorted.length; index += 1) {
		const element = sorted[index];
		if (element.startTime > runningEnd) {
			gaps.push({
				startTime: runningEnd,
				duration: subMediaTime({ a: element.startTime, b: runningEnd }),
			});
		}
		const elementEnd = addMediaTime({
			a: element.startTime,
			b: element.duration,
		});
		if (elementEnd > runningEnd) {
			runningEnd = elementEnd;
		}
	}

	return gaps;
}

// Pulls one track's later elements left to remove a single gap. Only the target
// track moves, so closing a gap on one row never disturbs other rows. Other
// gaps on the same track are preserved (their elements just shift along).
export function closeTrackGap({
	tracks,
	trackId,
	gapStartTime,
	gapDuration,
}: {
	tracks: SceneTracks;
	trackId: string;
	gapStartTime: MediaTime;
	gapDuration: MediaTime;
}): SceneTracks {
	if (gapDuration <= 0) {
		return tracks;
	}

	const gapEndTime = addMediaTime({ a: gapStartTime, b: gapDuration });

	return mapTargetTrack({
		tracks,
		trackId,
		update: (track) => ({
			...track,
			elements: track.elements.map((element) =>
				element.startTime >= gapEndTime
					? {
							...element,
							startTime: subMediaTime({
								a: element.startTime,
								b: gapDuration,
							}),
						}
					: element,
			),
		}),
	});
}

function mapTargetTrack({
	tracks,
	trackId,
	update,
}: {
	tracks: SceneTracks;
	trackId: string;
	update: <TTrack extends TimelineTrack>(track: TTrack) => TTrack;
}): SceneTracks {
	return {
		overlay: tracks.overlay.map((track) =>
			track.id === trackId ? update(track) : track,
		),
		main: tracks.main.id === trackId ? update(tracks.main) : tracks.main,
		audio: tracks.audio.map((track) =>
			track.id === trackId ? update(track) : track,
		),
	};
}
