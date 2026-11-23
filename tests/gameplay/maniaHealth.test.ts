import { describe, expect, it } from 'vitest';
import { buildManiaBeatmap } from '../../src/beatmap/mania';
import { parseOsu } from '../../src/beatmap/parser';
import { NO_MODS } from '../../src/gameplay/mods';
import { HealthProcessor } from '../../src/gameplay/scoring/HealthProcessor';
import { MAP_MANIA } from '../beatmap/mania.test';

/** HP 7: a miss costs (7 + 1) · 0.0075 = 0.06, a 50 costs (7 + 1) · 0.0016. */
function setup() {
    const beatmap = buildManiaBeatmap(parseOsu(MAP_MANIA), NO_MODS);
    const health = new HealthProcessor({
        hpDifficulty: beatmap.difficulty.hp,
        breaks: beatmap.breaks,
        drainStart: beatmap.startTime,
        drainEnd: beatmap.endTime,
        mechanics: 'lazer',
        objects: beatmap.hitObjects,
        od: beatmap.difficulty.od,
        mania: true,
    });
    return { beatmap, health };
}

describe('osu!mania health', () => {
    it('never drains on its own', () => {
        const { health } = setup();
        expect(health.drainRate).toBe(0);
        // Ten seconds of play with no judgements at all.
        for (let t = 1000; t <= 11000; t += 16) health.drain(t, 16);
        expect(health.hp).toBe(1);
        expect(health.failed).toBe(false);
    });

    it("uses lazer's mania judgement deltas", () => {
        const { health } = setup();
        health.applyMania('perfect');
        expect(health.hp).toBe(1); // capped
        health.applyMania('meh');
        expect(health.hp).toBeCloseTo(1 - 8 * 0.0016, 12);
        // 100 is neutral in mania.
        const before = health.hp;
        health.applyMania('ok');
        expect(health.hp).toBe(before);
    });

    it('survives a miss streak that would fail an osu!standard player', () => {
        const { health } = setup();
        for (let i = 0; i < 16; i++) health.applyMania('miss');
        expect(health.hp).toBeCloseTo(1 - 16 * 0.06, 12);
        expect(health.failed).toBe(false);
        // The seventeenth empties it.
        health.applyMania('miss');
        expect(health.hp).toBe(0);
        expect(health.failed).toBe(true);
    });

    it("recovers with hits, as mania's gains are per judgement", () => {
        const { health } = setup();
        for (let i = 0; i < 5; i++) health.applyMania('miss');
        const low = health.hp;
        // HP 7: a 320 gains 0.0055 − 0.0035 = 0.002, so recovery is gradual.
        for (let i = 0; i < 200; i++) health.applyMania('perfect');
        expect(health.hp).toBe(1);
        expect(low).toBeCloseTo(0.7, 12);
    });

    it('charges a missed hold as one note (its head and tail together)', () => {
        const { health } = setup();
        health.applyMania('miss', true);
        health.applyMania('miss', true);
        // 2 × (7 + 1) · 0.00375 = (7 + 1) · 0.0075, the same as one note's miss.
        expect(health.hp).toBeCloseTo(1 - 8 * 0.0075, 12);
    });
});
