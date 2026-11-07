import { describe, expect, it } from 'vitest';
import { displayLayout, gridPlaces, moveModule, placeModule } from './ambientLayout';
import { applyNavOrder } from './navOrderCore';

describe('frame layout', () => {
    it('fills two rows of 12 columns, three cards or fewer on one row', () => {
        expect(gridPlaces(['calendar', 'weather', 'f1', 'tasks', 'chores', 'news'])).toEqual({ spans: [4, 3, 5, 4, 4, 4], row: [1, 1, 1, 2, 2, 2], rows: 2 });
        expect(gridPlaces(['calendar', 'weather', 'f1', 'tasks'])).toEqual({ spans: [7, 5, 7, 5], row: [1, 1, 2, 2], rows: 2 });
        expect(gridPlaces(['photos', 'calendar']).rows).toBe(1);
        for (const n of [1, 2, 3, 4, 5, 6]) {
            const { spans, row } = gridPlaces(['calendar', 'weather', 'f1', 'tasks', 'chores', 'news'].slice(0, n));
            for (const r of [1, 2]) { const sum = spans.filter((_, i) => row[i] === r).reduce((a, b) => a + b, 0); expect([0, 12]).toContain(sum); }
        }
    });

    it('turns the last card into a pill when a seventh becomes a card, and reorders within a list', () => {
        const full = { cards: ['calendar', 'weather', 'tasks', 'chores', 'news', 'f1'], pills: ['wifi', 'photos'] };
        expect(placeModule(full, 'photos', 'card')).toEqual({ cards: ['calendar', 'weather', 'tasks', 'chores', 'news', 'photos'], pills: ['f1', 'wifi'] });
        expect(placeModule(full, 'calendar', 'off')).toEqual({ cards: ['weather', 'tasks', 'chores', 'news', 'f1'], pills: ['wifi', 'photos'] });
        expect(moveModule(full, 'photos', -1).pills).toEqual(['photos', 'wifi']);
        expect(moveModule(full, 'calendar', -1)).toBe(full);
    });

    it('falls back to the old fixed layout for a pre-v1.5.2 server', () => {
        expect(displayLayout({ settings: { widgets: ['calendar', 'f1'] }, extras: { wifi: {}, countdown: null, markets: null, photos: {} } }))
            .toEqual({ cards: ['calendar', 'f1'], pills: ['wifi', 'photos'] });
    });
});

describe('menu order', () => {
    it('puts saved items first and keeps new ones in their default place', () => {
        const items = ['/', '/calendar', '/todos', '/chores', '/budget', '/settings'].map((to) => ({ to }));
        expect(applyNavOrder(items, ['/', '/calendar', '/todos', '/budget']).map((item) => item.to)).toEqual(['/', '/calendar', '/todos', '/budget', '/chores', '/settings']);
        expect(applyNavOrder(items, [])).toBe(items);
    });
});
