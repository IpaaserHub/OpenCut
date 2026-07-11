import { useEffect, useRef } from "react";

export function useRafLoop(callback: ({ time }: { time: number }) => void) {
	const requestRef = useRef<number>(0);
	const previousTimeRef = useRef<number | null>(null);

	useEffect(() => {
		let lastErrorLogTime = 0;
		const loop = ({ time }: { time: number }) => {
			if (previousTimeRef.current !== null) {
				const deltaTime = time - previousTimeRef.current;
				// A throwing callback must not kill the loop: the next
				// requestAnimationFrame below is what keeps it alive.
				try {
					callback({ time: deltaTime });
				} catch (error) {
					if (time - lastErrorLogTime > 1_000) {
						lastErrorLogTime = time;
						console.error("useRafLoop callback failed:", error);
					}
				}
			}
			previousTimeRef.current = time;
			requestRef.current = requestAnimationFrame((time) => loop({ time }));
		};

		requestRef.current = requestAnimationFrame((time) => loop({ time }));
		return () => cancelAnimationFrame(requestRef.current);
	}, [callback]);
}
