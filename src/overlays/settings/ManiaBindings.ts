import type { FederatedPointerEvent, Text } from 'pixi.js';
import type { Game } from '../../app/Game';
import { Bindable } from '../../core/Bindable';
import { tween } from '../../core/Tweener';
import {
    codeLabel,
    isModifierCode,
} from '../../input/bindings';
import {
    MANIA_KEY_COUNTS,
    MANIA_UNBOUND_LABEL,
    maniaDefaultLayout,
    maniaKeyLayout,
    maniaOverrideFor,
} from '../../gameplay/mania/layout';
import { Box } from '../../ui/Box';
import { KeyBindButton } from '../../ui/KeyBindButton';
import { fitText, label } from '../../ui/text';
import { Colors } from '../../ui/theme';
import { UIComponent } from '../../ui/UIComponent';
import { buttonRow, SettingsRow } from './rows';
import type { SubsectionDef } from './types';

const SLOT_GAP = 4;
const SLOT_MIN_W = 26;
const SLOT_MAX_W = 64;
/** The caption's room (`4K`, `10K`). */
const CAPTION_W = 34;

/**
 * One column's key (lazer's mania key binding button): click, then press
 * the key. Esc cancels, right-click restores the column's default.
 */
class ColumnSlot extends UIComponent {
    private readonly box = new Box({ color: 0x000000, alpha: 0.5, radius: 5 });
    private readonly text: Text;
    code = '';
    listening = false;
    onStart: ((slot: ColumnSlot) => void) | null = null;
    onReset: ((slot: ColumnSlot) => void) | null = null;

    constructor() {
        super();
        this.text = label('', { size: 12, weight: '700' });
        this.text.anchor.set(0.5);
        this.addChild(this.box, this.text);
        this.makeInteractive();
        this.on('rightclick', (e: FederatedPointerEvent) => {
            e.stopPropagation();
            this.onReset?.(this);
        });
        this.tooltip = 'Click to change, right-click to restore the default key';
    }

    setCode(code: string): void {
        this.code = code;
        this.refresh();
    }

    setListening(on: boolean): void {
        if (this.listening === on) return;
        this.listening = on;
        this.box.setBorder(on ? { width: 2, color: Colors.yellow } : undefined);
        this.refresh();
        if (!on) {
            this.text.scale.set(1.2);
            tween(this.text, { scale: 1 }, { duration: 300, ease: 'OutElastic' });
        }
    }

    private refresh(): void {
        const t = this.listening ? '…' : this.code ? codeLabel(this.code) : MANIA_UNBOUND_LABEL;
        this.text.text = t;
        fitText(this.text, SLOT_MAX_W - 8, t);
        this.text.alpha = this.code || this.listening ? 1 : 0.45;
    }

    protected override onResize(w: number, h: number): void {
        this.box.resize(w, h);
        this.text.position.set(w / 2, h / 2);
    }

    protected override onHoverChange(hovered: boolean): void {
        this.box.alpha = hovered ? 0.7 : 0.5;
    }

    protected override onClick(): void {
        this.onStart?.(this);
    }
}

/**
 * A key count's columns as rebindable buttons (`D F J K`), reading and
 * writing `settings.maniaKeys`. Binding a key another column of the same
 * layout already uses takes it from that column (which is left unbound).
 */
class ManiaBindControl extends UIComponent {
    private readonly caption: Text;
    private readonly slots: ColumnSlot[] = [];
    private release: (() => void) | null = null;
    private active: ColumnSlot | null = null;

    constructor(private readonly game: Game, private readonly keysCount: number) {
        super();
        this.caption = label(`${keysCount}K`, { size: 14, weight: '600' });
        this.caption.anchor.set(0, 0.5);
        this.addChild(this.caption);
        for (let i = 0; i < keysCount; i++) {
            const slot = new ColumnSlot();
            slot.onStart = s => this.start(s);
            slot.onReset = s => this.write(this.slots.indexOf(s), maniaDefaultLayout(this.keysCount)[this.slots.indexOf(s)]);
            this.slots.push(slot);
            this.addChild(slot);
        }
        this.disposer.add(game.settings.maniaKeys.bind(() => this.refresh(), true));
        this.resize(300, 34);
    }

    private get layout(): string[] {
        return maniaKeyLayout(this.keysCount, this.game.settings.maniaKeys.value);
    }

    private refresh(): void {
        const layout = this.layout;
        this.slots.forEach((s, i) => s.setCode(layout[i] ?? ''));
        this.layoutSlots();
    }

    private start(slot: ColumnSlot): void {
        if (this.active === slot) {
            this.cancel();
            return;
        }
        this.cancel();
        if (!KeyBindButton.capture) return;
        this.active = slot;
        slot.setListening(true);
        this.layoutSlots();
        this.release = KeyBindButton.capture(e => {
            if (isModifierCode(e.code)) return true; // wait for the key itself
            if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                this.cancel();
                return true;
            }
            // Columns bind a bare key code (the game matches `event.code`).
            this.write(this.slots.indexOf(slot), e.code);
            this.cancel();
            return true;
        });
    }

    /** Stop waiting for a key (the panel closed, or another column was clicked). */
    cancel(): void {
        this.release?.();
        this.release = null;
        const a = this.active;
        this.active = null;
        a?.setListening(false);
        this.layoutSlots();
    }

    private write(column: number, code: string | null): void {
        const layout = this.layout;
        const next = [...layout];
        next[column] = code ?? '';
        // A key can only play one column: take it from any other column of this layout.
        let displaced = -1;
        if (next[column]) {
            for (let i = 0; i < next.length; i++) {
                if (i !== column && next[i] === next[column]) {
                    next[i] = '';
                    displaced = i;
                }
            }
        }
        const overrides: Record<string, readonly string[]> = { ...this.game.settings.maniaKeys.value };
        const saved = maniaOverrideFor(this.keysCount, next);
        if (saved) overrides[String(this.keysCount)] = saved;
        else delete overrides[String(this.keysCount)];
        this.game.settings.maniaKeys.value = overrides;
        if (displaced >= 0) {
            this.game.notifications.info(
                `${codeLabel(next[column])} was unbound from column ${displaced + 1} of ${this.keysCount}K.`,
            );
        }
    }

    override destroy(options?: Parameters<UIComponent['destroy']>[0]): void {
        this.release?.();
        super.destroy(options);
    }

    protected override onResize(): void {
        this.layoutSlots();
    }

    private layoutSlots(): void {
        if (!this.slots?.length) return;
        const w = this._w, h = this._h;
        const available = w - CAPTION_W - 6;
        // Fit every column: shrink the slots (never below SLOT_MIN_W, which
        // 10K × 26 px + gaps still fits in 360).
        const per = Math.min(SLOT_MAX_W, (available - SLOT_GAP * (this.slots.length - 1)) / this.slots.length);
        const width = Math.max(SLOT_MIN_W, per);
        let x = w;
        for (let i = this.slots.length - 1; i >= 0; i--) {
            const s = this.slots[i];
            x -= width;
            s.resize(width, h - 8);
            s.position.set(x, 4);
            x -= SLOT_GAP;
        }
        this.caption.position.set(0, h / 2);
    }
}

/**
 * The mania layout as one restorable value (joined), so the row's
 * restore-default pill shows while it differs from the stock layout.
 */
function layoutBindable(game: Game, keysCount: number): { bindable: Bindable<string>; dispose: () => void } {
    const s = game.settings.maniaKeys;
    const b = new Bindable(maniaDefaultLayout(keysCount).join('|'));
    let syncing = false;
    const off = s.bind(v => {
        syncing = true;
        b.value = maniaKeyLayout(keysCount, v).join('|');
        syncing = false;
    }, true);
    const offB = b.bind(v => {
        if (syncing) return;
        const overrides: Record<string, readonly string[]> = { ...s.value };
        const saved = maniaOverrideFor(keysCount, v.split('|'));
        if (saved) overrides[String(keysCount)] = saved;
        else delete overrides[String(keysCount)];
        s.value = overrides;
    });
    return { bindable: b, dispose: () => { off(); offB(); } };
}

export function maniaBindRow(game: Game, keysCount: number): SettingsRow {
    const control = new ManiaBindControl(game, keysCount);
    const { bindable, dispose } = layoutBindable(game, keysCount);
    const row = new SettingsRow(control, `${keysCount}K column keys osu!mania keyboard`, bindable, {
        keywords: `mania ${keysCount}k column keys keybind layout`,
    });
    row.onPanelHide = () => control.cancel();
    row.on('destroyed', dispose);
    return row;
}

/** Settings → Input: osu!mania's per-key-count column keys, plus "reset all". */
export function maniaBindingSubsections(game: Game): SubsectionDef[] {
    const rows = MANIA_KEY_COUNTS.map(k => maniaBindRow(game, k));
    rows.push(buttonRow('Reset osu!mania keys', () => {
        game.settings.maniaKeys.value = {};
        game.notifications.info('osu!mania keys were reset to their defaults.');
    }, { color: Colors.pinkDark, icon: 'rotate', keywords: 'restore default mania columns' }));
    return [{ title: 'osu!mania key bindings', rows }];
}
