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
 * Both hints lie in known ways, so every read is defensive:
 *
 * - `deviceMemory` does not exist in Safari (undefined, not 0) and is capped
 *   at 8 everywhere, so it can only ever *lower* a tier.
 * - `hardwareConcurrency` is a fingerprinting value on phones (iOS reports
 *   4-6 whatever the chip), so a phone is never called `high`.
 * - The renderer name is optional, deprecated in places and masked by
 *   Safari ("Apple GPU" on iOS, no chip). It is parsed as hostile text:
 *   unknown means "no opinion", and the fallback is the middle tier, never
 *   the top one.
 *
 * The result is deliberately two small tiers rather than exact numbers: the
 * cost of being one step wrong is a slightly softer or plainer picture, not
 * a broken game. Nothing here changes what is drawn — only how much.
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

/** Where a tier came from, for the debug dump and the report. */
export type TierSource = 'measured' | 'renderer' | 'hints' | 'override';

export interface TieredDevice {
    readonly tiers: DeviceTiers;
    readonly cpuSource: TierSource;
    readonly gpuSource: TierSource;
}

/** Read the hints from the browser. Missing APIs mean "unknown", not zero. */
export function deviceHints(nav: Navigator = navigator, win: Window = window): DeviceHints {
    const n = nav as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const mobile = n.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(nav.userAgent)
        // A touch screen with no mouse: a tablet in disguise, or a phone's "desktop site".
        || (win.matchMedia?.('(pointer: coarse)').matches === true && win.matchMedia?.('(hover: hover)').matches === false);
    return {
        // Safari: undefined. Treated as unknown below.
        deviceMemory: typeof n.deviceMemory === 'number' && n.deviceMemory > 0 ? n.deviceMemory : 0,
        cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : 0,
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
        // Some browsers mask the extension's parameter to an empty string, and
        // a few return "WebKit WebGL" — all of those mean "no name".
        try {
            const dbg = s.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: number } | null;
            const raw = dbg?.UNMASKED_RENDERER_WEBGL !== undefined ? s.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
            const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
            if (name && !isMaskedName(name)) return name;
            const plain = s.getParameter(0x1f01 /* gl.RENDERER */);
            if (typeof plain === 'string' && plain.trim() && !isMaskedName(plain)) return plain.trim();
        } catch {
            /* a lost context: fall through to the adapter info, if any */
        }
    }
    const info = s.info;
    if (info) {
        const parts = [info.vendor, info.architecture, info.device, info.description].filter((p): p is string => !!p);
        if (parts.length) return parts.join(' ');
    }
    return null;
}

/**
 * The GPU's name from a pixi Renderer: the WebGL context in 2D mode, the
 * WebGPU adapter otherwise. Null when the renderer is missing.
 */
export function rendererGpuName(renderer: unknown): string | null {
    const r = renderer as { gl?: unknown; device?: { adapter?: unknown } } | null;
    if (!r) return null;
    return gpuNameOf(r.gl ?? r.device?.adapter ?? r);
}

/** Placeholders browsers hand out instead of a model name. */
function isMaskedName(name: string): boolean {
    return /^(webkit webgl|webkit webgl 2\.0|webgl|generic renderer|apple gpu)$/i.test(name.trim());
}

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'mobile' | 'software' | 'unknown';

/** What a renderer string turned out to be. */
export interface GpuInfo {
    /** The string the browser gave, verbatim. Kept so unknown cards can be added from reports. */
    readonly raw: string;
    readonly vendor: GpuVendor;
    /** The model the vendor rules matched ("rtx 3060", "m2 pro", "iris xe"), if any. */
    readonly model: string | null;
    /** A laptop, phone or other power-limited part: rated one step below its desktop twin. */
    readonly mobile: boolean;
    /** The tier the name alone implies; null when the name says nothing useful. */
    readonly tier: GpuTier | null;
}

const TIER_BY_CLASS: readonly GpuTier[] = ['low', 'integrated', 'discrete', 'high'];
/** Software rendering is slower than every real GPU above 2010. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|swrast|basic render|microsoft basic|software rasterizer/;
const PHONE_GPU = /adreno|mali-?\w*|powervr|videocore|immortalis|tegra/;

/** NVIDIA: the model number decides, not the prefix (a mobile RTX 3050 is not a 4090). */
function nvidiaClass(n: string): { cls: number; model: string | null } {
    const rtx = /\brtx\s?(\d{4})/.exec(n);
    if (rtx) {
        const num = Number(rtx[1]);
        // Class 3 is a fast card, 2 a dedicated but entry-level one. xx50 is
        // the entry part (a 3050 is slower than a GTX 1080 Ti); xx60 and up
        // are the fast ones. The laptop rule steps a mobile part down unless
        // it is an xx80/xx90.
        return { cls: num % 100 >= 60 ? 3 : 2, model: `rtx ${num}` };
    }
    const gtx = /\bgtx\s?(\d{3,4})/.exec(n);
    if (gtx) {
        const num = Number(gtx[1]);
        // 1070+ still outruns most integrated parts; 1050/1060/1650 are entry.
        return { cls: num >= 1070 ? 2 : 1, model: `gtx ${num}` };
    }
    // GT 1030 has four digits and an MX150 three: take either.
    const mx = /\b(mx|gt)\s?(\d{3,4})\b/.exec(n);
    if (mx) return { cls: 0, model: `${mx[1]}${mx[2]}` };
    if (/geforce now|quadro|tesla/.test(n)) return { cls: 2, model: null };
    return { cls: 2, model: null };
}

/** AMD: RX 6000+ is RDNA, RX 5000 midrange, Vega/Polaris older, APUs integrated. */
function amdClass(n: string): { cls: number; model: string | null } {
    const rx = /\brx\s?(\d{4})\s?(xt|gre|m)?/.exec(n);
    if (rx) {
        const num = Number(rx[1]);
        if (num >= 6000) return { cls: num >= 6700 ? 3 : 2, model: `rx ${num}` };
        if (num >= 5000) return { cls: 2, model: `rx ${num}` };
        if (num >= 570) return { cls: 2, model: `rx ${num}` };
        return { cls: 1, model: `rx ${num}` };
    }
    // "AMD Radeon(TM) Graphics", Vega 8, and the APU code names.
    if (/vega|radeon[\s\w()]*graphics|renoir|cezanne|rembrandt|phoenix|lucienne|radeon\s*\d{3}m/.test(n)) {
        return { cls: 1, model: 'radeon graphics' };
    }
    return { cls: 2, model: null };
}

/** Intel: Arc by model, Iris Xe and up integrated, HD/UHD 6xx the old weak parts. */
function intelClass(n: string): { cls: number; model: string | null } {
    const arc = /\barc\s*(?:\(tm\)\s*)?([ab])\s?(\d{3})/.exec(n.replace(/\(tm\)/g, ''));
    if (arc) {
        const series = arc[1];
        const num = Number(arc[2]);
        // Arc A350M/A380 are entry dedicated; A5xx/A7xx real cards; B-series newer.
        const cls = series === 'b' ? (num >= 570 ? 3 : 2) : (num >= 500 ? 2 : 1);
        return { cls, model: `arc ${series}${num}` };
    }
    if (/\barc\b/.test(n)) return { cls: 2, model: 'arc' };
    // Iris Xe, Iris Plus, "Intel(R) Xe Graphics", UHD 7xx/8xx/9xx (11th gen and later).
    if (/iris\s*xe|iris\s*plus|iris\s*pro|\bxe\s*graphics|intel\(r\)\s*graphics|uhd\s*graphics\s*[789]\d\d/.test(n)) {
        const model = /iris\s*xe/.test(n) ? 'iris xe' : /iris/.test(n) ? 'iris' : 'xe graphics';
        return { cls: 1, model };
    }
    // UHD 6xx (2015-2017) still blits a playfield fine; HD 4xxx-5xxx and the
    // UHD 2xx/3xx parts are the genuinely weak ones.
    if (/\buhd\s*graphics\s*[6-9]\d\d/.test(n)) {
        const model = /(\buhd\s*graphics\s*\d{3})/.exec(n);
        return { cls: 1, model: model ? model[1] : 'uhd graphics' };
    }
    if (/\bhd\s*graphics|\buhd\s*graphics\s*[2-5]\d\d/.test(n)) {
        const model = /(\b[hu]d\s*graphics\s*\d{3})/.exec(n);
        return { cls: 0, model: model ? model[1] : 'hd graphics' };
    }
    return { cls: 1, model: null };
}

/** Apple silicon: Max/Ultra are high, Pro dedicated-class, the base chips integrated. */
function appleClass(n: string): { cls: number; model: string | null } {
    // Longest variant first: "m2 pro" must not read as "m2".
    const m = /\bm(\d)\s*(pro|max|ultra)?/.exec(n);
    if (!m) return { cls: 1, model: null };
    const variant = m[2];
    const model = `m${m[1]}${variant ? ` ${variant}` : ''}`;
    if (variant === 'max' || variant === 'ultra') return { cls: 3, model };
    if (variant === 'pro') return { cls: 2, model };
    return { cls: 1, model };
}

/**
 * Take a renderer string apart.
 *
 * The strings are hostile input: they are masked by privacy settings, differ
 * per browser and OS, and nest parentheses ("Intel(R)", "Arc(TM)",
 * "Vulkan 1.3.0 (SwiftShader Device ...)"). Every rule here therefore works
 * on the whole string, matches the most specific pattern first, and leaves
 * the raw text in the result for the report.
 */
export function parseGpu(raw: string | null, hints: { mobile?: boolean } = {}): GpuInfo {
    const text = (raw ?? '').trim();
    const n = text.toLowerCase();
    const base = { raw: text, model: null, mobile: false } as const;
    if (!n) return { ...base, vendor: 'unknown', tier: null };
    // Software rendering first: it contains vendor words ("Google",
    // "Vulkan 1.3") that would otherwise read as a modern GPU.
    if (SOFTWARE.test(n)) return { ...base, vendor: 'software', tier: 'low', model: 'software' };
    if (PHONE_GPU.test(n)) {
        const model = /(adreno[\s(]*\w+|mali-\w+|immortalis-\w+|powervr\s*\w*)/.exec(n);
        return { ...base, vendor: 'mobile', tier: 'low', mobile: true, model: model ? model[1] : 'mobile gpu' };
    }

    const mobile = hints.mobile === true || /laptop|mobile|max-q|notebook/.test(n);
    if (/apple|metal renderer/.test(n)) {
        const { cls, model } = appleClass(n);
        // "Apple GPU" with no chip model is the iOS case: a phone GPU, not a
        // desktop M-series part, so on a phone it takes the bottom tier.
        if (model === null) return { ...base, vendor: 'apple', tier: mobile ? 'low' : 'integrated', mobile };
        return { ...base, vendor: 'apple', model, mobile, tier: TIER_BY_CLASS[laptopClass(cls, model, mobile)] };
    }
    if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(n)) {
        const { cls, model } = nvidiaClass(n);
        return { ...base, vendor: 'nvidia', model, mobile, tier: TIER_BY_CLASS[laptopClass(cls, model, mobile)] };
    }
    if (/amd|radeon|\brx\b/.test(n)) {
        const { cls, model } = amdClass(n);
        return { ...base, vendor: 'amd', model, mobile, tier: TIER_BY_CLASS[laptopClass(cls, model, mobile)] };
    }
    if (/intel/.test(n)) {
        const { cls, model } = intelClass(n);
        // Arc is sold in laptops too, but a mobile A770-equivalent stays a
        // dedicated card; only the top class steps down.
        return { ...base, vendor: 'intel', model, mobile, tier: TIER_BY_CLASS[laptopClass(cls, model, mobile)] };
    }
    return { ...base, vendor: 'unknown', tier: null };
}

/**
 * A laptop part is one class below its desktop twin, except the biggest
 * cards (a mobile xx80/xx90 is still a high-end GPU).
 */
function laptopClass(cls: number, model: string | null, mobile: boolean): number {
    if (!mobile || cls < 3) return cls;
    // "rtx 4090" on a laptop is still a big card; "rtx 3060" is not.
    const digits = model !== null ? /(\d{3,4})/.exec(model) : null;
    const top = digits !== null && Number(digits[1]) % 100 >= 80;
    return top ? cls : cls - 1;
}

/**
 * A GPU tier from the renderer name, or null when the name says nothing
 * (masked by a privacy setting, an unknown new card). Callers fall back to
 * the measured throughput and then to the cheap hints.
 */
export function gpuTierFromName(name: string | null, opts: { mobile?: boolean } = {}): GpuTier | null {
    return parseGpu(name, opts).tier;
}

const notedUnknown = new Set<string>();

/**
 * Mention an unrecognised renderer string once, with the raw text, so a bug
 * report can grow the table instead of a developer having to guess. Quiet for
 * names that parsed, for masked names (nothing to log) and for repeats.
 */
export function noteUnknownGpu(raw: string | null): void {
    const info = parseGpu(raw);
    if (!raw || info.tier !== null || notedUnknown.has(info.raw)) return;
    notedUnknown.add(info.raw);
    console.info(`wosu!: unrecognised GPU renderer "${info.raw}" — falling back to the benchmark and the other hints.`);
}

/** CPU tier from the cheap hints. Phones are never `high`; unknown is `mid`. */
export function cpuTierFromHints(h: DeviceHints): CpuTier {
    // An absent value is the common case on Safari, and it means "unknown".
    const cores = h.cores > 0 ? h.cores : 4;
    // Memory is capped at 8 by every browser (so 8 and 64 GB look the same)
    // and missing on Safari (0 = unknown), so it can only ever demote.
    const small = h.deviceMemory > 0 && h.deviceMemory <= 4;
    if (h.mobile) {
        // iOS reports 4-6 cores whatever the chip, so only real weakness
        // counts against a phone (a small memory reading, or a netbook-class
        // core count). Never `high`.
        if (cores <= 2 || small) return 'low';
        return 'mid';
    }
    if (small || cores <= 2) return 'low';
    if (cores <= 4) return 'mid';
    return h.cores > 0 ? 'high' : 'mid';
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
    return resolveTieredDevice(i).tiers;
}

/** `resolveTiers`, plus where each answer came from (for the debug dump). */
export function resolveTieredDevice(i: TierInputs): TieredDevice {
    const measuredCpu = i.cpuIndex != null && i.cpuIndex > 0;
    const cpu = measuredCpu ? cpuTierFromIndex(i.cpuIndex as number, i.hints.mobile) : cpuTierFromHints(i.hints);
    const named = gpuTierFromName(i.gpuName, { mobile: i.hints.mobile });
    let gpu: GpuTier;
    let gpuSource: TierSource;
    if (named) {
        gpu = named;
        gpuSource = 'renderer';
    } else if (i.gpuScores) {
        gpu = gpuTierFromScores(i.gpuScores.fill, i.gpuScores.quads);
        gpuSource = 'measured';
    } else {
        gpu = gpuTierFromHints(i.hints, cpu);
        gpuSource = 'hints';
    }
    // A phone cannot drive a desktop card, whatever it claims.
    if (i.hints.mobile && (gpu === 'discrete' || gpu === 'high')) gpu = 'integrated';
    return { tiers: { cpu, gpu }, cpuSource: measuredCpu ? 'measured' : 'hints', gpuSource };
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
 * An explicit `?tiers=cpu,gpu` (or `?tiers=high`) from the URL: an escape
 * hatch for a device the detector reads wrong, and for testing a tier on
 * hardware that has none of it.
 */
export function tierOverride(search: string): DeviceTiers | null {
    const m = /[?&]tiers=([a-z]+)(?:,([a-z]+))?/i.exec(search);
    if (!m) return null;
    const cpus: CpuTier[] = ['low', 'mid', 'high'];
    const gpus: GpuTier[] = ['low', 'integrated', 'discrete', 'high'];
    const a = m[1]?.toLowerCase() ?? '';
    const b = (m[2] ?? '').toLowerCase();
    // Two values must both be valid: `?tiers=high,potato` is a typo, not a
    // request for "high" with the GPU left alone.
    if (m[2] !== undefined) {
        return cpus.includes(a as CpuTier) && gpus.includes(b as GpuTier) ? { cpu: a as CpuTier, gpu: b as GpuTier } : null;
    }
    if (gpus.includes(a as GpuTier)) return { cpu: 'mid', gpu: a as GpuTier };
    return null;
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

/**
 * Everything the detector read and concluded, on one line: the console
 * output that turns "this device looks wrong" into a bug report.
 */
export function describeTierInputs(hints: DeviceHints, gpuName: string | null, d: TieredDevice): string {
    const mem = hints.deviceMemory > 0 ? `${hints.deviceMemory} GB` : 'unknown (deviceMemory missing)';
    const cores = hints.cores > 0 ? `${hints.cores}` : 'unknown';
    return `wosu! device: CPU ${d.tiers.cpu} (${d.cpuSource}) · GPU ${d.tiers.gpu} (${d.gpuSource})`
        + ` · cores ${cores}, memory ${mem}${hints.mobile ? ', mobile' : ''}`
        + ` · renderer ${gpuName ?? 'unreadable'}`;
}

/**
 * A GPU name short enough for a settings row: the renderer string above is
 * what the browser hands out ("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060
 * Direct3D11 vs_5_0 ps_5_0, D3D11)"), and the interesting part is the card.
 */
export function shortGpuName(raw: string | null): string {
    if (!raw) return '';
    let s = raw.trim();
    // Software rendering is worth naming plainly: it explains everything.
    if (/swiftshader/i.test(s)) return 'SwiftShader (software)';
    if (/llvmpipe|softpipe|swrast/i.test(s)) return 'software renderer';
    // "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)":
    // the device part can itself contain commas, so split at depth 0 only.
    const angle = /^ANGLE\s*\((.*)\)$/is.exec(s);
    if (angle) {
        const parts = splitTopLevel(angle[1]);
        s = parts.length > 1 ? parts[1] : parts[0];
    }
    const metal = /^ANGLE Metal Renderer:\s*([^,]+)/i.exec(s);
    if (metal) s = metal[1];
    s = s
        .replace(/\bDirect3D\d+\b/gi, '')
        .replace(/\b(vs|ps|cs)_\d+_\d+\b/gi, '')
        .replace(/\s*\((?:0x)?[0-9a-f]{6,}\)\s*$/i, '')
        .replace(/\((?:R|TM|C)\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    // "Mesa Intel(R) UHD Graphics 620 (CFL GT2)": a trailing codename in
    // capitals says nothing to a person looking at a settings row.
    const codename = /\s*\(([^)]*)\)$/.exec(s);
    if (codename && !/[a-z]/.test(codename[1])) s = s.slice(0, codename.index).trim();
    s = s.replace(/[,;]$/, '');
    return s.length > 42 ? `${s.slice(0, 40).trimEnd()}…` : s;
}

/** Split on commas that are not inside brackets. */
function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) {
            out.push(s.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(s.slice(start).trim());
    return out.filter(Boolean);
}
