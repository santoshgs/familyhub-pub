import request from 'supertest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { app, registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';

const PASSWORD = 'fictional-password-1';
const GOOD = 'fictional_token_0123456789abcdef';
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
let exchange = '';
const call = (method: 'get' | 'put' | 'post', url: string, token = owner.token, body?: unknown) => {
    const r = request(app)[method](url).set('Authorization', `Bearer ${token}`);
    return body === undefined ? r : r.send(body);
};

beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Requires a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('creds-owner@example.test', PASSWORD, 'Fictional Owner');
    exchange = mkdtempSync(path.join(tmpdir(), 'fh-exchange-'));
    process.env.FAMILYHUB_ADMIN_EXCHANGE = exchange;
});
afterAll(async () => { delete process.env.FAMILYHUB_ADMIN_EXCHANGE; await pool.end(); });

it('reports the helper as unavailable until the host has installed it', async () => {
    expect((await call('get', '/api/familyhub/admin/credentials')).body.data).toEqual({ available: false });
    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', owner.token, { token: GOOD })).status).toBe(409);
});

it('hands a token to the host once, owner-only, and never returns it', async () => {
    mkdirSync(path.join(exchange, 'inbox'));
    writeFileSync(path.join(exchange, 'status.json'), JSON.stringify({ checkedAt: '2026-11-02T12:00:00Z', warnDays: 30, items: [
        { kind: 'github-release', name: 'GitHub release token (updater)', expiresAt: '2026-11-29T15:00:00Z', state: 'warn', note: 'x' },
        { kind: 'tailscale', name: 'Tailscale node key', expiresAt: null, state: 'ok', note: 'key expiry disabled' }] }));
    const status = await call('get', '/api/familyhub/admin/credentials');
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body.data).toMatchObject({ available: true, warnDays: 30, pending: [],
        items: [{ kind: 'github-release', state: 'warn', updatable: true }, { kind: 'tailscale', updatable: false }] });

    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', owner.token, { token: `  ${GOOD}\n` })).status).toBe(202);
    const file = path.join(exchange, 'inbox', 'ghcr.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ kind: 'ghcr', token: GOOD });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.join(exchange, 'inbox')).filter((f) => f.startsWith('.'))).toEqual([]);
    const after = await call('get', '/api/familyhub/admin/credentials');
    expect(after.body.data.pending).toEqual(['ghcr']);
    expect(JSON.stringify(after.body)).not.toContain(GOOD);

    expect((await call('put', '/api/familyhub/admin/credentials/tailscale', owner.token, { token: GOOD })).status).toBe(404);
    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', owner.token, { token: 'short' })).status).toBe(400);
    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', owner.token, { token: 'x; rm -rf / 0123456789abcdef' })).status).toBe(400);
    expect((await call('post', '/api/familyhub/admin/credentials/check', owner.token, {})).status).toBe(202);
    expect(readdirSync(path.join(exchange, 'inbox')).sort()).toEqual(['check.json', 'ghcr.json']);
});

it('refuses other parents, children and displays', async () => {
    mkdirSync(path.join(exchange, 'inbox'));
    const invite = await call('post', '/api/invites', owner.token, { role: 'parent' });
    const parent = await request(app).post('/api/auth/register').send({ email: 'creds-parent@example.test', name: 'Fictional Parent', password: PASSWORD, inviteToken: invite.body.data.token });
    expect(parent.status).toBe(200);
    expect((await call('get', '/api/familyhub/admin/credentials', parent.body.data.token)).status).toBe(403);
    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', parent.body.data.token, { token: GOOD })).status).toBe(403);
    const display = (await call('post', '/api/familyhub/ambient/display-session', owner.token, {})).body.data.token as string;
    expect((await call('get', '/api/familyhub/admin/credentials', display)).status).toBe(403);
    expect((await call('put', '/api/familyhub/admin/credentials/ghcr', display, { token: GOOD })).status).toBe(403);
    expect(readdirSync(path.join(exchange, 'inbox'))).toEqual([]);
});

it('asks the host for an off-site backup now, once at a time, server administrator only', async () => {
    expect((await call('post', '/api/familyhub/admin/backup')).status).toBe(503);
    mkdirSync(path.join(exchange, 'inbox'));
    expect((await call('post', '/api/familyhub/admin/backup')).status).toBe(200);
    expect(JSON.parse(readFileSync(path.join(exchange, 'inbox', 'backup-now.json'), 'utf8'))).toMatchObject({ kind: 'backup-now' });
    writeFileSync(path.join(exchange, 'backup-status.json'), JSON.stringify({ state: 'running', startedAt: new Date().toISOString(), message: 'Backing up…' }));
    expect((await call('post', '/api/familyhub/admin/backup')).status).toBe(409);
    expect((await call('get', '/api/familyhub/admin/credentials')).body.data.backup).toMatchObject({ state: 'running' });
    // A stuck "running" (older than an hour) does not block a new request.
    writeFileSync(path.join(exchange, 'backup-status.json'), JSON.stringify({ state: 'running', startedAt: '2026-11-01T00:00:00Z' }));
    expect((await call('post', '/api/familyhub/admin/backup')).status).toBe(200);
    const invite = await call('post', '/api/invites', owner.token, { role: 'parent' });
    const parent = (await request(app).post('/api/auth/register').send({ email: 'creds-parent@example.test', name: 'Fictional parent', password: PASSWORD, inviteToken: invite.body.data.token })).body.data.token;
    expect((await call('post', '/api/familyhub/admin/backup', parent)).status).toBe(403);
});
