import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentMayCall } from '../../src/lib/agentSessions';
import { verifyAccessToken } from '../../src/lib/authTokens';
import { app, query, registerWithPassword, resetState, startSuite, stopSuite } from '../helpers';

beforeAll(startSuite);
afterAll(stopSuite);

const BASE = '/api/familyhub/agent-sessions';
type Verb = 'get' | 'post' | 'put' | 'delete';
const call = (method: Verb, path: string, token: string, body?: unknown) => {
    const builder = request(app)[method](path).set('Authorization', `Bearer ${token}`);
    return body === undefined ? builder : builder.send(body as object);
};
const EXPENSE = { category: 'groceries', amount: 12.5, date: '2031-05-14', description: 'Fictional shop', is_expense: true };

let owner: Awaited<ReturnType<typeof registerWithPassword>>;
beforeEach(async () => {
    await resetState();
    owner = await registerWithPassword('agent-owner@example.test', 'correct-horse-1', 'Fictional Owner');
});

/** Creates a connected app and returns its token and id. */
const connect = async (permissions: object, extra: object = {}) => {
    const response = await call('post', BASE, owner.token, { name: 'Fictional bridge', permissions, ...extra });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return { token: response.body.data.token as string, id: response.body.data.session.id as string };
};
const member = async (role: 'parent' | 'enfant') => {
    const invite = await call('post', '/api/invites', owner.token, { role });
    const joined = await request(app).post('/api/auth/register')
        .send({ email: `agent-${role}@example.test`, password: 'correct-horse-1', name: 'Fictional Member', inviteToken: invite.body.data.token });
    expect(joined.status).toBe(200);
    return joined.body.data.token as string;
};

describe('managing connected apps', () => {
    it('gives the token once and never stores or lists it', async () => {
        const created = await call('post', BASE, owner.token, { name: '  Fictional   bridge ', permissions: { read: ['/api/budget/*'] } });
        expect(created.status).toBe(200);
        const { token, session } = created.body.data;
        expect(token).toMatch(/^fha_[A-Za-z0-9_-]{43}$/);
        expect(session).toMatchObject({ name: 'Fictional bridge', status: 'active', permissions: { read: ['/api/budget/*'], write: [] } });
        const days = (Date.parse(session.expires_at) - Date.now()) / 86400000;
        expect(days).toBeGreaterThan(89); expect(days).toBeLessThan(91);
        const listed = await call('get', BASE, owner.token);
        expect(listed.body.data).toHaveLength(1);
        expect(JSON.stringify(listed.body)).not.toContain(token);
        const stored = await query('SELECT token_hash FROM familyhub_agent_sessions');
        expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(listed.body)).not.toContain(stored.rows[0].token_hash);
    });

    it('is for parents only: not children, displays or connected apps', async () => {
        const child = await member('enfant');
        const display = (await call('post', '/api/familyhub/ambient/display-session', owner.token, {})).body.data.token as string;
        const agent = await connect({ read: ['/api/familyhub/*', '/api/budget/*'], write: ['POST /api/budget/entries'] });
        for (const token of [child, display, agent.token]) {
            expect((await call('get', BASE, token)).status).toBe(403);
            expect((await call('get', `${BASE}/grantable`, token)).status).toBe(403);
            expect((await call('post', BASE, token, { name: 'Another', permissions: { read: ['/api/budget/*'] } })).status).toBe(403);
            expect((await call('post', `${BASE}/${agent.id}/rotate`, token)).status).toBe(403);
            expect((await call('delete', `${BASE}/${agent.id}`, token)).status).toBe(403);
        }
        expect((await request(app).get(BASE)).status).toBe(401);
        expect((await call('get', BASE, owner.token)).body.data).toHaveLength(1);
        // Another parent in the family can manage it.
        const parent = await member('parent');
        expect((await call('delete', `${BASE}/${agent.id}`, parent)).status).toBe(200);
    });

    it('cannot be managed from another family', async () => {
        const agent = await connect({ read: ['/api/budget/*'] });
        const other = await registerWithPassword('other-family@example.test');
        expect((await call('get', BASE, other.token)).body.data).toHaveLength(0);
        expect((await call('delete', `${BASE}/${agent.id}`, other.token)).status).toBe(404);
        expect((await call('post', `${BASE}/${agent.id}/rotate`, other.token)).status).toBe(404);
        expect((await call('get', '/api/budget/entries', agent.token)).status).toBe(200);
    });

    it('refuses grants that must never be shared, and bad input', async () => {
        const refuse = async (body: object) => expect((await call('post', BASE, owner.token, body)).status, JSON.stringify(body)).toBe(400);
        for (const grant of ['/api/auth/*', '/api/auth/me', '/api/data/*', '/api/invites/*', '/api/familyhub/admin/*', '/api/familyhub/agent-sessions/*',
            '/api/familyhub/google/status', '/api/calendar/*', '/api/integrations/*', '/api/ai/*', '/api/notifications/*',
            '/api/*', '/*', '/api/nothing-here/*', '/api/Budget/*', '/api/budget/../auth/*', 'GET /api/budget/entries', '/health']) {
            await refuse({ name: 'Fictional', permissions: { read: [grant] } });
        }
        // Writes only where a payload contract exists.
        for (const grant of ['PUT /api/budget/entries/:id', 'DELETE /api/budget/entries/:id', 'POST /api/budget/groups', 'POST /api/auth/logout-all', 'POST /api/data/import', '/api/budget/*']) {
            await refuse({ name: 'Fictional', permissions: { write: [grant] } });
        }
        await refuse({ permissions: { read: ['/api/budget/*'] } });
        await refuse({ name: 'x'.repeat(41), permissions: {} });
        await refuse({ name: 'Fictional', permissions: { read: 'everything' } });
        for (const expiresInDays of [0, 366, 1.5, '90']) await refuse({ name: 'Fictional', permissions: {}, expiresInDays });
        expect((await call('get', BASE, owner.token)).body.data).toHaveLength(0);
    });

    it('lists what can be granted, without the forbidden areas', async () => {
        const response = await call('get', `${BASE}/grantable`, owner.token);
        expect(response.status).toBe(200);
        const grants = response.body.data.read.map((entry: { grant: string }) => entry.grant) as string[];
        expect(grants).toEqual(expect.arrayContaining(['/api/budget/*', '/api/family/*', '/api/notes/*', '/api/familyhub', '/api/familyhub/shopping/*']));
        const paths = response.body.data.read.flatMap((entry: { routes: string[] }) => entry.routes) as string[];
        expect(paths.filter((path) => /^\/api\/(auth|data|invites|calendar|ai|integrations|notifications)(\/|$)|\/admin\/|agent-sessions|google\/(status|sources)/.test(path))).toEqual([]);
        // One grant per area: never both "/api/x" and "/api/x/*".
        expect(grants.filter((grant) => grants.includes(`${grant}/*`))).toEqual([]);
        expect(grants).toEqual(expect.arrayContaining(['/api/familyhub/ambient/*', '/api/familyhub/photos/*']));
        expect(response.body.data.write.map((entry: { endpoint: string }) => entry.endpoint)).toEqual(['POST /api/budget/entries', 'POST /api/familyhub/google/events', 'POST /api/familyhub/google/tasks']);
        // Every offered grant can be used to create a session.
        expect((await call('post', BASE, owner.token, { name: 'Everything offered', permissions: { read: grants, write: response.body.data.write.map((entry: { endpoint: string }) => entry.endpoint) } })).status).toBe(200);
    });

    it('allows at most ten', async () => {
        for (let n = 0; n < 10; n += 1) await connect({ read: ['/api/budget/*'] });
        expect((await call('post', BASE, owner.token, { name: 'Eleventh', permissions: {} })).status).toBe(400);
    });
});

describe('what a connected app can reach', () => {
    it('reads only what it was granted', async () => {
        const agent = await connect({ read: ['/api/budget/*', '/api/familyhub/modules'] });
        expect((await call('get', '/api/budget/entries', agent.token)).status).toBe(200);
        expect((await call('get', '/api/budget/entries/', agent.token)).status).toBe(200);
        expect((await call('get', '/api/budget/entries?category=groceries', agent.token)).status).toBe(200);
        expect((await call('get', '/api/familyhub/modules', agent.token)).status).toBe(200);
        expect((await call('get', '/api/auth/me', agent.token)).status).toBe(200);
        for (const path of ['/api/family', '/api/notes', '/api/familyhub', '/api/familyhub/modules/x', '/api/tasks']) {
            const response = await call('get', path, agent.token);
            expect(response.status, path).toBe(403);
            expect(response.body.code).toBe('AGENT_FORBIDDEN');
        }
        // A path no router owns is not found, as for anyone.
        expect((await call('get', '/api/budgetx', agent.token)).status).toBe(404);
        // Read-only: no writes at all.
        expect((await call('post', '/api/budget/entries', agent.token, EXPENSE)).status).toBe(403);
        expect((await call('delete', '/api/budget/entries/00000000-0000-4000-8000-000000000000', agent.token)).status).toBe(403);
    });

    it('never reaches the forbidden areas, however broad its grants', async () => {
        const grantable = (await call('get', `${BASE}/grantable`, owner.token)).body.data;
        const agent = await connect({ read: ['/api/familyhub/*', ...grantable.read.map((entry: { grant: string }) => entry.grant)], write: grantable.write.map((entry: { endpoint: string }) => entry.endpoint) });
        const blocked: Array<[Verb, string]> = [
            ['get', '/api/familyhub/admin/credentials'], ['get', '/api/familyhub/ADMIN/credentials'], ['get', '/api/FamilyHub/Admin/Updates'],
            ['post', '/api/familyhub/admin/restart'], ['post', '/api/familyhub/admin/backup'],
            ['get', '/api/familyhub/agent-sessions'], ['post', '/api/familyhub/agent-sessions'],
            ['get', '/api/familyhub/display/sessions'], ['post', '/api/familyhub/display-session'], ['post', '/api/familyhub/ambient/display-session'],
            ['get', '/api/familyhub/google/status'], ['get', '/api/familyhub/google/sources'], ['post', '/api/familyhub/google/connect'], ['delete', '/api/familyhub/google/connection'],
            ['put', '/api/familyhub/modules'],
            ['get', '/api/auth/modules'], ['post', '/api/auth/logout-all'], ['put', '/api/auth/currency'],
            ['get', '/api/data/export'], ['post', '/api/data/import'], ['get', '/api/invites'], ['post', '/api/invites'],
            ['get', '/api/familyhub/ambient/locations'],
            ['get', '/api/calendar/token'], ['get', '/api/calendar/subscriptions'], ['get', '/api/integrations'], ['get', '/api/notifications'],
            ['get', '/api/familyhub/%61dmin/credentials'], ['get', '/api/familyhub//admin/credentials'], ['get', '/api/budget/../familyhub/admin/credentials'],
            ['put', '/api/budget/entries/00000000-0000-4000-8000-000000000000'], ['post', '/api/budget/groups'], ['post', '/api/budget/import'],
        ];
        for (const [method, path] of blocked) {
            const response = await call(method, path, agent.token, method === 'get' ? undefined : {});
            expect(response.status, `${method} ${path}`).toBe(403);
            expect(response.body.code, `${method} ${path}`).toBe('AGENT_FORBIDDEN');
        }
        expect((await call('get', '/api/familyhub/modules', agent.token)).status).toBe(200);
    });

    it('writes only where granted, as the parent who created it', async () => {
        const reader = await connect({ read: ['/api/budget/*'] });
        expect((await call('post', '/api/budget/entries', reader.token, EXPENSE)).status).toBe(403);
        const writer = await connect({ read: ['/api/budget/*'], write: ['POST /api/budget/entries'] });
        const created = await call('post', '/api/budget/entries', writer.token, EXPENSE);
        expect(created.status).toBe(200);
        expect(created.body.data.user_id).toBe(owner.user.id);
        expect((await call('get', '/api/budget/entries', owner.token)).body.data).toHaveLength(1);
        expect((await call('post', '/api/familyhub/google/tasks', writer.token, { title: 'Fictional chore' })).status).toBe(403);
        expect((await call('delete', `/api/budget/entries/${created.body.data.id}`, writer.token)).status).toBe(403);
    });

    it('sees only its own reach in /api/schema', async () => {
        const agent = await connect({ read: ['/api/budget/*'], write: ['POST /api/budget/entries'] });
        const { routes, payloadContracts } = (await call('get', '/api/schema', agent.token)).body.data;
        const keys = routes.map((route: { method: string; path: string }) => `${route.method} ${route.path}`) as string[];
        expect(keys).toEqual(expect.arrayContaining(['GET /api/budget/entries', 'POST /api/budget/entries', 'GET /api/schema', 'GET /api/auth/me']));
        expect(keys.filter((key) => !/^(GET \/api\/budget(\/|$)|POST \/api\/budget\/entries$|GET \/api\/schema$|GET \/api\/auth\/me$)/.test(key))).toEqual([]);
        expect(Object.keys(payloadContracts)).toEqual(['POST /api/budget/entries']);
        // A person still sees everything.
        expect((await call('get', '/api/schema', owner.token)).body.data.routes.length).toBeGreaterThan(keys.length);
    });

    it('keeps another family out of reach', async () => {
        const agent = await connect({ read: ['/api/budget/*'], write: ['POST /api/budget/entries'] });
        const other = await registerWithPassword('other-budget@example.test');
        await call('post', '/api/budget/entries', other.token, EXPENSE);
        expect((await call('get', '/api/budget/entries', agent.token)).body.data).toHaveLength(0);
    });
});

describe('ending a connected app', () => {
    const works = async (token: string) => (await call('get', '/api/budget/entries', token)).status;

    it('stops at once when removed', async () => {
        const agent = await connect({ read: ['/api/budget/*'] });
        expect(await works(agent.token)).toBe(200);
        expect((await call('delete', `${BASE}/${agent.id}`, owner.token)).status).toBe(200);
        expect(await works(agent.token)).toBe(401);
        expect((await call('get', BASE, owner.token)).body.data).toHaveLength(0);
        expect((await call('delete', `${BASE}/${agent.id}`, owner.token)).status).toBe(404);
        expect((await call('post', `${BASE}/${agent.id}/rotate`, owner.token)).status).toBe(404);
    });

    it('rotates to a new token and ends the old one', async () => {
        const agent = await connect({ read: ['/api/budget/*'] });
        const rotated = await call('post', `${BASE}/${agent.id}/rotate`, owner.token);
        expect(rotated.status).toBe(200);
        expect(rotated.body.data.token).not.toBe(agent.token);
        expect(await works(agent.token)).toBe(401);
        expect(await works(rotated.body.data.token)).toBe(200);
    });

    it('expires', async () => {
        const agent = await connect({ read: ['/api/budget/*'] }, { expiresInDays: 1 });
        expect(await works(agent.token)).toBe(200);
        await query(`UPDATE familyhub_agent_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [agent.id]);
        expect(await works(agent.token)).toBe(401);
        expect((await call('get', BASE, owner.token)).body.data[0].status).toBe('expired');
    });

    it('ends when the parent who created it signs out everywhere', async () => {
        const agent = await connect({ read: ['/api/budget/*'] });
        await call('post', '/api/auth/logout-all', owner.token);
        expect(await works(agent.token)).toBe(401);
        const again = (await request(app).post('/api/auth/login').send({ email: 'agent-owner@example.test', password: 'correct-horse-1' })).body.data.token as string;
        expect((await call('get', BASE, again)).body.data[0].status).toBe('signed-out');
    });

    it('records when it was last used', async () => {
        const agent = await connect({ read: ['/api/budget/*'] });
        expect((await call('get', BASE, owner.token)).body.data[0].last_used_at).toBeNull();
        await works(agent.token);
        expect((await call('get', BASE, owner.token)).body.data[0].last_used_at).not.toBeNull();
    });

    it('refuses made-up and malformed tokens', async () => {
        for (const token of ['fha_', `fha_${'a'.repeat(43)}`, `fha_${'a'.repeat(42)}'`, 'fha_../../x']) expect(await works(token)).toBe(401);
    });
});

describe('the write record', () => {
    /** The record is written as the answer is sent, so it can trail the response by a moment. */
    const writes = async (count: number, suffix = '') => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const response = await call('get', `${BASE}/writes${suffix}`, owner.token);
            if (response.body.data.length >= count) return response.body.data as Array<Record<string, unknown>>;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`fewer than ${count} writes recorded`);
    };

    it('logs each change with the session and the parent it acts as, and never the body', async () => {
        const agent = await connect({ read: ['/api/budget/*'], write: ['POST /api/budget/entries'] });
        await call('get', '/api/budget/entries', agent.token);
        expect((await call('post', '/api/budget/entries?x=1', agent.token, EXPENSE)).status).toBe(200);
        const [row] = await writes(1);
        expect(row).toMatchObject({ session_id: agent.id, session_name: 'Fictional bridge', session_removed: false, user_id: owner.user.id, method: 'POST', path: '/api/budget/entries', status: 200 });
        expect(JSON.stringify(row)).not.toContain('Fictional shop');
        // Refused and failed attempts are logged too; reads and people's own changes are not.
        await call('post', '/api/budget/entries', agent.token, { category: 'groceries' });
        await call('delete', '/api/budget/entries/00000000-0000-4000-8000-000000000000', agent.token);
        await call('post', '/api/budget/entries', owner.token, EXPENSE);
        const all = await writes(3);
        expect(all.map((entry) => `${entry.method} ${entry.status}`)).toEqual(['DELETE 403', 'POST 400', 'POST 200']);
    });

    it('is kept after the app is removed, filters by app, and is for parents of the family only', async () => {
        const first = await connect({ write: ['POST /api/budget/entries'] });
        const second = await connect({ write: ['POST /api/budget/entries'] });
        await call('post', '/api/budget/entries', first.token, EXPENSE);
        await writes(1);
        await call('post', '/api/budget/entries', second.token, EXPENSE);
        await writes(2);
        await call('delete', `${BASE}/${first.id}`, owner.token);
        expect(await writes(1, `?session=${first.id}`)).toMatchObject([{ session_id: first.id, session_removed: true }]);
        expect((await call('get', `${BASE}/writes?session=nope`, owner.token)).status).toBe(400);
        expect((await call('get', `${BASE}/writes`, second.token)).status).toBe(403);
        expect((await call('get', `${BASE}/writes`, await member('enfant'))).status).toBe(403);
        const other = await registerWithPassword('other-writes@example.test');
        expect((await call('get', `${BASE}/writes`, other.token)).body.data).toEqual([]);
    });

    it('keeps only the newest thousand per app and ninety days', async () => {
        const agent = await connect({ write: ['POST /api/budget/entries'] });
        await query(
            `INSERT INTO familyhub_agent_writes (session_id, family_id, user_id, method, path, status, created_at)
             SELECT $1, $2, $2, 'POST', '/api/budget/entries', 200, now() - make_interval(days => CASE WHEN n <= 5 THEN 91 ELSE 1 END)
             FROM generate_series(1, 1005) AS n`, [agent.id, owner.user.id]);
        await call('post', '/api/budget/entries', agent.token, EXPENSE);
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const count = (await query('SELECT count(*)::int AS n FROM familyhub_agent_writes')).rows[0].n;
            if (count === 1000) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('old writes were not pruned');
    });
});

it('marks a verified agent token so the WebSocket can refuse it', async () => {
    const agent = await connect({ read: ['/api/budget/*'] });
    const verified = await verifyAccessToken(agent.token);
    expect(verified.agent).toEqual({ sessionId: agent.id, permissions: { read: ['/api/budget/*'], write: [] } });
    expect((await verifyAccessToken(owner.token)).agent).toBeUndefined();
});

it('decides reach from the path alone', () => {
    const all = { read: ['/api/budget/*', '/api/familyhub'], write: ['POST /api/budget/entries'] };
    expect(agentMayCall(all, 'GET', '/api/budget')).toBe(true);
    expect(agentMayCall(all, 'HEAD', '/api/budget/entries')).toBe(true);
    expect(agentMayCall(all, 'GET', '/api/BUDGET/entries')).toBe(true);
    expect(agentMayCall(all, 'GET', '/api/familyhub')).toBe(true);
    expect(agentMayCall(all, 'GET', '/api/familyhub/ambient')).toBe(false);
    expect(agentMayCall(all, 'POST', '/api/budget/entries')).toBe(true);
    expect(agentMayCall(all, 'POST', '/api/budget/entries/x')).toBe(false);
    expect(agentMayCall(all, 'PATCH', '/api/budget/entries')).toBe(false);
    expect(agentMayCall({ read: [], write: ['POST /api/budget/groups'] }, 'POST', '/api/budget/groups')).toBe(false); // no contract
    expect(agentMayCall({ read: ['/api/auth/*'], write: [] }, 'GET', '/api/auth/modules')).toBe(false); // a stored grant cannot override the denied list
    for (const path of ['/health', '/api', 'api/budget', '/api/budget/%2e%2e/auth/me', '/api/budget/./entries', '/api/budget;x', '/api/budget\\entries']) expect(agentMayCall(all, 'GET', path), path).toBe(false);
});
