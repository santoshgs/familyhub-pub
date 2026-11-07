import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const oauth = vi.hoisted(() => ({ start: vi.fn(), finish: vi.fn(), lapsed: false }));
vi.mock('../../src/services/familyhub/google/connection', async (original) => {
    const real = await original<typeof import('../../src/services/familyhub/google/connection')>();
    return { ...real, startGoogleConnection: oauth.start, finishGoogleConnection: oauth.finish,
        getGoogleAccessToken: async () => {
            if (oauth.lapsed) throw new real.GoogleConnectionError(401, 'Google authorization needs reconnecting.');
            return 'fictional-access';
        },
        googleStatus: async (family: string) => {
            const { query } = await import('../../src/db');
            const row = (await query('SELECT email, scopes FROM familyhub_google_connections WHERE family_id=$1', [family])).rows[0];
            return { configured: true, connected: Boolean(row), email: row?.email, gmail: row?.scopes.includes('gmail'), scopes: row?.scopes ?? [], missingConfiguration: [] };
        },
    };
});
import pool, { query, runMigrations } from '../../src/db';
import { resetAuthConfigForTests } from '../../src/config/authConfig';
import { app, registerWithPassword } from '../helpers';
import { configureSources, invalidate, syncGoogle } from '../../src/services/familyhub/google/runtime';

let owner: Awaited<ReturnType<typeof registerWithPassword>>;
let send: ReturnType<typeof vi.spyOn>;
const config = { calendarId: 'shared/family', taskListId: 'family-list', timeZone: 'America/New_York' };
const event = { id: 'demo1', summary: 'Fictional pickup', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } };
const task = { id: 'demo-task', title: 'Fictional library bag', status: 'needsAction' };
const post = (path: string, body: unknown = {}, token = owner.token) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
const get = (path: string, token = owner.token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const transport = async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.includes('calendarList')) return Response.json({ items: [{ id: config.calendarId, summary: 'Fictional shared calendar', accessRole: 'writer' }, { id: 'read-only', summary: 'Read only', accessRole: 'reader' }] });
    if (path.includes('users/@me/lists')) return Response.json({ items: [{ id: config.taskListId, title: 'Fictional tasks' }] });
    if (path.includes('gmail.googleapis.com')) return Response.json({ messages: [] });
    const value = path.includes('/events') ? event : task;
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (options?.method === 'POST' || options?.method === 'PATCH') return Response.json({ ...value, ...JSON.parse(String(options.body)) });
    return Response.json({ items: [value] });
};
async function connect() {
    await query(`INSERT INTO familyhub_google_connections (family_id,subject,email,encrypted_tokens,scopes) VALUES ($1,'fictional-subject','hub@example.test','fictional-ciphertext',ARRAY['gmail'])`, [owner.user.id]);
    await configureSources(owner.user.id, config);
    send.mockClear();
}
beforeAll(async () => {
    if (!String((await query('SELECT current_database() AS name')).rows[0].name).endsWith('_test')) throw new Error('Disposable test database required');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    delete process.env.OIDC_ISSUER_URL;
    process.env.PASSWORD_LOGIN_ENABLED = 'true'; process.env.REGISTRATION_ENABLED = 'true';
    resetAuthConfigForTests();
    owner = await registerWithPassword('fictional-google-owner@example.test', 'fictional-password-1', 'Fictional Alex');
    send = vi.spyOn(globalThis, 'fetch').mockImplementation(transport);
    oauth.start.mockReset().mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/fictional-consent' });
    oauth.finish.mockReset().mockResolvedValue(undefined);
    oauth.lapsed = false;
});
afterAll(async () => { vi.restoreAllMocks(); await pool.end(); });

it('requires authentication and scopes setup and mutations to the effective family', async () => {
    expect((await request(app).get('/api/familyhub')).status).toBe(401);
    await connect();
    const outsider = await registerWithPassword('fictional-outsider@example.test');
    expect((await get('/api/familyhub/google/status', outsider.token)).body.data.selection).toBeNull();
    expect((await post('/api/familyhub/google/tasks', { title: 'Denied' }, outsider.token)).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
});
it('saves card order per member while sharing validated colour labels within one household', async () => {
    const order = ['notes', 'calendar', 'tasks', 'daycare', 'classroom'];
    expect((await request(app).put('/api/familyhub/preferences/order').set('Authorization', `Bearer ${owner.token}`).send({ cardOrder: order })).status).toBe(200);
    expect((await request(app).put('/api/familyhub/preferences/legend').set('Authorization', `Bearer ${owner.token}`).send({ legend: { '#039BE5': 'Blue: Fictional Alex' } })).status).toBe(200);
    expect((await get('/api/familyhub/preferences')).body.data).toEqual({ cardOrder: order, hiddenModules: [], legend: { '#039be5': 'Blue: Fictional Alex' } });
    const invitation = await post('/api/invites', { role: 'enfant' });
    const child = (await request(app).post('/api/auth/register').send({ email: 'appearance-child@example.test', name: 'Fictional child', password: 'fictional-password-1', inviteToken: invitation.body.data.token })).body.data.token;
    expect((await get('/api/familyhub/preferences', child)).body.data.cardOrder).toEqual(['calendar', 'tasks', 'notes', 'daycare', 'classroom']);
    expect((await get('/api/familyhub/preferences', child)).body.data.legend).toEqual({ '#039be5': 'Blue: Fictional Alex' });
    expect((await request(app).put('/api/familyhub/preferences/legend').set('Authorization', `Bearer ${child}`).send({ legend: {} })).status).toBe(403);
    const outsider = await registerWithPassword('appearance-outsider@example.test');
    expect((await get('/api/familyhub/preferences', outsider.token)).body.data.legend).toEqual({});
    const display = (await post('/api/familyhub/display-session')).body.data.token;
    expect((await get('/api/familyhub/preferences', display)).status).toBe(200);
    expect((await request(app).put('/api/familyhub/preferences/order').set('Authorization', `Bearer ${display}`).send({ cardOrder: order })).status).toBe(403);
    for (const body of [{ cardOrder: ['calendar'] }, { cardOrder: ['calendar', 'calendar', 'notes', 'daycare', 'classroom'] }]) {
        expect((await request(app).put('/api/familyhub/preferences/order').set('Authorization', `Bearer ${owner.token}`).send(body)).status).toBe(400);
    }
    expect((await request(app).put('/api/familyhub/preferences/legend').set('Authorization', `Bearer ${owner.token}`).send({ legend: { 'url(javascript:fictional)': 'Invalid' } })).status).toBe(400);
});
it('defaults optional modules off and keeps family module preferences separate from upstream and other households', async () => {
    const initial = (await get('/api/familyhub/modules')).body.data.disabled_modules;
    expect(initial).toEqual(['shopping', 'planning', 'integrations']);
    expect(initial).not.toContain('budget'); expect(initial).not.toContain('rewards');
    const changed = await request(app).put('/api/familyhub/modules').set('Authorization', `Bearer ${owner.token}`).send({ disabled_modules: ['budget'] });
    expect(changed.status).toBe(200);
    expect((await get('/api/familyhub/modules')).body.data.disabled_modules).toEqual(['budget']);
    expect((await get('/api/auth/modules')).body.data.disabled_modules).toEqual([]);
    const outsider = await registerWithPassword('fictional-module-outsider@example.test');
    expect((await get('/api/familyhub/modules', outsider.token)).body.data.disabled_modules).toEqual(initial);
    expect((await request(app).put('/api/familyhub/modules').set('Authorization', `Bearer ${owner.token}`).send({ disabled_modules: ['calendar'] })).status).toBe(400);
});
it('permits bounded full-calendar browsing for the selected source, including displays, and rejects invalid ranges', async () => {
    await connect();
    const range = new URLSearchParams({ start: '2027-01-01T00:00:00Z', end: '2027-02-01T00:00:00Z', calendarId: 'forged' });
    const display = (await post('/api/familyhub/display-session')).body.data.token;
    const result = await get(`/api/familyhub/google/calendar?${range}`, display);
    expect(result.status).toBe(200); expect(result.body.data.events).toHaveLength(1);
    expect(send.mock.calls.map(([url]) => String(url)).some((url) => url.includes('calendars/shared%2Ffamily/events') && url.includes('timeMin=2027-01-01'))).toBe(true);
    expect((await get('/api/familyhub/modules', display)).status).toBe(200);
    expect((await request(app).put('/api/familyhub/modules').set('Authorization', `Bearer ${display}`).send({ disabled_modules: [] })).status).toBe(403);
    send.mockClear();
    expect((await get('/api/familyhub/google/calendar?start=invalid&end=invalid')).status).toBe(400);
    expect((await get('/api/familyhub/google/calendar?start=2027-01-01T00:00:00Z&end=2028-01-01T00:00:00Z')).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
    const outsider = await registerWithPassword('fictional-range-outsider@example.test');
    expect((await get(`/api/familyhub/google/calendar?${range}`, outsider.token)).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
});
it('writes only to the saved Google sources and never creates local tasks or appointments', async () => {
    await connect();
    expect((await post('/api/familyhub/google/events', { calendarId: 'forged', title: 'Fictional pickup', start: event.start, end: event.end })).status).toBe(200);
    expect((await post('/api/familyhub/google/tasks', { taskListId: 'forged', title: task.title, dueDate: '2026-11-01' })).status).toBe(200);
    expect(send.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining('calendars/shared%2Ffamily/events'), expect.stringContaining('lists/family-list/tasks'),
    ]);
    expect((await query('SELECT id FROM tasks')).rows).toEqual([]);
    expect((await query('SELECT id FROM appointments')).rows).toEqual([]);
});
it('edits and deletes events on the saved calendar only', async () => {
    await connect();
    const body = { title: 'Fictional pickup', colorId: '5', start: event.start, end: event.end };
    const edited = await request(app).patch('/api/familyhub/google/events/demo1').set('Authorization', `Bearer ${owner.token}`).send(body);
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id: 'demo1', colorId: '5' });
    expect((await request(app).delete('/api/familyhub/google/events/demo1').set('Authorization', `Bearer ${owner.token}`)).status).toBe(200);
    expect(send.mock.calls.map(([url, options]) => [String(url).replace(/^.*calendar\/v3\//, ''), (options as RequestInit).method])).toEqual([
        ['calendars/shared%2Ffamily/events/demo1', 'PATCH'], ['calendars/shared%2Ffamily/events/demo1', 'DELETE'],
    ]);
    send.mockClear();
    expect((await request(app).patch('/api/familyhub/google/events/demo1').set('Authorization', `Bearer ${owner.token}`).send({ ...body, colorId: 'red' })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
});
it('permits another parent in the family and refuses children and display tokens', async () => {
    await connect();
    const join = async (role: string, email: string) => {
        const invite = await post('/api/invites', { role });
        return (await request(app).post('/api/auth/register').send({ email, name: 'Fictional member', password: 'fictional-password-1', inviteToken: invite.body.data.token })).body.data.token as string;
    };
    const parent = await join('parent', 'fictional-parent@example.test');
    expect((await post('/api/familyhub/google/tasks', { title: task.title }, parent)).status).toBe(200);
    const child = await join('enfant', 'fictional-child@example.test');
    const display = (await post('/api/familyhub/display-session')).body.data.token;
    send.mockClear();
    for (const token of [child, display]) {
        expect((await request(app).put('/api/familyhub/modules').set('Authorization', `Bearer ${token}`).send({ disabled_modules: [] })).status).toBe(403);
        expect((await get('/api/familyhub/google/status', token)).status).toBe(403);
        for (const path of ['/api/familyhub/google/tasks', '/api/familyhub/google/events', '/api/familyhub/google/connect']) expect((await post(path, { title: 'Denied' }, token)).status).toBe(403);
        expect((await request(app).put('/api/familyhub/google/sources').set('Authorization', `Bearer ${token}`).send(config)).status).toBe(403);
        expect((await request(app).patch('/api/familyhub/google/tasks/demo-task').set('Authorization', `Bearer ${token}`).send({ completed: true })).status).toBe(403);
        expect((await request(app).patch('/api/familyhub/google/events/demo1').set('Authorization', `Bearer ${token}`).send({ title: 'Denied' })).status).toBe(403);
        expect((await request(app).delete('/api/familyhub/google/events/demo1').set('Authorization', `Bearer ${token}`)).status).toBe(403);
        expect((await request(app).delete('/api/familyhub/google/connection').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    }
    expect((await get('/api/familyhub', display)).body.data).toMatchObject({ readOnly: true, connected: true });
});
it('discards a full-calendar response if Google is disconnected while the request is running', async () => {
    await connect();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    send.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
        if (String(url).includes('/events')) { entered(); await gate; }
        return transport(url, options);
    });
    const response = get('/api/familyhub/google/calendar?start=2027-01-01T00:00:00Z&end=2027-02-01T00:00:00Z').then((value) => value);
    await started;
    await query('DELETE FROM familyhub_google_connections WHERE family_id=$1', [owner.user.id]);
    release();
    const result = await response;
    expect(result.status).toBe(409);
    expect(result.body.data).toBeUndefined();
});
it('rejects uneditable calendars and invalid task patches without mutating Google', async () => {
    await connect();
    expect((await request(app).put('/api/familyhub/google/sources').set('Authorization', `Bearer ${owner.token}`).send({ ...config, calendarId: 'read-only' })).status).toBe(400);
    send.mockClear();
    expect((await request(app).patch('/api/familyhub/google/tasks/demo-task').set('Authorization', `Bearer ${owner.token}`).send({ completed: 'yes' })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
});
it('refreshes Google task changes and completion while respecting source cache TTL', async () => {
    await connect();
    const first = await get('/api/familyhub');
    expect(first.body.data.tasks[0]).toMatchObject({ title: task.title, completed: false });
    const count = send.mock.calls.length;
    expect((await get('/api/familyhub')).body.data.sources.tasks.state).toBe('fresh');
    expect(send).toHaveBeenCalledTimes(count);
    const changed = await request(app).patch('/api/familyhub/google/tasks/demo-task').set('Authorization', `Bearer ${owner.token}`).send({ completed: true });
    expect(changed.body.data.completed).toBe(true);
    expect((await query("SELECT kind FROM familyhub_google_snapshots WHERE kind='tasks'")).rows).toEqual([]);
});
it('keeps successful sources visible when another service fails and labels stale data', async () => {
    await connect(); await syncGoogle(owner.user.id);
    await query("UPDATE familyhub_google_snapshots SET fetched_at=now()-interval '10 minutes'");
    send.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => String(url).includes('tasks.googleapis.com') ? new Response('private error', { status: 429 }) : transport(url, options));
    const snapshot = await syncGoogle(owner.user.id);
    expect(snapshot.sources.tasks).toMatchObject({ state: 'stale', message: 'Google rate limit reached. Retrying later.' });
    expect(snapshot.tasks).toHaveLength(1); expect(snapshot.sources.calendar.state).toBe('fresh');
    expect(JSON.stringify(snapshot)).not.toContain('private error');
});
it('does not repopulate cache with an older read that completes after a task write invalidation', async () => {
    await connect();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetching = new Promise<void>((resolve) => { entered = resolve; });
    let reads = 0;
    send.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
        if (String(url).includes('tasks.googleapis.com')) {
            reads++;
            if (reads === 1) { entered(); await gate; return Response.json({ items: [task] }); }
            return Response.json({ items: [{ ...task, title: 'New Google value' }] });
        }
        return transport(url, options);
    });
    const syncing = syncGoogle(owner.user.id); await fetching;
    await invalidate(owner.user.id, 'tasks'); release();
    expect((await syncing).tasks[0]).toMatchObject({ title: 'New Google value' });
    expect((await query("SELECT payload FROM familyhub_google_snapshots WHERE kind='tasks'")).rows[0].payload[0].title).toBe('New Google value');
});
it('does not return or cache private results after an in-flight disconnection', async () => {
    await connect();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetching = new Promise<void>((resolve) => { entered = resolve; });
    send.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
        if (String(url).includes('tasks.googleapis.com')) { entered(); await gate; }
        return transport(url, options);
    });
    const syncing = syncGoogle(owner.user.id); await fetching;
    await query('DELETE FROM familyhub_google_connections WHERE family_id=$1', [owner.user.id]);
    await invalidate(owner.user.id); release();
    expect(await syncing).toMatchObject({ connected: false, tasks: [], events: [], daycare: [] });
    expect((await query('SELECT kind FROM familyhub_google_snapshots')).rows).toEqual([]);
});
it('uses a public callback with a fixed safe redirect on success or denial', async () => {
    process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1:53001/api/familyhub/google/callback';
    process.env.FAMILYHUB_APP_URL = 'http://127.0.0.1:5174/';
    const success = await request(app).get('/api/familyhub/google/callback?state=fictional&code=fictional');
    expect(success.status).toBe(302); expect(success.headers.location).toBe('http://127.0.0.1:5174/?google=connected');
    oauth.finish.mockRejectedValueOnce(new Error('private provider details'));
    const failure = await request(app).get('/api/familyhub/google/callback?state=fictional&redirect=https://evil.test');
    expect(failure.headers.location).toBe('http://127.0.0.1:5174/?google=connection-failed');
    expect(JSON.stringify(failure.body)).not.toContain('private provider details');
});

it('reports a lapsed Google grant as 409 GOOGLE_RECONNECT, never 401, so the app keeps the session', async () => {
    await connect();
    oauth.lapsed = true;
    const range = `start=${encodeURIComponent('2026-11-01T00:00:00Z')}&end=${encodeURIComponent('2026-11-08T00:00:00Z')}`;
    for (const response of [await get(`/api/familyhub/google/calendar?${range}`), await post('/api/familyhub/google/tasks', { title: 'Fictional chore' }),
        await request(app).patch('/api/familyhub/google/tasks/demo-task').set('Authorization', `Bearer ${owner.token}`).send({ completed: true })]) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'GOOGLE_RECONNECT', error: 'Google authorization needs reconnecting.' });
    }
    expect((await get('/api/auth/me')).status).toBe(200);
});
