import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const ambient = vi.hoisted(() => ({
    load: vi.fn(), settings: vi.fn(), save: vi.fn(), search: vi.fn(),
}));
vi.mock('../../src/services/familyhub/ambient', async (original) => {
    const real = await original<typeof import('../../src/services/familyhub/ambient')>();
    return {
        ...real,
        loadAmbientSnapshot: ambient.load,
        readAmbientSettings: ambient.settings,
        saveAmbientSettings: ambient.save,
        searchWeatherLocations: ambient.search,
    };
});

import { app, registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { verifyAccessToken } from '../../src/lib/authTokens';
import { normalizeRaceSchedule } from '../../src/services/familyhub/ambient';

const PASSWORD = 'fictional-password-1';
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const auth = (method: 'get' | 'post' | 'put' | 'delete', path: string, token = owner.token, body?: unknown) => {
    const requestBuilder = request(app)[method](path).set('Authorization', `Bearer ${token}`);
    return body === undefined ? requestBuilder : requestBuilder.send(body);
};

beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Ambient tests require a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('ambient-owner@example.test', PASSWORD, 'Fictional Owner');
    ambient.load.mockResolvedValue({ generatedAt: '2026-11-02T12:00:00.000Z', events: [], tasks: [], chores: [], notifications: [], settings: { location: null, widgets: ['calendar'] } });
    ambient.settings.mockResolvedValue({ location: null, widgets: ['calendar', 'weather', 'tasks', 'chores', 'daycare', 'f1'] });
    ambient.save.mockImplementation(async (_family: string, value: unknown) => value);
    ambient.search.mockResolvedValue([{ id: 1, city: 'Springfield', region: 'Illinois', country: 'United States', latitude: 43.6532, longitude: -79.3832 }]);
});
afterAll(async () => { await pool.end(); });

it('serves the ambient snapshot to protected displays without opening write APIs', async () => {
    const issued = await auth('post', '/api/familyhub/ambient/display-session');
    expect(issued.status).toBe(200);
    const token = issued.body.data.token as string;
    const result = await auth('get', '/api/familyhub/ambient', token);
    expect(result.status).toBe(200);
    expect(result.body.data.settings.widgets).toEqual(['calendar']);
    expect(ambient.load).toHaveBeenCalledWith(owner.user.id);
    expect((await auth('put', '/api/familyhub/ambient/settings', token, { widgets: ['calendar'] })).status).toBe(403);
    expect((await auth('get', '/api/familyhub', token)).status).toBe(403);
    expect((await auth('get', '/api/notes', token)).status).toBe(403);
    expect((await auth('get', '/api/familyhub/modules', token)).status).toBe(200);
    expect((await auth('get', '/api/familyhub/google/calendar?start=2026-11-02T00:00:00Z&end=2026-11-03T00:00:00Z', token)).status).toBe(403);
    expect((await auth('post', '/api/familyhub/ambient/display-session', token, {})).status).toBe(403);
});

it('keeps weather selection in parent settings and validates the location-search route', async () => {
    const childInvite = await auth('post', '/api/invites', owner.token, { role: 'enfant' });
    expect(childInvite.status).toBe(200);
    const child = await request(app).post('/api/auth/register').send({ email: 'ambient-child@example.test', name: 'Fictional Child', password: PASSWORD, inviteToken: childInvite.body.data.token });
    expect(child.status).toBe(200);
    expect((await auth('get', '/api/familyhub/ambient/settings', child.body.data.token)).status).toBe(200);
    expect((await auth('put', '/api/familyhub/ambient/settings', child.body.data.token, { widgets: ['calendar'] })).status).toBe(403);
    expect((await auth('put', '/api/familyhub/ambient/settings', owner.token, { location: null, widgets: ['calendar', 'weather'] })).status).toBe(200);
    expect((await auth('get', '/api/familyhub/ambient/locations?q=T')).status).toBe(400);
    expect((await auth('get', '/api/familyhub/ambient/locations?q=Springfield')).body.data[0]).toMatchObject({ city: 'Springfield', country: 'United States' });
});

it('renews only protected display tokens and never upgrades their read-only scope', async () => {
    const issued = await auth('post', '/api/familyhub/ambient/display-session');
    const refreshed = await auth('post', '/api/familyhub/display/refresh', issued.body.data.token, {});
    expect(refreshed.status).toBe(200);
    expect(await verifyAccessToken(refreshed.body.data.token)).toMatchObject({ userId: owner.user.id, ownerId: owner.user.id, readOnly: true, ambientOnly: true });
    expect((await auth('post', '/api/familyhub/display/refresh', owner.token, {})).status).toBe(403);
});

it('redeems a one-use frame pairing code for only an ambient token', async () => {
    const issued = await auth('post', '/api/familyhub/display/pairing-code');
    expect(issued.status).toBe(200);
    expect(issued.body.data.code).toMatch(/^\d{8}$/);
    const paired = await request(app).post('/api/familyhub/display/pair').send({ code: issued.body.data.code });
    expect(paired.status).toBe(200);
    expect(await verifyAccessToken(paired.body.data.token)).toMatchObject({ userId: owner.user.id, readOnly: true, ambientOnly: true });
    expect((await request(app).post('/api/familyhub/display/pair').send({ code: issued.body.data.code })).status).toBe(401);
    expect((await auth('get', '/api/notes', paired.body.data.token)).status).toBe(403);
});

it('gives every paired frame its own named, revocable display session', async () => {
    const issued = await auth('post', '/api/familyhub/display/pairing-code', owner.token, { name: '  Kitchen   frame ' });
    expect(issued.body.data.name).toBe('Kitchen frame');
    const paired = await request(app).post('/api/familyhub/display/pair').send({ code: issued.body.data.code });
    const frameToken = paired.body.data.token as string;
    const verified = await verifyAccessToken(frameToken);
    expect(verified.displaySessionId).toMatch(/^[0-9a-f-]{36}$/);

    const sessions = await auth('get', '/api/familyhub/display/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.data).toEqual([expect.objectContaining({ id: verified.displaySessionId, name: 'Kitchen frame' })]);

    // The frame itself can neither list nor revoke displays, nor mint codes.
    expect((await auth('get', '/api/familyhub/display/sessions', frameToken)).status).toBe(403);
    expect((await auth('post', '/api/familyhub/display/pairing-code', frameToken, {})).status).toBe(403);

    // Renewal keeps the same session; revoking it signs out only that frame.
    const renewed = await auth('post', '/api/familyhub/display/refresh', frameToken, {});
    expect((await verifyAccessToken(renewed.body.data.token)).displaySessionId).toBe(verified.displaySessionId);
    expect((await auth('delete', `/api/familyhub/display/sessions/${verified.displaySessionId}`)).status).toBe(200);
    expect((await auth('get', '/api/familyhub/ambient', frameToken)).status).toBe(401);
    expect((await auth('get', '/api/familyhub/ambient', renewed.body.data.token)).status).toBe(401);
    expect((await auth('get', '/api/auth/me')).status).toBe(200);
    expect((await auth('get', '/api/familyhub/display/sessions')).body.data).toEqual([]);
    expect((await auth('delete', `/api/familyhub/display/sessions/${verified.displaySessionId}`)).status).toBe(404);
});

it('moves an older session-less ambient token onto a revocable session when it renews', async () => {
    const { issueAccessToken } = await import('../../src/lib/authTokens');
    const row = (await query('SELECT id, family_owner_id, token_version FROM users WHERE id=$1', [owner.user.id])).rows[0];
    const legacy = issueAccessToken(row, 'ambient');
    expect((await verifyAccessToken(legacy)).displaySessionId).toBeUndefined();
    const renewed = await auth('post', '/api/familyhub/display/refresh', legacy, {});
    expect(renewed.status).toBe(200);
    const sessionId = (await verifyAccessToken(renewed.body.data.token)).displaySessionId;
    expect(sessionId).toBeDefined();
    expect((await auth('get', '/api/familyhub/display/sessions')).body.data).toEqual([expect.objectContaining({ id: sessionId, name: 'Photo frame' })]);
});

it('refuses forged display-session claims', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ userId: owner.user.id, ownerId: owner.user.id, tv: 0, scope: 'ambient', sid: '00000000-0000-4000-8000-000000000000' }, process.env.JWT_SECRET!);
    expect((await auth('get', '/api/familyhub/ambient', forged)).status).toBe(401);
    const malformed = jwt.sign({ userId: owner.user.id, ownerId: owner.user.id, tv: 0, scope: 'ambient', sid: 'not-a-uuid' }, process.env.JWT_SECRET!);
    expect((await auth('get', '/api/familyhub/ambient', malformed)).status).toBe(401);
    const fullScope = jwt.sign({ userId: owner.user.id, ownerId: owner.user.id, tv: 0, sid: '00000000-0000-4000-8000-000000000000' }, process.env.JWT_SECRET!);
    expect((await auth('get', '/api/auth/me', fullScope)).status).toBe(401);
});

it('lets a frame recover from a few mistyped pairing codes', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        expect((await request(app).post('/api/familyhub/display/pair').send({ code: '00000000' })).status).toBe(401);
    }
    const issued = await auth('post', '/api/familyhub/display/pairing-code');
    expect((await request(app).post('/api/familyhub/display/pair').send({ code: issued.body.data.code })).status).toBe(200);
    // Creating a new code invalidates the previous unused one.
    const first = await auth('post', '/api/familyhub/display/pairing-code');
    await auth('post', '/api/familyhub/display/pairing-code');
    expect((await request(app).post('/api/familyhub/display/pair').send({ code: first.body.data.code })).status).toBe(401);
});

it('selects the next future Formula 1 event and preserves session times as UTC instants', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    const races = [
        { raceName: 'Mexico City Grand Prix', date: '2026-11-01', time: '20:00:00Z', Circuit: { circuitName: 'Autódromo Hermanos Rodríguez', Location: { locality: 'Mexico City', country: 'Mexico' } } },
        { raceName: 'São Paulo Grand Prix', date: '2026-11-08', time: '17:00:00Z', Qualifying: { date: '2026-11-07', time: '18:00:00Z' }, Circuit: { circuitName: 'Interlagos', Location: { locality: 'São Paulo', country: 'Brazil' } } },
    ];
    expect(normalizeRaceSchedule(races, now)).toMatchObject({
        name: 'São Paulo Grand Prix', circuit: 'Interlagos', location: 'São Paulo', country: 'Brazil',
        raceDateTime: '2026-11-08T17:00:00Z', sessions: [{ name: 'Qualifying', dateTime: '2026-11-07T18:00:00Z' }],
    });
});
