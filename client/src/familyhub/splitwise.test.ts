import { describe, expect, it } from 'vitest';
import { guessMembers, mapCategory, parseSplitwise, planImport } from '../pages/budget/splitwise';

// Fictional household and amounts.
const csv = `﻿Date,Description,Category,Cost,Currency,Alex,Sam\r
\r
2026-01-02,Bus pass,Bus/train,10.00,CAD,-5.00,5.00\r
2026-01-02,"Pizza, large",Dining out,11.85,CAD,5.93,-5.93\r
2026-01-03,Sam's coat,Clothing,40.00,CAD,40.00,-40.00\r
2026-01-04,Own lunch,Dining out,12.00,CAD,0.00,0.00\r
2026-01-05,Uneven dinner,Dining out,30.00,CAD,20.00,-20.00\r
2026-01-06,Trip taxi,Taxi,500.00,INR,-250.00,250.00\r
2026-01-07,Sam paid Alex,Payment,10.00,CAD,-10.00,10.00\r
2026-01-08,Mystery,Something new,8.00,CAD,0.00,0.00\r
2026-01-09,Total balance, , ,CAD,50.93,-50.93\r
`;
const family = [{ id: 'm-alex', name: 'Alex Demo' }, { id: 'm-sam', name: 'Sam' }];

describe('Splitwise import', () => {
    it('parses the export, skipping totals and blank lines', () => {
        const file = parseSplitwise(csv);
        expect(file.people).toEqual(['Alex', 'Sam']);
        expect(file.rows).toHaveLength(8);
        expect(file.rows[1].description).toBe('Pizza, large');
        expect(file.currencies).toEqual(['CAD', 'INR']);
        expect(guessMembers(file.people, family)).toEqual(['m-alex', 'm-sam']);
        expect(mapCategory('Gas/fuel')).toBe('fuel');
        expect(mapCategory('Something new')).toBe('general');
    });

    it('turns rows into payer/split expenses and payments whose balance matches Splitwise', () => {
        const file = parseSplitwise(csv);
        const plan = planImport(file, ['m-alex', 'm-sam'], { CAD: 1, INR: 0.02 });
        expect(plan.counts).toEqual({ shared: 3, full: 1, personal: 2, approximate: 1, payments: 1, converted: 1 });
        expect(plan.expenses[0]).toMatchObject({ category: 'transit', paid_by: 'm-sam', split_with: ['m-sam', 'm-alex'] });
        expect(plan.expenses[2]).toMatchObject({ paid_by: 'm-alex', split_with: ['m-sam'], amount: 40 });
        expect(plan.expenses[3]).toMatchObject({ paid_by: null, split_with: [] });
        expect(plan.expenses[5]).toMatchObject({ description: 'Trip taxi (500.00 INR)', amount: 10, category: 'rideshare' });
        expect(plan.settlements[0]).toMatchObject({ from: 'm-sam', to: 'm-alex', amount: 10 });
        // Splitwise's balances, converted: Alex is owed 50.93 CAD and owes 250 INR (5.00).
        expect(plan.balance['m-alex']).toBeCloseTo(45.93, 2);
        // The uneven dinner (Sam owed 20 of 30) became an equal split; the adjustment covers the 5.00 gap.
        expect(plan.adjustment).toBeCloseTo(5, 2);
        expect(plan.settlements.at(-1)).toMatchObject({ from: 'm-alex', to: 'm-sam', date: '2026-01-08' });
    });

    it('refuses files that are not Splitwise exports and incomplete choices', () => {
        expect(() => parseSplitwise('a,b\n1,2')).toThrow('Splitwise');
        const file = parseSplitwise(csv);
        expect(() => planImport(file, ['m-alex', 'm-alex'], { CAD: 1, INR: 0.02 })).toThrow('different');
        expect(() => planImport(file, ['m-alex', 'm-sam'], { CAD: 1 })).toThrow('INR');
    });
});
