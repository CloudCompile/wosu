import { Signal } from '../../core/Signal';
import type { Grade } from '../../storage/ScoreStore';
import {
    lazerGrade, MANIA_RESULT_VALUE, type ManiaJudgement, type ScoreOptions,
} from './ScoreProcessor';

/**
 * osu!mania's score: one judgement per note, 320 / 300 / 200 / 100 / 50 / 0,
 * combo built from every non-miss. A hold is judged twice (its head and its
 * tail are separate notes in lazer), so it is worth two judgements here.
 *
 * Accuracy is lazer's mania formula:
 *   (320·320s + 300·300s + 200·200s + 100·100s + 50·50s) / (320 × judged),
 * and the rank follows the shared lazer cutoffs (SS/S/A/B/C/D, silver with
 * Hidden/Flashlight). The field names match ScoreProcessor's so the HUD,
 * leaderboard, results and score storage are shared.
 */
export class ManiaScoreProcessor {
    score = 0;
    combo = 0;
    maxCombo = 0;
    /** 320s (osu!mania's "perfect"). */
    count320 = 0;
    count200 = 0;
    count300 = 0;
    count100 = 0;
    count50 = 0;
    countMiss = 0;
    /** Not used by mania; kept so shared HUD/results code reads zeros. */
    countGeki = 0;
    countKatu = 0;
    sliderTicksHit = 0;
    sliderTicksTotal = 0;
    sliderEndsHit = 0;
    sliderEndsTotal = 0;
    /** Mania's accuracy bits: 320-weighted hits / 320 × judgements. */
    private accuracyBase = 0;
    private accuracyJudged = 0;
    readonly mechanics = 'lazer' as const;
    readonly changed = new Signal<[]>();
    readonly comboBroken = new Signal<[previous: number]>();
    readonly comboIncreased = new Signal<[combo: number]>();
    readonly judged = new Signal<[ManiaJudgement]>();

    constructor(private readonly opts: ScoreOptions) {}

    get judgedCount(): number {
        return this.count320 + this.count300 + this.count200 + this.count100 + this.count50 + this.countMiss;
    }

    get accuracy(): number {
        const n = this.accuracyJudged;
        return n > 0 ? this.accuracyBase / (320 * n) : 1;
    }

    /** One note's judgement (a hold's head and tail are two of them). */
    apply(result: ManiaJudgement, affectsCombo = true): void {
        const value = MANIA_RESULT_VALUE[result];
        const comboBefore = this.combo;
        this.accuracyBase += value;
        this.accuracyJudged++;
        this.score += value + (value * Math.max(comboBefore - 1, 0) * this.opts.difficultyMultiplier * this.opts.modMultiplier) / 25;
        switch (result) {
            case 'perfect': this.count320++; break;
            case 'great': this.count300++; break;
            case 'good': this.count200++; break;
            case 'ok': this.count100++; break;
            case 'meh': this.count50++; break;
            case 'miss': this.countMiss++; break;
        }
        if (affectsCombo) {
            if (result === 'miss') this.breakCombo();
            else this.incrementCombo();
        }
        this.judged.emit(result);
        this.changed.emit();
    }

    /** Counts as one judgement per tier, best first (results screens). */
    counts(): { 320: number; 300: number; 200: number; 100: number; 50: number; miss: number } {
        return {
            320: this.count320, 300: this.count300, 200: this.count200,
            100: this.count100, 50: this.count50, miss: this.countMiss,
        };
    }

    /** Per-tier share of the judgements so far (results bar charts). */
    ratios(): Record<ManiaJudgement, number> {
        const n = Math.max(1, this.judgedCount);
        return {
            perfect: this.count320 / n, great: this.count300 / n, good: this.count200 / n,
            ok: this.count100 / n, meh: this.count50 / n, miss: this.countMiss / n,
        };
    }

    grade(silver: boolean, failed = false): Grade {
        if (failed) return 'F';
        if (this.judgedCount === 0) return silver ? 'XH' : 'X';
        return lazerGrade(this.accuracy, this.countMiss, silver);
    }

    private incrementCombo(): void {
        this.combo++;
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
        this.comboIncreased.emit(this.combo);
    }

    /** Break the combo without a judgement (a hold let go early, lazer's HoldNoteBody). */
    breakCombo(): void {
        const prev = this.combo;
        this.combo = 0;
        if (prev > 0) this.comboBroken.emit(prev);
    }
}
