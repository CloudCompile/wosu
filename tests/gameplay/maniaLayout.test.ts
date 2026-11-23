import { describe, expect, it } from 'vitest';
import {
    MANIA_KEY_COUNTS,
    MANIA_UNBOUND_LABEL,
    maniaDefaultLayout,
    maniaKeyLabels,
    maniaKeyLayout,
    maniaOverrideFor,
    sanitizeManiaKeys,
} from '../../src/gameplay/mania/layout';

describe('osu!mania column layouts', () => {
    it('gives every key count 1–10 a full default layout', () => {
        for (const keys of MANIA_KEY_COUNTS) {
            const layout = maniaDefaultLayout(keys);
            expect(layout).toHaveLength(keys);
            // No key plays two columns.
            expect(new Set(layout).size).toBe(keys);
        }
        expect(maniaDefaultLayout(4)).toEqual(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
    });

    it('uses the saved layout where there is one, the defaults otherwise', () => {
        const overrides = { 4: ['KeyA', 'KeyS', '', 'KeyL'] };
        expect(maniaKeyLayout(4, overrides)).toEqual(['KeyA', 'KeyS', '', 'KeyL']);
        expect(maniaKeyLayout(7, overrides)).toEqual(maniaDefaultLayout(7));
        // A short saved array leaves the remaining columns on their defaults.
        expect(maniaKeyLayout(4, { 4: ['KeyA'] })[3]).toBe('KeyK');
    });

    it('labels a column with its key, and an unbound one with a dash', () => {
        expect(maniaKeyLabels(4, { 4: ['KeyA', '', 'KeyJ', 'Semicolon'] }))
            .toEqual(['A', MANIA_UNBOUND_LABEL, 'J', ';']);
    });

    it('only stores layouts that differ from the stock one', () => {
        expect(maniaOverrideFor(4, maniaDefaultLayout(4))).toBeNull();
        expect(maniaOverrideFor(4, ['KeyA', 'KeyS', 'KeyK', 'KeyL'])).toEqual(['KeyA', 'KeyS', 'KeyK', 'KeyL']);
    });

    it('cleans saved settings: unknown counts and bad codes are dropped', () => {
        expect(sanitizeManiaKeys(null)).toEqual({});
        expect(sanitizeManiaKeys({ 0: ['KeyA'], 99: ['KeyA'], nope: ['KeyA'] })).toEqual({});
        // A default layout is not stored.
        expect(sanitizeManiaKeys({ 4: maniaDefaultLayout(4) })).toEqual({});
        // Bad codes fall back to the default; a duplicate key unbinds the later column.
        expect(sanitizeManiaKeys({ 4: [42, 'KeyF', 'KeyF', 'KeyK'] }))
            .toEqual({ 4: ['KeyD', 'KeyF', '', 'KeyK'] });
    });
});
