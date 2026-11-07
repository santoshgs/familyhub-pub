import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// Fictional events: the Google loader is replaced so the real snapshot runs offline.
vi.mock('../../src/services/familyhub/google/runtime', async (original) => {
    const real = await original<typeof import('../../src/services/familyhub/google/runtime')>();
    const start = new Date(Date.now() + 3_600_000).toISOString();
    return {
        ...real,
        syncGoogle: async () => ({
            events: [
                { id: 'a', title: 'Fictional swim', start: { dateTime: start }, end: { dateTime: start }, color: '#039BE5' },
                { id: 'b', title: 'Fictional dentist', start: { dateTime: start }, end: { dateTime: start }, color: '#7986cb' },
                { id: 'c', title: 'Odd colour', start: { dateTime: start }, end: { dateTime: start }, color: 'red; background:url(x)' },
                { id: 'd', title: 'No colour', start: { dateTime: start }, end: { dateTime: start } },
            ],
            tasks: [], daycare: [], sources: {},
        }),
    };
});
import { app, query, registerWithPassword } from '../helpers';
import pool, { runMigrations } from '../../src/db';

let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('colours-owner@example.test', 'fictional-password-1', 'Fictional Owner');
});
afterAll(async () => { await pool.end(); });

it('sends each event its Google colour and the household legend label, and drops anything that is not a colour', async () => {
    expect((await request(app).put('/api/familyhub/preferences/legend').set(as(owner.token)).send({ legend: { '#039BE5': 'Fictional Alex' } })).status).toBe(200);
    const display = (await request(app).post('/api/familyhub/ambient/display-session').set(as(owner.token)).send({})).body.data.token as string;
    const snapshot = await request(app).get('/api/familyhub/ambient').set(as(display));
    expect(snapshot.status).toBe(200);
    const byId = Object.fromEntries(snapshot.body.data.events.map((event: { id: string }) => [event.id, event]));
    expect(byId.a).toMatchObject({ color: '#039be5', colorLabel: 'Fictional Alex' });
    expect(byId.b).toMatchObject({ color: '#7986cb' });
    expect(byId.b.colorLabel).toBeUndefined();
    expect(byId.c.color).toBeUndefined();
    expect(byId.d.color).toBeUndefined();
});
