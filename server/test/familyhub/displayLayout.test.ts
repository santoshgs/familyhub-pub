import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, query, registerWithPassword } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { readAmbientSettings, saveAmbientSettings } from '../../src/services/familyhub/ambient';
import { legacyLayout, parseLayout, readLayout } from '../../src/services/familyhub/ambientLayout';

let familyId = '', token = '';
beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    const owner = await registerWithPassword('layout-owner@example.test', 'fictional-password-1', 'Fictional Owner');
    familyId = owner.user.id; token = owner.token;
});
afterAll(async () => { await pool.end(); });

describe('display layout', () => {
    it('derives the pre-v1.6 layout: enabled cards in order (a seventh becomes a pill), then enabled quick cards', () => {
        expect(legacyLayout(['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare', 'f1'], { photos: true, wifi: true })).toEqual({
            cards: ['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare'], pills: ['f1', 'wifi', 'photos'],
        });
    });

    it('validates strictly on save and leniently on read', () => {
        expect(() => parseLayout({ cards: [], pills: ['wifi'] })).toThrow('at least one card');
        expect(() => parseLayout({ cards: ['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare', 'f1'], pills: [] })).toThrow('room for 6');
        expect(() => parseLayout({ cards: ['calendar'], pills: ['calendar'] })).toThrow('once');
        expect(() => parseLayout({ cards: ['calendar', 'mail'], pills: [] })).toThrow('once');
        expect(readLayout({ cards: ['photos', 'mail', 'photos', 'calendar'], pills: ['calendar', 'wifi'] })).toEqual({ cards: ['photos', 'calendar'], pills: ['wifi'] });
        expect(readLayout({ cards: [], pills: [] })).toBeNull();
    });

    it('stores the order, keeps widgets in step for older code, and falls back when an older page saves', async () => {
        const fresh = await readAmbientSettings(familyId);
        expect(fresh.layout).toEqual({ cards: ['calendar', 'weather', 'tasks', 'chores', 'daycare', 'f1'], pills: [] });
        const saved = await saveAmbientSettings(familyId, { location: null, layout: { cards: ['photos', 'calendar', 'f1'], pills: ['weather', 'wifi'] } });
        expect(saved.layout).toEqual({ cards: ['photos', 'calendar', 'f1'], pills: ['weather', 'wifi'] });
        expect(saved.widgets).toEqual(['calendar', 'weather', 'f1']);
        const older = await saveAmbientSettings(familyId, { location: null, widgets: ['calendar', 'news'] });
        expect(older.layout).toEqual({ cards: ['calendar', 'news'], pills: [] });
    });
});

describe('menu order', () => {
    it('saves each account its own order and rejects anything that is not a menu path', async () => {
        const as = { Authorization: `Bearer ${token}` };
        expect((await request(app).get('/api/familyhub/nav').set(as)).body.data).toEqual({ order: [] });
        expect((await request(app).put('/api/familyhub/nav').set(as).send({ order: ['/', '/calendar', '/todos', '/budget'] })).status).toBe(200);
        expect((await request(app).get('/api/familyhub/nav').set(as)).body.data.order).toEqual(['/', '/calendar', '/todos', '/budget']);
        expect((await request(app).put('/api/familyhub/nav').set(as).send({ order: ['https://example.test'] })).status).toBe(400);
        expect((await request(app).put('/api/familyhub/nav').set(as).send({ order: ['/', '/'] })).status).toBe(400);
        const display = await request(app).post('/api/familyhub/ambient/display-session').set(as);
        expect((await request(app).put('/api/familyhub/nav').set({ Authorization: `Bearer ${display.body.data.token}` }).send({ order: [] })).status).toBe(403);
    });
});

describe('screensaver and night off', () => {
    it('defaults off, saves choices, keeps them when an older page saves, and validates', async () => {
        const fresh = await readAmbientSettings(familyId);
        expect(fresh.screensaver).toEqual({ enabled: false, idleMinutes: 10 });
        expect(fresh.night.mode).toBe('dim');
        const night = { enabled: true, start: '22:30', end: '06:30', brightness: 0, mode: 'off' };
        const saved = await saveAmbientSettings(familyId, { location: null, layout: fresh.layout, night, screensaver: { enabled: true, idleMinutes: 5 } });
        expect(saved.screensaver).toEqual({ enabled: true, idleMinutes: 5 });
        expect(saved.night).toEqual(night);
        // An older page sends neither: both are kept.
        const older = await saveAmbientSettings(familyId, { location: null, widgets: ['calendar'] });
        expect(older.screensaver).toEqual({ enabled: true, idleMinutes: 5 });
        expect(older.night.mode).toBe('off');
        // A v1.5.3 page sends night without a mode: 'off' is kept.
        const v153 = await saveAmbientSettings(familyId, { location: null, layout: fresh.layout, night: { enabled: true, start: '22:30', end: '06:30', brightness: 10 } });
        expect(v153.night).toEqual({ enabled: true, start: '22:30', end: '06:30', brightness: 10, mode: 'off' });
        await expect(saveAmbientSettings(familyId, { location: null, layout: fresh.layout, screensaver: { enabled: true, idleMinutes: 7 } })).rejects.toThrow('screensaver');
        await expect(saveAmbientSettings(familyId, { location: null, layout: fresh.layout, night: { ...night, mode: 'sleep' } })).rejects.toThrow('turn it off');
    });
});
