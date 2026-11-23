import type { PlayableManiaBeatmap, PlayableManiaNote, SliderEvent } from '../../beatmap/types';
import { Signal } from '../../core/Signal';
import type { CursorState, HitEventInfo, JudgementRules } from '../GameplayRules';
import type { ModSet } from '../mods';
import type { HealthProcessor } from '../scoring/HealthProcessor';
import {
    MANIA_AS_HIT_RESULT, maniaResultForError, type HitResult, type ManiaJudgement,
} from '../scoring/ScoreProcessor';
import type { ManiaScoreProcessor } from '../scoring/ManiaScoreProcessor';
import type { GameplayMechanics } from '../scoring/mechanics';

/** lazer's TailNote.RELEASE_WINDOW_LENIENCE: a hold's tail windows are 1.5× the note's. */
export const MANIA_TAIL_LENIENCE = 1.5;

/** One note's judgement state (what the renderer and HUD read). */
export interface ManiaNoteState {
    /** The head's judgement (a tap's only judgement); null while it is unjudged. */
    result: ManiaJudgement | null;
    judgedAt: number;
    /** A hold's tail judgement (holds only); null while the tail is pending. */
    tailResult: ManiaJudgement | null;
    tailJudgedAt: number;
    /** A hold's key is down. */
    pressed: boolean;
    holding: boolean;
    /** A hold was let go early or its head missed: its tail can no longer score above 50. */
    broken: boolean;
}

const EMPTY_STATE = (): ManiaNoteState => ({
    result: null, judgedAt: 0, tailResult: null, tailJudgedAt: 0, pressed: false, holding: false, broken: false,
});

/**
 * The osu!mania rules, separate from rendering so they can be tested
 * headlessly. Each column keeps its notes in time order; a press judges
 * that column's earliest unjudged head by its timing.
 *
 * A hold (type 128) is judged as lazer judges it, as two notes:
 *  - its head is a normal note (judged on the press, missed when its 50
 *    window closes unplayed);
 *  - its tail is a note at the tail's time, judged when the key comes up
 *    (windowed by the release's distance from the tail, with lazer's 1.5×
 *    release lenience), and missed if the key is still down when that
 *    lenient window closes.
 * Letting go before the tail's window, or missing the head, breaks the
 * hold: the combo breaks (lazer's HoldNoteBody) and the tail can score no
 * more than a 50 (lazer's capped tail result). A key pressed again while
 * the hold is still live picks it back up, so a slipped finger costs the
 * combo and the tail's top windows, not a miss.
 *
 * Both judgements count for score, accuracy and combo, so a hold is worth
 * two (as in lazer); `maniaMaxCombo` counts it twice for the same reason.
 *
 * The windows are lazer's mania ones (16 ms for 320, then 64−3·OD down to
 * 151−3·OD for 50).
 */
export class ManiaRules implements JudgementRules {
    readonly states: ManiaNoteState[];
    readonly objectJudged = new Signal<[HitEventInfo]>();
    /** Never emitted by mania (no sliders); present for the shared rule interface. */
    readonly nestedJudged = new Signal<[number, SliderEvent, boolean]>();
    readonly headHit = new Signal<[number, number, number]>();
    readonly shaken = new Signal<[number]>();
    readonly spun = new Signal<[number, boolean]>();
    readonly hitErrors: number[] = [];
    readonly mechanics: GameplayMechanics;

    /** Per-column queues of note indices (time order). */
    private readonly columns: number[][];
    /** Index into `columns[c]` of that column's first note whose head is unjudged. */
    private readonly next: number[];
    /** Per column: the hold whose key is down (note index), or -1. */
    private readonly holding: number[];
    /** Per column: a live hold the key can pick back up (broken, or its head missed), or -1. */
    private readonly recoverable: number[];
    /** Every hold's note index, by tail time (the tail sweep's queue). */
    private readonly tails: number[];
    private tailNext = 0;
    private readonly suddenDeath: boolean;
    private readonly perfect: boolean;
    private lastTime = -Infinity;

    constructor(
        readonly beatmap: PlayableManiaBeatmap,
        mods: ModSet,
        readonly score: ManiaScoreProcessor,
        readonly health: HealthProcessor,
        mechanics: GameplayMechanics = 'lazer',
    ) {
        this.mechanics = mechanics;
        this.suddenDeath = mods.has('SD');
        this.perfect = mods.has('PF');
        this.states = this.beatmap.notes.map(EMPTY_STATE);
        this.columns = Array.from({ length: this.beatmap.keys }, () => []);
        this.holding = new Array(this.beatmap.keys).fill(-1);
        this.recoverable = new Array(this.beatmap.keys).fill(-1);
        const tails: number[] = [];
        for (let i = 0; i < this.beatmap.notes.length; i++) {
            const n = this.beatmap.notes[i];
            this.columns[n.column].push(i);
            if (n.isHold) tails.push(i);
        }
        tails.sort((a, b) => this.beatmap.notes[a].endTime - this.beatmap.notes[b].endTime);
        this.tails = tails;
        this.next = new Array(this.beatmap.keys).fill(0);
        score.comboBroken.add(() => {
            if (this.suddenDeath || this.perfect) health.fail();
        });
    }

    get windows(): { w300: number; w100: number; w50: number } {
        const d = this.beatmap.difficulty;
        return { w300: d.windowGreat, w100: d.windowOk, w50: d.windowMeh };
    }

    get finished(): boolean {
        for (let i = 0; i < this.states.length; i++) {
            const s = this.states[i];
            if (s.result === null) return false;
            if (this.beatmap.notes[i].isHold && s.tailResult === null) return false;
        }
        return true;
    }

    private get meh(): number {
        return this.beatmap.difficulty.windowMeh;
    }

    /** A hold's tail window: lazer's release lenience around the tail's time. */
    private get tailWindow(): number {
        return this.beatmap.difficulty.windowMiss * MANIA_TAIL_LENIENCE;
    }

    /** The cursor is irrelevant to mania; the signature is shared with standard. */
    update(time: number, _cursor: CursorState): void {
        const dt = this.lastTime === -Infinity ? 0 : Math.max(0, time - this.lastTime);
        this.lastTime = time;
        this.health.drain(time, dt);
        const notes = this.beatmap.notes;
        // Heads: a note whose 50 window closed unplayed misses.
        for (let c = 0; c < this.columns.length; c++) {
            const queue = this.columns[c];
            while (this.next[c] < queue.length) {
                const i = queue[this.next[c]];
                const n = notes[i];
                if (this.states[i].result !== null) {
                    this.next[c]++;
                    continue;
                }
                if (time <= n.time + this.meh) break;
                this.applyHead(i, 'miss', n.time + this.meh);
                this.next[c]++;
                this.makeRecoverable(c, i);
            }
        }
        // Tails: whatever the reason (never pressed, let go early, still
        // held), a tail whose lenient window closed unjudged misses.
        while (this.tailNext < this.tails.length) {
            const i = this.tails[this.tailNext];
            if (this.states[i].tailResult !== null) {
                this.tailNext++;
                continue;
            }
            const end = notes[i].endTime;
            if (time <= end + this.tailWindow) break;
            this.applyTail(i, 'miss', end + this.tailWindow);
            this.tailNext++;
        }
    }

    /** Standard's press (mouse or gamepad) has no mania meaning; the columns are keys. */
    press(_time: number, _x: number, _y: number): void {
        // Nothing to do.
    }

    /** A column's key went down at `time`. */
    pressColumn(time: number, column: number): void {
        if (column < 0 || column >= this.columns.length) return;
        if (this.holding[column] >= 0) {
            // The key of a hold being held went down again (a stray repeat):
            // follow it again, so its tail can still be released.
            const s = this.states[this.holding[column]];
            s.pressed = true;
            s.holding = true;
            return;
        }
        // A broken hold (or one whose head was missed) still in its column:
        // the key picks it back up rather than reaching for a later note.
        const back = this.recoverable[column];
        if (back >= 0) {
            this.recoverable[column] = -1;
            if (this.states[back].tailResult === null) {
                this.holding[column] = back;
                const s = this.states[back];
                s.pressed = true;
                s.holding = true;
                return;
            }
        }
        const queue = this.columns[column];
        const notes = this.beatmap.notes;
        while (this.next[column] < queue.length) {
            const i = queue[this.next[column]];
            const s = this.states[i];
            if (s.result !== null) {
                this.next[column]++;
                continue;
            }
            const n = notes[i];
            const error = time - n.time;
            // Too early: leave it for later (lazer mania ignores presses outside the miss window).
            if (error < -this.beatmap.difficulty.windowMiss) {
                this.shaken.emit(i);
                return;
            }
            const judgement = maniaResultForError(error, this.beatmap.difficulty);
            if (judgement === null) {
                // Between the 50 and miss windows: a late press is the note's miss.
                if (error > this.meh) {
                    this.applyHead(i, 'miss', time, error);
                    this.next[column]++;
                    this.makeRecoverable(column, i);
                }
                return;
            }
            if (n.isHold) {
                s.pressed = true;
                s.holding = true;
                this.holding[column] = i;
            }
            this.applyHead(i, judgement, time, error);
            this.next[column]++;
            return;
        }
    }

    /** A column's key came up at `time`: a hold being held has its tail judged. */
    releaseColumn(time: number, column: number): void {
        if (column < 0 || column >= this.holding.length) return;
        const i = this.holding[column];
        if (i < 0) return;
        this.holding[column] = -1;
        const s = this.states[i];
        const n = this.beatmap.notes[i];
        s.pressed = false;
        s.holding = false;
        if (s.tailResult !== null) return;
        // The release's distance from the tail decides it, with lazer's
        // release lenience. A release too early to judge leaves the tail
        // pending and breaks the hold's body.
        const offset = time - n.endTime;
        const judgement = maniaResultForError(offset / MANIA_TAIL_LENIENCE, this.beatmap.difficulty);
        if (judgement === null) {
            // Too early to judge: the body breaks and the tail misses once
            // its window closes. After the window, the tail is its miss.
            if (offset < 0) this.breakHold(column, i);
            else this.applyTail(i, 'miss', time);
            return;
        }
        this.applyTail(i, judgement, time, offset / MANIA_TAIL_LENIENCE);
    }

    /** The hold's body was let go: a combo break, and the tail can only score a 50 from now on. */
    private breakHold(column: number, i: number): void {
        const s = this.states[i];
        if (!s.broken) {
            s.broken = true;
            this.score.breakCombo();
        }
        this.makeRecoverable(column, i);
    }

    /**
     * Let the key pick this hold back up, unless a later note in the same
     * column comes before the hold ends (then the key is needed for it).
     */
    private makeRecoverable(column: number, i: number): void {
        if (!this.beatmap.notes[i].isHold) return;
        const queue = this.columns[column];
        const next = this.next[column];
        if (next < queue.length && this.beatmap.notes[queue[next]].time <= this.beatmap.notes[i].endTime) return;
        if (this.states[i].tailResult === null) this.recoverable[column] = i;
    }

    private applyHead(i: number, result: ManiaJudgement, time: number, error: number | null = null): void {
        const s = this.states[i];
        if (s.result !== null) return;
        s.result = result;
        s.judgedAt = time;
        const column = this.beatmap.notes[i].column;
        if (this.recoverable[column] === i) this.recoverable[column] = -1;
        if (error !== null) {
            // Timed hits feed the unstable rate and the hit error meter.
            this.hitErrors.push(error);
            this.headHit.emit(i, time, error);
        }
        this.score.apply(result);
        this.health.applyMania(result, this.beatmap.notes[i].isHold);
        if (this.perfect && result !== 'perfect') this.health.fail();
        this.emit(i, result, time, error, 'head');
    }

    private applyTail(i: number, result: ManiaJudgement, time: number, error: number | null = null): void {
        const s = this.states[i];
        if (s.tailResult !== null) return;
        const n = this.beatmap.notes[i];
        // lazer's capped tail: a missed head or a broken body limits the tail to a 50.
        const capped = s.broken || s.result === 'miss' || s.result === null;
        if (capped && result !== 'meh' && result !== 'miss') result = 'meh';
        s.tailResult = result;
        s.tailJudgedAt = time;
        s.holding = false;
        s.pressed = false;
        if (this.holding[n.column] === i) this.holding[n.column] = -1;
        if (this.recoverable[n.column] === i) this.recoverable[n.column] = -1;
        if (error !== null) {
            this.hitErrors.push(error);
            this.headHit.emit(i, time, error);
        }
        this.score.apply(result);
        this.health.applyMania(result, true);
        if (this.perfect && result !== 'perfect') this.health.fail();
        this.emit(i, result, time, error, 'tail');
    }

    private emit(i: number, result: ManiaJudgement, time: number, error: number | null, node: 'head' | 'tail'): void {
        const n = this.beatmap.notes[i];
        const info: HitEventInfo = {
            index: i,
            result: MANIA_AS_HIT_RESULT[result],
            time,
            x: n.x,
            y: n.y,
            error,
            variant: null,
            mania: result,
            maniaNode: node,
        };
        this.objectJudged.emit(info);
    }

    resetSpinnerTracking(): void {
        // Pausing lifts every key: a hold still down is let go, but not
        // broken — pressing its key again picks it back up.
        for (let c = 0; c < this.holding.length; c++) {
            const i = this.holding[c];
            if (i < 0) continue;
            this.holding[c] = -1;
            const s = this.states[i];
            s.pressed = false;
            s.holding = false;
            if (s.tailResult === null) this.makeRecoverable(c, i);
        }
    }
}

/** The standard result of a mania note state (for shared displays); null while pending. */
export function maniaStateResult(s: ManiaNoteState): HitResult | null {
    return s.result === null ? null : MANIA_AS_HIT_RESULT[s.result];
}

/** Mania autoplay: every note pressed dead on time, holds held to their tails. */
export interface ManiaAutoEvent {
    time: number;
    column: number;
    down: boolean;
}

/** osu!mania autoplay's presses and releases, in time order. */
export function maniaAutoEvents(beatmap: PlayableManiaBeatmap): ManiaAutoEvent[] {
    const events: ManiaAutoEvent[] = [];
    for (const n of beatmap.notes) {
        events.push({ time: n.time, column: n.column, down: true });
        events.push({ time: n.isHold ? n.endTime : n.time + 40, column: n.column, down: false });
    }
    // At the same moment releases go first: a hold's tail can share its
    // column with the next note (the key has to come up before it can go down).
    events.sort((a, b) => a.time - b.time || (a.down === b.down ? a.column - b.column : a.down ? 1 : -1));
    return events;
}

export type { PlayableManiaNote };
