/**
 * How good this device's CPU and GPU actually are, and which graphics
 * values that implies.
 *
 * Two signals, in order of trust:
 *
 * 1. The benchmark (bench/suite): real throughput measured on this device.
 *    When it has run, its numbers override the guess.
 * 2. Hints: core count, memory, mobile-ness, and the renderer's name
 *    (`Intel(R) UHD Graphics 620`, `Apple M1 Pro`, ...). Cheap, always
 *    available, and good enough to pick sane defaults on the first visit.
 *
 * The result is deliberately two small tiers rather than exact numbers: the
 * cost of being one step wrong is a slightly softer or plainer picture, not
 * a broken game.
 */
import type { GraphicsValues, GraphicsTier } from './GraphicsPreset';
import { TIERS } from './GraphicsPreset';

/** The cheap hints auto-detection reads (a subset of `navigator`, plus the window). */
export interface DeviceHints {
    /** `navigator.deviceMemory` in GB (browsers cap it at 8), or 0 when unknown. */
    deviceMemory: number;
    /** `navigator.hardwareConcurrency` (logical cores), or 0 when unknown. */
    cores: number;
    /** A phone or tablet: a mobile user agent, or a coarse pointer with no hover. */
    mobile: boolean;
}

export type CpuTier = 'low' | 'mid' | 'high';
/**
 * `low` is the weakest thing that still runs a browser (integrated graphics
 * from a decade ago, phone GPUs, software rendering); `integrated` is a
 * current iGPU or an entry Apple chip; `discrete` a dedicated card (or a
 * fast iGPU); `high` a recent dedicated card.
 */
export type GpuTier = 'low' | 'integrated' | 'discrete' | 'high';

export interface DeviceTiers {
    readonly cpu: CpuTier;
    readonly gpu: GpuTier;
}

/** Read the hints from the browser. */
export function deviceHints(nav: Navigator = navigator, win: Window = window): DeviceHints {
    const n = nav as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const mobile = n.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(nav.userAgent)
        // A touch screen with no mouse: a tablet in disguise, or a phone's "desktop site".
        || (win.matchMedia?.('(pointer: coarse)').matches === true && win.matchMedia?.('(hover: hover)').matches === false);
    return {
        deviceMemory: typeof n.deviceMemory === 'number' ? n.deviceMemory : 0,
        cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 0,
        mobile,
    };
}

/** The GPU's marketing name, from a WebGL context or a WebGPU adapter. */
export function gpuNameOf(source: unknown): string | null {
    const s = source as {
        getParameter?: (p: number) => unknown;
        getExtension?: (e: string) => unknown;
        info?: { vendor?: string; architecture?: string; device?: string; description?: string };
    } | null;
    if (!s) return null;
    if (typeof s.getParameter === 'function' && typeof s.getExtension === 'function') {
        // WebGL: the debug extension's unmasked name, else the plain RENDERER.
        const dbg = s.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: number } | null;
        const raw = (dbg?.UNMASKED_RENDERER_WEBGL !== undefined ? s.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null)
            ?? s.getParameter(0x1f01 /* gl.RENDERER */);
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    const info = s.info;
    if (info) {
        const parts = [info.vendor, info.architecture, info.device, info.description].filter((p): p is string => !!p);
        if (parts.length) return parts.join(' ');
    }
    return null;
}

/**
 * A GPU tier from the renderer name. Names look like
 * `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)`,
 * `ANGLE (Intel, Intel(R) UHD Graphics 620 ..., OpenGL)`,
 * `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`,
 * `Adreno (TM) 740`, `Mali-G78`. Unknown names return null.
 */
export function gpuTierFromName(name: string | null): GpuTier | null {
    if (!name) return null;
    const n = name.toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(n)) return 'low';
    if (/adreno|mali|powervr|videocore|immortalis/.test(n)) return 'low';

    if (/apple/.test(n)) {
        // Apple M-series: Max/Ultra are high, Pro discrete-class, plain integrated.
        if (/m\d\s*(max|ultra)/.test(n)) return 'high';
        if (/m\d\s*pro/.test(n)) return 'discrete';
        if (/\bm\d\b/.test(n) || /metal renderer: apple m/.test(n)) return 'integrated';
        return 'integrated';
    }
    if (/nvidia|geforce|quadro|rtx|gtx/.test(n)) {
        if (/rtx|\b(30|40|50)\d\d\b/.test(n)) return 'high';
        // GT / MX / MX1xx are the low-power laptop parts.
        if (/\b(gt|mx)\s?\d/.test(n) || /geforce now/.test(n)) return 'low';
        return 'discrete';
    }
    if (/amd|radeon|\brx\b/.test(n)) {
        if (/\brx\s?\d/.test(n))  {
            const m = /\brx\s?(\d{4})/.exec(n);
            return m && Number(m[1]) >= 6000 ? 'high' : 'discrete';
        }
        if (/vega|radeon[\s\w()]*graphics|renoir|cezanne|rembrandt|phoenix/.test(n)) return 'integrated';
        return 'discrete';
    }
    if (/intel/.test(n)) {
        if (/\barc\b/.test(n)) return 'discrete';
        // Xe and Iris are current integrated parts; UHD/HD the older ones.
        if (/iris xe|iris plus|\bx(e|) graphics\b|arc graphics/.test(n)) return 'integrated';
        if (/iris|hd graphics [5-7]\d\d\d|uhd graphics [6-9]\d\d/.test(n)) return 'integrated';
        if (/intel/.test(n)) return 'low';
    }
    return null;
}

/** CPU tier from the cheap hints. Phones can never be `high` on this scale. */
export function cpuTierFromHints(h: DeviceHints): CpuTier {
    const cores = h.cores > 0 ? h.cores : 4;
    const mem = h.deviceMemory > 0 ? h.deviceMemory : 8;
    if (h.mobile) return cores >= 8 && mem >= 6 ? 'mid' : 'low';
    if (mem <= 4 || cores <= 2) return 'low';
    if (cores <= 4) return 'mid';
    return 'high';
}

/** GPU tier from the cheap hints, for when the renderer name says nothing. */
export function gpuTierFromHints(h: DeviceHints, cpu: CpuTier): GpuTier {
    if (h.mobile) return 'low';
    return cpu === 'low' ? 'low' : 'integrated';
}

/** Best guess before any benchmark has run. */
export function guessTiers(h: DeviceHints, gpuName: string | null): DeviceTiers {
    return resolveTiers({ hints: h, gpuName });
}

export interface TierInputs {
    readonly hints: DeviceHints;
    /** The renderer's name, when it can be read. */
    readonly gpuName: string | null;
    /** The benchmark's CPU index (bench/cpu.cpuIndex), when it has run. */
    readonly cpuIndex?: number | null;
    /** The benchmark's GPU throughput, when it has run. */
    readonly gpuScores?: { readonly fill: number; readonly quads: number } | null;
}

/**
 * The tiers to use, from every signal available. A measured CPU index is
 * trusted over the core count (it measures the thing that matters); for the
 * GPU the *name* is trusted first, because absolute fill-rate numbers vary
 * widely between browsers and drivers, while a card's model does not.
 */
export function resolveTiers(i: TierInputs): DeviceTiers {
    const cpu = i.cpuIndex != null && i.cpuIndex > 0
        ? cpuTierFromIndex(i.cpuIndex, i.hints.mobile)
        : cpuTierFromHints(i.hints);
    const named = gpuTierFromName(i.gpuName);
    const gpu = named
        ?? (i.gpuScores ? gpuTierFromScores(i.gpuScores.fill, i.gpuScores.quads) : gpuTierFromHints(i.hints, cpu));
    return { cpu, gpu };
}

/**
 * CPU tier from the benchmark's composite index (see bench/cpu.ts):
 * 1.0 is a mid-range 2020 laptop. Phones can never be `high`.
 */
export function cpuTierFromIndex(index: number, mobile = false): CpuTier {
    if (!(index > 0)) return 'mid';
    if (index < 0.55) return 'low';
    if (mobile) return 'mid';
    return index >= 1.15 ? 'high' : 'mid';
}

/**
 * GPU tier from the fill-rate and batching measurements (Mpix/s and
 * kquads/s). Both are noisy across browsers, so the bands are wide; the
 * playfield frame times get the final say over the settings anyway.
 */
export function gpuTierFromScores(megapixelsPerSecond: number, kiloquadsPerSecond: number): GpuTier {
    const fill = megapixelsPerSecond > 0 ? megapixelsPerSecond : 0;
    const quads = kiloquadsPerSecond > 0 ? kiloquadsPerSecond : 0;
    // Blending pixels and pushing quads are separate limits, so each is
    // scored 0..2 and the two are added: 4 needs both to be fast, 3 one of
    // them, and anything below that is a genuinely small GPU.
    const fillScore = fill >= 2200 ? 2 : fill >= 700 ? 1 : 0;
    const quadScore = quads >= 700 ? 2 : quads >= 220 ? 1 : 0;
    const score = fillScore + quadScore;
    if (score >= 4) return 'high';
    if (score === 3) return 'discrete';
    if (score >= 1) return 'integrated';
    return 'low';
}

/**
 * The graphics values these tiers imply, before the playfield timing
 * refines the render scale:
 *
 * - the GPU decides pixel work: render scale, anti-aliasing, blur, video;
 * - the CPU decides per-frame JavaScript: parallax, bursts, ripples, the
 *   progress graph, the cursor trail, follow points, storyboards;
 * - `quality` is never chosen here, and neither is anything above it.
 */
export function valuesForTiers(t: DeviceTiers): GraphicsValues {
    if (t.gpu === 'low') return { ...TIERS.performance };
    const base = { ...TIERS.balanced };
    if (t.gpu === 'integrated') {
        base.backgroundBlur = 0.15;
        base.backgroundVideo = false;
        base.kiaiFlash = false;
    }
    if (t.cpu === 'low') {
        base.parallax = false;
        base.comboBursts = false;
        base.cursorTrail = false;
        base.progressGraph = false;
        base.hideFollowPoints = true;
        if (t.gpu === 'integrated') base.resolutionScale = 0.9;
    } else if (t.cpu === 'mid') {
        base.kiaiFlash = false;
    }
    return base;
}

/**
 * A one-line description for the settings panel and the benchmark report,
 * e.g. "CPU mid · GPU integrated (Intel Iris Xe)".
 */
export function describeTiers(t: DeviceTiers): string {
    const gpu = t.gpu === 'low' ? 'low-end'
        : t.gpu === 'integrated' ? 'integrated'
            : t.gpu === 'discrete' ? 'dedicated' : 'high-end';
    return `CPU ${t.cpu} · GPU ${gpu}`;
}

/** A rough preset name for the tiers (used when `auto` needs to say what it picked). */
export function presetNameForTiers(t: DeviceTiers): GraphicsTier {
    return t.gpu === 'low' ? 'performance' : 'balanced';
}
