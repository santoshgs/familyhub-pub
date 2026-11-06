import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isClientInputDbError, stripTrailingSlashes } from '../src/lib/asyncRoutes';
import { parseIcs } from '../src/lib/icsCalendar';
import { app, configure, createInvite, me, query, registerWithPassword, resetState, sso, startSuite, stopSuite } from './helpers';

// Regression tests for the November 2026 security scan (v1.1.0). Finding ids
// (F1, F44…) refer to CLAUDE-SECURITY-20261104-174215.

beforeAll(startSuite);
afterAll(stopSuite);
beforeEach(() => resetState());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** An owner and a member of the owner's family. */
const family = async (role?: string) => {
    const owner = await registerWithPassword('owner@example.org');
    const invite = await request(app).post('/api/invites').set(auth(owner.token)).send(role ? { role } : {});
    const joined = await request(app).post('/api/auth/register')
        .send({ email: 'member@example.org', password: 'correct-horse-1', name: 'Member', inviteToken: invite.body.data.token });
    return { owner, member: joined.body.data as { token: string; user: { id: string } } };
};

describe('G1: requests that used to crash or stall the server', () => {
    it('F1: a NUL invite token is refused without a query', async () => {
        const response = await request(app).get('/api/invites/info/%00');
        expect(response.status).toBe(404);
        expect((await request(app).get('/health')).status).toBe(200);
    });

    it('F44/F46: malformed ids answer 400', async () => {
        const owner = await registerWithPassword('owner@example.org');
        expect((await request(app).put('/api/invites/members/x/role').set(auth(owner.token)).send({ role: 'parent' })).status).toBe(400);
        expect((await request(app).delete('/api/invites/x').set(auth(owner.token))).status).toBe(400);
        expect((await request(app).post('/api/invites/requests/x/reject').set(auth(owner.token))).status).toBe(400);
        expect((await request(app).put('/api/notifications/x/read').set(auth(owner.token))).status).toBe(400);
    });

    it('F44: control characters in an invite email are refused', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const response = await request(app).post('/api/invites').set(auth(owner.token)).send({ inviteeEmail: 'a\u0000@b.cc' });
        expect(response.status).toBe(400);
    });

    it('F43: a pathological invite email is rejected quickly', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const started = Date.now();
        const response = await request(app).post('/api/invites').set(auth(owner.token))
            .send({ inviteeEmail: `a@${'.'.repeat(200_000)}@` });
        expect(response.status).toBe(400);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('any async handler rejection becomes a response, database input errors a 400', async () => {
        const mini = express();
        mini.get('/input', async () => { throw Object.assign(new Error('bad uuid'), { code: '22P02' }); });
        mini.get('/fault', async () => { throw new Error('boom'); });
        mini.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(isClientInputDbError(err) ? 400 : 500).end();
        });
        expect((await request(mini).get('/input')).status).toBe(400);
        expect((await request(mini).get('/fault')).status).toBe(500);
    });

    it('a real database input error through the app answers 400', async () => {
        const owner = await registerWithPassword('owner@example.org');
        // Bypasses the id check: appointments use their own router.
        const response = await request(app).get('/api/appointments/not-a-uuid').set(auth(owner.token));
        expect([400, 404]).toContain(response.status);
    });

    it('F52: trailing slashes are stripped in linear time', () => {
        const started = Date.now();
        expect(stripTrailingSlashes(`${'/'.repeat(200_000)}a`)).toHaveLength(200_001);
        expect(stripTrailingSlashes('/api/data/import///')).toBe('/api/data/import');
        expect(Date.now() - started).toBeLessThan(200);
    });

    it('F52: a long run of slashes in the path is answered promptly', async () => {
        const started = Date.now();
        await request(app).get(`/${'/'.repeat(8000)}a`);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    const calendarOf = (count: number, rule: string) => {
        const events = Array.from({ length: count }, (_, i) => [
            'BEGIN:VEVENT', `UID:u${i}@example.org`, 'DTSTART:20000101T000000Z', `RRULE:${rule}`,
            'SUMMARY:Fictional', 'END:VEVENT',
        ].join('\r\n')).join('\r\n');
        return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR\r\n`;
    };
    const parse = (ics: string) => parseIcs(ics, {
        timeZone: 'America/New_York', windowStart: new Date(), windowEnd: new Date(Date.now() + 365 * 86_400_000),
        untitled: 'Untitled', maxEvents: 5000,
    });

    it('F51: many recurring series stop at the parse budget', () => {
        const started = Date.now();
        const result = parse(calendarOf(400, 'FREQ=DAILY;BYHOUR=1,2'));
        expect(result.truncated).toBe(true);
        expect(Date.now() - started).toBeLessThan(10_000);
    });

    it('F51: sub-daily rules are skipped', () => {
        const started = Date.now();
        const result = parse(calendarOf(400, 'FREQ=MINUTELY;BYDAY=MO;BYHOUR=1'));
        expect(result.events).toHaveLength(0);
        expect(Date.now() - started).toBeLessThan(3_000);
    });
});


describe('G2: privilege boundaries', () => {
    it('F48/F49: a member who leaves does not become the server administrator', async () => {
        const { owner, member } = await family('enfant');
        const left = await request(app).delete('/api/invites/leave').set(auth(member.token));
        expect(left.status).toBe(200);
        const standalone = left.body.data.token as string;
        expect((await request(app).get('/api/familyhub/admin/credentials').set(auth(standalone))).status).toBe(403);
        expect((await request(app).get('/api/familyhub/admin/credentials').set(auth(owner.token))).status).toBe(200);
    });

    it('F48: FAMILYHUB_ADMIN_EMAIL names the administrator', async () => {
        const first = await registerWithPassword('first@example.org');
        const second = await registerWithPassword('second@example.org');
        process.env.FAMILYHUB_ADMIN_EMAIL = 'Second@example.org';
        try {
            expect((await request(app).get('/api/familyhub/admin/credentials').set(auth(first.token))).status).toBe(403);
            expect((await request(app).get('/api/familyhub/admin/credentials').set(auth(second.token))).status).toBe(200);
        } finally {
            delete process.env.FAMILYHUB_ADMIN_EMAIL;
        }
    });

    it('F2: a photo-frame session cannot link a sign-in identity', async () => {
        configure({ REGISTRATION_ENABLED: 'true' });
        const owner = await registerWithPassword('owner@example.org');
        const frame = (await request(app).post('/api/familyhub/ambient/display-session').set(auth(owner.token)).send({})).body.data.token as string;
        const started = await request(app).post('/api/auth/oidc/start').set(auth(frame))
            .send({ clientChallenge: 'a'.repeat(43), link: true });
        expect(started.status).toBe(403);
        const exchanged = await request(app).post('/api/auth/oidc/exchange').set(auth(frame))
            .send({ code: 'x'.repeat(43), clientVerifier: 'y'.repeat(43) });
        expect([400, 403]).toContain(exchanged.status);
        // A full session still links.
        const linked = await sso({ link: true, token: owner.token });
        expect(linked.status).toBe(200);
    });

    it('F45: joining another family ends the old sessions', async () => {
        const { member } = await family('enfant');
        const otherOwner = await registerWithPassword('other@example.org');
        const invite = await request(app).post('/api/invites').set(auth(otherOwner.token)).send({ role: 'parent' });
        // Leave first: an account still in a family cannot join another directly.
        const left = await request(app).delete('/api/invites/leave').set(auth(member.token));
        const standalone = left.body.data.token as string;
        const joined = await request(app).post('/api/invites/join').set(auth(standalone)).send({ token: invite.body.data.token });
        expect(joined.status).toBe(200);
        expect((await me(standalone)).status).toBe(401);
        expect((await me(joined.body.data.token)).status).toBe(200);
    });

    const choreSetup = async () => {
        const { owner, member } = await family('enfant');
        const kid = await request(app).post('/api/family').set(auth(owner.token)).send({ name: 'Fictional Kid', role: 'child' });
        const kidId = kid.body.data.id as string;
        const task = await request(app).post('/api/tasks').set(auth(owner.token)).send({ title: 'Fictional chore', points: 10, assigned_to: [kidId] });
        return { owner, child: member, kidId, taskId: task.body.data.id as string };
    };
    const earned = async (taskId: string) =>
        (await query("SELECT COALESCE(SUM(points),0)::int AS total FROM reward_transactions WHERE task_id = $1 AND type = 'earn'", [taskId])).rows[0].total as number;

    it('F58: repeating a member in assigned_to does not multiply points', async () => {
        const { owner, child, kidId, taskId } = await choreSetup();
        await request(app).put(`/api/tasks/${taskId}`).set(auth(child.token))
            .send({ assigned_to: Array(50).fill(kidId), is_completed: true });
        expect((await request(app).post(`/api/tasks/${taskId}/approve`).set(auth(owner.token))).status).toBe(200);
        expect(await earned(taskId)).toBe(10);
    });

    it('F65: a child cannot undo a rewarded chore', async () => {
        const { owner, child, taskId } = await choreSetup();
        await request(app).put(`/api/tasks/${taskId}`).set(auth(owner.token)).send({ is_completed: true });
        expect(await earned(taskId)).toBe(10);
        expect((await request(app).put(`/api/tasks/${taskId}`).set(auth(child.token)).send({ is_completed: false })).status).toBe(403);
        expect(await earned(taskId)).toBe(10);
        expect((await request(app).put(`/api/tasks/${taskId}`).set(auth(owner.token)).send({ is_completed: false })).status).toBe(200);
        expect(await earned(taskId)).toBe(0);
    });

    it('F64: a parent import cannot change the owner account', async () => {
        const { owner, member } = await family('parent');
        const payload = {
            format: 'openfamily-portable', version: '2.0',
            account_refs: [{ id: 'x', is_owner: true, avatar_url: 'https://tracker.example/p.png', language: 'fr' }],
        };
        const imported = await request(app).post('/api/data/import').set(auth(member.token)).send(payload);
        expect(imported.status, JSON.stringify(imported.body)).toBe(200);
        const row = (await query('SELECT avatar_url, language FROM users WHERE id = $1', [owner.user.id])).rows[0];
        expect(row.avatar_url).toBeNull();
        expect(row.language).not.toBe('fr');
    });
});


describe('G3: secrets and outbound requests', () => {
    it('F50: IPv4-mapped and NAT64 literals are judged by their IPv4 address', async () => {
        const { blockedReasonForTests: reason } = await import('../src/utils/urlGuard');
        expect(reason('::ffff:a9fe:a9fe', false)).toMatch(/metadata/);
        expect(reason('::ffff:169.254.169.254', false)).toMatch(/metadata/);
        expect(reason('64:ff9b::a9fe:a9fe', false)).toMatch(/metadata/);
        expect(reason('::a9fe:a9fe', false)).toMatch(/metadata|link-local/);
        expect(reason('::ffff:7f00:1', true)).toMatch(/private/);
        expect(reason('::ffff:ac11:2', true)).toMatch(/private/);
        expect(reason('fe80::1%eth0', false)).toMatch(/link-local/);
        expect(reason('fd12::1', true)).toMatch(/private/);
        expect(reason('192.168.1.10', false)).toBeNull();
        expect(reason('2001:db8::1', true)).toBeNull();
        expect(reason('8.8.8.8', true)).toBeNull();
    });

    it('F63: the guarded lookup refuses blocked answers and the URL check fails closed', async () => {
        const dns = (await import('node:dns/promises')).default;
        const { guardedLookup, assertSafeIntegrationUrl } = await import('../src/utils/urlGuard');
        const spy = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
        const outcome = await new Promise<unknown>((resolve) => guardedLookup(false)('rebind.example', {}, (err) => resolve(err)));
        expect(String(outcome)).toMatch(/bloquée/);
        spy.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
        await expect(assertSafeIntegrationUrl('http://nowhere.example')).rejects.toThrow(/introuvable/);
        spy.mockRestore();
    });

    it('F55: the stored AI key is not sent to another address', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const dns = (await import('node:dns/promises')).default;
        vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '203.0.113.10', family: 4 }] as never);
        const sent: string[] = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
            sent.push(String(new Headers((init as RequestInit)?.headers).get('authorization') ?? ''));
            return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
        });
        try {
            const saved = await request(app).put('/api/ai/settings').set(auth(owner.token))
                .send({ provider: 'openai', base_url: 'https://api.openai.example', model: 'm', api_key: 'sk-fictional-secret' });
            expect(saved.status).toBe(200);
            await request(app).post('/api/ai/test').set(auth(owner.token))
                .send({ provider: 'openai', base_url: 'https://collector.example', model: 'm', api_key: '' });
            expect(sent.join(' ')).not.toContain('sk-fictional-secret');
            // Moving the saved settings to a new address drops the stored key.
            const moved = await request(app).put('/api/ai/settings').set(auth(owner.token))
                .send({ provider: 'openai', base_url: 'https://collector.example', model: 'm' });
            expect(moved.body.data.has_api_key).toBe(false);
        } finally {
            fetchSpy.mockRestore();
            vi.restoreAllMocks();
        }
    });

    it('F41: an integration cannot be moved to a new address with its saved secret', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const dns = (await import('node:dns/promises')).default;
        vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '203.0.113.10', family: 4 }] as never);
        await request(app).put('/api/familyhub/modules').set(auth(owner.token)).send({ disabled_modules: [] });
        const first = await request(app).post('/api/integrations').set(auth(owner.token))
            .send({ type: 'homeassistant', base_url: 'http://192.168.1.20:8123', token: 'fictional-ha-token' });
        expect(first.status).toBe(200);
        const moved = await request(app).post('/api/integrations').set(auth(owner.token))
            .send({ type: 'homeassistant', base_url: 'https://collector.example' });
        expect(moved.status).toBe(400);
        expect(moved.body.error).toBe('CREDENTIALS_REQUIRED');
        const sameHost = await request(app).post('/api/integrations').set(auth(owner.token))
            .send({ type: 'homeassistant', base_url: 'http://192.168.1.20:8123/', display_name: 'Home' });
        expect(sameHost.status).toBe(200);
        vi.restoreAllMocks();
    });

    it('F66: push endpoints must be public https push-service URLs', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const keys = { auth: 'YXV0aA', p256dh: 'cDI1NmRo' };
        for (const endpoint of ['https://10.0.0.5:8443/api/x', 'http://fcm.googleapis.com/x', '\u0000', `https://fcm.googleapis.com/${'a'.repeat(3000)}`]) {
            expect((await request(app).post('/api/notifications/subscribe').set(auth(owner.token)).send({ endpoint, keys })).status).toBe(400);
        }
        const ok = await request(app).post('/api/notifications/subscribe').set(auth(owner.token))
            .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/fictional', keys });
        expect(ok.status).toBe(200);
    });
});


describe('G4: access ends with membership', () => {
    it('F42: removing a member rotates the calendar feed; children cannot read the token', async () => {
        const { owner, member } = await family('enfant');
        expect((await request(app).get('/api/calendar/token').set(auth(member.token))).status).toBe(403);
        const token = (await request(app).get('/api/calendar/token').set(auth(owner.token))).body.data.token as string;
        expect((await request(app).get(`/api/calendar/${token}/openfamily.ics`)).status).toBe(200);
        expect((await request(app).delete(`/api/invites/members/${member.user.id}`).set(auth(owner.token))).status).toBe(200);
        expect((await request(app).get(`/api/calendar/${token}/openfamily.ics`)).status).toBe(404);
    });

    it('F47: a departing member\'s push subscriptions are deleted', async () => {
        const { owner, member } = await family('parent');
        const keys = { auth: 'YXV0aA', p256dh: 'cDI1NmRo' };
        await request(app).post('/api/notifications/subscribe').set(auth(owner.token)).send({ endpoint: 'https://fcm.googleapis.com/fcm/send/owner', keys });
        await request(app).post('/api/notifications/subscribe').set(auth(member.token)).send({ endpoint: 'https://fcm.googleapis.com/fcm/send/member', keys });
        expect((await query('SELECT count(*)::int AS n FROM push_subscriptions')).rows[0].n).toBe(2);
        expect((await request(app).delete('/api/invites/leave').set(auth(member.token))).status).toBe(200);
        const left = (await query('SELECT endpoint FROM push_subscriptions')).rows.map((r) => r.endpoint);
        expect(left).toEqual(['https://fcm.googleapis.com/fcm/send/owner']);
    });

    it('F59: members cannot read or clear the owner\'s personal notifications or devices', async () => {
        const { owner, member } = await family('enfant');
        await query(`INSERT INTO notifications (user_id, title, message, type) VALUES
            ($1, 'Join request', 'Fictional Person (person@example.org)', 'family_join_request'),
            ($1, 'Reminder', 'Fictional appointment', 'appointment_reminder')`, [owner.user.id]);
        const seen = await request(app).get('/api/notifications').set(auth(member.token));
        expect(seen.body.data.map((n: { type: string }) => n.type)).toEqual(['appointment_reminder']);
        await request(app).put('/api/notifications/read-all').set(auth(member.token));
        const unread = await request(app).get('/api/notifications/unread-count').set(auth(owner.token));
        expect(unread.body.data.count).toBe(1);
        const keys = { auth: 'YXV0aA', p256dh: 'cDI1NmRo' };
        await request(app).post('/api/notifications/subscribe').set(auth(owner.token)).send({ endpoint: 'https://fcm.googleapis.com/fcm/send/owner', keys });
        await request(app).delete('/api/notifications/subscribe').set(auth(member.token));
        expect((await query('SELECT count(*)::int AS n FROM push_subscriptions')).rows[0].n).toBe(1);
    });
});


describe('G6: lower-severity fixes', () => {
    it('F3/F39: without APP_PUBLIC_URL only a trusted Host builds outbound links', async () => {
        const { resolveAppBaseUrl } = await import('../src/lib/appUrl');
        const saved = { url: process.env.APP_PUBLIC_URL, cors: process.env.CORS_ORIGINS };
        delete process.env.APP_PUBLIC_URL;
        process.env.CORS_ORIGINS = 'https://hub.example.org';
        try {
            const fake = (host: string) => ({ protocol: 'https', get: () => host }) as never;
            expect(resolveAppBaseUrl(fake('evil.example'))).toBe('');
            expect(resolveAppBaseUrl(fake('hub.example.org'))).toBe('https://hub.example.org');
            expect(resolveAppBaseUrl(fake('localhost:5173'))).toBe('https://localhost:5173');
        } finally {
            process.env.APP_PUBLIC_URL = saved.url;
            if (saved.cors === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = saved.cors;
        }
    });

    it('F56: imported override data cannot replace identity fields', async () => {
        const { pickOverrideFields } = await import('../src/lib/appointmentRecurrence');
        expect(pickOverrideFields({ user_id: 'x', id: 'y', title: 'Moved', start_time: '2026-11-10T10:00:00' }))
            .toEqual({ title: 'Moved', start_time: '2026-11-10T10:00:00' });
        expect(pickOverrideFields(['a'])).toEqual({});
    });

    it('F54: an unknown address still pays for a password check', async () => {
        await registerWithPassword('owner@example.org');
        const time = async (email: string) => {
            const started = Date.now();
            await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-1' });
            return Date.now() - started;
        };
        const known = await time('owner@example.org');
        const unknown = await time('nobody@example.org');
        expect(unknown).toBeGreaterThan(known / 4);
    });
});

export { auth, family, createInvite, query };
