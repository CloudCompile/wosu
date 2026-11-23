import { describe, expect, it } from 'vitest';
import { Bindable, BindableNumber } from '../../src/core/Bindable';
import {
    applyGraphicsTier, applyGraphicsValues, graphicsTierValues, TIERS, type GraphicsPresetTarget,
} from '../../src/settings/GraphicsPreset';
import { valuesForTiers } from '../../src/settings/deviceTiers';

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

    it('the balanced tier is wosu!\'s default look', () => {
        const defaults = target();
        const s = target();
        applyGraphicsTier(s, 'balanced');
        for (const key of Object.keys(TIERS.balanced) as (keyof typeof TIERS.balanced)[]) {
            expect(s[key].value, key).toBe(defaults[key].value);
        }
    });

    it('applies explicit values, like the benchmark\'s recommendation', () => {
        const s = target();
        applyGraphicsValues(s, { ...TIERS.performance, resolutionScale: 0.85, antialias: true });
        expect(s.resolutionScale.value).toBe(0.85);
        expect(s.antialias.value).toBe(true);
        expect(s.storyboard.value).toBe(false);
    });

    it('keeps a capable machine on the balanced look', () => {
        // The default must not spend frames on eye candy, even on fast hardware.
        const s = target();
        applyGraphicsValues(s, valuesForTiers({ cpu: 'high', gpu: 'high' }));
        const defaults = target();
        for (const key of Object.keys(TIERS.balanced) as (keyof typeof TIERS.balanced)[]) {
            expect(s[key].value, key).toBe(defaults[key].value);
        }
    });
});
