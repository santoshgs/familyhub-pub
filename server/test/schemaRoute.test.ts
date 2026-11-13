import express, { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listRoutes, PAYLOAD_CONTRACTS } from '../src/routes/schema';
import { app, registerWithPassword, resetState, startSuite, stopSuite } from './helpers';

beforeAll(startSuite);
afterAll(stopSuite);
beforeEach(() => resetState());

const schema = (token?: string) => {
    const call = request(app).get('/api/schema');
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
};

describe('route discovery', () => {
    it('lists routes of mounted and nested routers, with their methods', () => {
        const inner = Router();
        inner.get('/', (_req, res) => res.end());
        inner.route('/:id').patch((_req, res) => res.end()).delete((_req, res) => res.end());
        const outer = Router();
        outer.use('/items', inner);
        outer.post('/import', (_req, res) => res.end());
        const small = express();
        small.get('/health', (_req, res) => res.end());
        small.use('/api/things', (_req, _res, next) => next());
        small.use('/api/things', outer);
        expect(listRoutes(small)).toEqual({
            unresolvedMounts: 0,
            routes: [
                { method: 'POST', path: '/api/things/import' },
                { method: 'GET', path: '/api/things/items' },
                { method: 'DELETE', path: '/api/things/items/:id' },
                { method: 'PATCH', path: '/api/things/items/:id' },
            ],
        });
    });

    it('finds every router mounted on the real app', () => {
        const { routes, unresolvedMounts } = listRoutes(app);
        expect(unresolvedMounts).toBe(0);
        const paths = new Set(routes.map((route) => route.path));
        for (const prefix of ['auth', 'budget', 'calendar', 'categories', 'family', 'familyhub', 'familyhub/shopping', 'notes', 'schema', 'shopping', 'tasks']) {
            expect([...paths].some((path) => path === `/api/${prefix}` || path.startsWith(`/api/${prefix}/`)), prefix).toBe(true);
        }
        expect(routes.every((route) => route.path.startsWith('/api/'))).toBe(true);
    });

    it('documents only write endpoints that exist', () => {
        const known = new Set(listRoutes(app).routes.map((route) => `${route.method} ${route.path}`));
        for (const key of Object.keys(PAYLOAD_CONTRACTS)) expect(known.has(key), key).toBe(true);
    });
});

describe('GET /api/schema', () => {
    it('needs a signed-in session', async () => {
        expect((await schema()).status).toBe(401);
        expect((await schema('not-a-token')).status).toBe(401);
    });

    it('returns routes and payload contracts, and nothing about the household', async () => {
        const owner = await registerWithPassword('schema-owner@example.test', 'correct-horse-1', 'Fictional Owner');
        const response = await schema(owner.token);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        const { routes, payloadContracts } = response.body.data;
        expect(routes).toContainEqual({ method: 'POST', path: '/api/budget/entries' });
        expect(routes).toContainEqual({ method: 'POST', path: '/api/familyhub/google/events' });
        expect(routes).toContainEqual({ method: 'GET', path: '/api/schema' });
        expect(payloadContracts['POST /api/budget/entries'].body.required).toEqual(['category', 'amount', 'date']);
        expect(payloadContracts['POST /api/familyhub/google/tasks'].body.properties).toHaveProperty('dueDate');
        const text = JSON.stringify(response.body);
        expect(text).not.toContain(owner.user.id);
        expect(text).not.toContain('schema-owner@example.test');
        expect(text).not.toContain('Fictional Owner');
    });

    it('is closed to display sessions', async () => {
        const owner = await registerWithPassword('schema-display@example.test');
        for (const path of ['/api/familyhub/display-session', '/api/familyhub/ambient/display-session']) {
            const issued = await request(app).post(path).set('Authorization', `Bearer ${owner.token}`).send({});
            expect(issued.status).toBe(200);
            expect((await schema(issued.body.data.token)).status).toBe(403);
        }
    });

    it('describes bodies the handlers accept', async () => {
        const owner = await registerWithPassword('schema-budget@example.test');
        const send = (body: object) => request(app).post('/api/budget/entries').set('Authorization', `Bearer ${owner.token}`).send(body);
        const created = await send({ category: 'groceries', amount: 12.5, date: '2031-05-14', description: 'Fictional shop', is_expense: true });
        expect(created.status).toBe(200);
        expect(created.body.data.is_expense).toBe(true);
        // As the contract says: required fields, fixed categories, income unless is_expense is true.
        expect((await send({ category: 'groceries', amount: 12.5 })).status).toBe(400);
        expect((await send({ category: 'Dining', amount: 12.5, date: '2031-05-14' })).status).toBe(400);
        expect((await send({ category: 'groceries', amount: 1, date: '2031-05-14' })).body.data.is_expense).toBe(false);
    });
});
