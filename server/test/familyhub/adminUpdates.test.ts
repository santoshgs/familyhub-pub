import request from 'supertest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { app, registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';

const PASSWORD = 'fictional-password-1';
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
let exchange = '';
const call = (method: 'get' | 'post', url: string, token = owner.token) => {
    const r = request(app)[method](url).set('Authorization', `Bearer ${token}`);
    return method === 'post' ? r.send({}) : r;
};
const writeStatus = (status: object) => writeFileSync(path.join(exchange, 'update-status.json'), JSON.stringify(status));

beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Requires a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('updates-owner@example.test', PASSWORD, 'Fictional Owner');
    exchange = mkdtempSync(path.join(tmpdir(), 'fh-updates-'));
    process.env.FAMILYHUB_ADMIN_EXCHANGE = exchange;
});
afterAll(async () => { delete process.env.FAMILYHUB_ADMIN_EXCHANGE; await pool.end(); });

it('reports the helper as unavailable until the host has installed it', async () => {
    expect((await call('get', '/api/familyhub/admin/updates')).body.data).toEqual({ available: false });
    expect((await call('post', '/api/familyhub/admin/updates/check')).status).toBe(409);
});

it('shows the published status and recomputes whether a newer release exists', async () => {
    mkdirSync(path.join(exchange, 'inbox'));
    const empty = await call('get', '/api/familyhub/admin/updates');
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(empty.body.data).toMatchObject({ available: true, current: null, latest: null, updateAvailable: false, state: null, pending: [] });

    writeStatus({ current: 'familyhub-v1.1.0', previous: 'familyhub-v1.0.0', latest: 'familyhub-v1.2.0', updateAvailable: false,
        state: 'checked', message: 'line\none', checkedAt: '2026-11-05T21:00:00Z', autoUpdates: true });
    expect((await call('get', '/api/familyhub/admin/updates')).body.data).toMatchObject({
        current: 'familyhub-v1.1.0', previous: 'familyhub-v1.0.0', latest: 'familyhub-v1.2.0', updateAvailable: true,
        state: 'checked', message: 'line one', checkedAt: '2026-11-05T21:00:00Z', autoUpdates: true });

    // The exchange is writable by the container: odd values are dropped, not echoed.
    writeStatus({ current: 'familyhub-v1.10.0', latest: 'familyhub-v1.9.9', state: '<script>', checkedAt: 'yesterday', autoUpdates: 'yes', updateAvailable: true });
    expect((await call('get', '/api/familyhub/admin/updates')).body.data).toMatchObject({
        current: 'familyhub-v1.10.0', latest: 'familyhub-v1.9.9', updateAvailable: false, state: null, checkedAt: null, autoUpdates: null });
    writeStatus({ current: '../../etc', latest: 'familyhub-v1.2.0' });
    expect((await call('get', '/api/familyhub/admin/updates')).body.data).toMatchObject({ current: null, latest: 'familyhub-v1.2.0', updateAvailable: true });
});

it('hands check and install requests to the host, install only when a newer release is known', async () => {
    mkdirSync(path.join(exchange, 'inbox'));
    writeStatus({ current: 'familyhub-v1.1.0', latest: 'familyhub-v1.1.0', state: 'checked' });
    expect((await call('post', '/api/familyhub/admin/updates/install')).status).toBe(409);
    expect((await call('post', '/api/familyhub/admin/updates/check')).status).toBe(202);
    const file = path.join(exchange, 'inbox', 'update-check.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ kind: 'update-check' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await call('get', '/api/familyhub/admin/updates')).body.data.pending).toEqual(['check']);

    writeStatus({ current: 'familyhub-v1.1.0', latest: 'familyhub-v1.2.0', state: 'checked' });
    expect((await call('post', '/api/familyhub/admin/updates/install')).status).toBe(202);
    expect(readdirSync(path.join(exchange, 'inbox')).sort()).toEqual(['update-check.json', 'update-install.json']);
    expect((await call('post', '/api/familyhub/admin/updates/rollback')).status).toBe(404);
});

it('refuses other parents, children and displays', async () => {
    mkdirSync(path.join(exchange, 'inbox'));
    writeStatus({ current: 'familyhub-v1.1.0', latest: 'familyhub-v1.2.0' });
    const invite = await call('post', '/api/invites');
    const parent = await request(app).post('/api/auth/register').send({ email: 'updates-parent@example.test', name: 'Fictional Parent', password: PASSWORD, inviteToken: invite.body.data.token });
    expect(parent.status).toBe(200);
    expect((await call('get', '/api/familyhub/admin/updates', parent.body.data.token)).status).toBe(403);
    expect((await call('post', '/api/familyhub/admin/updates/install', parent.body.data.token)).status).toBe(403);
    const display = (await call('post', '/api/familyhub/ambient/display-session')).body.data.token as string;
    expect((await call('get', '/api/familyhub/admin/updates', display)).status).toBe(403);
    expect((await call('post', '/api/familyhub/admin/updates/install', display)).status).toBe(403);
    expect(readdirSync(path.join(exchange, 'inbox'))).toEqual([]);
});

it('restarts the server only for the server administrator', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
        const invite = await call('post', '/api/invites');
        const parent = await request(app).post('/api/auth/register').send({ email: 'restart-parent@example.test', name: 'Fictional Parent', password: PASSWORD, inviteToken: invite.body.data.token });
        expect((await call('post', '/api/familyhub/admin/restart', parent.body.data.token)).status).toBe(403);
        const display = (await call('post', '/api/familyhub/ambient/display-session')).body.data.token as string;
        expect((await call('post', '/api/familyhub/admin/restart', display)).status).toBe(403);
        vi.advanceTimersByTime(2000);
        expect(kill).not.toHaveBeenCalled();
        expect((await call('post', '/api/familyhub/admin/restart')).status).toBe(200);
        vi.advanceTimersByTime(2000);
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    } finally { vi.useRealTimers(); kill.mockRestore(); }
});
