import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { createCanvasSurface } from "./canvas-utils";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import { wasmCompositor } from "./compositor/wasm-compositor";
import { resolveRenderTree } from "./resolve";
import {
	measureSpanAsync,
	measureSpanSync,
	onRenderPerfFrameComplete,
} from "@/diagnostics/render-perf";

export type CanvasRendererParams = {
	width: number;
	height: number;
	fps: FrameRate;
};

// The wasm compositor is one global surface + texture cache shared by every
// CanvasRenderer (live preview, project thumbnails, snapshots, export). Two
// interleaved render sequences corrupt each other: syncTextures diff-releases
// the other caller's textures between its syncTextures and renderFrame, and a
// mid-sequence resize reconfigures the surface under the other render. That
// race can surface as wgpu errors, which panic and poison the whole wasm
// instance — so every resolve→sync→renderFrame sequence takes this lock.
let compositorQueue: Promise<unknown> = Promise.resolve();

function withCompositorLock<T>(fn: () => Promise<T>): Promise<T> {
	const result = compositorQueue.then(fn);
	compositorQueue = result.catch(() => undefined);
	return result;
}

export class CanvasRenderer {
	canvas: OffscreenCanvas;
	context: OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	fps: FrameRate;

	constructor({ width, height, fps }: CanvasRendererParams) {
		this.width = width;
		this.height = height;
		this.fps = fps;

		const surface = createCanvasSurface({ width, height });
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	getOutputCanvas(): HTMLCanvasElement {
		wasmCompositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		return wasmCompositor.getCanvas();
	}

	setSize({ width, height }: { width: number; height: number }) {
		this.width = width;
		this.height = height;

		const surface = createCanvasSurface({ width, height });
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	async render({ node, time }: { node: AnyBaseNode; time: number }) {
		await withCompositorLock(() => this.renderLocked({ node, time }));
	}

	private async renderLocked({
		node,
		time,
	}: {
		node: AnyBaseNode;
		time: number;
	}) {
		await measureSpanAsync({
			name: "resolve",
			fn: () => resolveRenderTree({ node, renderer: this, time }),
		});
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		wasmCompositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		measureSpanSync({
			name: "syncTextures",
			fn: () => wasmCompositor.syncTextures(textures),
		});
		measureSpanSync({
			name: "renderFrame",
			fn: () => wasmCompositor.render(frame),
		});
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
	}) {
		// The copy-out must happen inside the lock too, before a concurrent
		// caller overwrites the shared compositor surface.
		await withCompositorLock(async () => {
			await this.renderLocked({ node, time });

			const ctx = targetCanvas.getContext("2d");
			if (!ctx) {
				throw new Error("Failed to get target canvas context");
			}

			measureSpanSync({
				name: "drawImage",
				fn: () =>
					ctx.drawImage(
						wasmCompositor.getCanvas(),
						0,
						0,
						targetCanvas.width,
						targetCanvas.height,
					),
			});
		});
		onRenderPerfFrameComplete();
	}
}
