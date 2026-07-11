/**
 * Pure-TS port of `rust/crates/time` (media_time.rs / frame_rate.rs /
 * timecode.rs), signature-compatible with the same exports from
 * `opencut-wasm`.
 *
 * This exists so time math shares no failure domain with the wasm
 * compositor: a GPU panic poisons the whole wasm instance, and when time
 * math lived there too, every timeline interaction (seek, snap, insert)
 * started throwing alongside the preview. Keep this file dependency-free.
 *
 * Semantics to preserve when editing (mirrors the Rust source):
 * - ticks are integers; fractional seconds round HALF AWAY FROM ZERO
 *   (Rust `f64::round`), not `Math.round`'s half-toward-+Infinity.
 * - frame math uses euclidean div/rem so negative times floor correctly.
 * - out-of-range / non-finite inputs return `undefined`, never throw.
 */

export const TICKS_PER_SECOND = 120_000;

export interface FrameRate {
	numerator: number;
	denominator: number;
}

export type TimeCodeFormat = "MM:SS" | "HH:MM:SS" | "HH:MM:SS:CS" | "HH:MM:SS:FF";

const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;
const CENTISECONDS_PER_SECOND = 100;
const TICKS_PER_CENTISECOND = TICKS_PER_SECOND / CENTISECONDS_PER_SECOND;

function roundHalfAwayFromZero(value: number): number {
	const magnitude = Math.round(Math.abs(value));
	if (magnitude === 0) {
		return 0;
	}
	return value < 0 ? -magnitude : magnitude;
}

function toSafeInteger(value: number): number | undefined {
	if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
		return undefined;
	}
	return value;
}

function divEuclid(a: number, b: number): number {
	return Math.floor(a / b);
}

function remEuclid(a: number, b: number): number {
	return a - divEuclid(a, b) * b;
}

function isValidRate(rate: FrameRate): boolean {
	return rate.numerator > 0 && rate.denominator > 0;
}

export function ticksPerFrame({ rate }: { rate: FrameRate }): number | undefined {
	if (!isValidRate(rate)) {
		return undefined;
	}
	const tickNumerator = TICKS_PER_SECOND * rate.denominator;
	if (tickNumerator % rate.numerator !== 0) {
		return undefined;
	}
	return tickNumerator / rate.numerator;
}

function frameNumberUpperBound(rate: FrameRate): number | undefined {
	if (!isValidRate(rate)) {
		return undefined;
	}
	return Math.ceil(rate.numerator / rate.denominator);
}

export function mediaTimeFromSeconds({
	seconds,
}: {
	seconds: number;
}): number | undefined {
	if (!Number.isFinite(seconds)) {
		return undefined;
	}
	return toSafeInteger(roundHalfAwayFromZero(seconds * TICKS_PER_SECOND));
}

export function mediaTimeToSeconds({ time }: { time: number }): number {
	return time / TICKS_PER_SECOND;
}

export function mediaTimeFromFrame({
	frame,
	rate,
}: {
	frame: number;
	rate: FrameRate;
}): number | undefined {
	const perFrame = ticksPerFrame({ rate });
	if (perFrame === undefined) {
		return undefined;
	}
	return toSafeInteger(frame * perFrame);
}

function toFrameRound(time: number, rate: FrameRate): number | undefined {
	const perFrame = ticksPerFrame({ rate });
	if (perFrame === undefined) {
		return undefined;
	}
	const remainder = remEuclid(time, perFrame);
	const floor = divEuclid(time, perFrame);
	return remainder * 2 >= perFrame ? floor + 1 : floor;
}

export function roundToFrame({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): number | undefined {
	const frame = toFrameRound(time, rate);
	if (frame === undefined) {
		return undefined;
	}
	return mediaTimeFromFrame({ frame, rate });
}

export function floorToFrame({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): number | undefined {
	const perFrame = ticksPerFrame({ rate });
	if (perFrame === undefined) {
		return undefined;
	}
	return divEuclid(time, perFrame) * perFrame;
}

export function isFrameAligned({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): boolean | undefined {
	const perFrame = ticksPerFrame({ rate });
	if (perFrame === undefined) {
		return undefined;
	}
	return remEuclid(time, perFrame) === 0;
}

export function lastFrameTime({
	duration,
	rate,
}: {
	duration: number;
	rate: FrameRate;
}): number | undefined {
	if (duration <= 0) {
		return 0;
	}
	return floorToFrame({ time: duration - 1, rate });
}

export function snappedSeekTime({
	time,
	duration,
	rate,
}: {
	time: number;
	duration: number;
	rate: FrameRate;
}): number | undefined {
	const snapped = roundToFrame({ time, rate });
	if (snapped === undefined) {
		return undefined;
	}
	return Math.min(Math.max(snapped, 0), duration);
}

export function guessTimecodeFormat({
	timeCode,
}: {
	timeCode: string;
}): TimeCodeFormat | undefined {
	const trimmed = timeCode.trim();
	if (trimmed === "") {
		return undefined;
	}

	const parts = trimmed.split(":");
	if (!parts.every((part) => parseUnsignedInteger(part) !== undefined)) {
		return undefined;
	}

	switch (parts.length) {
		case 2:
			return "MM:SS";
		case 3:
			return "HH:MM:SS";
		case 4:
			return "HH:MM:SS:FF";
		default:
			return undefined;
	}
}

export function formatTimecode({
	time,
	format,
	rate,
}: {
	time: number;
	format?: TimeCodeFormat;
	rate?: FrameRate;
}): string | undefined {
	const resolvedFormat = format ?? "HH:MM:SS:CS";
	const totalTicks = Math.max(Math.trunc(time), 0);

	const hourTicks = SECONDS_PER_HOUR * TICKS_PER_SECOND;
	const minuteTicks = SECONDS_PER_MINUTE * TICKS_PER_SECOND;

	const hours = Math.floor(totalTicks / hourTicks);
	const minutes = Math.floor((totalTicks % hourTicks) / minuteTicks);
	const totalSeconds = Math.floor(totalTicks / TICKS_PER_SECOND);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	const secondTicks = totalTicks % TICKS_PER_SECOND;
	const centiseconds = Math.floor(secondTicks / TICKS_PER_CENTISECOND);

	const pad = (value: number) => String(value).padStart(2, "0");

	switch (resolvedFormat) {
		case "MM:SS":
			return `${pad(minutes)}:${pad(seconds)}`;
		case "HH:MM:SS":
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
		case "HH:MM:SS:CS":
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(centiseconds)}`;
		case "HH:MM:SS:FF": {
			if (!rate) {
				return undefined;
			}
			const perFrame = ticksPerFrame({ rate });
			if (perFrame === undefined) {
				return undefined;
			}
			const frames = Math.floor(secondTicks / perFrame);
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
		}
	}
}

export function parseTimecode({
	timeCode,
	format,
	rate,
}: {
	timeCode: string;
	format?: TimeCodeFormat;
	rate?: FrameRate;
}): number | undefined {
	const trimmed = timeCode.trim();
	if (trimmed === "") {
		return undefined;
	}

	const resolvedFormat = format ?? "HH:MM:SS:CS";
	const parts: number[] = [];
	for (const part of trimmed.split(":")) {
		const parsed = parseUnsignedInteger(part);
		if (parsed === undefined) {
			return undefined;
		}
		parts.push(parsed);
	}

	switch (resolvedFormat) {
		case "MM:SS": {
			if (parts.length !== 2) {
				return undefined;
			}
			const [minutes, seconds] = parts;
			if (seconds >= SECONDS_PER_MINUTE) {
				return undefined;
			}
			return (minutes * SECONDS_PER_MINUTE + seconds) * TICKS_PER_SECOND;
		}
		case "HH:MM:SS": {
			if (parts.length !== 3) {
				return undefined;
			}
			const [hours, minutes, seconds] = parts;
			if (minutes >= SECONDS_PER_MINUTE || seconds >= SECONDS_PER_MINUTE) {
				return undefined;
			}
			return (
				(hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds) *
				TICKS_PER_SECOND
			);
		}
		case "HH:MM:SS:CS": {
			if (parts.length !== 4) {
				return undefined;
			}
			const [hours, minutes, seconds, centiseconds] = parts;
			if (
				minutes >= SECONDS_PER_MINUTE ||
				seconds >= SECONDS_PER_MINUTE ||
				centiseconds >= CENTISECONDS_PER_SECOND
			) {
				return undefined;
			}
			return (
				(hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds) *
					TICKS_PER_SECOND +
				centiseconds * TICKS_PER_CENTISECOND
			);
		}
		case "HH:MM:SS:FF": {
			if (!rate || parts.length !== 4) {
				return undefined;
			}
			const upperBound = frameNumberUpperBound(rate);
			if (upperBound === undefined) {
				return undefined;
			}
			const [hours, minutes, seconds, frames] = parts;
			if (
				minutes >= SECONDS_PER_MINUTE ||
				seconds >= SECONDS_PER_MINUTE ||
				frames >= upperBound
			) {
				return undefined;
			}
			const frameTicks = mediaTimeFromFrame({ frame: frames, rate });
			if (frameTicks === undefined) {
				return undefined;
			}
			return (
				(hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds) *
					TICKS_PER_SECOND +
				frameTicks
			);
		}
	}
}

// Mirrors Rust's `u32::from_str`: digits with an optional leading '+', no
// sign, no whitespace, and must fit in u32.
function parseUnsignedInteger(part: string): number | undefined {
	if (!/^\+?\d+$/.test(part)) {
		return undefined;
	}
	const value = Number(part);
	if (!Number.isSafeInteger(value) || value > 0xffff_ffff) {
		return undefined;
	}
	return value;
}
