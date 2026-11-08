import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/familyhub/google/connection', async (original) => {
    const real = await original<typeof import('../../src/services/familyhub/google/connection')>();
    return { ...real,
        getGoogleAccessToken: async () => 'fictional-access',
        googleStatus: async (family: string) => {
            const { query } = await import('../../src/db');
            const row = (await query('SELECT email FROM familyhub_google_connections WHERE family_id=$1', [family])).rows[0];
            return { configured: true, connected: Boolean(row), email: row?.email, gmail: false, scopes: [], missingConfiguration: [] };
        },
    };
});
import pool, { query, runMigrations } from '../../src/db';
import { app, registerWithPassword } from '../helpers';
import { decodeItem, encodeNotes, parseQuantity } from '../../src/services/familyhub/shopping';
import { saveDisabledModules } from '../../src/lib/modules';

// A fictional Google Tasks account held in memory: lists and their tasks.
type FakeTask = { id: string; title: string; notes?: string; status: 'needsAction' | 'completed'; hidden?: boolean; position: string };
let lists: Map<string, { title: string; tasks: FakeTask[] }>;
let seq = 0;
const json = (value: unknown, status = 200) => Response.json(value, { status });
const transport = async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    const path = url.pathname.replace('/tasks/v1/', '');
    if (path === 'users/@me/lists') {
        if (method === 'POST') { const id = `list-${++seq}`; lists.set(id, { title: body.title, tasks: [] }); return json({ id, title: body.title }); }
        return json({ items: [...lists].map(([id, l]) => ({ id, title: l.title })) });
    }
    const m = /^lists\/([^/]+)\/(tasks(?:\/([^/]+))?|clear)$/.exec(path);
    const list = m && lists.get(decodeURIComponent(m[1]));
    if (!m || !list) return json({}, 404);
    if (m[2] === 'clear') { list.tasks.forEach((t) => { if (t.status === 'completed') t.hidden = true; }); return new Response(null, { status: 204 }); }
    const id = m[3] && decodeURIComponent(m[3]);
    if (!id && method === 'POST') { const t: FakeTask = { id: `t-${++seq}`, title: body.title, notes: body.notes, status: 'needsAction', position: String(seq).padStart(8, '0') }; list.tasks.push(t); return json(t); }
    if (!id) return json({ items: list.tasks.filter((t) => url.searchParams.get('showHidden') === 'true' || !t.hidden) });
    const task = list.tasks.find((t) => t.id === id);
    if (!task) return json({}, 404);
    if (method === 'DELETE') { list.tasks.splice(list.tasks.indexOf(task), 1); return new Response(null, { status: 204 }); }
    if (method === 'PATCH') { Object.assign(task, body); return json(task); }
    return json(task);
};

let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const as = (token = owner.token) => ({ Authorization: `Bearer ${token}` });
const connect = () => query(`INSERT INTO familyhub_google_connections (family_id,subject,email,encrypted_tokens,scopes) VALUES ($1,'fictional-subject','hub@example.test','fictional-ciphertext',ARRAY[]::text[])`, [owner.user.id]);
const page = async (token = owner.token) => (await request(app).get('/api/familyhub/shopping').set(as(token)).expect(200)).body.data;

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('shopping-owner@example.test', 'fictional-password-1', 'Fictional Alex');
    await saveDisabledModules(owner.user.id, []); // shopping is off by default
    lists = new Map([['todo', { title: 'Family to-dos', tasks: [] }], ['bulk', { title: 'Bulk store', tasks: [] }], ['grocer', { title: 'Grocer', tasks: [] }]]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(transport as typeof fetch);
});
afterAll(async () => { vi.restoreAllMocks(); await pool.end(); });

describe('item format in Google Tasks', () => {
    it('round-trips quantity, unit, aisle and notes through the task notes', () => {
        const notes = encodeNotes({ quantity: 2, unit: 'L', aisle: 'Dairy', notes: 'Lactose-free' });
        expect(notes).toBe('Qty: 2 L\nAisle: Dairy\nLactose-free');
        expect(decodeItem({ id: 'x', title: 'Milk', notes, completed: false, position: '1', updated: null }))
            .toMatchObject({ name: 'Milk', quantity: 2, unit: 'L', aisle: 'Dairy', notes: 'Lactose-free', checked: false });
    });
    it('reads items typed in Google’s own app, French headers and odd quantities', () => {
        expect(decodeItem({ id: 'x', title: 'Bread', notes: '', completed: true, position: '', updated: null })).toMatchObject({ quantity: null, unit: null, aisle: null, notes: '', checked: true });
        expect(decodeItem({ id: 'x', title: 'Pommes', notes: 'Qté : 1,5 kg\nRayon: Fruits', completed: false, position: '', updated: null })).toMatchObject({ quantity: 1.5, unit: 'kg', aisle: 'Fruits' });
        expect(parseQuantity('a dozen')).toEqual({ quantity: null, unit: 'a dozen' });
        // A note that looks like a header is protected from being read as one.
        const tricky = encodeNotes({ quantity: null, unit: null, aisle: null, notes: 'Aisle: ask staff' });
        expect(decodeItem({ id: 'x', title: 'Glue', notes: tricky, completed: false, position: '', updated: null }).aisle).toBeNull();
    });
});

describe('shopping lists on Google Tasks', () => {
    it('is closed while the shopping module is switched off', async () => {
        await saveDisabledModules(owner.user.id, ['shopping']);
        expect((await request(app).get('/api/familyhub/shopping').set(as())).status).toBe(403);
    });
    it('stays on the local list until Google is connected and lists are chosen', async () => {
        expect(await page()).toMatchObject({ mode: 'local', connected: false });
        await connect();
        expect(await page()).toMatchObject({ mode: 'local', connected: true, lists: [] });
        const settings = (await request(app).get('/api/familyhub/shopping/settings').set(as()).expect(200)).body.data;
        expect(settings.available.map((l: { id: string }) => l.id)).toEqual(['todo', 'bulk', 'grocer']);
    });

    it('shows the chosen lists in order with editable, movable items', async () => {
        await connect();
        await request(app).put('/api/familyhub/shopping/settings').set(as()).send({ lists: ['grocer', 'bulk'] }).expect(200);
        expect((await request(app).put('/api/familyhub/shopping/settings').set(as()).send({ lists: ['not-a-list'] })).status).toBe(400);

        const added = (await request(app).post('/api/familyhub/shopping/lists/bulk/items').set(as())
            .send({ name: '  Paper towels ', quantity: '2', unit: 'packs', aisle: 'Household' }).expect(200)).body.data;
        expect(added).toMatchObject({ name: 'Paper towels', quantity: 2, unit: 'packs', aisle: 'Household', checked: false });
        expect(lists.get('bulk')!.tasks[0].notes).toBe('Qty: 2 packs\nAisle: Household');

        const edited = (await request(app).patch(`/api/familyhub/shopping/lists/bulk/items/${added.id}`).set(as())
            .send({ name: 'Paper towels (12)', quantity: 1, notes: 'Store brand' }).expect(200)).body.data;
        expect(edited).toMatchObject({ name: 'Paper towels (12)', quantity: 1, unit: 'packs', aisle: 'Household', notes: 'Store brand' });

        await request(app).patch(`/api/familyhub/shopping/lists/bulk/items/${added.id}`).set(as()).send({ checked: true }).expect(200);
        const moved = (await request(app).patch(`/api/familyhub/shopping/lists/bulk/items/${added.id}`).set(as()).send({ moveTo: 'grocer' }).expect(200)).body.data;
        expect(lists.get('bulk')!.tasks).toHaveLength(0);
        expect(moved).toMatchObject({ name: 'Paper towels (12)', checked: true, quantity: 1 });

        const data = await page();
        expect(data.mode).toBe('google');
        expect(data.lists.map((l: { title: string }) => l.title)).toEqual(['Grocer', 'Bulk store']);
        expect(data.lists[0].items).toHaveLength(1);

        await request(app).post('/api/familyhub/shopping/lists/grocer/clear').set(as()).expect(200);
        expect((await page()).lists[0].items).toHaveLength(0);
    });

    it('never touches a task list that is not a shopping list', async () => {
        await connect();
        await request(app).put('/api/familyhub/shopping/settings').set(as()).send({ lists: ['grocer'] }).expect(200);
        lists.get('todo')!.tasks.push({ id: 'private', title: 'Fictional to-do', status: 'needsAction', position: '1' });
        expect((await request(app).post('/api/familyhub/shopping/lists/todo/items').set(as()).send({ name: 'x' })).status).toBe(404);
        expect((await request(app).delete('/api/familyhub/shopping/lists/todo/items/private').set(as())).status).toBe(404);
        const g = (await request(app).post('/api/familyhub/shopping/lists/grocer/items').set(as()).send({ name: 'Eggs' })).body.data;
        expect((await request(app).patch(`/api/familyhub/shopping/lists/grocer/items/${g.id}`).set(as()).send({ moveTo: 'todo' })).status).toBe(404);
        expect(lists.get('todo')!.tasks).toHaveLength(1);
    });

    it('creates a new Google list, lets children shop but not configure, and keeps displays out', async () => {
        await connect();
        const list = (await request(app).post('/api/familyhub/shopping/lists').set(as()).send({ title: 'Pharmacy' }).expect(200)).body.data;
        expect(lists.get(list.id)!.title).toBe('Pharmacy');
        expect((await page()).lists.map((l: { title: string }) => l.title)).toEqual(['Pharmacy']);

        const invitation = await request(app).post('/api/invites').set(as()).send({ role: 'enfant' });
        const child = (await request(app).post('/api/auth/register').send({ email: 'shopping-child@example.test', name: 'Fictional child', password: 'fictional-password-1', inviteToken: invitation.body.data.token })).body.data.token;
        expect((await request(app).post(`/api/familyhub/shopping/lists/${list.id}/items`).set(as(child)).send({ name: 'Plasters' })).status).toBe(200);
        expect((await request(app).put('/api/familyhub/shopping/settings').set(as(child)).send({ lists: [] })).status).toBe(403);

        const display = (await request(app).post('/api/familyhub/display-session').set(as()).expect(200)).body.data.token;
        expect((await request(app).get('/api/familyhub/shopping').set(as(display))).status).toBe(403);
    });

    it('copies the old local list once, with aisle names, and keeps the local rows', async () => {
        await connect();
        await request(app).post('/api/shopping').set(as()).send({ name: 'Fictional rice', category: 'Alimentation', quantity: 2, unit: 'kg' }).expect(200);
        const done = (await request(app).post('/api/shopping').set(as()).send({ name: 'Already bought', category: 'Alimentation' })).body.data;
        await request(app).put(`/api/shopping/${done.id}`).set(as()).send({ is_checked: true }).expect(200);
        await request(app).put('/api/familyhub/shopping/settings').set(as()).send({ lists: ['grocer'] }).expect(200);
        expect((await page()).migration).toMatchObject({ localItems: 1, migratedAt: null });

        const result = await request(app).post('/api/familyhub/shopping/migrate').set(as()).send({ listId: 'grocer', aisleLabels: { Alimentation: 'Food' } });
        expect(result.body.data).toEqual({ copied: 1 });
        expect(lists.get('grocer')!.tasks.map((t) => [t.title, t.notes])).toEqual([['Fictional rice', 'Qty: 2 kg\nAisle: Food']]);
        expect((await page()).migration).toMatchObject({ localItems: 1, migratedCount: 1 });
        expect((await request(app).post('/api/familyhub/shopping/migrate').set(as()).send({ listId: 'grocer' })).status).toBe(409);
        expect((await query('SELECT count(*)::int AS n FROM shopping_items WHERE user_id=$1', [owner.user.id])).rows[0].n).toBe(2);
    });
});
