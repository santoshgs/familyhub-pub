/**
 * Placing the frame's cards (v1.6). The household orders up to six cards; the
 * first row takes half (rounded up, at most three), the second the rest, and
 * three or fewer share one row. Each row splits the 12 grid columns by the
 * cards' natural widths (Formula 1 is wider, weather narrower).
 */
const WEIGHT: Record<string, number> = { calendar: 4, weather: 3, f1: 5 };
const weight = (key: string) => WEIGHT[key] ?? 4;

export function gridPlaces(cards: string[]) {
    const n = Math.min(cards.length, 6);
    const first = n <= 3 ? n : Math.ceil(n / 2);
    const rows = [cards.slice(0, first), cards.slice(first, n)].filter((row) => row.length);
    const spans: number[] = [], row: number[] = [];
    rows.forEach((keys, r) => {
        const total = keys.reduce((sum, key) => sum + weight(key), 0);
        // Largest-remainder rounding so each row adds up to exactly 12 columns.
        const raw = keys.map((key) => (weight(key) / total) * 12);
        const whole = raw.map((value) => Math.max(2, Math.floor(value)));
        let left = 12 - whole.reduce((sum, value) => sum + value, 0);
        const order = raw.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
        for (let k = 0; left > 0; k = (k + 1) % order.length) { whole[order[k].i] += 1; left -= 1; }
        for (let k = order.length - 1; left < 0; k = (k - 1 + order.length) % order.length) { if (whole[order[k].i] > 2) { whole[order[k].i] -= 1; left += 1; } }
        whole.forEach((value) => { spans.push(value); row.push(r + 1); });
    });
    return { spans, row, rows: rows.length };
}

type Snapshot = { settings: { widgets: string[]; layout?: { cards: string[]; pills: string[] } }; extras?: { wifi: unknown; countdown: unknown; markets: unknown; photos: unknown } } | null;
const BASE = ['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare', 'f1'];

/** The server's layout, or (from a pre-v1.6 server) the old fixed one. */
export function displayLayout(data: Snapshot) {
    if (data?.settings.layout?.cards?.length) return { cards: data.settings.layout.cards.slice(0, 6), pills: data.settings.layout.pills ?? [] };
    const widgets = data?.settings.widgets ?? ['calendar', 'weather', 'tasks', 'chores', 'daycare', 'f1'];
    const cards = BASE.filter((key) => widgets.includes(key));
    const extras = (['wifi', 'countdown', 'markets', 'photos'] as const).filter((key) => data?.extras?.[key]);
    return { cards: cards.slice(0, 6), pills: [...cards.slice(6), ...extras] };
}

export type Layout = { cards: string[]; pills: string[] };
export const MAX_CARDS = 6;

export function placeModule(layout: Layout, key: string, place: 'card' | 'pill' | 'off'): Layout {
    const cards = layout.cards.filter((k) => k !== key), pills = layout.pills.filter((k) => k !== key);
    if (place === 'card') {
        cards.push(key);
        // The grid holds six: the last card before this one becomes the first pill.
        if (cards.length > MAX_CARDS) pills.unshift(...cards.splice(MAX_CARDS - 1, cards.length - MAX_CARDS));
    } else if (place === 'pill') pills.push(key);
    return { cards, pills };
}
export function moveModule(layout: Layout, key: string, step: -1 | 1): Layout {
    const list = layout.cards.includes(key) ? 'cards' : 'pills';
    const items = [...layout[list]], index = items.indexOf(key), next = index + step;
    if (index < 0 || next < 0 || next >= items.length) return layout;
    [items[index], items[next]] = [items[next], items[index]];
    return { ...layout, [list]: items };
}

