import { codeLabel } from '../../input/bindings';
import { MANIA_MAX_KEYS } from '../../beatmap/mania';

/**
 * osu!mania's default column keys (KeyboardEvent.code), by key count.
 * These follow osu!mania's usual layouts: 4K on D F J K, then the wider
 * variants around a central Space. Beyond 10K a generic row is used.
 */
const LAYOUTS: Record<number, readonly string[]> = {
    1: ['Space'],
    2: ['KeyF', 'KeyJ'],
    3: ['KeyF', 'Space', 'KeyJ'],
    4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
    5: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'],
    6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
    7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL'],
    8: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
    9: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
    10: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyV', 'KeyN', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
};

/** Extra keys for the rare 11K+ maps. */
const EXTRA = [
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8',
];

/** Key counts the settings offer (1K–10K; wider maps still get defaults). */
export const MANIA_KEY_COUNTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** How a column with no key bound reads in the HUD and the settings. */
export const MANIA_UNBOUND_LABEL = '-';

/** Saved per-key-count overrides: `{ "4": ["KeyD", "KeyF", "KeyJ", ""] }`. */
export type ManiaKeyOverrides = Readonly<Record<string, readonly string[]>>;

/** The stock layout for a key count. */
export function maniaDefaultLayout(keys: number): string[] {
    const known = LAYOUTS[keys];
    if (known) return [...known];
    const base = [...(LAYOUTS[Math.min(10, keys)] ?? LAYOUTS[4])];
    for (let i = 0; base.length < keys && i < EXTRA.length; i++) {
        if (!base.includes(EXTRA[i])) base.push(EXTRA[i]);
    }
    while (base.length < keys) base.push(`F${base.length + 1}`);
    return base.slice(0, keys);
}

/**
 * A key count's column keys: the defaults with the user's saved layout on
 * top. An empty string means the column has no key (it can't be played).
 */
export function maniaKeyLayout(keys: number, overrides?: ManiaKeyOverrides | null): string[] {
    const def = maniaDefaultLayout(keys);
    const saved = overrides?.[String(keys)];
    if (!saved) return def;
    return def.map((d, i) => (typeof saved[i] === 'string' ? saved[i] : d));
}

/** Human-readable labels for the column keys ("D F J K"), `-` when unbound. */
export function maniaKeyLabels(keys: number, overrides?: ManiaKeyOverrides | null): string[] {
    return maniaKeyLayout(keys, overrides).map(code => (code ? codeLabel(code) : MANIA_UNBOUND_LABEL));
}

/** Whether two layouts are the same (ignoring the rest of the saved object). */
export function sameManiaLayout(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((code, i) => code === b[i]);
}

/** Keyboard codes a column may be bound to (no modifiers, no mouse). */
function isColumnCode(code: unknown): code is string {
    return typeof code === 'string' && code.length <= 24 && !code.includes('+');
}

/**
 * Settings sanitiser: keep the overrides for key counts osu! supports whose
 * layouts actually differ from the defaults. Unbound columns are kept as
 * empty strings (they only matter when the layout differs anyway).
 */
export function sanitizeManiaKeys(value: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (!value || typeof value !== 'object') return out;
    for (const [count, layout] of Object.entries(value as Record<string, unknown>)) {
        const keys = Number(count);
        if (!Number.isInteger(keys) || keys < 1 || keys > MANIA_MAX_KEYS || !Array.isArray(layout)) continue;
        const saved = maniaDefaultLayout(keys).map((d, i) => {
            const code = layout[i];
            return isColumnCode(code) ? code : d;
        });
        // A key can only play one column of a layout.
        for (let i = 0; i < saved.length; i++) {
            if (saved[i] && saved.indexOf(saved[i]) !== i) saved[i] = '';
        }
        if (!sameManiaLayout(saved, maniaDefaultLayout(keys))) out[count] = saved;
    }
    return out;
}

/** The overrides to persist for a key count's layout (`null` when it is the default). */
export function maniaOverrideFor(keys: number, layout: readonly string[]): string[] | null {
    return sameManiaLayout(layout, maniaDefaultLayout(keys)) ? null : [...layout];
}
