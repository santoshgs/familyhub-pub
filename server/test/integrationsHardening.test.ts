import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, registerWithPassword, query } from './helpers';
import pool, { runMigrations } from '../src/db';
import { safeImageContentType } from '../src/services/integrations/immich';

// Snyk Code hardening: integration routes must reject non-text fields instead of
// throwing outside their try blocks, and the Immich proxy must only re-serve images.
let parent: Awaited<ReturnType<typeof registerWithPassword>>;
const post = (url: string, body: unknown) =>
    request(app).post(url).set('Authorization', `Bearer ${parent.token}`).send(body as object);

beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Requires a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    parent = await registerWithPassword('integrations-parent@example.test', 'fictional-password-1', 'Fictional Parent');
    // Integrations are off by default; switch them on for this family.
    await request(app).put('/api/familyhub/modules').set('Authorization', `Bearer ${parent.token}`).send({ disabled_modules: [] });
});
afterAll(async () => { await pool.end(); });

describe('integration request validation', () => {
    it('rejects a non-string base_url when testing a connection', async () => {
        const res = await post('/api/integrations/test', { type: 'homeassistant', base_url: ['http://example.test'] });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('rejects non-string fields and a non-object config when saving', async () => {
        expect((await post('/api/integrations', { type: 'homeassistant', base_url: { href: 'x' } })).status).toBe(400);
        expect((await post('/api/integrations', { type: 'homeassistant', base_url: 'http://example.test', apiKey: 42 })).status).toBe(400);
        expect((await post('/api/integrations', { type: 'homeassistant', base_url: 'http://example.test', config: ['a'] })).status).toBe(400);
    });

    it('still answers a well-formed test request, refusing cloud metadata targets', async () => {
        const res = await post('/api/integrations/test', { type: 'homeassistant', base_url: 'http://169.254.169.254', apiKey: 'fictional' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
    });
});

describe('supported integrations', () => {
    it('refuses the integrations removed in v1.0', async () => {
        for (const type of ['mealie', 'tandoor', 'grocy']) {
            const res = await post('/api/integrations', { type, base_url: 'https://example.test' });
            expect(res.status).toBe(400);
        }
    });
});

describe('Immich proxy content type', () => {
    it('allows only known raster image types', () => {
        expect(safeImageContentType('image/jpeg')).toBe('image/jpeg');
        expect(safeImageContentType('Image/WEBP; charset=binary')).toBe('image/webp');
        expect(safeImageContentType(null)).toBe('image/jpeg');
        expect(safeImageContentType('text/html')).toBeNull();
        expect(safeImageContentType('image/svg+xml')).toBeNull();
        expect(safeImageContentType('application/octet-stream')).toBeNull();
    });
});
