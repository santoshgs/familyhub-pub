import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { readinessHandler } from '../src/lib/readiness';

it('reports readiness only after a successful database probe and forbids caching', async () => {
    const app = express();
    app.get('/ready', readinessHandler(async () => ({ rows: [{ '?column?': 1 }] })));
    const response = await request(app).get('/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(response.headers['cache-control']).toBe('no-store');
});

it('fails readiness without leaking database diagnostics', async () => {
    const app = express();
    app.get('/ready', readinessHandler(async () => { throw new Error('fictional secret connection diagnostic'); }));
    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
    expect(response.headers['cache-control']).toBe('no-store');
});
