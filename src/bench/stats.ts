/**
 * Small statistics helpers for the benchmark: percentiles, a summary of a
 * sample list, and the display formatting the benchmark panel and its
 * report use. Kept pure so the numbers can be unit tested.
 */

/** `values` sorted ascending, in place (mutates: the samples are ours). */
export function sortAscending(values: number[]): number[] {
    return values.sort((a, b) => a - b);
}

/** The p-quantile (0..1) of `sorted`, linearly interpolated like numpy's default. */
export function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

/** Median absolute deviation: a robust spread that one outlier can't inflate. */
export function spread(sorted: readonly number[]): number {
    if (sorted.length === 0) return 0;
    const med = percentile(sorted, 0.5);
    const dev = sorted.map(v => Math.abs(v - med));
    return percentile(sortAscending(dev), 0.5);
}

export interface Summary {
    /** How many samples the summary covers. */
    count: number;
    min: number;
    mean: number;
    median: number;
    p95: number;
    max: number;
    /** Median absolute deviation (robust spread). */
    spread: number;
}

/** Summarise a sample list without modifying it. */
export function summarize(values: readonly number[]): Summary {
    if (values.length === 0) return { count: 0, min: 0, mean: 0, median: 0, p95: 0, max: 0, spread: 0 };
    const sorted = sortAscending(values.slice());
    return {
        count: sorted.length,
        min: sorted[0],
        mean: mean(sorted),
        median: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1],
        spread: spread(sorted),
    };
}

/**
 * How much `summary` looks like a measurement worth trusting: false when the
 * samples are erratic (a stalled tab, a compositing hitch) — the benchmark
 * marks those tests as unreliable instead of recommending settings from them.
 */
export function isStable(s: Summary, tolerance = 0.5): boolean {
    if (s.count < 3) return false;
    // The robust spread covers the usual noise; the p95 catches a few spikes
    // that the median deviation ignores.
    return s.spread <= Math.max(0.15, s.median * tolerance) && s.p95 <= s.median * 2.5 + 1;
}

/** Round to `decimals` places (for report text). */
export function round(v: number, decimals = 1): number {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}

/** A duration in ms with a readable unit. */
export function formatMs(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    if (ms >= 100) return `${round(ms, 0)} ms`;
    if (ms >= 10) return `${round(ms, 1)} ms`;
    if (ms >= 1) return `${round(ms, 2)} ms`;
    return `${round(ms * 1000, 0)} µs`;
}

/** A throughput with a readable unit: 1.2M, 340k, 18.4. */
export function formatRate(v: number, unit: string): string {
    if (!Number.isFinite(v) || v <= 0) return `— ${unit}`;
    if (v >= 1e9) return `${round(v / 1e9, 2)}G ${unit}`;
    if (v >= 1e6) return `${round(v / 1e6, 2)}M ${unit}`;
    if (v >= 1e3) return `${round(v / 1e3, 1)}k ${unit}`;
    return `${round(v, 1)} ${unit}`;
}
