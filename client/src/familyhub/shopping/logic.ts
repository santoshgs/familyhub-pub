
/** Shopping lists kept in Google Tasks (server: routes/familyhubShopping.ts). */
export interface ShopItem {
    id: string; name: string; quantity: number | null; unit: string | null;
    aisle: string | null; notes: string; checked: boolean; position: string;
}
export interface ShopList { id: string; title: string; items: ShopItem[] }
export interface Migration { localItems: number; migratedAt: string | null; migratedCount: number | null }
export type ShoppingData =
    | { mode: 'local'; connected: boolean; lists: []; migration: Migration }
    | { mode: 'google'; connected: true; lists: ShopList[]; missing: number; migration: Migration };
export interface ShoppingSettings { connected: boolean; available: Array<{ id: string; title: string }>; selected: string[] }
export interface ItemDraft { name: string; quantity: string; unit: string; aisle: string; notes: string }

/**
 * Groups items into aisles in the household's category order. An aisle is
 * matched by its displayed name or its key; names typed elsewhere (Google's
 * app) get their own group after the known ones, and no aisle goes last.
 */
export function groupByAisle(items: ShopItem[], categories: Array<{ key: string; label: string }>, otherLabel: string) {
    const order = new Map<string, number>();
    categories.forEach(({ key, label }, index) => { order.set(label.toLowerCase(), index); order.set(key.toLowerCase(), index); });
    const groups = new Map<string, { label: string; rank: number; items: ShopItem[] }>();
    for (const item of items) {
        const raw = item.aisle?.trim() ?? '';
        const rank = raw ? order.get(raw.toLowerCase()) : undefined;
        const label = rank !== undefined ? categories[rank].label : raw || otherLabel;
        const id = rank !== undefined ? `k:${rank}` : raw ? `u:${raw.toLowerCase()}` : 'none';
        if (!groups.has(id)) groups.set(id, { label, rank: rank ?? (raw ? 1_000 : 2_000), items: [] });
        groups.get(id)!.items.push(item);
    }
    return [...groups.entries()]
        .sort(([, a], [, b]) => a.rank - b.rank || a.label.localeCompare(b.label))
        .map(([id, group]) => ({ id, label: group.label, items: [...group.items].sort((a, b) => Number(a.checked) - Number(b.checked)) }));
}

/** Per-device memory of collapsed lists; never required for the page to work. */
export function readCollapsed(key: string): Set<string> {
    try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []); }
    catch { return new Set(); }
}
export function writeCollapsed(key: string, value: Set<string>) {
    try { localStorage.setItem(key, JSON.stringify([...value])); } catch { /* private mode or blocked storage */ }
}

export const formatQuantity = (item: Pick<ShopItem, 'quantity' | 'unit'>, locale?: string) =>
    [item.quantity !== null ? new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(item.quantity) : '', item.unit ?? ''].join(' ').trim();

/** "2 L" typed in the quantity box becomes quantity 2 and unit L. */
export function splitQuantity(draft: Partial<ItemDraft>): Partial<ItemDraft> {
    if (draft.quantity === undefined || draft.unit) return draft;
    const match = /^\s*(\d+(?:[.,]\d+)?)\s*(\S.*)$/.exec(draft.quantity);
    return match ? { ...draft, quantity: match[1], unit: match[2].trim() } : draft;
}
