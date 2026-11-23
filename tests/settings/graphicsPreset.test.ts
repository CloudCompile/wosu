import { describe, expect, it } from 'vitest';
import { Bindable, BindableNumber } from '../../src/core/Bindable';
import {
    applyGraphicsTier, detectGraphicsTier, graphicsTierValues, resolveGraphicsPreset, type GraphicsPresetTarget,
} from '../../src/settings/GraphicsPreset';

/** The subset of GameSettings a preset writes, as plain bindables. */
function target(): GraphicsPresetTarget {
    return {
        resolutionScale: new BindableNumber(1, 0.5, 1, 0.05),
        antialias: new Bindable(true),
        parallax: new Bindable(true),
        backgroundBlur: new BindableNumber(0, 0, 1, 0.01),
        backgroundVideo: new Bindable(false),
        storyboard: new Bindable(true),
        hitLighting: new Bindable(true),
        kiaiFlash: new Bindable(false),
        comboBursts: new Bindable(true),
        cursorTrail: new Bindable(true),
        cursorRipples: new Bindable(false),
        hideFollowPoints: new Bindable(false),
        progressGraph: new Bindable(false),
    };
}

describe('graphics preset', () => {
    it('gives the performance tier every cheap option', () => {
        const s = target();
        applyGraphicsTier(s, 'performance');
        expect(s.resolutionScale.value).toBe(0.75);
        expect(s.antialias.value).toBe(false);
        expect(s.parallax.value).toBe(false);
        expect(s.backgroundBlur.value).toBe(0);
        expect(s.backgroundVideo.value).toBe(false);
        expect(s.storyboard.value).toBe(false);
        expect(s.hitLighting.value).toBe(false);
        expect(s.kiaiFlash.value).toBe(false);
        expect(s.cursorTrail.value).toBe(false);
        expect(s.hideFollowPoints.value).toBe(true);
    });

    it('gives the quality tier the full look at native resolution', () => {
        const s = target();
        applyGraphicsTier(s, 'quality');
        expect(s.resolutionScale.value).toBe(1);
        expect(s.antialias.value).toBe(true);
        expect(s.storyboard.value).toBe(true);
        expect(s.backgroundVideo.value).toBe(true);
        expect(s.hitLighting.value).toBe(true);
        expect(s.kiaiFlash.value).toBe(true);
        expect(s.cursorTrail.value).toBe(true);
        expect(s.cursorRipples.value).toBe(true);
        expect(s.hideFollowPoints.value).toBe(false);
    });

    it('applies a tier over any previous values', () => {
        const s = target();
        applyGraphicsTier(s, 'quality');
        applyGraphicsTier(s, 'performance');
        expect(s.resolutionScale.value).toBe(0.75);
        expect(s.backgroundVideo.value).toBe(false);
    });

    it('keeps every tier inside the settings it is given', () => {
        for (const tier of ['performance', 'balanced', 'quality'] as const) {
            const s = target();
            applyGraphicsTier(s, tier);
            const v = graphicsTierValues(tier);
            // The numbers must survive each bindable's own clamping.
            expect(s.resolutionScale.value).toBe(v.resolutionScale);
            expect(s.backgroundBlur.value).toBe(v.backgroundBlur);
        }
    });

    it('auto-detects phones and low-power machines as performance', () => {
        expect(detectGraphicsTier({ mobile: true, deviceMemory: 8, cores: 8 })).toBe('performance');
        expect(detectGraphicsTier({ mobile: false, deviceMemory: 4, cores: 8 })).toBe('performance');
        expect(detectGraphicsTier({ mobile: false, deviceMemory: 8, cores: 4 })).toBe('performance');
    });

    it('auto-detects a capable machine as balanced, never quality', () => {
        expect(detectGraphicsTier({ mobile: false, deviceMemory: 8, cores: 16 })).toBe('balanced');
        // Unknown hints are treated as capable rather than crippling the visuals.
        expect(detectGraphicsTier({ mobile: false, deviceMemory: 0, cores: 0 })).toBe('balanced');
    });

    it('resolves a named preset to itself', () => {
        for (const preset of ['performance', 'balanced', 'quality'] as const) {
            expect(resolveGraphicsPreset(preset, { mobile: true, deviceMemory: 2, cores: 2 })).toBe(preset);
        }
        expect(resolveGraphicsPreset('auto', { mobile: true, deviceMemory: 8, cores: 8 })).toBe('performance');
    });
});
