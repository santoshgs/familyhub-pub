import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Configuration } from 'openid-client';
import { query, withTransaction, type QueryFn } from '../../../db';
import { loadOpenIdClient } from '../../../lib/openidClient';

const ISSUER = 'https://accounts.google.com';
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const BASE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/tasks'];
const CONFIG_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'FAMILYHUB_GOOGLE_EMAIL', 'FAMILYHUB_TOKEN_KEY'] as const;

/** Messages are intentionally fixed: provider responses and tokens never escape. */
export class GoogleConnectionError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}
const invalidFlow = () => new GoogleConnectionError(400, 'Google connection expired or was refused. Start again.');
const reconnect = () => new GoogleConnectionError(401, 'Google authorization needs reconnecting.');

interface Settings { clientId: string; secret: string; redirect: string; email: string; key: Buffer }
function settings(): Settings {
    if (CONFIG_NAMES.some((name) => !process.env[name]?.trim())) {
        throw new GoogleConnectionError(503, 'Google connection is not configured on this server.');
    }
    const rawKey = process.env.FAMILYHUB_TOKEN_KEY!.trim();
    const key = Buffer.from(rawKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== rawKey) {
        throw new GoogleConnectionError(503, 'Google token encryption configuration is invalid.');
    }
    let redirect: URL;
    try { redirect = new URL(process.env.GOOGLE_REDIRECT_URI!.trim()); } catch {
        throw new GoogleConnectionError(503, 'Google callback configuration is invalid.');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback))
        || redirect.username || redirect.password || redirect.hash || redirect.search) {
        throw new GoogleConnectionError(503, 'Google callback must use HTTPS or loopback HTTP.');
    }
    const email = process.env.FAMILYHUB_GOOGLE_EMAIL!.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new GoogleConnectionError(503, 'The dedicated Google account configuration is invalid.');
    }
    return { clientId: process.env.GOOGLE_CLIENT_ID!.trim(), secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), redirect: redirect.href, email, key };
}

function encrypt(value: object, cfg: Settings, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', cfg.key, iv);
    cipher.setAAD(Buffer.from(`familyhub-google-v1:${context}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt<T>(value: string, cfg: Settings, context: string): T {
    try {
        const envelope = JSON.parse(value);
        if (envelope.v !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', cfg.key, Buffer.from(envelope.iv, 'base64'));
        decipher.setAAD(Buffer.from(`familyhub-google-v1:${context}`));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')) as T;
    } catch { throw reconnect(); }
}
const hash = (state: string) => createHash('sha256').update(state).digest('hex');
// Google may return the canonical userinfo.email URL for the requested email alias.
const normalizeScopes = (scope: string) => [...new Set(scope.split(/\s+/).filter(Boolean)
    .map((value) => value === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : value))];

// Discovery/configuration is intentionally not cached across credential changes.
async function provider(cfg: Settings): Promise<Configuration> {
    try {
        const client = await loadOpenIdClient();
        const config = await client.discovery(new URL(ISSUER), cfg.clientId, cfg.secret, undefined, { timeout: 15 });
        client.enableNonRepudiationChecks(config);
        return config;
    } catch { throw new GoogleConnectionError(502, 'Google authorization is temporarily unavailable.'); }
}

/** One database lock serializes callbacks, refreshes and disconnects across processes. */
async function lockFamily(q: QueryFn, ownerId: string): Promise<void> {
    const result = await q('SELECT id FROM users WHERE id = $1 AND family_owner_id IS NULL FOR UPDATE', [ownerId]);
    if (!result.rows.length) throw new GoogleConnectionError(403, 'Family authorization changed.');
}
async function actorVersion(q: QueryFn, ownerId: string, actorId: string): Promise<number> {
    const result = await q('SELECT id, family_owner_id, role, token_version FROM users WHERE id = $1 FOR SHARE', [actorId]);
    const actor = result.rows[0];
    if (!actor || (actor.family_owner_id ?? actor.id) !== ownerId || (actor.id !== ownerId && actor.role !== 'parent')) {
        throw new GoogleConnectionError(403, 'Only a parent in this family can connect Google.');
    }
    return actor.token_version;
}
interface Tokens { accessToken: string; refreshToken: string; expiresAt: number }
interface Flow { verifier: string; nonce: string; clientId: string; redirect: string; email: string; scopes: string[] }
interface Connection { subject: string; email: string; encrypted_tokens: string; scopes: string[] }

export async function googleStatus(ownerId: string) {
    const missingConfiguration = CONFIG_NAMES.filter((name) => !process.env[name]?.trim());
    let configured = false;
    try { settings(); configured = true; } catch { /* Only public configuration readiness. */ }
    const result = await query('SELECT email, scopes FROM familyhub_google_connections WHERE family_id = $1', [ownerId]);
    const row = result.rows[0] as { email: string; scopes: string[] } | undefined;
    const connected = configured && row?.email === process.env.FAMILYHUB_GOOGLE_EMAIL?.trim().toLowerCase();
    return { configured, connected: Boolean(connected), email: row?.email, scopes: row?.scopes ?? [], gmail: Boolean(connected && row?.scopes.includes(GMAIL)), missingConfiguration };
}

export async function startGoogleConnection(ownerId: string, actualUserId: string, includeGmail = false): Promise<{ authorizationUrl: string }> {
    const cfg = settings();
    const client = await loadOpenIdClient();
    const config = await provider(cfg);
    const state = client.randomState(), nonce = client.randomNonce(), verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const scopes = [...BASE_SCOPES, ...(includeGmail ? [GMAIL] : [])];
    const url = client.buildAuthorizationUrl(config, { redirect_uri: cfg.redirect, scope: scopes.join(' '), state, nonce,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account',
        login_hint: cfg.email, include_granted_scopes: 'false' });
    await withTransaction(async ({ query: q }) => {
        await lockFamily(q, ownerId);
        const version = await actorVersion(q, ownerId, actualUserId);
        await q('DELETE FROM familyhub_google_flows WHERE expires_at < now() OR family_id = $1', [ownerId]);
        await q(`INSERT INTO familyhub_google_flows (state_hash, family_id, actor_id, token_version, encrypted_flow, expires_at)
            VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
        [hash(state), ownerId, actualUserId, version, encrypt({ verifier, nonce, clientId: cfg.clientId, redirect: cfg.redirect, email: cfg.email, scopes }, cfg, `flow:${ownerId}`)]);
    });
    return { authorizationUrl: url.href };
}

export async function finishGoogleConnection(callbackURL: string): Promise<void> {
    const cfg = settings();
    let callback: URL;
    try { callback = new URL(callbackURL); } catch { throw invalidFlow(); }
    const expected = new URL(cfg.redirect);
    const state = callback.searchParams.get('state');
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || !state || state.length > 1024
        || callback.searchParams.getAll('state').length !== 1) throw invalidFlow();
    const found = await query('SELECT family_id FROM familyhub_google_flows WHERE state_hash = $1 AND expires_at > now()', [hash(state)]);
    const ownerId = found.rows[0]?.family_id as string | undefined;
    if (!ownerId) throw invalidFlow();
    const failure = await withTransaction(async ({ query: q }): Promise<GoogleConnectionError | null> => {
        await lockFamily(q, ownerId);
        const claimed = await q(`DELETE FROM familyhub_google_flows WHERE state_hash = $1 AND family_id = $2 AND expires_at > now()
            RETURNING actor_id, token_version, encrypted_flow`, [hash(state), ownerId]);
        const row = claimed.rows[0];
        if (!row) return invalidFlow();
        // Return failures so consuming the flow is committed even when Google
        // refuses authorization or identity verification fails.
        try {
            if (await actorVersion(q, ownerId, row.actor_id) !== row.token_version) return invalidFlow();
            const flow = decrypt<Flow>(row.encrypted_flow, cfg, `flow:${ownerId}`);
            if (flow.clientId !== cfg.clientId || flow.redirect !== cfg.redirect || flow.email !== cfg.email) return invalidFlow();
            const client = await loadOpenIdClient();
            const config = await provider(cfg);
            const tokens = await client.authorizationCodeGrant(config, callback, {
                expectedState: state, expectedNonce: flow.nonce, pkceCodeVerifier: flow.verifier, idTokenExpected: true,
            }, { redirect_uri: cfg.redirect });
            const claims = tokens.claims();
            if (!claims?.sub) return invalidFlow();
            const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
            if (info.email_verified !== true || typeof info.email !== 'string' || info.email.toLowerCase() !== cfg.email) {
                return new GoogleConnectionError(403, 'Select the configured dedicated Family Hub Google account.');
            }
            const existing = (await q('SELECT subject, email, encrypted_tokens, scopes FROM familyhub_google_connections WHERE family_id = $1', [ownerId])).rows[0] as Connection | undefined;
            if (existing && existing.subject !== claims.sub) return new GoogleConnectionError(403, 'Disconnect the existing Google account before changing accounts.');
            const scopes = typeof tokens.scope === 'string' ? normalizeScopes(tokens.scope) : [];
            if (!flow.scopes.every((scope) => scopes.includes(scope))) return new GoogleConnectionError(403, 'Required Google permissions were not granted.');
            const previous = existing ? decrypt<Tokens>(existing.encrypted_tokens, cfg, `tokens:${ownerId}`) : undefined;
            // A refresh token from a differently scoped grant must not silently
            // restore permissions the household just chose to remove.
            const unchangedScopes = existing && existing.scopes.length === scopes.length && existing.scopes.every((scope) => scopes.includes(scope));
            const refreshToken = tokens.refresh_token ?? (unchangedScopes ? previous?.refreshToken : undefined);
            if (!refreshToken) return new GoogleConnectionError(400, 'Offline Google access was not granted. Reconnect with consent.');
            const stored: Tokens = { accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + Math.max(0, Number(tokens.expires_in ?? 0)) * 1000 };
            await q(`INSERT INTO familyhub_google_connections (family_id, subject, email, encrypted_tokens, scopes)
                VALUES ($1, $2, $3, $4, $5) ON CONFLICT (family_id) DO UPDATE SET subject = EXCLUDED.subject,
                email = EXCLUDED.email, encrypted_tokens = EXCLUDED.encrypted_tokens, scopes = EXCLUDED.scopes, updated_at = now(),
                cache_revision = familyhub_google_connections.cache_revision + 1`,
            [ownerId, claims.sub, cfg.email, encrypt(stored, cfg, `tokens:${ownerId}`), scopes]);
            await q('DELETE FROM familyhub_google_snapshots WHERE family_id = $1', [ownerId]);
            return null;
        } catch (error) {
            return error instanceof GoogleConnectionError ? error : new GoogleConnectionError(502, 'Google connection failed. Start again.');
        }
    });
    if (failure) throw failure;
}

export async function getGoogleAccessToken(ownerId: string): Promise<string> {
    const cfg = settings();
    return withTransaction(async ({ query: q }) => {
        await lockFamily(q, ownerId);
        const row = (await q('SELECT subject, email, encrypted_tokens, scopes FROM familyhub_google_connections WHERE family_id = $1', [ownerId])).rows[0] as Connection | undefined;
        if (!row || row.email !== cfg.email) throw reconnect();
        const previous = decrypt<Tokens>(row.encrypted_tokens, cfg, `tokens:${ownerId}`);
        if (previous.expiresAt > Date.now() + 60_000) return previous.accessToken;
        try {
            const client = await loadOpenIdClient();
            const config = await provider(cfg);
            const result = await client.refreshTokenGrant(config, previous.refreshToken);
            const claims = result.claims();
            if (claims && claims.sub !== row.subject) throw reconnect();
            const tokens: Tokens = { accessToken: result.access_token, refreshToken: result.refresh_token ?? previous.refreshToken,
                expiresAt: Date.now() + Math.max(0, Number(result.expires_in ?? 0)) * 1000 };
            const scopes = result.scope ? normalizeScopes(result.scope) : row.scopes;
            if (!BASE_SCOPES.every((scope) => scopes.includes(scope))) throw reconnect();
            const changedScopes = scopes.length !== row.scopes.length || scopes.some((scope) => !row.scopes.includes(scope));
            await q('UPDATE familyhub_google_connections SET encrypted_tokens = $1, scopes = $2, updated_at = now() WHERE family_id = $3',
                [encrypt(tokens, cfg, `tokens:${ownerId}`), scopes, ownerId]);
            if (changedScopes) {
                await q('UPDATE familyhub_google_connections SET cache_revision = cache_revision + 1 WHERE family_id = $1', [ownerId]);
                await q('DELETE FROM familyhub_google_snapshots WHERE family_id = $1', [ownerId]);
            }
            return tokens.accessToken;
        } catch { throw reconnect(); }
    });
}

export async function disconnectGoogle(ownerId: string): Promise<void> {
    // Local disconnection must work even after credentials were removed or rotated.
    await withTransaction(async ({ query: q }) => {
        await lockFamily(q, ownerId);
        const row = (await q('SELECT encrypted_tokens FROM familyhub_google_connections WHERE family_id = $1', [ownerId])).rows[0];
        await q('DELETE FROM familyhub_google_flows WHERE family_id = $1', [ownerId]);
        await q('DELETE FROM familyhub_google_connections WHERE family_id = $1', [ownerId]);
        if (!row) return;
        try {
            const cfg = settings();
            const tokens = decrypt<Tokens>(row.encrypted_tokens, cfg, `tokens:${ownerId}`);
            // Fixed endpoint and form body: credentials never enter URL/logs.
            await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: tokens.refreshToken }), signal: AbortSignal.timeout(10_000) });
        } catch { /* Best effort. Local deletion still commits. */ }
    });
}
