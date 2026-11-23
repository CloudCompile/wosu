import { describe, expect, it } from 'vitest';
import {
    cpuTierFromHints, cpuTierFromIndex, describeTiers, deviceHints, gpuNameOf, gpuTierFromName,
    gpuTierFromScores, guessTiers, noteUnknownGpu, parseGpu, resolveTiers, shortGpuName, tierOverride,
    valuesForTiers,
    type DeviceHints,
} from '../../src/settings/deviceTiers';
import { TIERS } from '../../src/settings/GraphicsPreset';

const desktop = (cores: number, mem: number): DeviceHints => ({ cores, deviceMemory: mem, mobile: false });

describe('gpu tier from the renderer name', () => {
    it('reads Intel integrated parts', () => {
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) OpenGL Engine, OpenGL 4.1)')).toBe('integrated');
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) HD Graphics 4600 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics, OpenGL 4.6)')).toBe('discrete');
    });

    it('reads NVIDIA cards', () => {
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce GT 1030 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
    });

    it('reads AMD and Apple parts', () => {
        expect(gpuTierFromName('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
        expect(gpuTierFromName('ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
        expect(gpuTierFromName('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M1, Unspecified Version')).toBe('integrated');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version')).toBe('discrete');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2 Max, Unspecified Version')).toBe('high');
    });

    it('reads phone GPUs and software rendering as low', () => {
        expect(gpuTierFromName('Adreno (TM) 740')).toBe('low');
        expect(gpuTierFromName('Mali-G78 MP14')).toBe('low');
        expect(gpuTierFromName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe('low');
        expect(gpuTierFromName('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    });

    it('returns null for a name it cannot place', () => {
        expect(gpuTierFromName('')).toBeNull();
        expect(gpuTierFromName(null)).toBeNull();
        expect(gpuTierFromName('Some Future Renderer 9000')).toBeNull();
    });

    it('reads a stored flag name from either renderer API', () => {
        const gl = {
            getParameter: (p: number) => (p === 0x1f01 ? 'Fake Renderer' : 'ignored'),
            getExtension: () => null,
        };
        expect(gpuNameOf(gl)).toBe('Fake Renderer');
        const gpu = { info: { vendor: 'apple', architecture: 'metal-3', device: 'Apple M3' } };
        expect(gpuNameOf(gpu)).toBe('apple metal-3 Apple M3');
        expect(gpuNameOf(null)).toBeNull();
    });
});

describe('short gpu names', () => {
    it('picks the card out of the renderer string', () => {
        expect(shortGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3060');
        expect(shortGpuName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel Iris Xe Graphics');
        expect(shortGpuName('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('AMD Radeon Graphics');
        expect(shortGpuName('ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version')).toBe('Apple M2 Pro');
        expect(shortGpuName('Adreno (TM) 740')).toBe('Adreno 740');
    });

    it('says so when the GPU is the CPU', () => {
        expect(shortGpuName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'))
            .toBe('SwiftShader (software)');
        expect(shortGpuName('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software renderer');
    });

    it('keeps a long name from overflowing a row', () => {
        const name = shortGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU with Max-Q Design and Optimus Technology, D3D11)');
        expect(name.length).toBeLessThanOrEqual(41);
        expect(name.endsWith('…')).toBe(true);
    });

    it('has nothing to say about an unknown GPU', () => {
        expect(shortGpuName(null)).toBe('');
        expect(shortGpuName('')).toBe('');
    });
});

describe('cpu tier', () => {
    it('reads cores and memory', () => {
        expect(cpuTierFromHints(desktop(16, 8))).toBe('high');
        expect(cpuTierFromHints(desktop(8, 8))).toBe('high');
        expect(cpuTierFromHints(desktop(4, 8))).toBe('mid');
        expect(cpuTierFromHints(desktop(2, 8))).toBe('low');
        expect(cpuTierFromHints(desktop(16, 4))).toBe('low');
    });

    it('never calls a phone high', () => {
        expect(cpuTierFromHints({ cores: 8, deviceMemory: 8, mobile: true })).toBe('mid');
        expect(cpuTierFromHints({ cores: 4, deviceMemory: 4, mobile: true })).toBe('low');
    });

    it('treats unknown hints as a normal laptop', () => {
        expect(cpuTierFromHints({ cores: 0, deviceMemory: 0, mobile: false })).toBe('mid');
    });

    it('reads the benchmark index', () => {
        expect(cpuTierFromIndex(2.2)).toBe('high');
        expect(cpuTierFromIndex(1.15)).toBe('high');
        expect(cpuTierFromIndex(1.0)).toBe('mid');
        expect(cpuTierFromIndex(0.56)).toBe('mid');
        expect(cpuTierFromIndex(0.54)).toBe('low');
        expect(cpuTierFromIndex(0)).toBe('mid');
        expect(cpuTierFromIndex(3, true)).toBe('mid');
    });
});

describe('gpu tier from measured throughput', () => {
    it('needs both fill rate and batching to earn a tier', () => {
        expect(gpuTierFromScores(3000, 900)).toBe('high');
        expect(gpuTierFromScores(3000, 100)).toBe('integrated');
        expect(gpuTierFromScores(100, 900)).toBe('integrated');
        expect(gpuTierFromScores(100, 100)).toBe('low');
        expect(gpuTierFromScores(0, 0)).toBe('low');
    });

    it('calls a device that passes both mid bands integrated', () => {
        expect(gpuTierFromScores(1000, 300)).toBe('integrated');
        // One very fast axis and a mid one is where dedicated cards land.
        expect(gpuTierFromScores(3000, 300)).toBe('discrete');
    });
});

describe('resolving tiers', () => {
    it('prefers the measured CPU index and the renderer name', () => {
        const hints = desktop(4, 8);
        expect(guessTiers(hints, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 ...)')).toEqual({ cpu: 'mid', gpu: 'high' });
        expect(resolveTiers({ hints, gpuName: null, cpuIndex: 1.9 })).toEqual({ cpu: 'high', gpu: 'integrated' });
        expect(resolveTiers({ hints, gpuName: null, gpuScores: { fill: 100, quads: 100 } })).toEqual({ cpu: 'mid', gpu: 'low' });
        // A named GPU wins over the throughput guess (absolute numbers vary).
        expect(resolveTiers({ hints: desktop(16, 8), gpuName: 'ANGLE (Intel, Intel(R) UHD Graphics 620 ...)', gpuScores: { fill: 3000, quads: 900 } }))
            .toEqual({ cpu: 'high', gpu: 'integrated' });
    });

    it('falls back to the hints when nothing is known', () => {
        expect(guessTiers(desktop(2, 4), null)).toEqual({ cpu: 'low', gpu: 'low' });
        expect(guessTiers({ cores: 8, deviceMemory: 6, mobile: true }, null)).toEqual({ cpu: 'mid', gpu: 'low' });
    });

    it('reads hints from the navigator', () => {
        const nav = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', hardwareConcurrency: 12, deviceMemory: 8 } as unknown as Navigator;
        const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
        expect(deviceHints(nav, win)).toEqual({ cores: 12, deviceMemory: 8, mobile: false });
        const phone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', hardwareConcurrency: 6 } as unknown as Navigator;
        expect(deviceHints(phone, win).mobile).toBe(true);
        const tablet = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', hardwareConcurrency: 8 } as unknown as Navigator;
        const touch = { matchMedia: (q: string) => ({ matches: q.includes('coarse') }) } as unknown as Window;
        expect(deviceHints(tablet, touch).mobile).toBe(true);
    });

    it('describes itself', () => {
        expect(describeTiers({ cpu: 'high', gpu: 'discrete' })).toBe('CPU high · GPU dedicated');
        expect(describeTiers({ cpu: 'low', gpu: 'low' })).toBe('CPU low · GPU low-end');
    });
});

describe('values for tiers', () => {
    it('gives a weak GPU the performance values', () => {
        expect(valuesForTiers({ cpu: 'high', gpu: 'low' })).toEqual(TIERS.performance);
    });

    it('gives capable machines the default look', () => {
        expect(valuesForTiers({ cpu: 'high', gpu: 'high' })).toEqual(TIERS.balanced);
        expect(valuesForTiers({ cpu: 'mid', gpu: 'discrete' })).toEqual(TIERS.balanced);
    });

    it('trims per-frame effects for a weak CPU', () => {
        const v = valuesForTiers({ cpu: 'low', gpu: 'discrete' });
        expect(v.parallax).toBe(false);
        expect(v.comboBursts).toBe(false);
        expect(v.cursorTrail).toBe(false);
        expect(v.hideFollowPoints).toBe(true);
        // The GPU is fine, so resolution and anti-aliasing stay.
        expect(v.resolutionScale).toBe(1);
        expect(v.antialias).toBe(true);
    });

    it('drops the render scale when both sides are weak', () => {
        const v = valuesForTiers({ cpu: 'low', gpu: 'integrated' });
        expect(v.resolutionScale).toBe(0.9);
        expect(v.backgroundBlur).toBe(0.15);
        expect(v.backgroundVideo).toBe(false);
    });

    it('never turns anything on that a preset would not', () => {
        const base = TIERS.balanced;
        for (const cpu of ['low', 'mid', 'high'] as const) {
            for (const gpu of ['low', 'integrated', 'discrete', 'high'] as const) {
                const v = valuesForTiers({ cpu, gpu });
                // Booleans only ever move from on to off, and the scale never grows.
                for (const key of Object.keys(base) as (keyof typeof base)[]) {
                    // hideFollowPoints is inverted: true means fewer drawn.
                    if (typeof base[key] !== 'boolean' || key === 'hideFollowPoints') continue;
                    expect(Number(v[key]), `${cpu}/${gpu} ${key}`).toBeLessThanOrEqual(Number(base[key]));
                }
                expect(v.resolutionScale).toBeLessThanOrEqual(1);
            }
        }
    });
});

/**
 * The real strings, not invented ones. These are the formats browsers hand
 * out today; the table is the regression test for the parser, and the place
 * to add a line when a report brings a new card.
 */
describe('real renderer strings', () => {
    const cases: [string | null, string | null][] = [
        // Intel
        ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['ANGLE (Intel, Intel(R) HD Graphics 4600 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
        ['Mesa Intel(R) UHD Graphics 620 (CFL GT2)', 'integrated'],
        // NVIDIA: a laptop part is a class below its desktop twin
        ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
        ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        // Apple: the model number is optional, and missing means iOS
        ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'discrete'],
        ['ANGLE (Apple, ANGLE Metal Renderer: Apple GPU, Unspecified Version)', 'integrated'],
        // Phones and software
        ['Adreno (TM) 740', 'low'],
        ['Mali-G78 MP14', 'low'],
        ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'low'],
        // Negatives: no opinion, so the caller falls back
        ['', null],
        [null, null],
        ['Mozilla', null],
        ['WebKit WebGL', null],
        ['Deliberately Unknown Card 9000', null],
    ];

    it.each(cases)('%s', (name, tier) => {
        expect(gpuTierFromName(name)).toBe(tier);
    });

    it('reads "Apple GPU" on a phone as a phone GPU', () => {
        expect(gpuTierFromName('ANGLE (Apple, ANGLE Metal Renderer: Apple GPU, Unspecified Version)', { mobile: true }))
            .toBe(('low'));
    });

    it('keeps the raw string and the vendor for an unknown card', () => {
        const info = parseGpu('Deliberately Unknown Card 9000');
        expect(info.raw).toBe('Deliberately Unknown Card 9000');
        expect(info.vendor).toBe('unknown');
        expect(info.model).toBeNull();
        expect(info.tier).toBeNull();
    });
});

describe('order sensitivity', () => {
    it('matches the longest Apple chip name first', () => {
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2, Unspecified Version')).toBe('integrated');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version')).toBe('discrete');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2 Max, Unspecified Version')).toBe('high');
        expect(gpuTierFromName('ANGLE Metal Renderer: Apple M2 Ultra, Unspecified Version')).toBe('high');
    });

    it('matches Iris Xe before plain Iris', () => {
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL)')).toBe('integrated');
        expect(gpuTierFromName('ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 655, OpenGL)')).toBe('integrated');
    });

    it('rates by model number, not by the RTX prefix', () => {
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11, D3D11)')).toBe('high');
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11, D3D11)')).toBe('discrete');
        expect(gpuTierFromName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11, D3D11)')).toBe('discrete');
    });

    it('calls SwiftShader software before its "Google" and "Vulkan 1.3" words', () => {
        const info = parseGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)');
        expect(info.vendor).toBe('software');
        expect(info.tier).toBe('low');
    });
});

describe('browsers that do not answer', () => {
    it('treats a missing API as unknown, never as zero', () => {
        const bare = {} as Navigator;
        const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
        expect(deviceHints(bare, win)).toEqual({ cores: 0, deviceMemory: 0, mobile: false });
        // Unknown hints must land in the middle, not the top or the bottom.
        expect(cpuTierFromHints({ cores: 0, deviceMemory: 0, mobile: false })).toBe('mid');
        expect(guessTiers({ cores: 0, deviceMemory: 0, mobile: false }, null).gpu).toBe('integrated');
    });

    it('has no name when the renderer masks it to an empty string', () => {
        const gl = { getParameter: () => '', getExtension: () => null };
        expect(gpuNameOf(gl)).toBeNull();
        const maskedExt = {
            getParameter: (p: number) => (p === 0x9245 ? '' : 'WebKit WebGL'),
            getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9245 }),
        };
        expect(gpuNameOf(maskedExt)).toBeNull();
    });

    it('puts an unknown desktop card in the middle tier', () => {
        expect(guessTiers(desktop(8, 8), 'Deliberately Unknown Card 9000'))
            .toEqual({ cpu: 'high', gpu: 'integrated' });
    });

    it('logs an unrecognised renderer once, with the raw text', () => {
        const seen: string[] = [];
        const original = console.info;
        console.info = (...args: unknown[]) => { seen.push(args.join(' ')); };
        try {
            noteUnknownGpu('Some Vendor Card 1234');
            noteUnknownGpu('Some Vendor Card 1234');
            noteUnknownGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11, D3D11)');
            noteUnknownGpu(null);
        } finally {
            console.info = original;
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain('Some Vendor Card 1234');
    });
});

describe('the ?tiers escape hatch', () => {
    it('reads a pair, a single GPU name, or nothing', () => {
        expect(tierOverride('?tiers=high,low')).toEqual({ cpu: 'high', gpu: 'low' });
        expect(tierOverride('?foo=1&tiers=high')).toEqual({ cpu: 'mid', gpu: 'high' });
        expect(tierOverride('?tiers=integrated')).toEqual({ cpu: 'mid', gpu: 'integrated' });
        expect(tierOverride('')).toBeNull();
        expect(tierOverride('?tiers=nonsense')).toBeNull();
        expect(tierOverride('?tiers=high,potato')).toBeNull();
    });
});
