/**
 * CPU side of the graphics personalization benchmark: a few short, pure
 * workloads shaped like the work the game does per frame (hit-object maths,
 * per-frame particle integration, judgement text, the allocation churn of
 * importing and sorting). Each runs for a fixed wall time, in ~4 ms chunks
 * with a real task yield between them, so the settings panel keeps drawing
 * and the tab is never blocked long enough for the browser to warn about it.
 */
import { nextTask } from '../core/nextTask';
import { hitchLimit, summarize, withoutHitches, type Summary } from './stats';

export interface CpuWorkload {
    readonly id: string;
    readonly name: string;
    /** What the workload stands in for, shown in the live log. */
    readonly detail: string;
    /** The unit one operation is counted in ("ops", "notes", "frames"). */
    readonly unit: string;
    /** Run `iters` operations and return a checksum (keeps the work observable). */
    run(iters: number): number;
}

/** A 512-particle field, reused across chunks like a gameplay frame would. */
const field = {
    x: new Float32Array(512),
    y: new Float32Array(512),
    vx: new Float32Array(512),
    vy: new Float32Array(512),
    life: new Float32Array(512),
};
for (let i = 0; i < field.x.length; i++) {
    field.x[i] = (i * 37) % 512;
    field.y[i] = (i * 91) % 384;
    field.vx[i] = ((i % 7) - 3) * 0.8;
    field.vy[i] = ((i % 5) - 2) * 0.9;
    field.life[i] = 1 - i / 512;
}
/** The field's starting values, copied back before each call so results repeat. */
const fieldStart = {
    x: field.x.slice(),
    y: field.y.slice(),
    vx: field.vx.slice(),
    vy: field.vy.slice(),
    life: field.life.slice(),
};

export const CPU_WORKLOADS: readonly CpuWorkload[] = [
    {
        id: 'hit-math',
        name: 'Hit-object maths',
        detail: 'approach circles: trig, roots, angles',
        unit: 'objects',
        run(iters: number): number {
            let acc = 0;
            for (let i = 0; i < iters; i++) {
                const a = i * 0.0021;
                const cs = Math.cos(a);
                const sn = Math.sin(a * 1.7);
                const x = cs * 100 + sn * 40;
                const y = sn * 100 - Math.cos(a * 0.6) * 40;
                const d = Math.sqrt(x * x + y * y + 1e-6);
                acc += d * 1e-3 + Math.atan2(y, x) * 1e-3;
            }
            return acc;
        },
    },
    {
        id: 'particles',
        name: 'Particle integration',
        detail: 'per-frame position, damping and lifetime of 512 particles',
        unit: 'particle-frames',
        run(frames: number): number {
            const { x, y, vx, vy, life } = field;
            x.set(fieldStart.x);
            y.set(fieldStart.y);
            vx.set(fieldStart.vx);
            vy.set(fieldStart.vy);
            life.set(fieldStart.life);
            const n = x.length;
            let acc = 0;
            for (let f = 0; f < frames; f++) {
                for (let i = 0; i < n; i++) {
                    vx[i] *= 0.98;
                    vy[i] = vy[i] * 0.98 + 0.05;
                    x[i] += vx[i];
                    y[i] += vy[i];
                    life[i] -= 0.01;
                    if (life[i] <= 0) {
                        x[i] = 0;
                        y[i] = 0;
                        life[i] = 1;
                    }
                    acc += x[i] + y[i];
                }
            }
            return acc;
        },
    },
    {
        id: 'sort',
        name: 'Object sort and filter',
        detail: 'allocating, sorting and scanning a hit-object list',
        unit: 'objects',
        run(iters: number): number {
            const list: { t: number; x: number; y: number; kind: number }[] = new Array(iters);
            for (let i = 0; i < iters; i++) {
                list[i] = { t: (i * 7919) % 100000, x: i % 512, y: i % 384, kind: i & 3 };
            }
            list.sort((a, b) => a.t - b.t);
            let acc = 0;
            for (let i = 0; i < list.length; i++) {
                const o = list[i];
                if (o.kind === 2) acc += o.t + o.x;
            }
            return acc;
        },
    },
    {
        id: 'text',
        name: 'Judgement text',
        detail: 'building the label strings the HUD shows',
        unit: 'labels',
        run(iters: number): number {
            const words = ['300', '100', '50', 'miss'];
            let acc = 0;
            for (let i = 0; i < iters; i++) {
                acc += `${words[i & 3]} x${i % 1000} +${i % 37} (${i % 100}%)`.length;
            }
            return acc;
        },
    },
];

export interface CpuTestResult {
    readonly id: string;
    readonly name: string;
    readonly detail: string;
    readonly unit: string;
    /** Throughput of the last measured chunk set, in `unit` per second. */
    readonly rate: number;
    /** Per-chunk times, summarised (ms). */
    readonly timing: Summary;
    /** Total work counted, and time spent (ms), so the rate can be re-derived. */
    readonly ops: number;
    readonly ms: number;
    /** False when the samples were too erratic to recommend settings from. */
    readonly stable: boolean;
}

export interface CpuBenchOptions {
    /** Wall time per workload (ms). Longer is steadier; default 320. */
    durationMs?: number;
    /** Aimed chunk length (ms); the panel still gets a turn between chunks. */
    chunkMs?: number;
    /** Clock, for tests. */
    now?: () => number;
    /** Yield between chunks, for tests. */
    yieldTask?: () => Promise<void>;
    /** Called as each chunk completes (progress for the live log). */
    onProgress?: (update: CpuProgress) => void;
    /** Return true to stop early (the panel was closed). */
    shouldStop?: () => boolean;
}

/** A live sample of one workload, for the panel's running numbers. */
export interface CpuProgress {
    /** Workload id (CPU_WORKLOADS[].id). */
    id: string;
    /** Overall progress 0..1 across all workloads. */
    fraction: number;
    /** Median chunk time so far (ms). */
    median: number;
    /** Chunks measured so far. */
    chunks: number;
}

/** The parts of CpuBenchOptions the per-workload runner needs, with defaults applied. */
type BenchClock = Required<Pick<CpuBenchOptions, 'durationMs' | 'chunkMs' | 'now' | 'yieldTask'>>;

/**
 * Time one workload. The first call warms the code up (V8 first runs the
 * unoptimised bytecode), then the loop grows the chunk until it takes about
 * `chunkMs`, and measures from there until `durationMs` is spent.
 */
async function runWorkload(w: CpuWorkload, o: BenchClock & Pick<CpuBenchOptions, 'onProgress' | 'shouldStop'>, fractionBase: number, fractionSpan: number): Promise<CpuTestResult> {
    const { now, yieldTask } = o;
    // Warm-up: the same work in a chunk sized from a guess, so the timed run
    // starts with optimised code and a filled instruction cache.
    let chunkIters = 4000;
    const warmStart = now();
    w.run(chunkIters);
    const warmMs = now() - warmStart;
    // Even a fast workload gives a usable estimate; the clock's resolution
    // can round a very fast one to zero, in which case the loop below grows
    // the chunk instead.
    if (warmMs > 0.01) {
        chunkIters = Math.max(200, Math.min(4_000_000, Math.round((chunkIters * o.chunkMs) / warmMs)));
    }
    await yieldTask();

    const chunks: { iters: number; ms: number }[] = [];
    const samples: number[] = [];
    let stalled = false;
    while (samples.reduce((a, b) => a + b, 0) < o.durationMs) {
        const t = now();
        w.run(chunkIters);
        const dt = now() - t;
        // A chunk that suddenly takes many times its aim means the device is
        // thrashing (background tab, thermal throttle): stop rather than
        // burn the whole budget on a stalled chunk. The chunk is not counted
        // as throughput, because a stall is not how fast the CPU can compute.
        if (dt > o.chunkMs * 25 + 25) {
            stalled = true;
            break;
        }
        chunks.push({ iters: chunkIters, ms: dt });
        samples.push(dt);
        const totalMs = samples.reduce((a, b) => a + b, 0);
        // Grow the chunk toward the aim (the first chunks are the warm-up's
        // estimate meeting the real cost of an optimised run).
        const perIter = dt / chunkIters;
        if (perIter > 0) {
            const aim = Math.round(o.chunkMs / perIter);
            chunkIters = Math.max(200, Math.min(aim, chunkIters * 4, 4_000_000));
        }
        if (o.shouldStop?.()) break;
        o.onProgress?.({
            id: w.id,
            fraction: fractionBase + fractionSpan * Math.min(1, totalMs / o.durationMs),
            median: summarize(samples).median,
            chunks: samples.length,
        });
        await yieldTask();
    }
    const timing = summarize(withoutHitches(samples));
    // Throughput from the chunks that were not hitches: one GC pause in the
    // middle of a 320 ms run would otherwise drag the whole rate down.
    const limit = hitchLimit(samples);
    const counted = chunks.filter(c => c.ms <= limit);
    const ops = counted.reduce((a, c) => a + c.iters, 0);
    const totalMs = counted.reduce((a, c) => a + c.ms, 0);
    return {
        id: w.id,
        name: w.name,
        detail: w.detail,
        unit: w.unit,
        rate: totalMs > 0 ? ops / (totalMs / 1000) : 0,
        timing,
        ops,
        ms: totalMs,
        stable: !stalled && timing.count >= 3 && timing.spread <= Math.max(0.35, timing.median * 0.6),
    };
}

/** Run every CPU workload. ~`durationMs` × workloads, plus the yields. */
export async function runCpuBench(options: CpuBenchOptions = {}): Promise<CpuTestResult[]> {
    const o = {
        durationMs: options.durationMs ?? 320,
        chunkMs: options.chunkMs ?? 4,
        now: options.now ?? (() => performance.now()),
        yieldTask: options.yieldTask ?? nextTask,
        onProgress: options.onProgress,
        shouldStop: options.shouldStop,
    };
    const out: CpuTestResult[] = [];
    for (let i = 0; i < CPU_WORKLOADS.length; i++) {
        if (options.shouldStop?.()) break;
        const w = CPU_WORKLOADS[i];
        out.push(await runWorkload(w, o, i / CPU_WORKLOADS.length, 1 / CPU_WORKLOADS.length));
    }
    return out;
}

/**
 * Throughputs of the reference machine per workload id: a typical mid-range
 * laptop of the kind the Balanced preset is aimed at. A device scoring 1.0
 * is that machine; the tiers in settings/deviceTiers read the scale from
 * here (`low` below 0.55, `high` from 1.15).
 *
 * The numbers are ~55% of this project's development desktop (a recent
 * 8-core x86, which therefore scores about 1.8), measured with
 * `BENCH_PRINT=1 npx vitest run tests/bench/cpu.test.ts`. Recalibrate the
 * same way if the workloads change, and keep the ratios between the four.
 */
export const CPU_REFERENCE: Readonly<Record<string, number>> = {
    'hit-math': 16_000_000,
    'particles': 400_000,
    'sort': 4_200_000,
    'text': 91_000_000,
};

/** Composite CPU index: 1.0 = the reference machine (geometric mean over workloads). */
export function cpuIndex(results: readonly CpuTestResult[], reference: Readonly<Record<string, number>> = CPU_REFERENCE): number {
    let sum = 0;
    let n = 0;
    for (const r of results) {
        const ref = reference[r.id];
        if (!ref || !(r.rate > 0)) continue;
        sum += Math.log(r.rate / ref);
        n++;
    }
    return n > 0 ? Math.exp(sum / n) : 0;
}
