import type { Bindable, BindableNumber } from '../core/Bindable';

/**
 * Settings → Graphics → "Graphics preset": one choice that sets every
 * visual-cost setting at once. `auto` picks a tier for the device.
 */
export type GraphicsPreset = 'auto' | 'performance' | 'balanced' | 'quality';
/** A preset that actually names a level of detail. */
export type GraphicsTier = Exclude<GraphicsPreset, 'auto'>;

/**
 * The graphics settings a preset writes. Deliberately not the whole of
 * Graphics: the renderer, frame limiter and low latency mode are user
 * choices that need a restart, and HUD scale is readability rather than
 * cost. Everything below is a visual extra that can be turned down without
 * changing how the game plays.
 */
export interface GraphicsPresetTarget {
    readonly resolutionScale: BindableNumber;
    readonly antialias: Bindable<boolean>;
    readonly parallax: Bindable<boolean>;
    readonly backgroundBlur: BindableNumber;
    readonly backgroundVideo: Bindable<boolean>;
    readonly storyboard: Bindable<boolean>;
    readonly hitLighting: Bindable<boolean>;
    readonly kiaiFlash: Bindable<boolean>;
    readonly comboBursts: Bindable<boolean>;
    readonly cursorTrail: Bindable<boolean>;
    readonly cursorRipples: Bindable<boolean>;
    readonly hideFollowPoints: Bindable<boolean>;
    readonly progressGraph: Bindable<boolean>;
}

/** What each tier sets. `balanced` is wosu!'s own defaults with the costliest extras off. */
const TIERS: Record<GraphicsTier, {
    resolutionScale: number;
    antialias: boolean;
    parallax: boolean;
    backgroundBlur: number;
    backgroundVideo: boolean;
    storyboard: boolean;
    hitLighting: boolean;
    kiaiFlash: boolean;
    comboBursts: boolean;
    cursorTrail: boolean;
    cursorRipples: boolean;
    hideFollowPoints: boolean;
    progressGraph: boolean;
}> = {
    // Everything that costs per-frame time off, and the frame rendered at
    // three quarters of the screen's pixels (the single biggest saving on a
    // weak GPU: fill rate, not JavaScript).
    performance: {
        resolutionScale: 0.75,
        antialias: false,
        parallax: false,
        backgroundBlur: 0,
        backgroundVideo: false,
        storyboard: false,
        hitLighting: false,
        kiaiFlash: false,
        comboBursts: false,
        cursorTrail: false,
        cursorRipples: false,
        hideFollowPoints: true,
        progressGraph: false,
    },
    // The normal look, minus the effects that are pure eye candy.
    balanced: {
        resolutionScale: 1,
        antialias: true,
        parallax: true,
        backgroundBlur: 0.2,
        backgroundVideo: false,
        storyboard: true,
        hitLighting: true,
        kiaiFlash: false,
        comboBursts: true,
        cursorTrail: true,
        cursorRipples: false,
        hideFollowPoints: false,
        progressGraph: false,
    },
    // Everything on, for a machine with GPU time to spare.
    quality: {
        resolutionScale: 1,
        antialias: true,
        parallax: true,
        backgroundBlur: 0.4,
        backgroundVideo: true,
        storyboard: true,
        hitLighting: true,
        kiaiFlash: true,
        comboBursts: true,
        cursorTrail: true,
        cursorRipples: true,
        hideFollowPoints: false,
        progressGraph: true,
    },
};

/** Write `tier`'s values into the graphics settings (the UI rows show them change). */
export function applyGraphicsTier(s: GraphicsPresetTarget, tier: GraphicsTier): void {
    const v = TIERS[tier];
    s.resolutionScale.value = v.resolutionScale;
    s.antialias.value = v.antialias;
    s.parallax.value = v.parallax;
    s.backgroundBlur.value = v.backgroundBlur;
    s.backgroundVideo.value = v.backgroundVideo;
    s.storyboard.value = v.storyboard;
    s.hitLighting.value = v.hitLighting;
    s.kiaiFlash.value = v.kiaiFlash;
    s.comboBursts.value = v.comboBursts;
    s.cursorTrail.value = v.cursorTrail;
    s.cursorRipples.value = v.cursorRipples;
    s.hideFollowPoints.value = v.hideFollowPoints;
    s.progressGraph.value = v.progressGraph;
}

/** What the preset sets for `tier` (for the settings row's summary). */
export function graphicsTierValues(tier: GraphicsTier): Readonly<typeof TIERS[GraphicsTier]> {
    return TIERS[tier];
}

/** The hints auto-detection reads (a subset of `navigator`, plus the screen). */
export interface DeviceHints {
    /** `navigator.deviceMemory` in GB (browsers cap it at 8), or 0 when unknown. */
    deviceMemory: number;
    /** `navigator.hardwareConcurrency` (logical cores), or 0 when unknown. */
    cores: number;
    /** A phone or tablet: a mobile user agent, or a coarse pointer with no hover. */
    mobile: boolean;
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

/**
 * Which tier `auto` means on a device. Phones and low-power machines get the
 * performance tier; anything else gets the balanced look. `quality` is never
 * picked automatically: the default should not spend frames on eye candy.
 */
export function detectGraphicsTier(h: DeviceHints): GraphicsTier {
    if (h.mobile) return 'performance';
    if (h.deviceMemory > 0 && h.deviceMemory <= 4) return 'performance';
    if (h.cores > 0 && h.cores <= 4) return 'performance';
    return 'balanced';
}

/** The tier a preset stands for right now (auto detects). */
export function resolveGraphicsPreset(preset: GraphicsPreset, hints: DeviceHints): GraphicsTier {
    return preset === 'auto' ? detectGraphicsTier(hints) : preset;
}
