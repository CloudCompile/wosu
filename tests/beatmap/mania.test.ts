import { describe, expect, it } from 'vitest';
import {
    buildManiaBeatmap, calculateManiaStars, maniaColumnFor, maniaColumnX, maniaHitWindows, maniaKeys,
    maniaMaxCombo, maniaStarRating, MANIA_JUDGEMENT_Y,
} from '../../src/beatmap/mania';
import { parseOsu } from '../../src/beatmap/parser';
import { NO_MODS, sanitizeMods } from '../../src/gameplay/mods';

/** A 4K map: three taps in columns 0–2 and one hold in column 3. */
export const MAP_MANIA = `osu file format v14
[General]
AudioFilename: song.ogg
Mode: 3
[Metadata]
Title:Mania
Artist:A
Creator:C
Version:4K
BeatmapID:2
BeatmapSetID:20
[Difficulty]
HPDrainRate:7
CircleSize:4
OverallDifficulty:8
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1100,1,0,0:0:0:0:
320,192,1200,1,0,0:0:0:0:
448,192,1300,128,0,2000:0:0:0:0:
`;

describe('osu!mania parsing', () => {
    it('keeps notes and holds with their hit samples', () => {
        const map = parseOsu(MAP_MANIA);
        expect(map.general.mode).toBe(3);
        expect(map.hitObjects.map(h => h.kind)).toEqual(['mania', 'mania', 'mania', 'mania']);
        const hold = map.hitObjects[3];
        expect(hold.isHold).toBe(true);
        expect(hold.endTime).toBe(2000);
        expect(hold.hitSound).toBe(0);
        expect(map.hitObjects[0].isHold).toBeUndefined();
    });

    it('drops standard objects from a mania map', () => {
        const map = parseOsu(MAP_MANIA.replace('64,192,1000,1,0,0:0:0:0:', '64,192,1000,2,0,L|100:192,1,50'));
        expect(map.hitObjects.every(h => h.kind === 'mania')).toBe(true);
    });
});

describe('mania columns and difficulty', () => {
    it('maps x to a column across the field', () => {
        expect(maniaColumnFor(0, 4)).toBe(0);
        expect(maniaColumnFor(127, 4)).toBe(0);
        expect(maniaColumnFor(128, 4)).toBe(1);
        expect(maniaColumnFor(511, 4)).toBe(3);
        expect(maniaColumnFor(-50, 4)).toBe(0);
        expect(maniaColumnFor(9999, 4)).toBe(3);
        expect(maniaColumnFor(256, 7)).toBe(3);
    });

    it('derives the key count from CircleSize', () => {
        expect(maniaKeys(4)).toBe(4);
        expect(maniaKeys(7)).toBe(7);
        expect(maniaKeys(0)).toBe(1);
        expect(maniaKeys(99)).toBe(18);
        expect(maniaKeys(4.4)).toBe(4);
    });

    it("uses lazer's mania hit windows", () => {
        const w = maniaHitWindows(8);
        expect(w.windowPerfect).toBe(16);
        expect(w.windowGreat).toBe(40);
        expect(w.windowGood).toBe(73);
        expect(w.windowOk).toBe(103);
        expect(w.windowMeh).toBe(127);
        expect(w.windowMiss).toBe(164);
        // Clamped at OD 10.
        expect(maniaHitWindows(10).windowGreat).toBeCloseTo(34, 6);
    });

    it('builds the playable notes and a standard-shaped view', () => {
        const beatmap = buildManiaBeatmap(parseOsu(MAP_MANIA), NO_MODS);
        expect(beatmap.keys).toBe(4);
        expect(beatmap.difficulty.columnWidth).toBe(128);
        expect(beatmap.difficulty.cs).toBe(4);
        expect(beatmap.notes.map(n => n.column)).toEqual([0, 1, 2, 3]);
        expect(beatmap.notes[3].isHold).toBe(true);
        expect(beatmap.notes[3].endTime).toBe(2000);
        expect(beatmap.notes[0].y).toBe(MANIA_JUDGEMENT_Y);
        expect(beatmap.notes[3].x).toBe(maniaColumnX(3, 4));
        // The compatibility view: one circle per note, the hold ending at its tail.
        expect(beatmap.hitObjects).toHaveLength(4);
        expect(beatmap.hitObjects.every(h => h.kind === 'circle')).toBe(true);
        expect(beatmap.hitObjects[3].endTime).toBe(2000);
        expect(beatmap.hitObjects[0].control).toBeDefined();
        expect(beatmap.startTime).toBe(1000);
        expect(beatmap.endTime).toBe(2000);
        // Four notes, and the hold is judged twice (head and tail).
        expect(maniaMaxCombo(beatmap.notes)).toBe(5);
    });

    it('applies Hard Rock and Difficulty Adjust to OD', () => {
        const data = parseOsu(MAP_MANIA);
        const nomod = buildManiaBeatmap(data, NO_MODS);
        const hr = buildManiaBeatmap(data, sanitizeMods(['HR']));
        expect(hr.keys).toBe(4);
        // HR raises OD 8 to 10: the windows get tighter.
        expect(hr.difficulty.od).toBeCloseTo(10, 6);
        expect(hr.difficulty.windowGreat).toBeLessThan(nomod.difficulty.windowGreat);
    });
});

describe('mania star estimate', () => {
    it('rates denser maps higher', () => {
        const sparse = buildManiaBeatmap(parseOsu(MAP_MANIA), NO_MODS);
        const dense = buildManiaBeatmap(parseOsu(MAP_MANIA.replace(
            /\[HitObjects\][\s\S]*$/,
            '[HitObjects]\n' + Array.from({ length: 200 }, (_, i) => {
                const x = (i % 4) * 128 + 64;
                return `${x},192,${1000 + i * 60},1,0,0:0:0:0:`;
            }).join('\n') + '\n',
        )), NO_MODS);
        expect(maniaStarRating(dense.notes, 4)).toBeGreaterThan(maniaStarRating(sparse.notes, 4));
        expect(calculateManiaStars(parseOsu(MAP_MANIA))).toBeGreaterThan(0);
    });

    it('has no rating for an empty map', () => {
        const empty = buildManiaBeatmap(parseOsu(MAP_MANIA.replace(/\[HitObjects\][\s\S]*$/, '[HitObjects]\n')), NO_MODS);
        expect(maniaStarRating(empty.notes, 4)).toBe(0);
    });
});
