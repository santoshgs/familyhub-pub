import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { registerWithPassword, query } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { readAmbientSettings, saveAmbientSettings } from '../../src/services/familyhub/ambient';

let familyId: string;
beforeAll(async () => {
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) throw new Error('Ambient settings tests require a disposable _test database.');
    await runMigrations();
});
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    familyId = (await registerWithPassword('ambient-settings@example.test', 'fictional-password-1', 'Fictional Parent')).user.id;
});
afterAll(async () => { await pool.end(); });

it('defaults night dimming to off with a 22:00–07:00 window', async () => {
    expect((await readAmbientSettings(familyId)).night).toEqual({ enabled: false, start: '22:00', end: '07:00', brightness: 15 });
});

it('stores a parent-chosen night dimming schedule and keeps it when an older client saves', async () => {
    await saveAmbientSettings(familyId, { location: null, widgets: ['calendar'], night: { enabled: true, start: '21:30', end: '06:45', brightness: 0 } });
    expect((await readAmbientSettings(familyId)).night).toEqual({ enabled: true, start: '21:30', end: '06:45', brightness: 0 });
    await saveAmbientSettings(familyId, { location: null, widgets: ['calendar', 'weather'] });
    const saved = await readAmbientSettings(familyId);
    expect(saved.widgets).toEqual(['calendar', 'weather']);
    expect(saved.night).toEqual({ enabled: true, start: '21:30', end: '06:45', brightness: 0 });
});

it('rejects invalid night dimming values', async () => {
    const base = { location: null, widgets: ['calendar'] };
    for (const night of [
        { enabled: true, start: '24:00', end: '07:00', brightness: 10 },
        { enabled: true, start: '7:00', end: '22:00', brightness: 10 },
        { enabled: true, start: '22:00', end: '22:00', brightness: 10 },
        { enabled: true, start: '22:00', end: '07:00', brightness: 81 },
        { enabled: true, start: '22:00', end: '07:00', brightness: 12.5 },
        { enabled: 'yes', start: '22:00', end: '07:00', brightness: 10 },
    ]) await expect(saveAmbientSettings(familyId, { ...base, night })).rejects.toThrow();
});
