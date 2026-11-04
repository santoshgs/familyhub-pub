import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { clearModuleCache } from '../../src/lib/modules';

// v1.0: switched-off modules are closed on the server, not just hidden, and the
// OpenFamily modules Family Hub removed stay removed across restarts.
let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const auth = (req: request.Test) => req.set('Authorization', `Bearer ${owner.token}`);
const setDisabled = (disabled: string[]) => auth(request(app).put('/api/familyhub/modules')).send({ disabled_modules: disabled });

beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Requires a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    clearModuleCache();
    owner = await registerWithPassword('modules-owner@example.test', 'fictional-password-1', 'Fictional Owner');
});
afterAll(async () => { await pool.end(); });

describe('server-enforced modules', () => {
    it('closes a module API when the module is off and reopens it when switched back on', async () => {
        expect((await auth(request(app).get('/api/budget/entries'))).status).toBe(200);
        expect((await setDisabled(['budget'])).status).toBe(200);
        const closed = await auth(request(app).get('/api/budget/entries'));
        expect(closed.status).toBe(403);
        expect(closed.body.error).toBe('MODULE_DISABLED');
        expect((await auth(request(app).get('/api/kakeibo?month=1&year=2026'))).status).toBe(403);
        expect((await setDisabled([])).status).toBe(200);
        expect((await auth(request(app).get('/api/budget/entries'))).status).toBe(200);
    });

    it('keeps chores reachable while pocket money needs them', async () => {
        expect((await setDisabled(['chores'])).status).toBe(200);
        expect((await auth(request(app).get('/api/tasks'))).status).toBe(200);
        expect((await setDisabled(['chores', 'rewards'])).status).toBe(200);
        expect((await auth(request(app).get('/api/tasks'))).status).toBe(403);
    });

    it('rejects removed and unknown module keys', async () => {
        for (const key of ['recipes', 'posts', 'meals', 'kiosk', 'calendar']) {
            expect((await setDisabled([key])).status).toBe(400);
        }
    });

    it('serves no API for the removed modules', async () => {
        for (const path of ['/api/recipes', '/api/meal-plans', '/api/posts']) {
            expect((await auth(request(app).get(path))).status).toBe(404);
        }
    });
});

describe('per-member Show (menu and overview)', () => {
    const hide = (keys: unknown) => auth(request(app).put('/api/familyhub/preferences/hidden')).send({ hiddenModules: keys });
    it('saves a member\'s own choice without closing the module', async () => {
        expect((await auth(request(app).get('/api/familyhub/preferences'))).body.data.hiddenModules).toEqual([]);
        const saved = await hide(['budget', 'daycare', 'budget']);
        expect(saved.status).toBe(200);
        expect(saved.body.data.hiddenModules).toEqual(['budget', 'daycare']);
        const prefs = (await auth(request(app).get('/api/familyhub/preferences'))).body.data;
        expect(prefs.hiddenModules).toEqual(['budget', 'daycare']);
        expect(prefs.cardOrder.length).toBeGreaterThan(0);
        // Hidden is a view preference: the API stays open.
        expect((await auth(request(app).get('/api/budget/entries'))).status).toBe(200);
        // Household modules are unchanged.
        expect((await auth(request(app).get('/api/familyhub/modules'))).body.data.disabled_modules).not.toContain('budget');
    });

    it('rejects unknown and removed keys', async () => {
        for (const keys of [['recipes'], ['calendar'], 'budget', [42]]) expect((await hide(keys)).status).toBe(400);
    });

    it('keeps each member\'s choice separate', async () => {
        await hide(['notes']);
        const other = await registerWithPassword('modules-other@example.test', 'fictional-password-2', 'Fictional Other');
        const theirs = await request(app).get('/api/familyhub/preferences').set('Authorization', `Bearer ${other.token}`);
        expect(theirs.body.data.hiddenModules).toEqual([]);
    });
});

describe('v1.0 cleanup migration', () => {
    it('drops the removed tables and does not recreate them on the next start', async () => {
        const exists = async (table: string) => (await query('SELECT to_regclass($1) AS t', [table])).rows[0].t !== null;
        for (const table of ['recipes', 'meal_plans', 'family_posts', 'family_post_seen']) expect(await exists(table)).toBe(false);
        await runMigrations(); // a restart
        for (const table of ['recipes', 'meal_plans', 'family_posts', 'family_post_seen']) expect(await exists(table)).toBe(false);
        expect(await exists('tasks')).toBe(true);
    });
});
