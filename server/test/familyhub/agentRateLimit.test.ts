import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRateLimiter, DEFAULT_AGENT_RATE_LIMIT, agentCallKind, agentRateLimitFromEnv } from '../../src/lib/agentRateLimit';
import { agentRateLimiter } from '../../src/lib/agentRateLimit';
import { app, query, registerWithPassword, resetState, startSuite, stopSuite } from '../helpers';

describe('the limiter', () => {
    const at = { now: 1_000_000 };
    const limiter = () => new AgentRateLimiter({ windowMs: 60_000, reads: 3, writes: 2 }, () => at.now);
    beforeEach(() => { at.now = 1_000_000; });

    it('allows up to the limit, then refuses until the window ends', () => {
        const l = limiter();
        expect([l.check('a', 'GET'), l.check('a', 'GET'), l.check('a', 'GET')].map((d) => d.allowed)).toEqual([true, true, true]);
        const refused = l.check('a', 'GET');
        expect(refused).toMatchObject({ allowed: false, limit: 3, remaining: 0, resetSeconds: 60, firstRefusal: true });
        at.now += 59_000;
        expect(l.check('a', 'GET')).toMatchObject({ allowed: false, resetSeconds: 1, firstRefusal: false });
        at.now += 1_000;
        expect(l.check('a', 'GET')).toMatchObject({ allowed: true, remaining: 2 });
    });

    it('gives changes the tighter allowance and counts them apart from reads', () => {
        const l = limiter();
        expect(l.check('a', 'POST').allowed).toBe(true);
        expect(l.check('a', 'DELETE').allowed).toBe(true);
        expect(l.check('a', 'PUT')).toMatchObject({ allowed: false, limit: 2 });
        expect(l.check('a', 'GET')).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    });

    it('keeps one session from using another one\'s allowance', () => {
        const l = limiter();
        l.check('a', 'POST'); l.check('a', 'POST');
        expect(l.check('a', 'POST').allowed).toBe(false);
        expect(l.check('b', 'POST').allowed).toBe(true);
    });

    it('treats HEAD as a read and any other method as a change', () => {
        expect(['GET', 'head', 'POST', 'put', 'PATCH', 'DELETE', 'OPTIONS'].map(agentCallKind)).toEqual(['read', 'read', 'write', 'write', 'write', 'write', 'write']);
    });

    it('reads its limits from the environment and ignores anything unusable', () => {
        expect(agentRateLimitFromEnv({})).toEqual(DEFAULT_AGENT_RATE_LIMIT);
        expect(agentRateLimitFromEnv({ AGENT_RATE_LIMIT_READS: '5', AGENT_RATE_LIMIT_WRITES: '1', AGENT_RATE_LIMIT_WINDOW_MS: '1000' })).toEqual({ windowMs: 1000, reads: 5, writes: 1 });
        expect(agentRateLimitFromEnv({ AGENT_RATE_LIMIT_READS: '0', AGENT_RATE_LIMIT_WRITES: '-3', AGENT_RATE_LIMIT_WINDOW_MS: 'soon' })).toEqual(DEFAULT_AGENT_RATE_LIMIT);
    });
});

describe('a connected app over HTTP', () => {
    beforeAll(startSuite);
    afterAll(stopSuite);

    const BASE = '/api/familyhub/agent-sessions';
    const EXPENSE = { category: 'groceries', amount: 12.5, date: '2031-05-14', description: 'Fictional shop', is_expense: true };
    let owner: Awaited<ReturnType<typeof registerWithPassword>>;
    const normal = { ...DEFAULT_AGENT_RATE_LIMIT, reads: 100_000, writes: 100_000 };

    beforeEach(async () => {
        await resetState();
        owner = await registerWithPassword('agent-rate@example.test', 'correct-horse-1', 'Fictional Owner');
    });
    afterEach(() => agentRateLimiter.configure(normal));

    const connect = async (permissions: object) => {
        const response = await request(app).post(BASE).set('Authorization', `Bearer ${owner.token}`).send({ name: 'Fictional bridge', permissions });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return { token: response.body.data.token as string, id: response.body.data.session.id as string };
    };

    it('answers 429 with Retry-After once its reads are used up, and says how much is left before that', async () => {
        agentRateLimiter.configure({ windowMs: 60_000, reads: 3, writes: 2 });
        const agent = await connect({ read: ['/api/budget/*'] });
        const get = () => request(app).get('/api/budget/entries').set('Authorization', `Bearer ${agent.token}`);
        const first = await get();
        expect(first.status).toBe(200);
        expect(first.headers['ratelimit-limit']).toBe('3');
        expect(first.headers['ratelimit-remaining']).toBe('2');
        await get(); await get();
        const refused = await get();
        expect(refused.status).toBe(429);
        expect(refused.body).toMatchObject({ success: false, code: 'AGENT_RATE_LIMITED' });
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('limits changes more tightly, counts refused attempts, and logs only the first throttled change', async () => {
        agentRateLimiter.configure({ windowMs: 60_000, reads: 100, writes: 2 });
        const agent = await connect({ read: ['/api/budget/*'], write: ['POST /api/budget/entries'] });
        const post = (body: object = EXPENSE) => request(app).post('/api/budget/entries').set('Authorization', `Bearer ${agent.token}`).send(body);
        expect((await post()).status).toBe(200);
        // A refused change (bad category) still uses the allowance.
        expect((await post({ ...EXPENSE, category: 'not-a-category' })).status).toBe(400);
        for (let i = 0; i < 5; i += 1) expect((await post()).status).toBe(429);
        // Reads have their own allowance.
        expect((await request(app).get('/api/budget/entries').set('Authorization', `Bearer ${agent.token}`)).status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const rows = await query('SELECT status FROM familyhub_agent_writes WHERE session_id = $1 ORDER BY id', [agent.id]);
        // The two that were answered, then one row for the first throttled change.
        expect(rows.rows.map((row: { status: number }) => row.status)).toEqual([200, 400, 429]);
    });

    it('does not let one app use up another\'s allowance, and leaves people alone', async () => {
        agentRateLimiter.configure({ windowMs: 60_000, reads: 1, writes: 1 });
        const one = await connect({ read: ['/api/budget/*'] });
        const two = await connect({ read: ['/api/budget/*'] });
        const get = (token: string) => request(app).get('/api/budget/entries').set('Authorization', `Bearer ${token}`);
        expect((await get(one.token)).status).toBe(200);
        expect((await get(one.token)).status).toBe(429);
        expect((await get(two.token)).status).toBe(200);
        for (let i = 0; i < 3; i += 1) expect((await get(owner.token)).status).toBe(200);
    });
});
