import { describe, expect, it } from 'vitest';
import { CPU_REFERENCE, CPU_WORKLOADS, cpuIndex, runCpuBench } from '../../src/bench/cpu';

describe('cpu benchmark', () => {
    it('has a workload for every reference rate', () => {
        expect(Object.keys(CPU_REFERENCE).sort()).toEqual(CPU_WORKLOADS.map(w => w.id).sort());
        for (const v of Object.values(CPU_REFERENCE)) expect(v).toBeGreaterThan(0);
    });

    it('keeps the reference at measured throughputs, not placeholders', () => {
        // The index is only meaningful if these are rates from a real
        // machine (see CPU_REFERENCE): a placeholder 1 made every device
        // score in the millions.
        expect(CPU_REFERENCE['hit-math']).toBeGreaterThan(5_000_000);
        expect(CPU_REFERENCE.particles).toBeGreaterThan(100_000);
        expect(CPU_REFERENCE.sort).toBeGreaterThan(1_000_000);
        expect(CPU_REFERENCE.text).toBeGreaterThan(10_000_000);
        expect(cpuIndex(CPU_WORKLOADS.map(w => ({
            id: w.id, name: w.id, detail: '', unit: w.unit, rate: CPU_REFERENCE[w.id],
            timing: { count: 3, min: 1, mean: 1, median: 1, p95: 1, max: 1, spread: 0 }, ops: 1, ms: 1, stable: true,
        })))).toBeCloseTo(1, 10);
    });

    it('workloads are deterministic for a given size', () => {
        for (const w of CPU_WORKLOADS) {
            const a = w.run(500);
            const b = w.run(500);
            expect(a).toBe(b);
            expect(Number.isFinite(a)).toBe(true);
        }
    });

    it('scales its chunk size to fill the time budget', async () => {
        const results = await runCpuBench({ durationMs: 40, chunkMs: 2 });
        expect(results).toHaveLength(CPU_WORKLOADS.length);
        for (const r of results) {
            expect(r.rate).toBeGreaterThan(0);
            expect(r.ms).toBeGreaterThan(0);
            expect(r.timing.count).toBeGreaterThan(1);
        }
        // Re-running with a longer budget does more work but reports a
        // comparable rate (the chunk grows instead of the loop spinning).
        const longer = await runCpuBench({ durationMs: 120, chunkMs: 2 });
        for (let i = 0; i < results.length; i++) {
            const ratio = longer[i].rate / results[i].rate;
            expect(ratio).toBeGreaterThan(0.15);
            expect(ratio).toBeLessThan(6);
        }
    });

    it('reports progress and yields between chunks', async () => {
        let yields = 0;
        const fractions: number[] = [];
        await runCpuBench({
            durationMs: 20,
            chunkMs: 2,
            yieldTask: async () => {
                yields++;
            },
            onProgress: u => fractions.push(u.fraction),
        });
        expect(yields).toBeGreaterThan(4);
        expect(fractions[fractions.length - 1]).toBeGreaterThan(0.9);
    });

    it('leaves straight away when it is asked to stop', async () => {
        const results = await runCpuBench({ durationMs: 1000, shouldStop: () => true });
        expect(results).toEqual([]);
        expect(cpuIndex(results)).toBe(0);
    });

    it('stops between workloads when asked to', async () => {
        let done = 0;
        const results = await runCpuBench({
            durationMs: 20,
            chunkMs: 2,
            yieldTask: async () => {},
            shouldStop: () => done++ >= 2,
        });
        // Two workloads ran, the rest were skipped.
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.length).toBeLessThan(CPU_WORKLOADS.length);
        expect(results[0].id).toBe(CPU_WORKLOADS[0].id);
    });

    it('uses an injectable clock', async () => {
        let t = 0;
        const results = await runCpuBench({
            durationMs: 10,
            chunkMs: 1,
            now: () => (t += 2),
            yieldTask: async () => {},
        });
        for (const r of results) expect(r.ms).toBeGreaterThanOrEqual(10);
    });

    it('cpuIndex is 1 for a device that matches the reference', () => {
        const ref = { 'hit-math': 10, particles: 20, sort: 30, text: 40 };
        const results = Object.entries(ref).map(([id, rate]) => ({
            id, name: id, detail: '', unit: 'x', rate, timing: { count: 3, min: 1, mean: 1, median: 1, p95: 1, max: 1, spread: 0 }, ops: 1, ms: 1, stable: true,
        }));
        expect(cpuIndex(results, ref)).toBeCloseTo(1, 10);
        const faster = results.map(r => ({ ...r, rate: r.rate * 4 }));
        expect(cpuIndex(faster, ref)).toBeCloseTo(4, 10);
        // A workload the reference doesn't know is ignored, not zero.
        expect(cpuIndex([...results, { ...results[0], id: 'unknown', rate: 1e9 }], ref)).toBeCloseTo(1, 10);
    });

    it('prints the measured rates when BENCH_PRINT is set', async () => {
        if (!process.env.BENCH_PRINT) return;
        const results = await runCpuBench({ durationMs: 500 });
        const rates = Object.fromEntries(results.map(r => [r.id, Math.round(r.rate)]));
        console.log('CPU rates', JSON.stringify(rates), 'index', cpuIndex(results).toExponential(2));
        for (const r of results) {
            console.log(` ${r.id.padEnd(10)} ${Math.round(r.rate).toString().padStart(12)} ${r.unit}/s  chunk ${r.timing.median.toFixed(2)} ms${r.stable ? '' : ' (unstable)'}`);
        }
    }, 20000);
});
