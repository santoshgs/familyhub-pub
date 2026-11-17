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
            tasks: [],
            // Family Updates (v2.2): one source kept off the display.
            daycare: [
                { id: 'k1', title: 'Fictional class trip', text: 'Bring a lunch.', receivedAt: start, kind: 'message', hasDetails: true, source: { id: 'Label_1', name: 'School' }, display: true },
                { id: 'k2', title: 'Fictional private note', text: 'Not for the kitchen.', receivedAt: start, kind: 'message', hasDetails: true, source: { id: 'Label_2', name: 'Teacher' }, display: false },
                { id: 'k3', title: 'Fictional nap', text: 'Slept 45 minutes.', receivedAt: start, kind: 'activity', hasDetails: true },
            ],
            sources: {},
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

it('keeps Family Updates sources marked off the display away from the frame', async () => {
    const display = (await request(app).post('/api/familyhub/ambient/display-session').set(as(owner.token)).send({})).body.data.token as string;
    const notifications = (await request(app).get('/api/familyhub/ambient').set(as(display))).body.data.notifications as { id: string; source: string }[];
    expect(notifications.map((item) => item.id)).toEqual(['k1', 'k3']);
    expect(notifications[0].source).toBe('School');
});
