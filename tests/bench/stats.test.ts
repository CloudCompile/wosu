import { describe, expect, it } from 'vitest';
import {
    formatMs, formatRate, hitchLimit, isStable, mean, percentile, round, sortAscending, spread, summarize, withoutHitches,
} from '../../src/bench/stats';

describe('percentiles and summaries', () => {
    it('interpolates like numpy', () => {
        const sorted = sortAscending([4, 1, 3, 2]);
        expect(sorted).toEqual([1, 2, 3, 4]);
        expect(percentile(sorted, 0)).toBe(1);
        expect(percentile(sorted, 0.5)).toBe(2.5);
        expect(percentile(sorted, 1)).toBe(4);
        expect(percentile([], 0.5)).toBe(0);
        expect(percentile([7], 0.9)).toBe(7);
    });

    it('summarises without touching the input', () => {
        const values = [10, 12, 11, 40, 9];
        const s = summarize(values);
        expect(values).toEqual([10, 12, 11, 40, 9]);
        expect(s.count).toBe(5);
        expect(s.min).toBe(9);
        expect(s.max).toBe(40);
        expect(s.median).toBe(11);
        expect(s.mean).toBeCloseTo(16.4, 6);
        expect(s.p95).toBeGreaterThan(30);
        expect(summarize([]).count).toBe(0);
    });

    it('measures spread robustly', () => {
        // One outlier barely moves the median absolute deviation.
        expect(spread(sortAscending([10, 10, 10, 10, 500]))).toBe(0);
        expect(mean([1, 2, 3])).toBe(2);
        expect(mean([])).toBe(0);
    });
});

describe('dropping hitches', () => {
    it('has no limit for a short or genuinely slow run', () => {
        expect(hitchLimit([10, 20, 30])).toBe(Infinity);
        // Already slow: every sample is real.
        expect(hitchLimit([120, 130, 140, 150])).toBe(Infinity);
    });

    it('allows eight times the median, but never less than 250 ms', () => {
        expect(hitchLimit([10, 11, 12, 13])).toBe(250);
        expect(hitchLimit([50, 50, 50, 50])).toBe(400);
    });

    it('drops a lone spike and keeps a slow device intact', () => {
        expect(withoutHitches([10, 11, 12, 900])).toEqual([10, 11, 12]);
        expect(withoutHitches([200, 210, 220, 230])).toEqual([200, 210, 220, 230]);
        // Dropping would leave too few samples: keep them all and let the
        // stability check mark the run unreliable instead.
        expect(withoutHitches([10, 900, 900, 900])).toEqual([10, 900, 900, 900]);
        expect(withoutHitches([1, 2])).toEqual([1, 2]);
    });
});

describe('stability', () => {
    it('accepts a tight run and rejects an erratic one', () => {
        const tight = summarize([16, 16.1, 15.9, 16.2, 16]);
        expect(isStable(tight)).toBe(true);
        const erratic = summarize([16, 90, 20, 400, 17]);
        expect(isStable(erratic)).toBe(false);
        expect(isStable(summarize([16, 17]))).toBe(false);
    });
});

describe('formatting', () => {
    it('picks a readable unit', () => {
        expect(formatMs(0.4)).toBe('400 µs');
        expect(formatMs(4)).toBe('4 ms');
        expect(formatMs(16.7)).toBe('16.7 ms');
        expect(formatMs(320)).toBe('320 ms');
        expect(formatMs(Number.NaN)).toBe('—');
        expect(formatRate(1_500_000, 'objects/s')).toBe('1.5M objects/s');
        expect(formatRate(340_000, 'notes/s')).toBe('340k notes/s');
        expect(formatRate(18, 'quads/s')).toBe('18 quads/s');
        expect(formatRate(0, 'quads/s')).toBe('— quads/s');
        expect(round(1.2345, 2)).toBe(1.23);
        expect(round(1.2355, 3)).toBe(1.236);
    });
});
