/**
 * Tracks the health of the wasm compositor's render loop.
 *
 * A Rust panic inside opencut-wasm aborts without unwinding, which leaves the
 * module's RefCells permanently borrowed — after that, every wasm call traps
 * with `RuntimeError: unreachable`. There is no in-page recovery from that
 * state (the wasm instance memory is undefined), so once we detect it we stop
 * hammering the dead module every animation frame and surface a reload prompt
 * instead of a silent white preview.
 *
 * Transient GPU errors (device lost during a resize race, a single failed
 * upload) are retried; only a poisoned wasm instance or a sustained failure
 * streak is treated as a crash.
 */

declare global {
	interface Window {
		/** Set by the Rust panic hook in opencut-wasm with the panic message. */
		__wasmPanic?: string;
	}
}

const MAX_CONSECUTIVE_FAILURES = 5;

let crashMessage: string | null = null;
let consecutiveFailures = 0;
const listeners = new Set<() => void>();

export function getRenderCrashMessage(): string | null {
	return crashMessage;
}

export function subscribeRenderCrash(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function reportRenderSuccess(): void {
	consecutiveFailures = 0;
}

export function reportRenderFailure({ error }: { error: unknown }): void {
	consecutiveFailures += 1;

	const wasmPanic =
		typeof window !== "undefined" ? window.__wasmPanic : undefined;
	const message = error instanceof Error ? error.message : String(error);
	const isWasmPoisoned =
		wasmPanic !== undefined ||
		message.includes("unreachable") ||
		message.includes("RefCell");

	if (!isWasmPoisoned && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
		console.warn(
			`Preview render failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), retrying:`,
			error,
		);
		return;
	}

	if (crashMessage !== null) {
		return;
	}

	crashMessage = wasmPanic ?? message;
	console.error("Preview renderer crashed, halting render loop:", error);
	if (wasmPanic) {
		console.error("wasm panic:", wasmPanic);
	}
	for (const listener of listeners) {
		listener();
	}
}
