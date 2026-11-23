/**
 * osu!mania (mode 3) support: the playable beatmap and its difficulty.
 *
 * A mania difficulty stores its key count as CircleSize (4K, 5K, 7K…),
 * and every hit object is a note or a hold (osu!'s type 128) whose `x`
 * locates the column. Processing is much simpler than standard's: no
 * paths, stacking or combo colours — just the column mapping and the
 * judgement windows.
 *
 * The star rating here is a local estimate (there is no offline port of
 * the mania strain model): it follows note density, chord size, column
 * movement and hold usage, which ranks typical maps sensibly. Mirrors'
 * official ratings replace it when available.
 */
import { adjustDifficulty, NO_MODS, type ModSet } from '../gameplay/mods';
import { buildControlPointTimeline } from './controlPoints';
import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from './processing';
import type {
    BeatmapData,
    DifficultyAttributes,
    ManiaDifficultyAttributes,
    PlayableCircle,
    PlayableManiaBeatmap,
    PlayableManiaNote,
} from './types';

/** How long a note takes to cross the field (lazer's mania scroll time at 1×). */
export const MANIA_SCROLL_TIME = 1148.5;
/** The judgement line sits this far above the field's bottom edge. */
export const MANIA_JUDGEMENT_OFFSET = 78;
/** Highest key count osu!mania supports. */
export const MANIA_MAX_KEYS = 18;

/** Key count from CircleSize (integer in every real map). */
export function maniaKeys(cs: number): number {
    return Math.max(1, Math.min(MANIA_MAX_KEYS, Math.round(cs) || 1));
}

/** The column an object's raw x belongs to. */
export function maniaColumnFor(x: number, keys: number): number {
    return Math.max(0, Math.min(keys - 1, Math.floor((x * keys) / PLAYFIELD_WIDTH)));
}

/** lazer's ManiaHitWindows: a fixed 320 window, the rest scaled by OD. */
export function maniaHitWindows(od: number): Pick<ManiaDifficultyAttributes,
    'windowPerfect' | 'windowGreat' | 'windowGood' | 'windowOk' | 'windowMeh' | 'windowMiss'> {
    return {
        windowPerfect: 16,
        windowGreat: Math.max(22.4, 64 - 3 * od),
        windowGood: Math.max(19.4, 97 - 3 * od),
        windowOk: Math.max(13.9, 127 - 3 * od),
        windowMeh: Math.max(8.3, 151 - 3 * od),
        windowMiss: Math.max(2.5, 188 - 3 * od),
    };
}

export function maniaDifficultyAttributes(keys: number, od: number, hp: number): ManiaDifficultyAttributes & DifficultyAttributes {
    const windows = maniaHitWindows(od);
    const columnWidth = PLAYFIELD_WIDTH / keys;
    return {
        keys,
        od,
        hp,
        columnWidth,
        scrollTime: MANIA_SCROLL_TIME,
        ...windows,
        // Standard-shaped fields for the shared Player code (HUD, layout).
        cs: keys,
        ar: 5,
        circleRadius: columnWidth / 2,
        preempt: MANIA_SCROLL_TIME,
        fadeIn: MANIA_SCROLL_TIME * 0.4,
        window300: windows.windowGreat,
        window100: windows.windowOk,
        window50: windows.windowMeh,
        stackOffset: 0,
    };
}

/** Column centre in playfield units. */
export function maniaColumnX(column: number, keys: number): number {
    return ((column + 0.5) * PLAYFIELD_WIDTH) / keys;
}

/** The y of the judgement line. */
export const MANIA_JUDGEMENT_Y = PLAYFIELD_HEIGHT - MANIA_JUDGEMENT_OFFSET;

/**
 * BeatmapData + mods -> PlayableManiaBeatmap. Hard Rock/Easy and Difficulty
 * Adjust change OD/HP; the key count (CS) never changes.
 */
export function buildManiaBeatmap(data: BeatmapData, mods: ModSet): PlayableManiaBeatmap {
    const raw = data.difficulty;
    const adjusted = adjustDifficulty(
        { cs: raw.circleSize, ar: raw.approachRate, od: raw.overallDifficulty, hp: raw.hpDrainRate },
        mods,
    );
    const keys = maniaKeys(raw.circleSize);
    const difficulty = maniaDifficultyAttributes(keys, adjusted.od, adjusted.hp);
    const timeline = buildControlPointTimeline(data.timingPoints, data.general.sampleSet);

    const notes: PlayableManiaNote[] = [];
    for (let i = 0; i < data.hitObjects.length; i++) {
        const o = data.hitObjects[i];
        if (o.kind !== 'mania') continue;
        const column = maniaColumnFor(o.x, keys);
        notes.push({
            index: notes.length,
            column,
            time: o.time,
            endTime: o.isHold ? Math.max(o.endTime ?? o.time, o.time) : o.time,
            isHold: !!o.isHold,
            x: maniaColumnX(column, keys),
            y: MANIA_JUDGEMENT_Y,
            hitSound: o.hitSound,
            hitSample: o.hitSample,
        });
    }
    notes.sort((a, b) => a.time - b.time || a.column - b.column);
    for (let i = 0; i < notes.length; i++) notes[i].index = i;

    let startTime = 0;
    let endTime = 0;
    if (notes.length > 0) {
        startTime = notes[0].time;
        for (const n of notes) if (n.endTime > endTime) endTime = n.endTime;
    }

    // The standard-compatible view: one circle per note (holds end at their
    // tail). Only the shared HUD / hitsound / timing code reads it.
    const hitObjects: PlayableCircle[] = notes.map(n => ({
        kind: 'circle',
        index: n.index,
        x: n.x,
        y: n.y,
        time: n.time,
        endTime: n.endTime,
        stackHeight: 0,
        newCombo: false,
        comboNumber: 0,
        comboColorIndex: 0,
        lastInCombo: false,
        hitSound: n.hitSound,
        hitSample: n.hitSample,
        control: timeline.at(n.time),
    }));

    return {
        data,
        difficulty,
        notes,
        keys,
        hitObjects,
        comboColors: data.comboColors,
        startTime,
        endTime,
        breaks: data.events.breaks.map(b => ({ startTime: b.startTime, endTime: b.endTime })),
        controlPoints: timeline,
    };
}

// ---------------------------------------------------------------------------
// Star rating (local estimate)
// ---------------------------------------------------------------------------

interface Row {
    time: number;
    /** Column of every note in the row, in order. */
    columns: number[];
}

/** Notes sharing a time (within this) form one chord row. */
const ROW_TOLERANCE = 3;
/** The density window is ±this many ms (a 1 s window). */
const DENSITY_WINDOW = 500;

function rowsOf(notes: readonly PlayableManiaNote[]): Row[] {
    const rows: Row[] = [];
    for (const n of notes) {
        const last = rows[rows.length - 1];
        if (last && n.time - last.time <= ROW_TOLERANCE) {
            last.columns.push(n.column);
        } else {
            rows.push({ time: n.time, columns: [n.column] });
        }
    }
    return rows;
}

/**
 * A density-and-movement based star estimate: rows per second around each
 * note, weighted by chord size, column travel and hold usage, averaged
 * over the hardest sections (a 500 ms section length, peaks weighted).
 */
export function maniaStarRating(notes: readonly PlayableManiaNote[], keys: number): number {
    if (notes.length < 2) return 0;
    const rows = rowsOf(notes);
    if (rows.length < 2) return 0;

    // Notes per row: chord sizes count toward difficulty.
    const secValues: number[] = [];
    let sectionEnd = Math.ceil(rows[0].time / 500) * 500;
    let sectionSum = 0;
    let sectionCount = 0;
    let lo = 0;
    let hi = 0;
    let windowNotes = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        while (hi < rows.length && rows[hi].time <= row.time + DENSITY_WINDOW) {
            windowNotes += rows[hi].columns.length;
            hi++;
        }
        while (rows[lo].time < row.time - DENSITY_WINDOW) {
            windowNotes -= rows[lo].columns.length;
            lo++;
        }
        const chord = row.columns.length;
        // Column travel from the previous row's nearest note (jacks are easier).
        let travel = 0;
        if (i > 0) {
            let best = Infinity;
            for (const c of row.columns) for (const p of rows[i - 1].columns) best = Math.min(best, Math.abs(c - p));
            travel = Number.isFinite(best) ? best : 0;
        }
        const travelFactor = 0.9 + 0.12 * (travel / Math.max(1, keys - 1));
        // The window's notes per second (chords included) is the density.
        const density = windowNotes * (1000 / (2 * DENSITY_WINDOW));
        const value = density * (0.72 + 0.28 * chord) * travelFactor;
        sectionSum += value;
        sectionCount++;
        while (row.time > sectionEnd) {
            secValues.push(sectionCount ? sectionSum / sectionCount : 0);
            sectionSum = 0;
            sectionCount = 0;
            sectionEnd += 500;
        }
    }
    if (sectionCount) secValues.push(sectionSum / sectionCount);
    secValues.sort((a, b) => b - a);
    // Top-weighted mean of the section values (the hardest stretches dominate).
    let total = 0, weight = 1, used = 0;
    for (const v of secValues) {
        total += v * weight;
        used += weight;
        weight *= 0.9;
    }
    const value = used > 0 ? total / used : 0;
    // Calibrated against typical maps: ~12 notes/s streams land near 4★.
    return Math.round(Math.min(12, Math.pow(value / 2.9, 0.95)) * 100) / 100;
}

/**
 * Total combo a mania map can give: one per note, and two per hold (its
 * head and its tail are judged separately, as in lazer).
 */
export function maniaMaxCombo(notes: readonly PlayableManiaNote[]): number {
    let combo = notes.length;
    for (const n of notes) if (n.isHold) combo++;
    return combo;
}

/** Convenience for callers that have decoded data: the local star estimate. */
export function calculateManiaStars(data: BeatmapData, mods: ModSet | null = null): number {
    const beatmap = buildManiaBeatmap(data, mods ?? NO_MODS);
    let holdRatio = 0;
    for (const n of beatmap.notes) if (n.isHold) holdRatio++;
    const base = maniaStarRating(beatmap.notes, beatmap.keys);
    // Holds are easier per object but longer; a small bonus matches the model's feel.
    return Math.round(base * (1 + 0.04 * (holdRatio / Math.max(1, beatmap.notes.length))) * 100) / 100;
}
