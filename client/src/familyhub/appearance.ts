export const CARD_ORDER = ['calendar', 'tasks', 'notes', 'daycare', 'classroom'];
export const CARD_LABELS: Record<string, string> = { calendar: 'Calendar', tasks: 'To-dos', notes: 'Notes', daycare: 'Daycare', classroom: 'School' };
export function normalizeCardOrder(raw: unknown): string[] {
    const result = Array.isArray(raw) ? [...new Set(raw.filter((key): key is string => typeof key === 'string' && CARD_ORDER.includes(key)))] : [];
    return [...result, ...CARD_ORDER.filter((key) => !result.includes(key))];
}
export function moveCard(order: string[], card: string, target: string) {
    if (!order.includes(card) || !order.includes(target)) return order;
    const next = order.filter((key) => key !== card);
    next.splice(order.indexOf(target), 0, card);
    return next;
}
