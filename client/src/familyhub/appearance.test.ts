import { expect, it } from 'vitest';
import { CARD_ORDER, moveCard, normalizeCardOrder } from './appearance';
it('repairs legacy layouts without duplicating or losing cards', () => {
    expect(normalizeCardOrder(['notes', 'unknown', 'notes'])).toEqual(['notes', 'calendar', 'tasks', 'daycare', 'classroom']);
    expect(normalizeCardOrder(null)).toEqual(CARD_ORDER);
});
it('moves in both directions, preserves membership, and ignores foreign drag data', () => {
    expect(moveCard(CARD_ORDER, 'calendar', 'notes')).toEqual(['tasks', 'notes', 'calendar', 'daycare', 'classroom']);
    expect(moveCard(CARD_ORDER, 'notes', 'calendar')).toEqual(['notes', 'calendar', 'tasks', 'daycare', 'classroom']);
    expect(moveCard(CARD_ORDER, 'external', 'notes')).toEqual(CARD_ORDER);
    expect(moveCard(CARD_ORDER, 'notes', 'notes')).toEqual(CARD_ORDER);
});
