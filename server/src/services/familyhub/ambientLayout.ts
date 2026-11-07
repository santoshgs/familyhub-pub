/**
 * Where each module appears on the photo frame (v1.6): one of up to six cards
 * in the 3 × 2 grid, in the household's order, or a pill in the quick bar
 * below it, or not at all. Chosen in Settings → Display; the frame only reads it.
 */
export const BASE_MODULES = ['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare', 'f1'] as const;
export const EXTRA_MODULES = ['wifi', 'countdown', 'markets', 'photos'] as const;
export const DISPLAY_MODULES = [...BASE_MODULES, ...EXTRA_MODULES] as const;
export type DisplayModule = typeof DISPLAY_MODULES[number];
export const MAX_CARDS = 6;

export interface DisplayLayout { cards: DisplayModule[]; pills: DisplayModule[] }

const isModule = (value: unknown): value is DisplayModule => typeof value === 'string' && (DISPLAY_MODULES as readonly string[]).includes(value);

/**
 * The layout a household had before v1.6: the enabled cards in their fixed
 * order (a seventh becomes a pill) and the enabled quick cards as pills.
 */
export function legacyLayout(widgets: readonly string[], extrasEnabled: Partial<Record<DisplayModule, boolean>>): DisplayLayout {
    const cards = BASE_MODULES.filter((module) => widgets.includes(module));
    const extras = EXTRA_MODULES.filter((module) => extrasEnabled[module]);
    return { cards: cards.slice(0, MAX_CARDS), pills: [...cards.slice(MAX_CARDS), ...extras] };
}

/** Keeps known modules once each, at most six cards; returns null for anything unusable. */
export function readLayout(raw: unknown): DisplayLayout | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as { cards?: unknown; pills?: unknown };
    if (!Array.isArray(value.cards) || !Array.isArray(value.pills)) return null;
    const seen = new Set<string>();
    const keep = (list: unknown[]) => list.filter((item): item is DisplayModule => isModule(item) && !seen.has(item) && Boolean(seen.add(item)));
    const cards = keep(value.cards).slice(0, MAX_CARDS);
    const pills = keep(value.pills);
    return cards.length ? { cards, pills } : null;
}

/** Strict validation for a layout sent by Settings → Display. */
export function parseLayout(raw: unknown): DisplayLayout {
    const fail = (message: string): never => { throw new Error(message); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid display layout.');
    const value = raw as { cards?: unknown; pills?: unknown };
    if (!Array.isArray(value.cards) || !Array.isArray(value.pills)) fail('Invalid display layout.');
    const cards = value.cards as unknown[], pills = value.pills as unknown[];
    if (!cards.length) fail('Choose at least one card for the display.');
    if (cards.length > MAX_CARDS) fail(`The display has room for ${MAX_CARDS} cards; make the rest quick pills.`);
    const all = [...cards, ...pills];
    if (all.some((item) => !isModule(item)) || new Set(all).size !== all.length) fail('Each module can appear once, as a card or a pill.');
    return { cards: cards as DisplayModule[], pills: pills as DisplayModule[] };
}

export const shownModules = (layout: DisplayLayout) => new Set<DisplayModule>([...layout.cards, ...layout.pills]);
