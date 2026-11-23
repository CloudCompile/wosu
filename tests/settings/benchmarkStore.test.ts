import { describe, expect, it } from 'vitest';
import { benchmarkToStorage, formatAge, sanitizeStoredBenchmark, type StoredBenchmark } from '../../src/settings/benchmarkStore';
import { TIERS } from '../../src/settings/GraphicsPreset';
import type { BenchmarkReport } from '../../src/bench/suite';

const report: BenchmarkReport = {
    version: 1,
    at: 1_700_000_000_000,
    cpu: [
        { id: 'hit-math', name: 'Hit-object maths', detail: '', unit: 'objects', rate: 29_231_627.4, timing: { count: 80, min: 3.9, mean: 4, median: 4, p95: 4.2, max: 4.3, spread: 0.1 }, ops: 1e6, ms: 320, stable: true },
    ],
    cpuIndex: 1.82,
    gpu: {
        scenes: [{ scale: 1, width: 1920, height: 1080, timing: { count: 7, min: 2.9, mean: 3.1, median: 3.0, p95: 3.4, max: 3.5, spread: 0.1 }, stable: true }],
        fill: { width: 1920, height: 1080, timing: { count: 7, min: 0.9, mean: 1, median: 1, p95: 1.1, max: 1.2, spread: 0.05 }, megapixelsPerSecond: 12_345.6, stable: true },
        quads: { quads: 4000, timing: { count: 7, min: 1, mean: 1, median: 1, p95: 1.1, max: 1.2, spread: 0.05 }, kiloquadsPerSecond: 3456.7, stable: true },
        targetHz: 60,
    },
    gpuName: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 ...)',
    tiers: { cpu: 'high', gpu: 'high' },
    values: { ...TIERS.balanced },
    reasons: ['Frame budget: 16.7 ms at 60 Hz.'],
    refreshHz: 60,
    width: 1920,
    height: 1080,
};

describe('benchmark storage', () => {
    it('keeps the numbers and rounds the rates', () => {
        const s = benchmarkToStorage(report);
        expect(s.cpuRate).toEqual({ 'hit-math': 29_231_627 });
        expect(s.fill).toBe(12_346);
        expect(s.quads).toBe(3457);
        expect(s.sceneMs).toEqual([{ scale: 1, p95: 3.4 }]);
        expect(s.tiers).toEqual({ cpu: 'high', gpu: 'high' });
        expect(s.values).toEqual(TIERS.balanced);
        expect(s.at).toBe(report.at);
    });

    it('survives a round trip through JSON', () => {
        const s = benchmarkToStorage(report);
        expect(sanitizeStoredBenchmark(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });

    it('rejects other versions, junk and half-written records', () => {
        const good = benchmarkToStorage(report);
        expect(sanitizeStoredBenchmark(null)).toBeNull();
        expect(sanitizeStoredBenchmark('nope')).toBeNull();
        expect(sanitizeStoredBenchmark({ ...good, version: 2 })).toBeNull();
        expect(sanitizeStoredBenchmark({ ...good, cpuIndex: 0 })).toBeNull();
        expect(sanitizeStoredBenchmark({ ...good, tiers: { cpu: 'ultra', gpu: 'high' } })).toBeNull();
        expect(sanitizeStoredBenchmark({ ...good, values: null })).toBeNull();
        // Bad optional pieces are dropped, not fatal.
        const mended = sanitizeStoredBenchmark({ ...good, sceneMs: [{ scale: 1, p95: 'x' }, { scale: 0.8, p95: 5 }], cpuRate: { a: 1, b: 'x' } });
        expect(mended?.sceneMs).toEqual([{ scale: 0.8, p95: 5 }]);
        expect(mended?.cpuRate).toEqual({ a: 1 });
    });

    it('accepts a record whose GPU half never ran', () => {
        const s = { ...benchmarkToStorage(report), fill: null, quads: null, sceneMs: [], gpuName: null };
        expect(sanitizeStoredBenchmark(s)).toEqual(s);
    });
});

describe('benchmark age', () => {
    const now = 1_700_000_000_000;
    it('reads like a person wrote it', () => {
        expect(formatAge(now - 5_000, now)).toBe('just now');
        expect(formatAge(now - 60_000, now)).toBe('1 minute ago');
        expect(formatAge(now - 12 * 60_000, now)).toBe('12 minutes ago');
        expect(formatAge(now - 3 * 3_600_000, now)).toBe('3 hours ago');
        expect(formatAge(now - 26 * 3_600_000, now)).toBe('yesterday');
        expect(formatAge(now - 5 * 86_400_000, now)).toBe('5 days ago');
        expect(typeof formatAge(now - 400 * 86_400_000, now)).toBe('string');
    });

    it('never says a future run is old', () => {
        expect(formatAge(now + 60_000, now)).toBe('just now');
    });
});
