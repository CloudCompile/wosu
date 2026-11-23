/**
 * GPU side of the graphics personalization benchmark: renders a synthetic
 * playfield (background, hit circles, slider bodies, balls, particles and
 * judgements) into an off-screen target at several render scales, and
 * measures how long the GPU takes to finish each frame.
 *
 * Off-screen on purpose: the visible canvas keeps showing the menu, no
 * full-screen flicker, and the numbers don't depend on what the app happens
 * to be drawing. Each measurement is flushed (a one-pixel read-back, or the
 * WebGPU queue) so the time includes the GPU's work, not just the calls
 * being queued.
 */
import { Container, Graphics, RenderTexture, Sprite, type Renderer, type Texture } from 'pixi.js';
import { nextTask } from '../core/nextTask';
import { summarize, type Summary } from './stats';

/** The scene is laid out in this space and scaled to each test size. */
const DESIGN_W = 1280;
const DESIGN_H = 720;

/** Render scales tried for the playfield scene, largest first. */
export const SCENE_SCALES = [1, 0.9, 0.8, 0.7] as const;
/** Full-screen blended layers in the fill-rate test. */
const FILL_LAYERS = 7;

export interface GpuSceneResult {
    /** Render resolution scale this was measured at. */
    readonly scale: number;
    readonly width: number;
    readonly height: number;
    /** Wall time per rendered frame (ms), summarised. */
    readonly timing: Summary;
    /** False when the samples were too erratic to recommend from. */
    readonly stable: boolean;
}

export interface GpuFillResult {
    readonly width: number;
    readonly height: number;
    readonly timing: Summary;
    /** Million pixels shaded per second, overdraw included. */
    readonly megapixelsPerSecond: number;
    readonly stable: boolean;
}

export interface GpuQuadResult {
    readonly quads: number;
    readonly timing: Summary;
    /** Thousand quads per second. */
    readonly kiloquadsPerSecond: number;
    readonly stable: boolean;
}

export interface GpuBenchOptions {
    /** Size of the visible canvas in device pixels (what scale 1 means). */
    width: number;
    height: number;
    /** Rendered frames per measurement (after a warm-up). Default 7. */
    samples?: number;
    /** Progress: 0..1 with the id of the measurement under way. */
    onProgress?: (update: GpuProgress) => void;
    /** Return true to stop early (the panel was closed). */
    shouldStop?: () => boolean;
    now?: () => number;
    yieldTask?: () => Promise<void>;
}

/** A live progress update: which measurement, and how far along the run is. */
export interface GpuProgress {
    /** `scene-1`, `scene-0.9`, ..., `fill`, `quads`. */
    id: string;
    /** Overall progress 0..1. */
    fraction: number;
}

export interface GpuBenchResult {
    readonly scenes: GpuSceneResult[];
    readonly fill: GpuFillResult;
    readonly quads: GpuQuadResult;
    /** The scene frame time at scale 1 is the reference for the report. */
    readonly targetHz: number;
}

/** Small deterministic PRNG so the scene is the same every run. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** The progress id of a playfield scene measurement. */
export function sceneId(scale: number): string {
    return `scene-${scale}`;
}

/** Flush the GPU: the frame is only "done" once its pixels are readable. */
async function finishGpu(renderer: Renderer): Promise<void> {
    const r = renderer as unknown as {
        gl?: WebGL2RenderingContext;
        device?: { queue?: { onSubmittedWorkDone?: () => Promise<unknown> } };
    };
    try {
        if (r.gl) {
            const gl = r.gl;
            const pixel = new Uint8Array(4);
            // Forces the driver to complete everything queued for the bound target.
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return;
        }
        // WebGPU: wait for the submitted work rather than the CPU queue.
        await r.device?.queue?.onSubmittedWorkDone?.();
    } catch {
        // A lost context or a refused read-back: the caller's timings stay
        // useful as CPU-side numbers instead of failing the whole run.
    }
}

function whiteCircleTexture(renderer: Renderer): Texture {
    const g = new Graphics().circle(24, 24, 21).fill(0xffffff).circle(24, 24, 21).stroke({ width: 4, color: 0xffffff, alpha: 0.85 });
    const t = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return t;
}

function sliderTexture(renderer: Renderer): Texture {
    const g = new Graphics().roundRect(0, 0, 160, 18, 9).fill(0xffffff);
    const t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return t;
}

function quadTexture(renderer: Renderer): Texture {
    const g = new Graphics().rect(0, 0, 8, 8).fill(0xffffff);
    const t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return t;
}

function backgroundTexture(renderer: Renderer): Texture {
    // A soft, busy-ish backdrop: its job is to make the scene's fill rate
    // realistic rather than a flat clear.
    const g = new Graphics().rect(0, 0, 256, 256).fill({ color: 0x2a2140, alpha: 1 });
    for (let i = 0; i < 12; i++) {
        g.circle((i * 61) % 256, (i * 97) % 256, 60).fill({ color: 0x6a3f8f, alpha: 0.18 });
    }
    const t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return t;
}

/**
 * The synthetic playfield: roughly a busy osu!standard frame (~290 quads,
 * ~1.5× overdraw at scale 1).
 */
function buildScene(renderer: Renderer): { root: Container; textures: Texture[] } {
    const textures = [whiteCircleTexture(renderer), sliderTexture(renderer), backgroundTexture(renderer)];
    const [circle, slider, bg] = textures;
    const root = new Container();
    const back = new Sprite(bg);
    back.width = DESIGN_W;
    back.height = DESIGN_H;
    root.addChild(back);
    const rand = rng(0xc0ffee);
    for (let i = 0; i < 30; i++) {
        const s = new Sprite(slider);
        s.position.set(rand() * (DESIGN_W - 160), rand() * (DESIGN_H - 18));
        s.alpha = 0.75;
        root.addChild(s);
    }
    for (let i = 0; i < 140; i++) {
        const s = new Sprite(circle);
        s.anchor.set(0.5);
        s.position.set(40 + rand() * (DESIGN_W - 80), 40 + rand() * (DESIGN_H - 80));
        s.alpha = 0.9;
        root.addChild(s);
    }
    for (let i = 0; i < 80; i++) {
        const s = new Sprite(circle);
        s.anchor.set(0.5);
        s.scale.set(0.32);
        s.position.set(rand() * DESIGN_W, rand() * DESIGN_H);
        s.alpha = 0.5;
        root.addChild(s);
    }
    for (let i = 0; i < 10; i++) {
        const s = new Sprite(circle);
        s.anchor.set(0.5);
        s.scale.set(0.7);
        s.position.set(80 + i * 120, 90 + (i % 3) * 40);
        s.alpha = 0.35;
        root.addChild(s);
    }
    return { root, textures };
}

/**
 * Render `root` into a fresh off-screen target `samples` times and summarise
 * the wall time of each frame.
 */
async function timeScene(
    renderer: Renderer,
    root: Container,
    width: number,
    height: number,
    samples: number,
    now: () => number,
    yieldTask: () => Promise<void>,
): Promise<Summary> {
    const target = RenderTexture.create({ width, height, resolution: 1, antialias: false });
    root.scale.set(width / DESIGN_W, height / DESIGN_H);
    try {
        // Warm-up: shader compilation, texture uploads and batching all
        // happen on the first renders.
        for (let i = 0; i < 3; i++) renderer.render({ container: root, target, clear: true });
        await finishGpu(renderer);
        const times: number[] = [];
        for (let i = 0; i < samples; i++) {
            const t = now();
            renderer.render({ container: root, target, clear: true });
            await finishGpu(renderer);
            times.push(now() - t);
            await yieldTask();
        }
        return summarize(times);
    } finally {
        target.destroy(true);
    }
}

/** Time a synthetic overdraw scene: 7 full-screen translucent quads. */
async function timeFill(
    renderer: Renderer,
    width: number,
    height: number,
    samples: number,
    now: () => number,
    yieldTask: () => Promise<void>,
): Promise<Summary> {
    const quad = quadTexture(renderer);
    const root = new Container();
    for (let i = 0; i < FILL_LAYERS; i++) {
        const s = new Sprite(quad);
        s.width = DESIGN_W;
        s.height = DESIGN_H;
        s.alpha = 0.22;
        root.addChild(s);
    }
    try {
        return await timeScene(renderer, root, width, height, samples, now, yieldTask);
    } finally {
        root.destroy({ children: true });
        quad.destroy(true);
    }
}

/** Time 4000 small sprites: how fast the batching side keeps up. */
async function timeQuads(
    renderer: Renderer,
    width: number,
    height: number,
    samples: number,
    now: () => number,
    yieldTask: () => Promise<void>,
): Promise<Summary> {
    const quad = quadTexture(renderer);
    const root = new Container();
    const rand = rng(0x5eed);
    const count = 4000;
    for (let i = 0; i < count; i++) {
        const s = new Sprite(quad);
        s.position.set(rand() * DESIGN_W, rand() * DESIGN_H);
        s.alpha = 0.8;
        root.addChild(s);
    }
    try {
        return await timeScene(renderer, root, width, height, samples, now, yieldTask);
    } finally {
        root.destroy({ children: true });
        quad.destroy(true);
    }
}

/**
 * Run the GPU measurements. Total time is a second or so: a handful of
 * frames per measurement, each flushed and followed by a task yield.
 */
export async function runGpuBench(renderer: Renderer, options: GpuBenchOptions): Promise<GpuBenchResult> {
    const now = options.now ?? (() => performance.now());
    const yieldTask = options.yieldTask ?? nextTask;
    const samples = Math.max(3, options.samples ?? 7);
    const progress = (id: string, fraction: number) => options.onProgress?.({ id, fraction });

    const scene = buildScene(renderer);
    const scenes: GpuSceneResult[] = [];
    try {
        for (let i = 0; i < SCENE_SCALES.length; i++) {
            const scale = SCENE_SCALES[i];
            const width = Math.max(160, Math.round(options.width * scale));
            const height = Math.max(90, Math.round(options.height * scale));
            progress(sceneId(scale), i / (SCENE_SCALES.length + 2));
            const timing = await timeScene(renderer, scene.root, width, height, samples, now, yieldTask);
            scenes.push({ scale, width, height, timing, stable: timing.count >= 3 && timing.spread <= Math.max(0.3, timing.median * 0.5) });
        }
    } finally {
        scene.root.destroy({ children: true });
        for (const t of scene.textures) t.destroy(true);
    }

    progress('fill', SCENE_SCALES.length / (SCENE_SCALES.length + 2));
    const fillTiming = await timeFill(renderer, options.width, options.height, samples, now, yieldTask);
    const fill: GpuFillResult = {
        width: options.width,
        height: options.height,
        timing: fillTiming,
        megapixelsPerSecond: fillTiming.median > 0
            ? (options.width * options.height * FILL_LAYERS) / fillTiming.median / 1000
            : 0,
        stable: fillTiming.count >= 3 && fillTiming.spread <= Math.max(0.3, fillTiming.median * 0.5),
    };

    progress('quads', (SCENE_SCALES.length + 1) / (SCENE_SCALES.length + 2));
    const quadTiming = await timeQuads(renderer, options.width, options.height, samples, now, yieldTask);
    const quads: GpuQuadResult = {
        quads: 4000,
        timing: quadTiming,
        kiloquadsPerSecond: quadTiming.median > 0 ? (4000 / quadTiming.median) * 1000 / 1000 : 0,
        stable: quadTiming.count >= 3 && quadTiming.spread <= Math.max(0.3, quadTiming.median * 0.5),
    };

    return { scenes, fill, quads, targetHz: 60 };
}
