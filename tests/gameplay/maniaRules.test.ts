import { describe, expect, it } from 'vitest';
import { buildManiaBeatmap } from '../../src/beatmap/mania';
import { parseOsu } from '../../src/beatmap/parser';
import { ManiaRules, maniaAutoEvents } from '../../src/gameplay/mania/ManiaRules';
import { NO_MODS } from '../../src/gameplay/mods';
import { HealthProcessor } from '../../src/gameplay/scoring/HealthProcessor';
import { ManiaScoreProcessor } from '../../src/gameplay/scoring/ManiaScoreProcessor';
import { MAP_MANIA } from '../beatmap/mania.test';

/**
 * Notes: 0@1000 col0, 1@1100 col1, 2@1200 col2, hold 3@1300–2000 col3. OD 8:
 * 16 / 40 / 73 / 103 / 127 ms windows, and the tail's are 1.5× those.
 */
function setup() {
    const beatmap = buildManiaBeatmap(parseOsu(MAP_MANIA), NO_MODS);
    const score = new ManiaScoreProcessor({ difficultyMultiplier: 4, modMultiplier: 1 });
    const health = new HealthProcessor({
        hpDifficulty: beatmap.difficulty.hp,
        breaks: beatmap.breaks,
        drainStart: beatmap.startTime,
        drainEnd: beatmap.endTime,
        noFail: true,
        mechanics: 'lazer',
        objects: beatmap.hitObjects,
        od: beatmap.difficulty.od,
        mania: true,
    });
    const rules = new ManiaRules(beatmap, NO_MODS, score, health, 'lazer');
    const log: string[] = [];
    rules.objectJudged.add(info => log.push(`${info.index}:${info.maniaNode}:${info.mania}`));
    return { beatmap, score, health, rules, log };
}

const tick = { x: 256, y: 192, held: false };

describe('osu!mania judgement', () => {
    it('scores a perfect tap and builds combo', () => {
        const s = setup();
        s.rules.update(1000, tick);
        s.rules.pressColumn(1000, 0);
        expect(s.rules.states[0].result).toBe('perfect');
        expect(s.score.count320).toBe(1);
        expect(s.score.combo).toBe(1);
        expect(s.log).toEqual(['0:head:perfect']);
        expect(s.rules.hitErrors).toEqual([0]);
    });

    it('grades by timing window', () => {
        const s = setup();
        // 50 ms early on the 1100 note: "good" (73 ms window, not 40).
        s.rules.update(1050, tick);
        s.rules.pressColumn(1050, 1);
        expect(s.rules.states[1].result).toBe('good');
        expect(s.score.count200).toBe(1);
        // 20 ms late on the 1200 note: "great" (40 ms window).
        s.rules.update(1220, tick);
        s.rules.pressColumn(1220, 2);
        expect(s.rules.states[2].result).toBe('great');
        expect(s.score.count300).toBe(1);
    });

    it('misses a note nobody pressed when its window closes', () => {
        const s = setup();
        s.rules.update(1000, tick);
        expect(s.rules.states[0].result).toBeNull();
        // The "meh" window is 127 ms at OD 8.
        s.rules.update(1128, tick);
        expect(s.rules.states[0].result).toBe('miss');
        expect(s.score.countMiss).toBe(1);
        expect(s.score.combo).toBe(0);
    });

    it('ignores presses in the wrong column', () => {
        const s = setup();
        s.rules.pressColumn(1100, 1);
        expect(s.rules.states[0].result).toBeNull();
        expect(s.rules.states[1].result).toBe('perfect');
    });

    it('jack: a second note in the same column follows the first', () => {
        const s = setup();
        s.rules.pressColumn(1000, 0);
        s.rules.pressColumn(1001, 0);
        expect(s.rules.states[0].result).toBe('perfect');
        // No other column-0 note for a while: nothing else was judged.
        expect(s.rules.states[3].result).toBeNull();
    });

    it('rejects a press far too early', () => {
        const s = setup();
        let shaken = -1;
        s.rules.shaken.add(i => { shaken = i; });
        s.rules.pressColumn(600, 0);
        expect(shaken).toBe(0);
        expect(s.rules.states[0].result).toBeNull();
    });
});

describe('osu!mania holds', () => {
    it('judges the head on the press and the tail on the release', () => {
        const s = setup();
        s.rules.update(1300, tick);
        s.rules.pressColumn(1310, 3);
        expect(s.rules.states[3].pressed).toBe(true);
        expect(s.rules.states[3].result).toBe('perfect');
        expect(s.rules.states[3].tailResult).toBeNull();
        expect(s.score.count320).toBe(1);
        s.rules.releaseColumn(2000, 3);
        expect(s.rules.states[3].tailResult).toBe('perfect');
        // A hold is two judgements: its head and its tail.
        expect(s.score.count320).toBe(2);
        expect(s.score.combo).toBe(2);
        expect(s.log.filter(e => e.startsWith('3:'))).toEqual(['3:head:perfect', '3:tail:perfect']);
        expect(s.rules.hitErrors).toEqual([10, 0]);
    });

    it('judges an early release by its distance from the tail', () => {
        const s = setup();
        s.rules.pressColumn(1300, 3);
        // 100 ms early is still within the lenient windows: 100 / 1.5 = 67 ms.
        s.rules.releaseColumn(1900, 3);
        expect(s.rules.states[3].tailResult).toBe('good');
        expect(s.rules.states[3].broken).toBe(false);
        expect(s.score.combo).toBe(2);
    });

    it('breaks a hold let go too early, and caps its tail at 50', () => {
        const s = setup();
        s.rules.pressColumn(1300, 3);
        s.rules.releaseColumn(1500, 3);
        expect(s.rules.states[3].broken).toBe(true);
        expect(s.rules.states[3].tailResult).toBeNull();
        // The body breaks the combo.
        expect(s.score.combo).toBe(0);
        // Picking the hold back up and releasing on time can only score a 50.
        s.rules.pressColumn(1800, 3);
        s.rules.releaseColumn(2000, 3);
        expect(s.rules.states[3].tailResult).toBe('meh');
        expect(s.score.count50).toBe(1);
    });

    it('misses a hold never pressed, head and tail', () => {
        const s = setup();
        // The head misses once its 127 ms window closes.
        s.rules.update(1440, tick);
        expect(s.rules.states[3].result).toBe('miss');
        expect(s.rules.states[3].tailResult).toBeNull();
        // The tail's lenient window is 1.5 × 188 ms after it.
        s.rules.update(2300, tick);
        expect(s.rules.states[3].tailResult).toBe('miss');
        // The three taps missed too.
        expect(s.score.countMiss).toBe(5);
    });

    it('lets a press during the body pick up a hold whose head was missed', () => {
        const s = setup();
        s.rules.update(1440, tick);
        expect(s.rules.states[3].result).toBe('miss');
        // Pressing the column mid-hold re-attaches it (lazer allows this).
        s.rules.pressColumn(1600, 3);
        expect(s.rules.states[3].pressed).toBe(true);
        s.rules.releaseColumn(2000, 3);
        expect(s.rules.states[3].tailResult).toBe('meh');
    });

    it('misses a tail still held when its window closes', () => {
        const s = setup();
        s.rules.pressColumn(1300, 3);
        s.rules.update(2300, tick);
        expect(s.rules.states[3].tailResult).toBe('miss');
        expect(s.rules.states[3].pressed).toBe(false);
        expect(s.score.count320).toBe(1);
        // The tail, plus the three taps nobody pressed.
        expect(s.score.countMiss).toBe(4);
    });

    it('a pause lets go of a hold without breaking it', () => {
        const s = setup();
        s.rules.pressColumn(1300, 3);
        s.rules.resetSpinnerTracking();
        expect(s.rules.states[3].holding).toBe(false);
        expect(s.rules.states[3].broken).toBe(false);
        expect(s.score.combo).toBe(1);
        // The key pressed again after the pause resumes the hold.
        s.rules.pressColumn(1700, 3);
        s.rules.releaseColumn(2000, 3);
        expect(s.rules.states[3].tailResult).toBe('perfect');
        expect(s.score.combo).toBe(2);
    });
});

describe('osu!mania autoplay', () => {
    it('presses and releases every note to a full combo', () => {
        const s = setup();
        const events = maniaAutoEvents(s.beatmap);
        expect(events).toHaveLength(8);
        expect(events[0]).toEqual({ time: 1000, column: 0, down: true });
        for (let t = 900; t <= 2200; t += 10) {
            s.rules.update(t, tick);
            for (const e of events) {
                if (e.time > t - 10 && e.time <= t) {
                    if (e.down) s.rules.pressColumn(e.time, e.column);
                    else s.rules.releaseColumn(e.time, e.column);
                }
            }
        }
        s.rules.update(2300, tick);
        expect(s.rules.finished).toBe(true);
        expect(s.score.countMiss).toBe(0);
        // Three taps, plus the hold's head and tail.
        expect(s.score.count320).toBe(5);
        expect(s.score.maxCombo).toBe(5);
        expect(s.score.accuracy).toBe(1);
    });
});

/** A 2K map: a hold in column 0 ending exactly where the next note starts. */
export const MAP_MANIA_JACK = `osu file format v14
[General]
AudioFilename: song.ogg
Mode: 3
[Metadata]
Title:Jack
Artist:A
Creator:C
Version:2K
BeatmapID:3
BeatmapSetID:30
[Difficulty]
HPDrainRate:7
CircleSize:2
OverallDifficulty:8
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
64,192,1000,128,0,2000:0:0:0:0:
64,192,2000,1,0,0:0:0:0:
320,192,2100,1,0,0:0:0:0:
`;

describe('osu!mania hold tails', () => {
    function setupJack() {
        const beatmap = buildManiaBeatmap(parseOsu(MAP_MANIA_JACK), NO_MODS);
        const score = new ManiaScoreProcessor({ difficultyMultiplier: 4, modMultiplier: 1 });
        const health = new HealthProcessor({
            hpDifficulty: beatmap.difficulty.hp,
            breaks: beatmap.breaks,
            drainStart: beatmap.startTime,
            drainEnd: beatmap.endTime,
            noFail: true,
            mechanics: 'lazer',
            objects: beatmap.hitObjects,
            od: beatmap.difficulty.od,
            mania: true,
        });
        return { beatmap, score, rules: new ManiaRules(beatmap, NO_MODS, score, health, 'lazer') };
    }

    it('lets a note start where the hold in its column ends', () => {
        const s = setupJack();
        s.rules.update(1000, tick);
        s.rules.pressColumn(1000, 0);
        s.rules.update(2000, tick);
        expect(s.rules.states[0].result).toBe('perfect');
        // The tail's release and the next note's press, same moment, same column.
        s.rules.releaseColumn(2000, 0);
        s.rules.pressColumn(2000, 0);
        expect(s.rules.states[0].tailResult).toBe('perfect');
        expect(s.rules.states[1].result).toBe('perfect');
        s.rules.releaseColumn(2040, 0);
        s.rules.pressColumn(2100, 1);
        s.rules.update(2200, tick);
        expect(s.rules.states[2].result).toBe('perfect');
        expect(s.score.count320).toBe(4);
        expect(s.score.countMiss).toBe(0);
    });

    it('autoplay clears the hold before pressing the jack', () => {
        const s = setupJack();
        const events = maniaAutoEvents(s.beatmap);
        for (let t = 900; t <= 2300; t += 8) {
            s.rules.update(t, tick);
            for (const e of events) {
                if (e.time > t - 8 && e.time <= t) {
                    if (e.down) s.rules.pressColumn(e.time, e.column);
                    else s.rules.releaseColumn(e.time, e.column);
                }
            }
        }
        expect(s.rules.finished).toBe(true);
        expect(s.score.countMiss).toBe(0);
        // The hold's head, its tail, then the two taps.
        expect(s.score.maxCombo).toBe(4);
    });
});
