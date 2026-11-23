import { describe, expect, it } from 'vitest';
import { ManiaScoreProcessor } from '../../src/gameplay/scoring/ManiaScoreProcessor';
import type { ManiaJudgement } from '../../src/gameplay/scoring/ScoreProcessor';

function setup() {
    return new ManiaScoreProcessor({ difficultyMultiplier: 4, modMultiplier: 1 });
}

describe('ManiaScoreProcessor', () => {
    it('counts each tier and builds combo from every hit', () => {
        const s = setup();
        const all: ManiaJudgement[] = ['perfect', 'great', 'good', 'ok', 'meh', 'miss'];
        for (const r of all) s.apply(r);
        expect(s.counts()).toEqual({ 320: 1, 300: 1, 200: 1, 100: 1, 50: 1, miss: 1 });
        expect(s.combo).toBe(0);
        expect(s.maxCombo).toBe(5);
        expect(s.judgedCount).toBe(6);
        s.apply('perfect');
        expect(s.combo).toBe(1);
        expect(s.maxCombo).toBe(5);
    });

    it("computes lazer's mania accuracy (/320 per judgement)", () => {
        const s = setup();
        s.apply('perfect');
        expect(s.accuracy).toBe(1);
        s.apply('great'); // (320 + 300) / 640
        expect(s.accuracy).toBeCloseTo(620 / 640, 12);
        s.apply('miss');
        expect(s.accuracy).toBeCloseTo(620 / 960, 12);
        // A map nobody has hit yet reads as full accuracy.
        expect(setup().accuracy).toBe(1);
    });

    it('grades with the shared lazer cutoffs', () => {
        const s = setup();
        for (let i = 0; i < 10; i++) s.apply('perfect');
        expect(s.grade(false)).toBe('X');
        expect(s.grade(true)).toBe('XH');
        const oneMiss = setup();
        for (let i = 0; i < 10; i++) oneMiss.apply(i === 0 ? 'miss' : 'perfect');
        // 90% accuracy, and a miss knocks the rank off SS anyway.
        expect(oneMiss.grade(false)).toBe('A');
        const lowAcc = setup();
        for (let i = 0; i < 10; i++) lowAcc.apply(i < 9 ? 'perfect' : 'meh');
        expect(lowAcc.accuracy).toBeCloseTo((2880 + 50) / 3200, 12);
        expect(lowAcc.grade(false)).toBe('A');
    });

    it('scores more for higher combos and multipliers', () => {
        const flat = new ManiaScoreProcessor({ difficultyMultiplier: 0, modMultiplier: 1 });
        flat.apply('perfect');
        flat.apply('perfect');
        expect(flat.score).toBe(640);
        const scaled = setup();
        // value + value · (combo − 1) · difficulty · mod / 25
        scaled.apply('perfect');
        scaled.apply('perfect');
        scaled.apply('perfect');
        expect(scaled.score).toBe(320 * 3 + (320 * 1 * 4) / 25);
    });

    it('reports its per-tier ratios', () => {
        const s = setup();
        s.apply('perfect');
        s.apply('miss');
        const r = s.ratios();
        expect(r.perfect).toBe(0.5);
        expect(r.miss).toBe(0.5);
        expect(r.great).toBe(0);
    });
});
