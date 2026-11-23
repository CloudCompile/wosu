import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { PlayableManiaBeatmap, PlayableManiaNote } from '../../beatmap/types';
import { MANIA_JUDGEMENT_Y } from '../../beatmap/mania';
import type { ManiaNoteState } from '../mania/ManiaRules';
import type { SkinChain } from '../../skin/SkinChain';
import { Judgements } from './Judgements';

export const MANIA_PLAYFIELD_W = 512;
export const MANIA_PLAYFIELD_H = 384;

const NOTE_HEIGHT = 12;
/** The hold body's minimum visible height, so a nearly-finished hold still reads. */
const HOLD_MIN_HEIGHT = 4;

export interface ManiaPlayfieldOptions {
    renderer: Renderer;
    skin: SkinChain;
    beatmap: PlayableManiaBeatmap;
    /** Note states from ManiaRules (for hit animations and held holds). */
    states: readonly ManiaNoteState[];
    /** Device pixels per playfield unit (unused: mania geometry is flat). */
    pixelsPerUnit?: number;
}

interface NoteView {
    note: PlayableManiaNote;
    /** The head sprite (a tap's whole note); null once it has faded out. */
    head: Sprite | null;
    /** A hold's body; null once the tail is judged or it scrolled away. */
    body: Sprite | null;
}

/** Per-column colours (white / blue, with the middle column of odd key counts special). */
function columnTint(column: number, keys: number): number {
    if (keys % 2 === 1 && column === (keys - 1) / 2) return 0xffd166;
    return column % 2 === 0 ? 0xf2f5ff : 0x9ec5ff;
}

/**
 * The osu!mania playfield: column lanes, receptors at the judgement line,
 * scrolling notes and hold bodies, per-column key lighting, and the shared
 * Judgements layer for hit feedback. Geometry is all in the 512×384 osu!
 * playfield units, like the standard playfield, so the Player lays it out
 * the same way.
 *
 * Skins: a mania skin's `mania-key1` / `mania-key2` / `mania-keyS`
 * textures become the receptors when present; everything else is drawn
 * procedurally so any skin (or none) is playable.
 */
export class ManiaPlayfield extends Container {
    readonly judgements: Judgements;
    /** osu!standard's spinner fade has no mania equivalent; kept for the shared Player layout. */
    readonly spinnerFade = new Graphics();

    private readonly beatmap: PlayableManiaBeatmap;
    private readonly states: readonly ManiaNoteState[];
    private readonly keys: number;
    private readonly columnWidth: number;
    private readonly stage = new Graphics();
    private readonly noteLayer = new Container();
    private readonly keyLayer = new Container();
    private readonly views = new Map<number, NoteView>();
    private readonly noteTextures: Texture[];
    private readonly glowTexture: Texture;
    private readonly receptorSprites: Sprite[] = [];
    private readonly receptorGlow: Sprite[] = [];
    private readonly keyTextures: (Texture | null)[];
    private next = 0;
    private readonly skin: SkinChain;

    constructor(private readonly o: ManiaPlayfieldOptions) {
        super();
        this.eventMode = 'none';
        this.beatmap = o.beatmap;
        this.states = o.states;
        this.keys = o.beatmap.keys;
        this.columnWidth = this.beatmap.difficulty.columnWidth;
        this.skin = o.skin;
        this.judgements = new Judgements(o.skin, Math.min(56, this.columnWidth * 0.9));
        this.glowTexture = this.makeGlowTexture(o.renderer);
        this.noteTextures = [];
        for (let c = 0; c < this.keys; c++) this.noteTextures.push(this.tapTexture(o.renderer));
        this.keyTextures = [];
        for (let c = 0; c < this.keys; c++) this.keyTextures.push(this.keyTexture(c));

        this.drawStage();
        this.drawReceptors();
        // Stage, the keys at the judgement line, then the notes falling onto
        // them; new-style skin judgements under the notes, the rest above.
        this.addChild(this.stage, this.keyLayer, this.judgements.below, this.noteLayer, this.judgements);
    }

    /** A plain white panel the keys tint and blend additively when pressed. */
    private makeGlowTexture(renderer: Renderer): Texture {
        const g = new Graphics();
        g.roundRect(0, 0, 64, 64, 6).fill(0xffffff);
        const tex = renderer.generateTexture(g);
        g.destroy();
        return tex;
    }

    private tapTexture(renderer: Renderer): Texture {
        const w = Math.max(2, Math.round(this.columnWidth * 0.92));
        const g = new Graphics();
        g.roundRect(0, 0, w, NOTE_HEIGHT, 4).fill(0xffffff);
        const tex = renderer.generateTexture(g);
        g.destroy();
        return tex;
    }

    /** A skin key image for this column (`mania-keyS` for the special column). */
    private keyTexture(column: number): Texture | null {
        const special = this.keys % 2 === 1 && column === (this.keys - 1) / 2;
        const names = special
            ? ['mania-keyS', 'mania-key2', 'mania-key1']
            : column % 2 === 0 ? ['mania-key1', 'mania-key2'] : ['mania-key2', 'mania-key1'];
        for (const n of names) {
            const t = this.skin.texture(n);
            if (t) return t.texture;
        }
        return null;
    }

    private drawStage(): void {
        const g = this.stage;
        const cw = this.columnWidth;
        g.clear();
        // Lanes: a dark stage with alternating column shades.
        g.rect(0, 0, MANIA_PLAYFIELD_W, MANIA_JUDGEMENT_Y).fill(0x05070d);
        for (let c = 0; c < this.keys; c++) {
            const tint = columnTint(c, this.keys);
            g.rect(c * cw, 0, cw, MANIA_JUDGEMENT_Y).fill({ color: tint, alpha: c % 2 === 0 ? 0.055 : 0.1 });
            if (c > 0) g.rect(c * cw - 0.5, 0, 1, MANIA_JUDGEMENT_Y).fill({ color: 0x000000, alpha: 0.55 });
        }
        // The judgement line.
        g.rect(0, MANIA_JUDGEMENT_Y - 1, MANIA_PLAYFIELD_W, 2).fill({ color: 0xdfe9ff, alpha: 0.55 });
        g.rect(0, MANIA_JUDGEMENT_Y, MANIA_PLAYFIELD_W, MANIA_PLAYFIELD_H - MANIA_JUDGEMENT_Y).fill({ color: 0x000000, alpha: 0.35 });
    }

    private drawReceptors(): void {
        const cw = this.columnWidth;
        const h = MANIA_PLAYFIELD_H - MANIA_JUDGEMENT_Y - 4;
        for (let c = 0; c < this.keys; c++) {
            const tex = this.keyTextures[c];
            let sprite: Sprite;
            if (tex) {
                sprite = new Sprite(tex);
                sprite.anchor.set(0.5, 0);
                // Fit the key image to the column, keeping its aspect.
                const sx = (cw * 0.94) / tex.width;
                const sy = h / tex.height;
                sprite.scale.set(Math.min(sx, sy), Math.min(sx, sy));
            } else {
                const g = new Graphics();
                g.roundRect(-cw * 0.45, 0, cw * 0.9, h * 0.8, 4).fill({ color: 0x1b2130, alpha: 0.9 })
                    .roundRect(-cw * 0.45, 0, cw * 0.9, h * 0.8, 4).stroke({ color: columnTint(c, this.keys), width: 1.5, alpha: 0.5 });
                sprite = new Sprite(this.o.renderer.generateTexture(g));
                sprite.anchor.set(0.5, 0);
                g.destroy();
            }
            sprite.position.set((c + 0.5) * cw, MANIA_JUDGEMENT_Y + 2);
            // The key's lighting: a bright additive panel of the column's colour.
            const glow = new Sprite(this.glowTexture);
            glow.anchor.set(0.5, 0);
            glow.position.set((c + 0.5) * cw, MANIA_JUDGEMENT_Y + 2);
            glow.width = cw * 0.9;
            glow.height = h * 0.8;
            glow.tint = columnTint(c, this.keys);
            glow.blendMode = 'add';
            glow.alpha = 0;
            this.receptorSprites.push(sprite);
            this.receptorGlow.push(glow);
            this.keyLayer.addChild(sprite, glow);
        }
    }

    /** Kept for the shared Player layout (mania geometry is flat). */
    setPixelsPerUnit(_v: number): void {
        // Nothing to scale.
    }

    /** Kept for the shared Player API; mania has no kiai flashes on notes. */
    set kiaiFlashes(_v: boolean) {
        // Nothing to do.
    }

    /** Kept for the shared Player API (mania has no follow points or combo numbers). */
    setHitObjectOptions(_o: { snakingIn: boolean; snakingOut: boolean; hideNumbers: boolean; hideFollowPoints: boolean }): void {
        // Nothing to do.
    }

    setInstafade(_circles: boolean, _sliders: boolean): void {
        // Nothing to do.
    }

    /** Draw a note of each kind and every judgement once, so pipelines exist before gameplay. */
    warmUp(render: () => void): void {
        const note = this.beatmap.notes[0];
        if (note) {
            const v = this.create(0);
            if (v) {
                if (v.head) v.head.y = MANIA_JUDGEMENT_Y - 100;
                if (v.body) v.body.y = MANIA_JUDGEMENT_Y - 60;
            }
        }
        for (const r of ['great', 'ok', 'meh', 'miss'] as const) {
            this.judgements.add(r, note?.x ?? MANIA_PLAYFIELD_W / 2, MANIA_JUDGEMENT_Y, 0, 0xffffff);
        }
        for (const label of ['320', '300', '200', '100', '50']) this.judgements.add('great', note?.x ?? 256, MANIA_JUDGEMENT_Y, 0, 0xffffff, null, label);
        this.judgements.update(50);
        render();
        this.judgements.clear();
        for (const v of this.views.values()) {
            v.head?.destroy();
            v.body?.destroy();
        }
        this.views.clear();
        this.next = 0;
    }

    private noteY(time: number, noteTime: number): number {
        return MANIA_JUDGEMENT_Y - ((noteTime - time) * MANIA_JUDGEMENT_Y) / this.beatmap.difficulty.scrollTime;
    }

    private create(index: number): NoteView | null {
        const note = this.beatmap.notes[index];
        if (!note) return null;
        const tint = columnTint(note.column, this.keys);
        const head = new Sprite(this.noteTextures[note.column]);
        head.anchor.set(0.5, 0.5);
        head.tint = tint;
        head.position.set(note.x, this.noteY(this.lastTime(), note.time));
        let body: Sprite | null = null;
        if (note.isHold) {
            body = new Sprite(this.noteTextures[note.column]);
            body.anchor.set(0.5, 1);
            body.tint = tint;
            body.alpha = 0.7;
            body.x = note.x;
            this.noteLayer.addChild(body);
        }
        this.noteLayer.addChild(head);
        const view: NoteView = { note, head, body };
        this.views.set(index, view);
        return view;
    }

    private lastTimeValue = 0;
    private lastTime(): number {
        return this.lastTimeValue;
    }

    update(time: number, down: readonly boolean[] = []): void {
        this.lastTimeValue = time;
        const notes = this.beatmap.notes;
        const scroll = this.beatmap.difficulty.scrollTime;
        // Bring in notes that are about to appear.
        while (this.next < notes.length && notes[this.next].time - scroll <= time) {
            this.create(this.next);
            this.next++;
        }

        for (const [index, v] of this.views) {
            const n = v.note;
            const s = this.states[index];
            const headY = Math.min(MANIA_JUDGEMENT_Y, this.noteY(time, n.time));

            // The head: falling, frozen on the line while its hold is held,
            // then a hit or miss animation. A hold's head lives on (frozen)
            // until its tail; a tap's is gone once it has faded.
            if (v.head) {
                v.head.position.set(n.x, headY);
                if (s.result === null) {
                    // Beyond the sweep: keep drawing it a moment (the fail look).
                    v.head.alpha = time > n.time + this.beatmap.difficulty.windowMiss + 40 ? 0.6 : 1;
                } else if (n.isHold && s.holding && s.tailResult === null) {
                    v.head.alpha = 1;
                    v.head.scale.set(1);
                } else {
                    const dt = time - s.judgedAt;
                    const hit = s.result !== 'miss';
                    const dur = hit ? 140 : 220;
                    const k = Math.max(0, Math.min(1, dt / dur));
                    v.head.alpha = hit ? 1 - k : 0.85 * (1 - k);
                    if (hit) v.head.scale.set(1 + 0.35 * k, Math.max(0.2, 1 - k));
                    else v.head.tint = 0x8a8f9a;
                    if (dt > dur) {
                        v.head.destroy();
                        v.head = null;
                    }
                }
            }

            // The hold body: from the head to the tail, bright while held,
            // greyed when the hold broke or its head missed, fading once the
            // tail is judged.
            if (v.body) {
                const tailY = Math.max(0, Math.min(MANIA_JUDGEMENT_Y, this.noteY(time, n.endTime)));
                const height = headY - tailY;
                const visible = height > HOLD_MIN_HEIGHT - 0.01;
                v.body.visible = visible;
                if (visible) {
                    v.body.y = headY;
                    v.body.scale.set(1, Math.max(0.4, height / NOTE_HEIGHT));
                    const held = s.holding && s.tailResult === null;
                    const dead = s.broken || s.result === 'miss';
                    if (dead) v.body.tint = 0x8a8f9a;
                    v.body.alpha = dead ? 0.25 : held ? 0.95 : 0.65;
                    if (s.tailResult !== null) v.body.alpha *= Math.max(0, 1 - (time - s.tailJudgedAt) / 200);
                }
                if (s.tailResult !== null && time - s.tailJudgedAt > 200) {
                    v.body.destroy();
                    v.body = null;
                } else if (!visible && time > n.endTime + 400) {
                    v.body.destroy();
                    v.body = null;
                }
            }

            if (!v.head && !v.body) {
                this.views.delete(index);
                continue;
            }
            // Out of view (past the judgement line after its window): drop it.
            if (time > n.endTime + 1500) this.release(index, v);
        }

        // Keys: light a column while its key is held.
        for (let c = 0; c < this.keys; c++) {
            const glow = this.receptorGlow[c];
            if (!glow) continue;
            const held = !!down[c];
            glow.alpha = held ? 0.55 : Math.max(0, glow.alpha - 0.08);
        }
        this.judgements.update(time);
    }

    private release(index: number, v: NoteView): void {
        if (v.head && !v.head.destroyed) v.head.destroy();
        if (v.body && !v.body.destroyed) v.body.destroy();
        this.views.delete(index);
    }

    /** lazer's fail animation: the notes fall away and fade (see Playfield.failDrop). */
    failDrop(t: number): void {
        const a = Math.max(0, 1 - t * 2);
        this.noteLayer.alpha = a;
        this.keyLayer.alpha = a;
        this.stage.alpha = a;
        this.judgements.alpha = a;
        this.judgements.below.alpha = a;
        this.noteLayer.y = 400 * t;
        this.noteLayer.rotation = 0.017 * t;
        this.keyLayer.y = 400 * t;
    }

    override destroy(): void {
        for (const idx of [...this.views.keys()]) {
            const v = this.views.get(idx)!;
            this.release(idx, v);
        }
        super.destroy({ children: true });
    }
}
