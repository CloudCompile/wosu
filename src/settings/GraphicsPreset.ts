import type { Bindable, BindableNumber } from '../core/Bindable';

/**
 * Settings → Graphics → "Graphics preset": one choice that sets every
 * visual-cost setting at once. `auto` picks a tier for the device.
 */
export type GraphicsPreset = 'auto' | 'performance' | 'balanced' | 'quality';
/** A preset that names a level of detail (what `auto` resolves to, and what the user picks). */
export type GraphicsTier = 'performance' | 'balanced' | 'quality';

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

/** The values a preset writes, as plain data (so the benchmark can build its own set). */
export interface GraphicsValues {
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
}

/** What each tier sets. `balanced` is wosu!'s own defaults with the costliest extras off. */
export const TIERS: Record<GraphicsTier, GraphicsValues> = {
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
        backgroundBlur: 0,
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
    applyGraphicsValues(s, TIERS[tier]);
}

/** Write explicit values into the graphics settings (populated by the benchmark). */
export function applyGraphicsValues(s: GraphicsPresetTarget, v: GraphicsValues): void {
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
