import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pool, { query, runMigrations } from '../../src/db';
import { resetAuthConfigForTests } from '../../src/config/authConfig';
import { verifyAccessToken } from '../../src/lib/authTokens';
import { app, registerWithPassword } from '../helpers';

const OWNER_EMAIL = 'local-owner@example.test';
const PASSWORD = 'fictional-password-1';
type Account = Awaited<ReturnType<typeof registerWithPassword>>;
let owner: Account;

beforeAll(async () => {
    // setupEnv.ts guards the configured name; check the actual connection too
    // before migrations or destructive cleanup can touch a different database.
    const database = await query('SELECT current_database() AS name');
    if (!String(database.rows[0]?.name).endsWith('_test')) {
        throw new Error('Family Hub local tests require a disposable database ending in _test.');
    }
    await runMigrations();
});

beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    // These tests exercise local password accounts, not a live identity provider.
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    process.env.PASSWORD_LOGIN_ENABLED = 'true';
    process.env.REGISTRATION_ENABLED = 'true';
    resetAuthConfigForTests();
    owner = await registerWithPassword(OWNER_EMAIL, PASSWORD, 'Fictional Alex');
});

afterAll(async () => {
    await pool.end();
});

const get = (path: string, token = owner.token) =>
    request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: unknown = {}, token = owner.token) =>
    request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
const createNote = async (body: Record<string, unknown> = {}) => {
    const response = await post('/api/notes', { content: 'Pack the fictional library tote.', color: 'green', ...body });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    return response.body.data as { id: string; content: string; author_name: string; author_id?: string; pinned: boolean };
};
const displayToken = async () => {
    const response = await post('/api/familyhub/display-session');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toEqual(expect.any(String));
    return response.body.data.token as string;
};

describe('persistent family notes', () => {
    it('persists an authenticated note and pin through later reads and a second login', async () => {
        const note = await createNote();
        const updated = await request(app).put(`/api/notes/${note.id}`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ content: 'Bring the fictional swim bag instead.', pinned: true });
        expect(updated.status).toBe(200);
        expect(updated.body.data).toMatchObject({ id: note.id, pinned: true });

        const stored = await query('SELECT content, pinned FROM family_notes WHERE id = $1', [note.id]);
        expect(stored.rows).toEqual([{ content: 'Bring the fictional swim bag instead.', pinned: true }]);

        const login = await request(app).post('/api/auth/login').send({ email: OWNER_EMAIL, password: PASSWORD });
        expect(login.status).toBe(200);
        for (const token of [owner.token, login.body.data.token as string]) {
            const hub = await get('/api/familyhub', token);
            expect(hub.status).toBe(200);
            expect(hub.body.data.readOnly).toBe(false);
            expect(hub.body.data.notes).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: note.id, content: 'Bring the fictional swim bag instead.', pinned: true }),
            ]));
        }
    });

    it('uses the authenticated author and ignores forged author fields on create and edit', async () => {
        const other = await registerWithPassword('unrelated-author@example.test', PASSWORD, 'Fictional Outsider');
        const note = await createNote({ author_name: 'Forged Name', author_id: other.user.id, author: 'forged' });
        expect(note.author_name).toBe('Fictional Alex');
        if (note.author_id !== undefined) expect(note.author_id).toBe(owner.user.id);

        const edited = await request(app).put(`/api/notes/${note.id}`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ content: 'An edited fictional note.', author_name: 'Still Forged', author_id: other.user.id });
        expect(edited.status).toBe(200);
        expect(edited.body.data.author_name).toBe('Fictional Alex');
        if (edited.body.data.author_id !== undefined) expect(edited.body.data.author_id).toBe(owner.user.id);
    });

    it('does not let a different household read, edit, or delete the owner’s note', async () => {
        const note = await createNote();
        const other = await registerWithPassword('other-household@example.test', PASSWORD, 'Fictional Jamie');
        const list = await get('/api/notes', other.token);
        expect(list.status).toBe(200);
        expect(list.body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id })]));
        const hub = await get('/api/familyhub', other.token);
        expect(hub.status).toBe(200);
        expect(hub.body.data.notes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id })]));

        const edit = await request(app).put(`/api/notes/${note.id}`)
            .set('Authorization', `Bearer ${other.token}`).send({ content: 'An unauthorized change.', pinned: true });
        const remove = await request(app).delete(`/api/notes/${note.id}`).set('Authorization', `Bearer ${other.token}`);
        expect(edit.status).toBe(404);
        expect(remove.status).toBe(404);
        const stored = await query('SELECT content, pinned FROM family_notes WHERE id = $1', [note.id]);
        expect(stored.rows).toEqual([{ content: note.content, pinned: false }]);
    });

    it('retains normal owner delete behavior after display restrictions are added', async () => {
        const note = await createNote();
        const remove = await request(app).delete(`/api/notes/${note.id}`).set('Authorization', `Bearer ${owner.token}`);
        expect(remove.status).toBe(200);
        expect((await get('/api/familyhub')).body.data.notes).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ id: note.id })]),
        );
        expect((await query('SELECT id FROM family_notes WHERE id = $1', [note.id])).rows).toEqual([]);
    });
});

describe('protected tablet sessions', () => {
    it('issues a signed read-only session that can read its own household’s permitted data', async () => {
        const note = await createNote();
        const token = await displayToken();
        expect(await verifyAccessToken(token)).toMatchObject({ userId: owner.user.id, ownerId: owner.user.id, readOnly: true });
        const hub = await get('/api/familyhub', token);
        expect(hub.status).toBe(200);
        expect(hub.body.data.readOnly).toBe(true);
        expect(hub.body.data.notes).toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id })]));
        for (const path of ['/api/notes', '/api/auth/me', '/api/auth/modules', '/api/auth/dashboard-prefs']) {
            expect((await get(path, token)).status, `${path} must remain readable on the tablet`).toBe(200);
        }
    });

    it('rejects missing authentication and child accounts when issuing display sessions', async () => {
        expect((await request(app).post('/api/familyhub/display-session').send({})).status).toBe(401);
        const invite = await post('/api/invites', { role: 'enfant' });
        expect(invite.status).toBe(200);
        const child = await request(app).post('/api/auth/register').send({
            email: 'fictional-child@example.test', password: PASSWORD, name: 'Fictional Child', inviteToken: invite.body.data.token,
        });
        expect(child.status).toBe(200);
        const issue = await post('/api/familyhub/display-session', {}, child.body.data.token);
        expect(issue.status).toBe(403);
    });

    it('rejects note and task mutations with the tablet token without changing stored notes', async () => {
        const note = await createNote();
        const token = await displayToken();
        expect((await post('/api/notes', { content: 'Tablet must not create this.' }, token)).status).toBe(403);
        expect((await request(app).put(`/api/notes/${note.id}`)
            .set('Authorization', `Bearer ${token}`).send({ content: 'Tablet must not edit this.', pinned: true })).status).toBe(403);
        expect((await request(app).delete(`/api/notes/${note.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
        expect((await post('/api/tasks', { title: 'Tablet must not create this task.' }, token)).status).toBe(403);
        expect((await request(app).put(`/api/tasks/${note.id}`)
            .set('Authorization', `Bearer ${token}`).send({ is_completed: true })).status).toBe(403);
        expect((await request(app).delete(`/api/tasks/${note.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
        const stored = await query('SELECT content, pinned FROM family_notes WHERE id = $1', [note.id]);
        expect(stored.rows).toEqual([{ content: note.content, pinned: false }]);
        expect((await query('SELECT id FROM family_notes WHERE user_id = $1', [owner.user.id])).rows).toHaveLength(1);
        expect((await query('SELECT id FROM tasks WHERE user_id = $1', [owner.user.id])).rows).toEqual([]);
    });

    it('cannot refresh into a full session, create another tablet session, or read integrations', async () => {
        const token = await displayToken();
        for (const path of ['/api/auth/refresh', '/api/familyhub/display-session', '/api/auth/logout-all']) {
            const response = await post(path, {}, token);
            expect(response.status, `${path} must reject tablet credentials`).toBe(403);
            expect(response.body.data?.token).toBeUndefined();
        }
        for (const path of ['/api/integrations', '/api/tasks', '/api/data/export']) {
            expect((await get(path, token)).status, `${path} is outside the tablet read allow-list`).toBe(403);
        }
        // The blocked logout-all request did not revoke the owner's session.
        expect((await get('/api/auth/me')).status).toBe(200);
    });

    it('refuses an edited scope claim rather than letting the browser promote itself', async () => {
        const token = await displayToken();
        const segments = token.split('.');
        const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString()) as Record<string, unknown>;
        delete claims.scope;
        segments[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const forged = segments.join('.');
        expect(forged).not.toBe(token);
        expect((await get('/api/familyhub', forged)).status).toBe(401);
    });

    it('revokes the display token when the issuing account’s token version changes', async () => {
        const token = await displayToken();
        expect((await get('/api/familyhub', token)).status).toBe(200);
        const revoke = await post('/api/auth/logout-all');
        expect(revoke.status).toBe(200);
        for (const path of ['/api/familyhub', '/api/notes', '/api/auth/me']) {
            expect((await get(path, token)).status, `${path} must reject the revoked tablet session`).toBe(401);
        }
    });
});
