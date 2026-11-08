import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, query, registerWithPassword } from '../helpers';
import pool, { runMigrations } from '../../src/db';

// Fictional household. The portable export must carry everything the budget
// needs: expense groups, who paid and who shares, settle-up payments, and the
// default "split between" members (missing before v1.6).
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const as = () => ({ Authorization: `Bearer ${owner.token}` });
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('export-owner@example.test', 'fictional-password-1', 'Fictional Alex');
});
afterAll(async () => { await pool.end(); });

async function household() {
    const member = async (name: string) => (await request(app).post('/api/family').set(as()).send({ name, role: 'Parent' })).body.data.id as string;
    const alex = await member('Alex'), sam = await member('Sam');
    await request(app).put('/api/budget/sharing/settings').set(as()).send({ defaultSharers: [alex, sam] }).expect(200);
    const group = (await request(app).post('/api/budget/groups').set(as()).send({ name: 'Springfield trip', members: [alex, sam] }).expect(200)).body.data.id as string;
    await request(app).post('/api/budget/entries').set(as())
        .send({ category: 'groceries', amount: 60, date: today, is_expense: true, paid_by: alex, split_with: [alex, sam], group_id: group }).expect(200);
    await request(app).post('/api/budget/settlements').set(as())
        .send({ from: sam, to: alex, amount: 30, date: today, group_id: group, note: 'Fictional e-transfer' }).expect(200);
    return { alex, sam, group };
}

describe('portable export of shared budgets', () => {
    it('includes groups, settlements, sharing defaults and who paid', async () => {
        const { alex, sam, group } = await household();
        const data = (await request(app).get('/api/data/export').set(as()).expect(200)).body.data;
        expect(data.budget_groups).toHaveLength(1);
        expect(data.budget_groups[0]).toMatchObject({ id: group, name: 'Springfield trip', members: [alex, sam] });
        expect(data.budget_settlements).toEqual([expect.objectContaining({ group_id: group, from_member: sam, to_member: alex, date: today, note: 'Fictional e-transfer' })]);
        expect(Number(data.budget_settlements[0].amount)).toBe(30);
        expect(data.budget_sharing.members).toEqual([alex, sam]);
        expect(data.budget_entries[0]).toMatchObject({ paid_by: alex, split_with: [alex, sam], group_id: group });
    });

    it('restores the shared budget into an empty installation', async () => {
        const { alex, sam, group } = await household();
        const file = (await request(app).get('/api/data/export').set(as()).expect(200)).body.data;
        await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
        owner = await registerWithPassword('export-owner@example.test', 'fictional-password-1', 'Fictional Alex');
        const imported = await request(app).post('/api/data/import').set(as()).send(file);
        expect(imported.status).toBe(200);

        const groups = (await query('SELECT id, name, members FROM budget_groups WHERE user_id = $1', [owner.user.id])).rows;
        expect(groups).toEqual([{ id: group, name: 'Springfield trip', members: [alex, sam] }]);
        const entry = (await query('SELECT paid_by, split_with, group_id FROM budget_entries WHERE user_id = $1', [owner.user.id])).rows[0];
        expect(entry).toEqual({ paid_by: alex, split_with: [alex, sam], group_id: group });
        const settlement = (await query('SELECT from_member, to_member, amount, group_id FROM budget_settlements WHERE user_id = $1', [owner.user.id])).rows[0];
        expect(settlement).toMatchObject({ from_member: sam, to_member: alex, group_id: group });
        expect(Number(settlement.amount)).toBe(30);
        const sharing = (await query('SELECT members FROM budget_sharing_settings WHERE user_id = $1', [owner.user.id])).rows[0];
        expect(sharing.members).toEqual([alex, sam]);

        // The restored balances match: Sam's half of 60 is settled by the 30 payment.
        const summary = (await request(app).get(`/api/budget/sharing?month=${today.slice(0, 7)}&group=${group}`).set(as()).expect(200)).body.data;
        expect(summary.balance.owes).toEqual([]);
    });

    it('drops references to members, groups and amounts that do not fit', async () => {
        const { alex, group } = await household();
        const file = (await request(app).get('/api/data/export').set(as()).expect(200)).body.data;
        const stranger = '00000000-0000-4000-8000-000000000001';
        file.budget_groups[0].members.push(stranger);
        file.budget_entries[0].split_with.push(stranger);
        file.budget_entries[0].group_id = stranger;
        file.budget_settlements.push({ ...file.budget_settlements[0], id: '00000000-0000-4000-8000-000000000002', from_member: alex, to_member: alex });
        file.budget_settlements.push({ ...file.budget_settlements[0], id: '00000000-0000-4000-8000-000000000003', amount: -5 });
        await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
        owner = await registerWithPassword('export-owner@example.test', 'fictional-password-1', 'Fictional Alex');
        expect((await request(app).post('/api/data/import').set(as()).send(file)).status).toBe(200);

        expect((await query('SELECT members FROM budget_groups WHERE id = $1', [group])).rows[0].members).not.toContain(stranger);
        const entry = (await query('SELECT split_with, group_id FROM budget_entries WHERE user_id = $1', [owner.user.id])).rows[0];
        expect(entry.split_with).not.toContain(stranger);
        expect(entry.group_id).toBeNull();
        expect((await query('SELECT count(*)::int AS n FROM budget_settlements WHERE user_id = $1', [owner.user.id])).rows[0].n).toBe(1);
    });
});
