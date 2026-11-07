/** Pure helper for the menu order (kept apart so it can be tested without React). */
/** Items in the saved order; anything new keeps its default place after them. */
export function applyNavOrder<T extends { to: string }>(items: T[], order: string[]): T[] {
    if (!order.length) return items;
    const rank = new Map(order.map((to, index) => [to, index]));
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
        const ra = rank.get(a.item.to), rb = rank.get(b.item.to);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return a.index - b.index;
    }).map(({ item }) => item);
}

