/**
 * The last benchmark run, kept in localStorage so the settings panel can
 * show it long after the run (and so the next launch knows what this device
 * measured, instead of guessing from the renderer's name alone).
 */
import type { GraphicsValues } from './GraphicsPreset';
import type { CpuTier, GpuTier } from './deviceTiers';
import type { BenchmarkReport } from '../bench/suite';
import { BENCHMARK_VERSION } from '../bench/suite';

const STORAGE_KEY = 'webosu.benchmark.v1';

/** What keeps across launches: numbers, not samples or timings. */
export interface StoredBenchmark {
    version: number;
    at: number;
    cpuIndex: number;
    cpuRate: Record<string, number>;
    gpuName: string | null;
    fill: number | null;
    quads: number | null;
    /** The playfield frame time at each tested scale (ms). */
    sceneMs: { scale: number; p95: number }[];
    tiers: { cpu: CpuTier; gpu: GpuTier };
    values: GraphicsValues;
    reasons: string[];
    refreshHz: number;
    width: number;
    height: number;
}

/** Condense a run into what is worth storing. */
export function benchmarkToStorage(r: BenchmarkReport): StoredBenchmark {
    return {
        version: BENCHMARK_VERSION,
        at: r.at,
        cpuIndex: r.cpuIndex,
        cpuRate: Object.fromEntries(r.cpu.map(t => [t.id, Math.round(t.rate)])),
        gpuName: r.gpuName,
        fill: r.gpu ? Math.round(r.gpu.fill.megapixelsPerSecond) : null,
        quads: r.gpu ? Math.round(r.gpu.quads.kiloquadsPerSecond) : null,
        sceneMs: r.gpu ? r.gpu.scenes.map(s => ({ scale: s.scale, p95: Math.round(s.timing.p95 * 100) / 100 })) : [],
        tiers: { cpu: r.tiers.cpu, gpu: r.tiers.gpu },
        values: { ...r.values },
        reasons: r.reasons.slice(),
        refreshHz: r.refreshHz,
        width: r.width,
        height: r.height,
    };
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Accept only a record that looks like ours (an older or edited one is ignored). */
export function sanitizeStoredBenchmark(raw: unknown): StoredBenchmark | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.version !== BENCHMARK_VERSION) return null;
    if (!isFiniteNumber(r.at) || !isFiniteNumber(r.cpuIndex) || r.cpuIndex <= 0) return null;
    const tiers = r.tiers as Record<string, unknown> | undefined;
    const values = r.values as Record<string, unknown> | undefined;
    if (!tiers || !values) return null;
    if (!['low', 'mid', 'high'].includes(String(tiers.cpu))) return null;
    if (!['low', 'integrated', 'discrete', 'high'].includes(String(tiers.gpu))) return null;
    if (!isFiniteNumber(values.resolutionScale)) return null;
    const sceneMs = Array.isArray(r.sceneMs)
        ? r.sceneMs.filter((s): s is { scale: number; p95: number } => !!s && isFiniteNumber((s as { scale?: unknown }).scale) && isFiniteNumber((s as { p95?: unknown }).p95))
        : [];
    const cpuRate: Record<string, number> = {};
    if (r.cpuRate && typeof r.cpuRate === 'object') {
        for (const [k, v] of Object.entries(r.cpuRate as Record<string, unknown>)) if (isFiniteNumber(v)) cpuRate[k] = v;
    }
    return {
        version: BENCHMARK_VERSION,
        at: r.at,
        cpuIndex: r.cpuIndex,
        cpuRate,
        gpuName: typeof r.gpuName === 'string' ? r.gpuName : null,
        fill: isFiniteNumber(r.fill) ? r.fill : null,
        quads: isFiniteNumber(r.quads) ? r.quads : null,
        sceneMs,
        tiers: { cpu: String(tiers.cpu) as CpuTier, gpu: String(tiers.gpu) as GpuTier },
        values: values as unknown as GraphicsValues,
        reasons: Array.isArray(r.reasons) ? r.reasons.filter((s): s is string => typeof s === 'string') : [],
        refreshHz: isFiniteNumber(r.refreshHz) ? r.refreshHz : 60,
        width: isFiniteNumber(r.width) ? r.width : 0,
        height: isFiniteNumber(r.height) ? r.height : 0,
    };
}

export function loadBenchmark(): StoredBenchmark | null {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        return raw ? sanitizeStoredBenchmark(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

export function saveBenchmark(b: StoredBenchmark): void {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(b));
    } catch {
        /* private mode: the panel still shows this session's run */
    }
}

export function clearBenchmark(): void {
    try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
        /* nothing to clear */
    }
}

/** "3 minutes ago", "yesterday", or a date, for the settings row. */
export function formatAge(at: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 30) return `${d} days ago`;
    return new Date(at).toLocaleDateString();
}
