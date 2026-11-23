/**
 * One benchmark run: the CPU workloads, the GPU playfield timings, the
 * tiers that follow from them, and the concrete graphics values the run
 * recommends. Kept separate from the panel that displays it so the numbers
 * and the recommendations can be tested.
 */
import type { Renderer } from 'pixi.js';
import type { GraphicsValues } from '../settings/GraphicsPreset';
import { resolveTiers, valuesForTiers, type DeviceHints, type DeviceTiers } from '../settings/deviceTiers';
import { CPU_REFERENCE, cpuIndex, runCpuBench, type CpuTestResult } from './cpu';
import { BenchmarkCancelled, runGpuBench, type GpuBenchResult } from './gpu';
import { formatMs, round } from './stats';

export const BENCHMARK_VERSION = 1;

export interface BenchmarkReport {
    version: number;
    /** When the run finished (ms since epoch). */
    at: number;
    cpu: CpuTestResult[];
    /** Composite CPU index, 1.0 = the reference mid-range laptop. */
    cpuIndex: number;
    /** Null when the renderer could not run the GPU tests. */
    gpu: GpuBenchResult | null;
    /** The renderer's name, when it could be read. */
    gpuName: string | null;
    tiers: DeviceTiers;
    /** The values the run recommends. */
    values: GraphicsValues;
    /** Why the values came out that way, one line each. */
    reasons: string[];
    /** The display's refresh rate the run assumed. */
    refreshHz: number;
    /** The visible canvas size (device pixels) the GPU tests used. */
    width: number;
    height: number;
}

export interface BenchmarkProgress {
    stage: 'cpu' | 'gpu' | 'done';
    /** The test being run right now, for the live log. */
    label: string;
    /** 0..1 overall. */
    fraction: number;
    /** The running median of the test under way (ms), when it has one. */
    value?: number;
}

export interface RunBenchmarkOptions {
    /** The app's renderer; null runs the CPU half only. */
    renderer: Renderer | null;
    /** Core count, memory and mobile-ness (settings/deviceTiers.deviceHints). */
    hints: DeviceHints;
    gpuName: string | null;
    /** Canvas size in device pixels (what render scale 1 means). */
    width: number;
    height: number;
    /** Display refresh rate (ms budget = 1000 / this). */
    refreshHz: number;
    /** Wall time per CPU workload (default 320 ms). */
    cpuDurationMs?: number;
    onProgress?: (p: BenchmarkProgress) => void;
    /** Return true to stop the run early (the panel was closed). */
    shouldStop?: () => boolean;
    /** Clock and yield, for tests. */
    now?: () => number;
    yieldTask?: () => Promise<void>;
}

/** Share of a frame the playfield scene is allowed to take (the rest is HUD, cursor, logic). */
const SCENE_HEADROOM = 0.75;

/**
 * Largest render scale whose worst-case (p95) scene frame fits the budget,
 * or the smallest tested scale when even that doesn't.
 */
export function chooseScale(scenes: GpuBenchResult['scenes'], budgetMs: number): { scale: number; timing: number; fits: boolean } {
    if (scenes.length === 0) return { scale: 1, timing: 0, fits: false };
    for (const s of scenes) {
        if (s.timing.p95 <= budgetMs * SCENE_HEADROOM) return { scale: s.scale, timing: s.timing.p95, fits: true };
    }
    const smallest = scenes[scenes.length - 1];
    return { scale: smallest.scale, timing: smallest.timing.p95, fits: false };
}

/**
 * The values a run recommends: the tiers' look, with the render scale moved
 * to what the device actually managed, and the last few effects dropped when
 * even the smallest scale was too slow.
 */
export function recommendValues(report: {
    tiers: DeviceTiers;
    gpu: GpuBenchResult | null;
    refreshHz: number;
}): { values: GraphicsValues; reasons: string[] } {
    const values = valuesForTiers(report.tiers);
    const reasons: string[] = [];
    // A browser reports its display's rate, but a machine already struggling
    // reports the frames it manages instead (30 Hz on a busy VM), which would
    // hand out a budget twice the real one. Nothing below 60 Hz is worth
    // planning for, so that is the floor.
    const hz = Math.max(60, Math.min(360, report.refreshHz || 60));
    const budget = 1000 / hz;
    reasons.push(`Frame budget: ${formatMs(budget)} at ${Math.round(hz)} Hz.`);

    if (!report.gpu || report.gpu.scenes.length === 0) {
        reasons.push('The GPU tests could not run, so the render scale comes from the device tiers.');
        return { values, reasons };
    }

    const scenes = report.gpu.scenes;
    const atOne = scenes.find(s => s.scale === 1);
    const pick = chooseScale(scenes, budget);
    values.resolutionScale = pick.scale;
    if (pick.fits) {
        reasons.push(atOne
            ? `A busy playfield at full resolution took ${formatMs(atOne.timing.p95)} of the ${formatMs(budget)} frame.`
            : `A busy playfield took ${formatMs(pick.timing)} at ${Math.round(pick.scale * 100)}%.`);
        if (pick.scale < 1) {
            reasons.push(`Rendering at ${Math.round(pick.scale * 100)}% keeps the playfield at ${formatMs(pick.timing)}, `
                + 'which leaves room for the HUD and the rest of the frame.');
            // Below ~80% the picture softens noticeably: anti-aliasing stops
            // being worth its cost.
            if (pick.scale < 0.8) values.antialias = false;
        }
    } else {
        reasons.push(`Even ${Math.round(pick.scale * 100)}% took ${formatMs(pick.timing)} of the ${formatMs(budget)} frame, `
            + 'so the heaviest extras are off as well.');
        values.antialias = false;
        values.storyboard = false;
        values.hitLighting = false;
        values.comboBursts = false;
        values.backgroundVideo = false;
    }

    // A very slow CPU would spend its frame in JavaScript no matter what the
    // GPU does, so the per-frame effect budget stays as the tiers left it.
    if (report.tiers.cpu === 'low') {
        reasons.push('The CPU measured as slow, so per-frame extras (parallax, bursts, the cursor trail) stay off.');
    }
    const fill = report.gpu.fill;
    const quads = report.gpu.quads;
    if (fill && fill.megapixelsPerSecond > 0) {
        reasons.push(`Fill rate ${round(fill.megapixelsPerSecond, 0)} Mpix/s, batching ${round(quads.kiloquadsPerSecond, 0)}k quads/s.`);
    }
    return { values, reasons };
}

/** Re-exported so the panel can tell a cancelled run from a failed one. */
export { BenchmarkCancelled };

/** Run the whole benchmark. About 2–3 seconds. */
export async function runBenchmark(o: RunBenchmarkOptions): Promise<BenchmarkReport> {
    const emit = o.onProgress ?? (() => {});
    emit({ stage: 'cpu', label: 'Starting the CPU tests', fraction: 0 });

    const cpu = await runCpuBench({
        durationMs: o.cpuDurationMs ?? 320,
        onProgress: u => emit({ stage: 'cpu', label: u.id, fraction: u.fraction * 0.55, value: u.median }),
        now: o.now,
        yieldTask: o.yieldTask,
        shouldStop: o.shouldStop,
    });
    if (o.shouldStop?.()) throw new BenchmarkCancelled();
    const index = cpuIndex(cpu);

    let gpu: GpuBenchResult | null = null;
    if (o.renderer) {
        emit({ stage: 'gpu', label: 'Starting the GPU tests', fraction: 0.55 });
        try {
            gpu = await runGpuBench(o.renderer, {
                width: o.width,
                height: o.height,
                onProgress: u => emit({ stage: 'gpu', label: u.id, fraction: 0.55 + u.fraction * 0.45, value: u.value }),
                now: o.now,
                yieldTask: o.yieldTask,
                shouldStop: o.shouldStop,
            });
        } catch (e) {
            if (e instanceof BenchmarkCancelled) throw e;
            // A driver that refuses an off-screen target shouldn't fail the run:
            // the CPU half and the hints still give usable values.
            console.warn('benchmark: GPU tests failed', e);
            gpu = null;
        }
    }

    const tiers = resolveTiers({
        hints: o.hints,
        gpuName: o.gpuName,
        cpuIndex: index,
        gpuScores: gpu ? { fill: gpu.fill.megapixelsPerSecond, quads: gpu.quads.kiloquadsPerSecond } : null,
    });
    const { values, reasons } = recommendValues({ tiers, gpu, refreshHz: o.refreshHz });
    const report: BenchmarkReport = {
        version: BENCHMARK_VERSION,
        at: Date.now(),
        cpu,
        cpuIndex: index,
        gpu,
        gpuName: o.gpuName,
        tiers,
        values,
        reasons,
        refreshHz: o.refreshHz,
        width: o.width,
        height: o.height,
    };
    emit({ stage: 'done', label: 'Done', fraction: 1 });
    return report;
}

/** The reference rates, exported so the panel can show the index's scale. */
export { CPU_REFERENCE };
