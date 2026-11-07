import request from 'supertest';
import app from '../src/app';
import pool, { query, runMigrations } from '../src/db';
import { resetAuthConfigForTests } from '../src/config/authConfig';

export { app, query };

// OIDC_* stay in the list so a test can check they are ignored (single sign-on was removed).
const AUTH_ENV = ['REGISTRATION_ENABLED', 'PASSWORD_LOGIN_ENABLED', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REGISTRATION_ENABLED'];

/** Applies a sign-in configuration (unset variables fall back to their defaults). */
export const configure = (env: Record<string, string | undefined> = {}): void => {
    for (const name of AUTH_ENV) delete process.env[name];
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    resetAuthConfigForTests();
};

export const startSuite = async (): Promise<void> => {
    await runMigrations();
};

export const stopSuite = async (): Promise<void> => {
    await pool.end();
};

export const resetState = async (): Promise<void> => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    configure();
};

export const registerWithPassword = async (email: string, password = 'correct-horse-1', name = 'Someone') => {
    const response = await request(app).post('/api/auth/register').send({ email, password, name });
    if (response.status !== 200) throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
    return response.body.data as { token: string; user: { id: string } };
};

export const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

export const createInvite = async (ownerToken: string, inviteeEmail?: string) => {
    const response = await request(app)
        .post('/api/invites')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(inviteeEmail ? { inviteeEmail } : {});
    if (response.status !== 200 && response.status !== 201) {
        throw new Error(`invite failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.data.token as string;
};
