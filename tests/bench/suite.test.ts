import { describe, expect, it } from 'vitest';
import { BenchmarkCancelled, chooseScale, recommendValues, runBenchmark } from '../../src/bench/suite';
import type { GpuBenchResult, GpuSceneResult } from '../../src/bench/gpu';
import { TIERS } from '../../src/settings/GraphicsPreset';

function scene(scale: number, p95: number): GpuSceneResult {
    return {
        scale,
        width: Math.round(1280 * scale),
        height: Math.round(720 * scale),
        timing: { count: 7, min: p95 * 0.8, mean: p95 * 0.9, median: p95 * 0.9, p95, max: p95 * 1.1, spread: 0.2 },
        stable: true,
    };
}

function gpu(scenes: GpuSceneResult[], fill = 1200, quads = 400): GpuBenchResult {
    return {
        scenes,
        fill: {
            width: 1280,
            height: 720,
            timing: { count: 7, min: 1, mean: 1, median: 1, p95: 1.1, max: 1.2, spread: 0.1 },
            megapixelsPerSecond: fill,
            stable: true,
        },
        quads: {
            quads: 4000,
            timing: { count: 7, min: 1, mean: 1, median: 1, p95: 1.1, max: 1.2, spread: 0.1 },
            kiloquadsPerSecond: quads,
            stable: true,
        },
        targetHz: 60,
    };
}

describe('choosing a render scale', () => {
    const budget = 1000 / 60;

    it('keeps full resolution when it fits', () => {
        const pick = chooseScale([scene(1, 5), scene(0.9, 4), scene(0.8, 3)], budget);
        expect(pick).toEqual({ scale: 1, timing: 5, fits: true });
    });

    it('steps down to the largest scale that fits', () => {
        // 100% is over budget, 90% is not.
        const pick = chooseScale([scene(1, 18), scene(0.9, 11), scene(0.8, 9)], budget);
        expect(pick.scale).toBe(0.9);
        expect(pick.fits).toBe(true);
    });

    it('uses the smallest scale and reports failure when nothing fits', () => {
        const pick = chooseScale([scene(1, 40), scene(0.9, 30), scene(0.8, 25), scene(0.7, 21)], budget);
        expect(pick).toMatchObject({ scale: 0.7, fits: false });
    });

    it('leaves headroom for the rest of the frame', () => {
        // 12.3 ms of a 16.7 ms frame is 74%: allowed. 12.6 ms (76%) is not.
        expect(chooseScale([scene(1, 12.3)], budget).fits).toBe(true);
        expect(chooseScale([scene(1, 12.6), scene(0.9, 10)], budget).scale).toBe(0.9);
    });

    it('assumes full resolution when there are no scenes', () => {
        expect(chooseScale([], budget)).toEqual({ scale: 1, timing: 0, fits: false });
    });
});

describe('stopping early', () => {
    const hints = { cores: 4, deviceMemory: 8, mobile: false };

    it('throws as soon as the caller asks to stop', async () => {
        await expect(runBenchmark({
            renderer: null, hints, gpuName: null, width: 1280, height: 720, refreshHz: 60,
            shouldStop: () => true,
        })).rejects.toBeInstanceOf(BenchmarkCancelled);
    });

    it('stops between CPU workloads', async () => {
        let asked = 0;
        await expect(runBenchmark({
            renderer: null, hints, gpuName: null, width: 1280, height: 720, refreshHz: 60,
            cpuDurationMs: 30,
            // The first check runs before any work, the next after one workload.
            shouldStop: () => ++asked > 1,
        })).rejects.toBeInstanceOf(BenchmarkCancelled);
    });
});

describe('cancelling', () => {
    const base = {
        renderer: null, hints: { cores: 4, deviceMemory: 8, mobile: false },
        gpuName: null, width: 1280, height: 720, refreshHz: 60,
        cpuDurationMs: 10, yieldTask: async () => {},
    };

    it('stops a run the panel was closed on', async () => {
        const report = runBenchmark({ ...base, shouldStop: () => true });
        await expect(report).rejects.toBeInstanceOf(BenchmarkCancelled);
    });

    it('finishes normally when nothing asks it to stop', async () => {
        const report = await runBenchmark(base);
        expect(report.cpu.length).toBeGreaterThan(0);
        expect(report.gpu).toBeNull();
    });
});

describe('recommending values', () => {
    it('keeps the balanced look on a fast device', () => {
        const { values, reasons } = recommendValues({
            tiers: { cpu: 'high', gpu: 'high' },
            gpu: gpu([scene(1, 3), scene(0.9, 2.6), scene(0.8, 2.2), scene(0.7, 2)]),
            refreshHz: 60,
        });
        expect(values).toEqual(TIERS.balanced);
        expect(reasons[0]).toContain('16.7 ms');
    });

    it('lowers the scale and drops anti-aliasing below 80%', () => {
        const { values, reasons } = recommendValues({
            tiers: { cpu: 'high', gpu: 'integrated' },
            gpu: gpu([scene(1, 26), scene(0.9, 20), scene(0.8, 16.5), scene(0.7, 12)]),
            refreshHz: 60,
        });
        expect(values.resolutionScale).toBe(0.7);
        expect(values.antialias).toBe(false);
        expect(reasons.join(' ')).toContain('70%');
    });

    it('turns the heavy extras off when nothing fits', () => {
        const { values, reasons } = recommendValues({
            tiers: { cpu: 'mid', gpu: 'low' },
            gpu: gpu([scene(1, 60), scene(0.9, 50), scene(0.8, 45), scene(0.7, 40)]),
            refreshHz: 60,
        });
        expect(values).toMatchObject({ storyboard: false, hitLighting: false, comboBursts: false, antialias: false });
        expect(reasons.join(' ')).toContain('heaviest extras');
    });

    it('scales the budget to a 144 Hz display', () => {
        const { values } = recommendValues({
            tiers: { cpu: 'high', gpu: 'high' },
            gpu: gpu([scene(1, 5), scene(0.9, 4.5), scene(0.8, 4)]),
            refreshHz: 144,
        });
        // 6.9 ms budget: 5 ms fits with the 75% headroom (5.2).
        expect(values.resolutionScale).toBe(1);
        const { values: slow } = recommendValues({
            tiers: { cpu: 'high', gpu: 'high' },
            gpu: gpu([scene(1, 6), scene(0.9, 5)]),
            refreshHz: 144,
        });
        expect(slow.resolutionScale).toBe(0.9);
    });

    it('plans for 60 Hz even when the display reports less', () => {
        // A busy machine reports the frames it manages (30 Hz here), which
        // would double the budget: 15 ms of a 33 ms frame must not pass.
        const { values, reasons } = recommendValues({
            tiers: { cpu: 'mid', gpu: 'integrated' },
            gpu: gpu([scene(1, 15), scene(0.9, 12), scene(0.8, 10)]),
            refreshHz: 30,
        });
        expect(reasons[0]).toContain('16.7 ms');
        expect(values.resolutionScale).toBe(0.9);
    });

    it('keeps per-frame extras off for a slow CPU', () => {
        const { values, reasons } = recommendValues({
            tiers: { cpu: 'low', gpu: 'high' },
            gpu: gpu([scene(1, 3), scene(0.9, 2.6), scene(0.8, 2.2), scene(0.7, 2)]),
            refreshHz: 60,
        });
        expect(values.parallax).toBe(false);
        expect(values.comboBursts).toBe(false);
        expect(reasons.join(' ')).toContain('CPU measured as slow');
    });

    it('falls back to the tiers without GPU numbers', () => {
        const { values, reasons } = recommendValues({ tiers: { cpu: 'mid', gpu: 'integrated' }, gpu: null, refreshHz: 60 });
        expect(values.resolutionScale).toBe(1);
        expect(reasons.join(' ')).toContain('could not run');
    });
});
