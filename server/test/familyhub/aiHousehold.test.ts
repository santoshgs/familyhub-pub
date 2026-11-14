import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const ai = vi.hoisted(() => ({ prompt: '', reply: { items: [] as unknown[] } }));
vi.mock('../../src/services/ai', async (original) => {
    const real = await original<typeof import('../../src/services/ai')>();
    return { ...real, aiComplete: async (_settings: unknown, request: { system: string }) => { ai.prompt = request.system; return ai.reply; } };
});
vi.mock('../../src/services/familyhub/google/connection', async (original) => {
    const real = await original<typeof import('../../src/services/familyhub/google/connection')>();
    return { ...real,
        getGoogleAccessToken: async () => 'fictional-access',
        googleStatus: async (family: string) => {
            const { query } = await import('../../src/db');
            const row = (await query('SELECT email FROM familyhub_google_connections WHERE family_id=$1', [family])).rows[0];
            return { configured: true, connected: Boolean(row), email: row?.email, gmail: false, scopes: [], missingConfiguration: [] };
        },
    };
});
import pool, { query, runMigrations } from '../../src/db';
import { app, registerWithPassword } from '../helpers';
import { saveDisabledModules } from '../../src/lib/modules';
import { localToday, repeatRule, validateParsedItems } from '../../src/services/ai/assistant';
import { peopleFromLegend, type HouseholdContext } from '../../src/services/ai/householdContext';

const zone = 'America/New_York';
const blank = { title: '', description: '', date: '', start_time: '', end_time: '', location: '', member_names: [], priority: '', frequency: '', quantity: 0, unit: '', category: '', amount: 0, is_expense: true,
    ref: '', people: [], list: '', repeat: '', repeat_days: [], repeat_until: '', repeat_count: 0 };
const context: HouseholdContext = {
    timeZone: zone,
    people: [{ label: 'Fictional Sam', colorId: '10' }, { label: 'Blue: Fictional Lee', colorId: '9' }, { label: 'Family', colorId: null }],
    lists: [{ id: 'grocer', title: 'Groceries' }, { id: 'bulk', title: 'Groceries - Costco' }],
    events: [
        { ref: 'E1', id: 'ev1', title: 'Fictional vaccine', location: 'Clinic', colorId: '10', allDay: false, start: { dateTime: '2026-11-20T15:00:00-05:00' }, end: { dateTime: '2026-11-20T15:45:00-05:00' } },
        { ref: 'E2', id: 'ev2', title: 'Fictional fair', location: '', colorId: null, allDay: true, start: { date: '2026-11-21' }, end: { date: '2026-11-23' } },
    ],
    tasks: [{ ref: 'T1', id: 'task1', title: 'Fictional library bag', dueDate: '2026-11-18' }],
    items: [{ ref: 'S1', id: 'item1', listId: 'grocer', listTitle: 'Groceries', name: 'Milk' }],
};
const parse = (items: unknown[], withContext: HouseholdContext | null = context) =>
    validateParsedItems({ items: items.map((item) => ({ ...blank, ...(item as object) })) }, [], undefined, undefined, withContext);

describe('the assistant in Family Hub mode', () => {
    it('gives a new event the colour of the person it is for, and its repeat rule', () => {
        const [event] = parse([{ type: 'appointment', title: 'Fictional swim', start_time: '2026-11-24T17:00:00', people: ['fictional lee'], repeat: 'weekly', repeat_days: ['tu'], repeat_count: 6 }]);
        expect(event).toMatchObject({ type: 'appointment', color_id: '9', people: ['Blue: Fictional Lee'], recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6' });
        const [plain] = parse([{ type: 'appointment', title: 'Fictional call', start_time: '2026-11-24T09:00:00', people: ['Nobody'] }]);
        expect(plain).not.toHaveProperty('color_id'); expect(plain).not.toHaveProperty('recurrence');
    });
    it('ends a repeat on the last day in the household time zone', () => {
        expect(repeatRule({ repeat: 'daily', repeat_until: '2026-12-01' }, '2026-11-20', zone)).toBe('RRULE:FREQ=DAILY;UNTIL=20261202T045959Z');
        expect(repeatRule({ repeat: 'daily', repeat_until: '2026-01-01' }, '2026-11-20', zone)).toBe('RRULE:FREQ=DAILY');
        expect(repeatRule({ repeat: 'hourly' }, '2026-11-20', zone)).toBeNull();
    });
    it('puts shopping items on the named list, a list named after the store, or the first list', () => {
        const items = parse([{ type: 'shopping_item', title: 'Diapers', list: 'costco' }, { type: 'shopping_item', title: 'Floss', list: 'Groceries' }, { type: 'shopping_item', title: 'Tape' }]);
        expect(items.map((item) => 'list_id' in item && item.list_id)).toEqual(['bulk', 'grocer', 'grocer']);
    });
    it('moves an event and keeps its length, or moves it to another day at the same time', () => {
        const [moved] = parse([{ type: 'appointment_update', ref: 'E1', start_time: '2026-11-21T10:00:00' }]);
        expect(moved).toMatchObject({ type: 'appointment_update', event_id: 'ev1', title: 'Fictional vaccine', location: 'Clinic', color_id: '10',
            start: { dateTime: '2026-11-21T10:00:00', timeZone: zone }, end: { dateTime: '2026-11-21T10:45:00', timeZone: zone } });
        const [day] = parse([{ type: 'appointment_update', ref: 'e1', date: '2026-11-27' }]);
        expect(day).toMatchObject({ start: { dateTime: '2026-11-27T15:00:00' }, end: { dateTime: '2026-11-27T15:45:00' } });
        const [fair] = parse([{ type: 'appointment_update', ref: 'E2', date: '2026-11-28', people: ['Fictional Sam'] }]);
        expect(fair).toMatchObject({ all_day: true, start: { date: '2026-11-28' }, end: { date: '2026-11-30' }, color_id: '10' });
    });
    it('changes to-dos and shopping items by reference only, once each, and never without the household context', () => {
        const edits = parse([
            { type: 'task_update', ref: 'T1', date: '2026-11-25' }, { type: 'task_complete', ref: 'T1' },
            { type: 'shopping_check', ref: 'S1' }, { type: 'appointment_delete', ref: 'E9' }, { type: 'appointment_update', ref: 'E1' },
        ]);
        expect(edits).toEqual([
            { type: 'task_update', task_id: 'task1', title: 'Fictional library bag', due_date: '2026-11-25', before: { title: 'Fictional library bag', due_date: '2026-11-18' } },
            { type: 'shopping_check', list_id: 'grocer', item_id: 'item1', name: 'Milk', list_title: 'Groceries' },
        ]);
        expect(parse([{ type: 'shopping_check', ref: 'S1' }, { type: 'shopping_item', title: 'Floss' }], null)).toEqual([{ type: 'shopping_item', name: 'Floss', category: 'Autre', quantity: null, unit: null }]);
    });
    it('maps colour labels on custom shades onto Google colours', () => {
        const palette = { calendar: '#9fe1e7', colors: [{ id: '9', color: '#5484ed' }, { id: '10', color: '#51b749' }] };
        expect(peopleFromLegend({ '#33b679': 'Fictional Sam', '#9fe1e7': 'Family', '#000000': 'Far away', '#51B749': 'Fictional Kim' }, palette))
            .toEqual([{ label: 'Family', colorId: null }, { label: 'Fictional Kim', colorId: '10' }]);
    });
    it('reads "today" in the household time zone', () => {
        expect(localToday(zone, new Date('2026-11-15T02:00:00Z')).iso).toBe('2026-11-14');
    });
});

describe('POST /api/ai/parse with Google connected', () => {
    let owner: Awaited<ReturnType<typeof registerWithPassword>>;
    const tasks = [{ id: 'task1', title: 'Fictional library bag', status: 'needsAction', due: '2026-11-18T00:00:00.000Z' }, { id: 'done', title: 'Done already', status: 'completed' }];
    const transport = async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/colors')) return Response.json({ event: { 10: { background: '#51b749' } } });
        if (url.pathname.includes('/users/me/calendarList/')) return Response.json({ backgroundColor: '#9fe1e7' });
        if (url.pathname.includes('/events')) return Response.json({ items: [{ id: 'ev1', summary: 'Fictional vaccine', start: { dateTime: '2026-11-20T15:00:00-05:00' }, end: { dateTime: '2026-11-20T15:45:00-05:00' } }] });
        if (url.pathname.endsWith('/users/@me/lists')) return Response.json({ items: [{ id: 'family-list', title: 'Fictional tasks' }, { id: 'grocer', title: 'Groceries' }] });
        if (url.pathname.includes('/lists/family-list/tasks')) return Response.json({ items: tasks });
        if (url.pathname.includes('/lists/grocer/tasks')) return Response.json({ items: [{ id: 'item1', title: 'Milk', status: 'needsAction', position: '1' }] });
        return Response.json({}, { status: 404 });
    };
    beforeAll(async () => { await runMigrations(); });
    beforeEach(async () => {
        await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
        owner = await registerWithPassword('fictional-ai-owner@example.test', 'fictional-password-1', 'Fictional Alex');
        await query(`INSERT INTO ai_settings (user_id, provider, model, enabled) VALUES ($1,'ollama','fictional-model',true)`, [owner.user.id]);
        vi.spyOn(globalThis, 'fetch').mockImplementation(transport as typeof fetch);
    });
    afterAll(async () => { vi.restoreAllMocks(); await pool.end(); });
    const post = (text: string) => request(app).post('/api/ai/parse').set('Authorization', `Bearer ${owner.token}`).send({ text });

    it('works as before without Google, and offers no changes to existing items', async () => {
        ai.reply = { items: [{ ...blank, type: 'shopping_check', ref: 'S1' }, { ...blank, type: 'task', title: 'Fictional bag' }] };
        const result = await post('milk is bought');
        expect(result.status).toBe(200);
        expect(result.body.data.items.map((item: { type: string }) => item.type)).toEqual(['task']);
        expect(ai.prompt).not.toContain('Événements existants');
    });
    it('shows the model the household by reference and maps its answer back to Google ids', async () => {
        await query(`INSERT INTO familyhub_google_connections (family_id,subject,email,encrypted_tokens,scopes) VALUES ($1,'fictional-subject','hub@example.test','fictional-ciphertext',ARRAY[]::text[])`, [owner.user.id]);
        await query(`INSERT INTO familyhub_google_settings (family_id,calendar_id,task_list_id,time_zone) VALUES ($1,'shared','family-list',$2)`, [owner.user.id, zone]);
        await query(`INSERT INTO familyhub_calendar_legend (family_id,labels) VALUES ($1,$2)`, [owner.user.id, JSON.stringify({ '#33b679': 'Fictional Sam' })]);
        await saveDisabledModules(owner.user.id, []);
        await query(`INSERT INTO familyhub_shopping_settings (family_id,list_ids) VALUES ($1,'["grocer"]')`, [owner.user.id]);
        ai.reply = { items: [
            { ...blank, type: 'appointment_update', ref: 'E1', start_time: '2026-11-27T15:00:00', people: ['Fictional Sam'] },
            { ...blank, type: 'task_complete', ref: 'T1' }, { ...blank, type: 'shopping_check', ref: 'S1' },
            { ...blank, type: 'shopping_item', title: 'Floss', list: 'Groceries' },
        ] };
        const result = await post('move the vaccine to next Friday for Sam, the bag is done, milk is bought, add floss');
        expect(result.status).toBe(200);
        expect(ai.prompt).toContain('E1 | Fictional vaccine | 2026-11-20T15:00 | 2026-11-20T15:45');
        expect(ai.prompt).toContain('T1 | Fictional library bag | 2026-11-18');
        expect(ai.prompt).toContain('S1 | Milk | Groceries');
        expect(ai.prompt).toContain('- Fictional Sam');
        expect(ai.prompt).not.toContain('Done already');
        expect(result.body.data.items).toEqual([
            expect.objectContaining({ type: 'appointment_update', event_id: 'ev1', color_id: '10', start: { dateTime: '2026-11-27T15:00:00', timeZone: zone }, end: { dateTime: '2026-11-27T15:45:00', timeZone: zone } }),
            { type: 'task_complete', task_id: 'task1', title: 'Fictional library bag' },
            { type: 'shopping_check', list_id: 'grocer', item_id: 'item1', name: 'Milk', list_title: 'Groceries' },
            expect.objectContaining({ type: 'shopping_item', name: 'Floss', list_id: 'grocer', list_title: 'Groceries' }),
        ]);
    });
});
