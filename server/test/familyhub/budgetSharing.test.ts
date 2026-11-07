import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, query, registerWithPassword } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { computeSharing, settle, shares } from '../../src/lib/budgetSplit';
import { BUDGET_CATEGORIES } from '../../src/lib/budgetCategories';

// Fictional household: Alex and Sam are the parents, Kid is a child profile.
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
let alex = '', sam = '', kid = '';
const as = (token = owner.token) => ({ Authorization: `Bearer ${token}` });
const month = new Date().toISOString().slice(0, 7);
const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const summary = async (group = 'all') => (await request(app).get(`/api/budget/sharing?month=${month}&group=${group}`).set(as())).body.data;
const add = (body: object) => request(app).post('/api/budget/entries').set(as()).send({ category: 'groceries', date: today, is_expense: true, ...body });

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('budget-owner@example.test', 'fictional-password-1', 'Fictional Alex');
    const member = async (name: string, role: string) => (await request(app).post('/api/family').set(as()).send({ name, role })).body.data.id as string;
    alex = await member('Alex', 'Parent'); sam = await member('Sam', 'Parent'); kid = await member('Kid', 'Enfant');
});
afterAll(async () => { await pool.end(); });

describe('splitting arithmetic', () => {
    it('splits to the cent and gives leftover cents to the non-payers', () => {
        expect(Object.fromEntries(shares(4411, 'alex', ['alex', 'sam']))).toEqual({ sam: 2206, alex: 2205 });
        expect([...shares(1000, 'a', ['a', 'b', 'c']).values()].reduce((x, y) => x + y)).toBe(1000);
        expect(Object.fromEntries(shares(500, 'a', []))).toEqual({ a: 500 });
    });
    it('totals, nets and the fewest payments', () => {
        const result = computeSharing(['a', 'b', 'c'], [
            { amount: 90, paidBy: 'a', participants: ['a', 'b', 'c'] },
            { amount: 30, paidBy: 'b', participants: ['a', 'b', 'c'] },
        ], [{ from: 'c', to: 'a', amount: 10 }]);
        expect(result.total).toBe(120);
        expect(result.members).toEqual([{ id: 'a', paid: 90, share: 40, net: 40 }, { id: 'b', paid: 30, share: 40, net: -10 }, { id: 'c', paid: 0, share: 40, net: -30 }]);
        expect(result.owes).toEqual([{ from: 'c', to: 'a', amount: 30 }, { from: 'b', to: 'a', amount: 10 }]);
        expect(settle(new Map([['x', 0]]))).toEqual([]);
    });
});

describe('categories', () => {
    it('accepts only the fixed category keys for new transactions', async () => {
        expect(BUDGET_CATEGORIES).toContain('home-gas');
        expect(BUDGET_CATEGORIES).toContain('fuel');
        expect((await add({ amount: 10 })).status).toBe(200);
        expect((await add({ amount: 10, category: 'Alimentation' })).status).toBe(400);
        expect((await request(app).put('/api/categories').set(as()).send({ module: 'budget', categories: ['x'] })).status).toBe(400);
        expect((await request(app).get('/api/categories').set(as())).body.data.categories.budget).toEqual(BUDGET_CATEGORIES);
    });
    it('keeps a legacy category on edit but refuses to switch to another unknown one', async () => {
        const row = await query("INSERT INTO budget_entries (user_id, category, amount, date, is_expense) VALUES ($1, 'Fictional custom', 5, $2, true) RETURNING id", [owner.user.id, today]);
        const id = row.rows[0].id;
        expect((await request(app).put(`/api/budget/entries/${id}`).set(as()).send({ category: 'Fictional custom', amount: 6 })).status).toBe(200);
        expect((await request(app).put(`/api/budget/entries/${id}`).set(as()).send({ category: 'Other custom' })).status).toBe(400);
        expect((await request(app).put(`/api/budget/entries/${id}`).set(as()).send({ category: 'coffee' })).status).toBe(200);
    });
});

describe('shared expenses', () => {
    it('splits between the parents by default and reports who owes whom this month', async () => {
        const created = await add({ amount: 44.11, paid_by: alex, description: 'Fictional grocer' });
        expect(created.body.data).toMatchObject({ paid_by: alex, split_with: [], group_id: null });
        await add({ amount: 20, paid_by: sam, split_with: [sam, alex] });
        await add({ amount: 15, paid_by: alex, split_with: [kid] }); // all for the child
        await add({ amount: 99, description: 'Not shared (no payer)' });
        const data = await summary();
        expect(data.defaultSharers.sort()).toEqual([alex, sam].sort());
        expect(data.month.total).toBe(79.11);
        const byId = Object.fromEntries(data.month.members.map((m: any) => [m.id, m]));
        expect(byId[alex]).toMatchObject({ paid: 59.11, share: 32.05 });
        expect(byId[sam]).toMatchObject({ paid: 20, share: 32.06 });
        expect(byId[kid]).toMatchObject({ paid: 0, share: 15 });
        expect(data.balance.owes).toEqual(expect.arrayContaining([{ from: kid, to: alex, amount: 15 }, { from: sam, to: alex, amount: 12.06 }]));
    });

    it('settles up, which clears the outstanding balance but not the monthly totals', async () => {
        await add({ amount: 100, paid_by: alex });
        expect((await summary()).balance.owes).toEqual([{ from: sam, to: alex, amount: 50 }]);
        const paid = await request(app).post('/api/budget/settlements').set(as()).send({ from: sam, to: alex, amount: '50', date: today });
        expect(paid.status).toBe(200);
        const after = await summary();
        expect(after.balance.owes).toEqual([]);
        expect(after.month.owes).toEqual([{ from: sam, to: alex, amount: 50 }]);
        expect(after.settlements).toHaveLength(1);
        expect((await request(app).post('/api/budget/settlements').set(as()).send({ from: sam, to: sam, amount: 5 })).status).toBe(400);
        expect((await request(app).post('/api/budget/settlements').set(as()).send({ from: sam, to: alex, amount: -5 })).status).toBe(400);
        expect((await request(app).delete(`/api/budget/settlements/${paid.body.data.id}`).set(as())).status).toBe(200);
        expect((await summary()).balance.owes).toEqual([{ from: sam, to: alex, amount: 50 }]);
    });

    it('keeps an expense group separate, splitting between its members', async () => {
        const trip = await request(app).post('/api/budget/groups').set(as()).send({ name: 'Fictional beach trip', members: [alex, sam, kid] });
        expect(trip.status).toBe(200);
        const groupId = trip.body.data.id;
        await add({ amount: 90, paid_by: sam, group_id: groupId, category: 'flight' });
        await add({ amount: 10, paid_by: alex });
        const grouped = await summary(groupId);
        expect(grouped.month.total).toBe(90);
        expect(grouped.balance.owes).toEqual(expect.arrayContaining([{ from: alex, to: sam, amount: 30 }, { from: kid, to: sam, amount: 30 }]));
        const loose = await summary('none');
        expect(loose.month.total).toBe(10);
        expect(loose.balance.owes).toEqual([{ from: sam, to: alex, amount: 5 }]);
        expect((await summary()).groups[0]).toMatchObject({ name: 'Fictional beach trip', owes: expect.any(Array) });
        expect((await request(app).delete(`/api/budget/groups/${groupId}`).set(as())).status).toBe(200);
        expect((await summary()).month.total).toBe(100); // its expenses stay, ungrouped
    });

    it('counts recurring expenses with a payer once each occurrence is due', async () => {
        const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 2); start.setUTCDate(1);
        const recurring = await request(app).post('/api/budget/recurring').set(as()).send({ label: 'Fictional rent', amount: 1000, category: 'rent', start_date: start.toISOString().slice(0, 10), recurrence_frequency: 'monthly', is_expense: true, paid_by: alex });
        expect(recurring.status).toBe(200);
        const data = await summary();
        expect(data.month.total).toBe(1000);
        expect(data.balance.owes).toEqual([{ from: sam, to: alex, amount: 1500 }]);
        expect(data.history.slice(-3).map((m: any) => m.total)).toEqual([1000, 1000, 1000]);
    });

    it('validates members and groups, and saves the default sharers', async () => {
        const other = await registerWithPassword('budget-other@example.test');
        const foreign = (await request(app).post('/api/family').set(as(other.token)).send({ name: 'Elsewhere', role: 'Parent' })).body.data.id;
        expect((await add({ amount: 5, paid_by: foreign })).status).toBe(400);
        expect((await add({ amount: 5, paid_by: alex, split_with: [foreign] })).status).toBe(400);
        expect((await add({ amount: 5, paid_by: alex, group_id: '00000000-0000-0000-0000-000000000000' })).status).toBe(400);
        expect((await request(app).post('/api/budget/settlements').set(as()).send({ from: foreign, to: alex, amount: 5 })).status).toBe(400);
        expect((await request(app).get(`/api/budget/sharing?month=${month}`).set(as(other.token))).body.data.members.map((m: any) => m.name)).toEqual(['Elsewhere']);
        expect((await request(app).put('/api/budget/sharing/settings').set(as()).send({ defaultSharers: [alex, sam, kid] })).status).toBe(200);
        expect((await summary()).defaultSharers).toEqual([alex, sam, kid]);
        expect((await request(app).post('/api/budget/groups').set(as()).send({ name: '' })).status).toBe(400);
    });
});

describe('migrations 0014 and 0015: limits', () => {
    it('moves legacy limits to the new keys and drops a legacy limit whose new key already exists', async () => {
        const { budgetSharingMigrations } = await import('../../src/migrations/familyhub/budgetSharing');
        const limit = (category: string, amount: number, mon: number) => query('INSERT INTO budget_limits (user_id, category, monthly_limit, month, year) VALUES ($1,$2,$3,$4,2026)', [owner.user.id, category, amount, mon]);
        await limit('Logement', 1000, 10); await limit('Autre', 50, 10);
        await limit('Logement', 1000, 11); await limit('rent', 1100, 11);
        for (const migration of budgetSharingMigrations) for (const statement of migration.statements) await query(statement);
        const rows = (await query('SELECT category, monthly_limit::float AS amount, month FROM budget_limits WHERE user_id=$1 ORDER BY month, category', [owner.user.id])).rows;
        expect(rows).toEqual([{ category: 'general', amount: 50, month: 10 }, { category: 'rent', amount: 1000, month: 10 }, { category: 'rent', amount: 1100, month: 11 }]);
    });
});

describe('bulk import', () => {
    it('imports expenses and payments, keeps identical rows in a file, and skips them on a retry', async () => {
        const body = {
            expenses: [
                { date: '2026-10-02', description: 'Fictional bus fare', category: 'transit', amount: 10, paid_by: alex, split_with: [alex, sam] },
                { date: '2026-10-02', description: 'Fictional bus fare', category: 'transit', amount: 10, paid_by: alex, split_with: [alex, sam] },
                { date: '2026-10-03', description: 'Demo groceries', category: 'groceries', amount: 30, paid_by: sam, split_with: [alex] },
                { date: '2026-10-04', description: 'Own lunch', category: 'restaurants', amount: 12, paid_by: null, split_with: [] },
            ],
            settlements: [{ date: '2026-10-05', from: alex, to: sam, amount: 5, note: 'Imported payment' }],
        };
        const first = await request(app).post('/api/budget/import').set(as()).send(body);
        expect(first.body.data).toEqual({ expenses: 4, settlements: 1, skippedExpenses: 0, skippedSettlements: 0 });
        const again = await request(app).post('/api/budget/import').set(as()).send(body);
        expect(again.body.data).toEqual({ expenses: 0, settlements: 0, skippedExpenses: 4, skippedSettlements: 1 });
        const data = (await request(app).get('/api/budget/sharing?month=2026-10&group=all').set(as())).body.data;
        // Alex paid 20 (Sam owes 10), Sam paid 30 for Alex, Alex paid back 5: Alex owes Sam 15.
        expect(data.balance.owes).toEqual([{ from: alex, to: sam, amount: 15 }]);
        expect(data.month.total).toBe(50);
    });

    it('rejects unknown categories, strangers and oversized batches before writing', async () => {
        const bad = (expense: object) => request(app).post('/api/budget/import').set(as()).send({ expenses: [{ date: '2026-10-02', description: 'x', category: 'groceries', amount: 1, paid_by: alex, split_with: [sam], ...expense }] });
        expect((await bad({ category: 'Logement' })).status).toBe(400);
        expect((await bad({ paid_by: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
        expect((await bad({ date: '2026-02-30' })).status).toBe(400);
        expect((await request(app).post('/api/budget/import').set(as()).send({ expenses: Array(1001).fill({}) })).status).toBe(400);
        expect((await query('SELECT count(*)::int AS n FROM budget_entries')).rows[0].n).toBe(0);
    });
});
