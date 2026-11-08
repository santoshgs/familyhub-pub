import { describe, expect, it } from 'vitest';
import { formatQuantity, groupByAisle, splitQuantity, type ShopItem } from './logic';

const item = (id: string, aisle: string | null, checked = false): ShopItem => ({ id, name: id, quantity: null, unit: null, aisle, notes: '', checked, position: id });
const aisles = [{ key: 'Alimentation', label: 'Food' }, { key: 'Hygiène', label: 'Hygiene' }];

describe('shopping aisles', () => {
    it('orders known aisles like the household categories, then typed ones, then none', () => {
        const groups = groupByAisle([item('a', null), item('b', 'hygiene'), item('c', 'Garden centre'), item('d', 'Alimentation'), item('e', 'Food', true), item('f', 'Food')], aisles, 'Other');
        expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
            ['Food', ['d', 'f', 'e']], ['Hygiene', ['b']], ['Garden centre', ['c']], ['Other', ['a']],
        ]);
    });
});

describe('quantity box', () => {
    it('splits "2 L" into quantity and unit, leaving plain numbers and set units alone', () => {
        expect(splitQuantity({ quantity: '2 L' })).toMatchObject({ quantity: '2', unit: 'L' });
        expect(splitQuantity({ quantity: '1,5 kg' })).toMatchObject({ quantity: '1,5', unit: 'kg' });
        expect(splitQuantity({ quantity: '3' })).toEqual({ quantity: '3' });
        expect(splitQuantity({ quantity: '2 L', unit: 'packs' })).toEqual({ quantity: '2 L', unit: 'packs' });
        expect(formatQuantity({ quantity: 1.5, unit: 'kg' }, 'en')).toBe('1.5 kg');
        expect(formatQuantity({ quantity: null, unit: null }, 'en')).toBe('');
    });
});
