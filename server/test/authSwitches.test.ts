import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAuthConfig } from '../src/config/authConfig';
import { app, configure, createInvite, query, registerWithPassword, resetState, startSuite, stopSuite } from './helpers';

beforeAll(startSuite);
afterAll(stopSuite);
beforeEach(() => resetState());

const config = () => request(app).get('/api/auth/config');

describe('effective configuration (passwords only since v1.4.1)', () => {
    it('offers password sign-in and no single sign-on', async () => {
        const response = await config();
        expect(response.body.data).toEqual({
            passwordLogin: true,
            passwordSignup: true,
            passwordReset: false,
            oidc: { enabled: false, name: null, signup: false },
        });
    });

    it.each([
        // REGISTRATION -> passwordSignup
        [undefined, true],
        ['true', true],
        ['false', false],
    ])('REGISTRATION_ENABLED=%s', (reg, signup) => {
        configure({ REGISTRATION_ENABLED: reg });
        expect(getAuthConfig()).toEqual({ passwordLogin: true, passwordSignup: signup });
    });

    it('ignores PASSWORD_LOGIN_ENABLED=false and old OIDC settings, so nobody is locked out', async () => {
        configure({ PASSWORD_LOGIN_ENABLED: 'false', OIDC_ISSUER_URL: 'https://accounts.example.org', OIDC_CLIENT_ID: 'fictional-id', OIDC_CLIENT_SECRET: 'fictional-secret' });
        expect(getAuthConfig()).toEqual({ passwordLogin: true, passwordSignup: true });
        expect((await config()).body.data.oidc).toEqual({ enabled: false, name: null, signup: false });
        await registerWithPassword('bob@example.org', 'correct-horse-1');
        const login = await request(app).post('/api/auth/login').send({ email: 'bob@example.org', password: 'correct-horse-1' });
        expect(login.status).toBe(200);
    });

    it('has no single sign-on routes', async () => {
        expect((await request(app).post('/api/auth/oidc/start').send({ clientChallenge: 'a'.repeat(43) })).status).toBe(404);
        expect((await request(app).get('/api/auth/oidc/callback?code=x&state=y')).status).toBe(404);
        expect((await request(app).delete('/api/auth/oidc/link')).status).toBe(404);
    });

    it('no longer reports an SSO link on /me', async () => {
        const bob = await registerWithPassword('bob@example.org');
        const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bob.token}`);
        expect(me.body.data.user).not.toHaveProperty('sso_linked');
        expect(me.body.data.user.has_password).toBe(true);
    });

    it('keeps the older /registration endpoint working', async () => {
        configure({ REGISTRATION_ENABLED: 'false' });
        const response = await request(app).get('/api/auth/registration');
        expect(response.body.data).toEqual({ open: false });
    });
});

describe('password sign-in', () => {
    it('cannot sign into an account without a password (one made through the old single sign-on)', async () => {
        await query("INSERT INTO users (email, name) VALUES ('alice@example.org', 'Alice')");
        const response = await request(app).post('/api/auth/login').send({ email: 'alice@example.org', password: 'anything-at-all' });
        expect(response.status).toBe(401);
    });

    it('still accepts an invitation when sign-up is closed', async () => {
        const owner = await registerWithPassword('owner@example.org');
        const invite = await createInvite(owner.token);
        configure({ REGISTRATION_ENABLED: 'false' });
        const closed = await request(app).post('/api/auth/register').send({ email: 'new@example.org', password: 'correct-horse-1', name: 'N' });
        expect(closed.status).toBe(403);
        const invited = await request(app).post('/api/auth/register')
            .send({ email: 'new@example.org', password: 'correct-horse-1', name: 'N', inviteToken: invite });
        expect(invited.status).toBe(200);
        expect(invited.body.data.user.is_owner).toBe(false);
    });
});
