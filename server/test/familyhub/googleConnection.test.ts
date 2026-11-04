import { beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    query: vi.fn(), transaction: vi.fn(), discovery: vi.fn(), grant: vi.fn(), refresh: vi.fn(), userInfo: vi.fn(),
    state: 0, flows: new Map<string, any>(), connection: undefined as any,
    actor: { id: 'fictional-parent', family_owner_id: null as string | null, role: 'parent', token_version: 1 },
    scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/tasks',
}));
vi.mock('../../src/db', () => ({ query: fake.query, withTransaction: fake.transaction }));
vi.mock('../../src/lib/openidClient', () => ({ loadOpenIdClient: async () => ({
    discovery: fake.discovery, enableNonRepudiationChecks: vi.fn(), randomState: () => `fictional-state-${++fake.state}`,
    randomNonce: () => 'fictional-nonce', randomPKCECodeVerifier: () => 'fictional-verifier', calculatePKCECodeChallenge: async () => 'fictional-challenge',
    buildAuthorizationUrl: (_: unknown, params: Record<string, string>) => new URL(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`),
    authorizationCodeGrant: fake.grant, fetchUserInfo: fake.userInfo, refreshTokenGrant: fake.refresh,
}) }));
import { disconnectGoogle, finishGoogleConnection, getGoogleAccessToken, googleStatus, startGoogleConnection } from '../../src/services/familyhub/google/connection';

const OWNER = 'fictional-parent';
const callback = (url: string) => `http://localhost:3001/api/familyhub/google/callback?state=${new URL(url).searchParams.get('state')}&code=fictional-code`;
const authorized = () => ({ access_token: 'fictional-access-token', refresh_token: 'fictional-refresh-token', expires_in: 3600,
    scope: fake.scope, claims: () => ({ sub: 'fictional-google-subject' }) });

beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'fictional-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fictional-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/familyhub/google/callback';
    process.env.FAMILYHUB_GOOGLE_EMAIL = 'hub@example.test';
    process.env.FAMILYHUB_TOKEN_KEY = Buffer.alloc(32, 3).toString('base64');
    fake.flows.clear(); fake.connection = undefined; fake.actor = { id: OWNER, family_owner_id: null, role: 'parent', token_version: 1 };
    fake.discovery.mockResolvedValue({}); fake.grant.mockImplementation(async () => authorized());
    fake.userInfo.mockResolvedValue({ sub: 'fictional-google-subject', email: 'hub@example.test', email_verified: true });
    fake.refresh.mockResolvedValue({ ...authorized(), access_token: 'fictional-refreshed', expires_in: 3600 });
    // Simulate transactional serialization independently of OAuth transport.
    let tail = Promise.resolve();
    fake.transaction.mockImplementation((work: any) => {
        const pending = tail.then(() => work({ query: fake.query }));
        tail = pending.then(() => undefined, () => undefined);
        return pending;
    });
    fake.query.mockImplementation(async (sql: string, args: any[] = []) => {
        let rows: any[] = [];
        if (sql.startsWith('SELECT id FROM users')) rows = [{ id: OWNER }];
        else if (sql.startsWith('SELECT id, family_owner_id')) rows = [fake.actor];
        else if (sql.startsWith('DELETE FROM familyhub_google_flows WHERE expires_at')) fake.flows.clear();
        else if (sql.startsWith('INSERT INTO familyhub_google_flows')) fake.flows.set(args[0], { family_id: args[1], actor_id: args[2], token_version: args[3], encrypted_flow: args[4] });
        else if (sql.startsWith('SELECT family_id FROM familyhub_google_flows')) { const row = fake.flows.get(args[0]); rows = row ? [row] : []; }
        else if (sql.startsWith('DELETE FROM familyhub_google_flows WHERE state_hash')) { const row = fake.flows.get(args[0]); fake.flows.delete(args[0]); rows = row ? [row] : []; }
        else if (sql.startsWith('INSERT INTO familyhub_google_connections')) fake.connection = { family_id: args[0], subject: args[1], email: args[2], encrypted_tokens: args[3], scopes: args[4] };
        else if (sql.startsWith('SELECT') && sql.includes('FROM familyhub_google_connections')) rows = fake.connection ? [fake.connection] : [];
        else if (sql.startsWith('UPDATE familyhub_google_connections SET encrypted_tokens')) { fake.connection.encrypted_tokens = args[0]; fake.connection.scopes = args[1]; }
        else if (sql.startsWith('DELETE FROM familyhub_google_flows WHERE family_id')) fake.flows.clear();
        else if (sql.startsWith('DELETE FROM familyhub_google_connections')) fake.connection = undefined;
        return { rows, rowCount: rows.length };
    });
});

it('fails closed for unsafe callback URLs, invalid encryption keys and missing config without discovery', async () => {
    process.env.GOOGLE_REDIRECT_URI = 'http://192.168.1.20/callback';
    await expect(startGoogleConnection(OWNER, OWNER)).rejects.toMatchObject({ status: 503 });
    process.env.GOOGLE_REDIRECT_URI = 'https://hub.example.test/callback?override=1';
    await expect(startGoogleConnection(OWNER, OWNER)).rejects.toMatchObject({ status: 503 });
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/callback'; process.env.FAMILYHUB_TOKEN_KEY = 'short';
    await expect(startGoogleConnection(OWNER, OWNER)).rejects.toMatchObject({ status: 503 });
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(await googleStatus(OWNER)).toMatchObject({ configured: false, connected: false, missingConfiguration: ['GOOGLE_CLIENT_SECRET'] });
    expect(fake.discovery).not.toHaveBeenCalled();
});

it('stores only hashed state and authenticated ciphertext, with PKCE and no Gmail scope by default', async () => {
    const started = await startGoogleConnection(OWNER, OWNER);
    const url = new URL(started.authorizationUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).not.toContain('gmail');
    expect([...fake.flows.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
    expect([...fake.flows.values()][0].encrypted_flow).not.toContain('fictional-verifier');
    await finishGoogleConnection(callback(started.authorizationUrl));
    expect(fake.grant.mock.calls[0][2]).toEqual(expect.objectContaining({
        expectedState: url.searchParams.get('state'), expectedNonce: 'fictional-nonce',
        pkceCodeVerifier: 'fictional-verifier', idTokenExpected: true,
    }));
    expect(fake.connection.encrypted_tokens).not.toContain('fictional-access-token');
    expect(await getGoogleAccessToken(OWNER)).toBe('fictional-access-token');
    await expect(finishGoogleConnection(callback(started.authorizationUrl))).rejects.toMatchObject({ status: 400 });
    expect(fake.grant).toHaveBeenCalledTimes(1);
});

it('requires verified dedicated email and burns unsuccessful flows without leaking Google details', async () => {
    const started = await startGoogleConnection(OWNER, OWNER);
    fake.userInfo.mockResolvedValue({ email: 'other@example.test', email_verified: true });
    await expect(finishGoogleConnection(callback(started.authorizationUrl))).rejects.toMatchObject({ status: 403 });
    expect(fake.connection).toBeUndefined(); expect(fake.flows.size).toBe(0);
    const next = await startGoogleConnection(OWNER, OWNER);
    fake.grant.mockRejectedValue(new Error('private OAuth response: fictional-secret'));
    await expect(finishGoogleConnection(callback(next.authorizationUrl))).rejects.toThrow('Google connection failed. Start again.');
    expect(fake.flows.size).toBe(0);
});

it('rejects changed sessions, family membership, and child actors before exchanging the code', async () => {
    const first = await startGoogleConnection(OWNER, OWNER); fake.actor.token_version++;
    await expect(finishGoogleConnection(callback(first.authorizationUrl))).rejects.toMatchObject({ status: 400 });
    const second = await startGoogleConnection(OWNER, OWNER); fake.actor.family_owner_id = 'other-family';
    await expect(finishGoogleConnection(callback(second.authorizationUrl))).rejects.toMatchObject({ status: 403 });
    fake.actor.family_owner_id = OWNER; fake.actor.id = 'fictional-child'; fake.actor.role = 'enfant';
    await expect(startGoogleConnection(OWNER, 'fictional-child')).rejects.toMatchObject({ status: 403 });
    expect(fake.grant).not.toHaveBeenCalled();
});

it('refuses an unverified email and first-time consent without an offline refresh token', async () => {
    const first = await startGoogleConnection(OWNER, OWNER);
    fake.userInfo.mockResolvedValue({ email: 'hub@example.test', email_verified: false });
    await expect(finishGoogleConnection(callback(first.authorizationUrl))).rejects.toMatchObject({ status: 403 });
    fake.userInfo.mockResolvedValue({ email: 'hub@example.test', email_verified: true });
    fake.grant.mockImplementation(async () => ({ ...authorized(), refresh_token: undefined }));
    const second = await startGoogleConnection(OWNER, OWNER);
    await expect(finishGoogleConnection(callback(second.authorizationUrl))).rejects.toMatchObject({ status: 400 });
    expect(fake.connection).toBeUndefined();
});

it('rejects a wrong callback origin and missing permissions, including explicit Gmail consent', async () => {
    const first = await startGoogleConnection(OWNER, OWNER);
    await expect(finishGoogleConnection(callback(first.authorizationUrl).replace('localhost', 'evil.test'))).rejects.toMatchObject({ status: 400 });
    expect(fake.grant).not.toHaveBeenCalled();
    const second = await startGoogleConnection(OWNER, OWNER, true);
    expect(new URL(second.authorizationUrl).searchParams.get('scope')).toContain('gmail.readonly');
    await expect(finishGoogleConnection(callback(second.authorizationUrl))).rejects.toMatchObject({ status: 403 });
    expect(fake.connection).toBeUndefined();
});

it('normalizes canonical Google email scope and refuses swapping a stable account subject', async () => {
    fake.grant.mockImplementation(async () => ({ ...authorized(), scope: fake.scope.replace(' email ', ' https://www.googleapis.com/auth/userinfo.email ') }));
    const first = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(first.authorizationUrl));
    const second = await startGoogleConnection(OWNER, OWNER);
    fake.grant.mockImplementation(async () => ({ ...authorized(), claims: () => ({ sub: 'different-google-subject' }) }));
    await expect(finishGoogleConnection(callback(second.authorizationUrl))).rejects.toMatchObject({ status: 403 });
    expect(fake.connection.subject).toBe('fictional-google-subject');
});

it('refreshes once for simultaneous readers and retains omitted refresh tokens', async () => {
    fake.grant.mockImplementation(async () => ({ ...authorized(), expires_in: 0 }));
    const start = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(start.authorizationUrl));
    fake.refresh.mockResolvedValue({ ...authorized(), refresh_token: undefined, access_token: 'fictional-refreshed' });
    expect(await Promise.all([getGoogleAccessToken(OWNER), getGoogleAccessToken(OWNER)])).toEqual(['fictional-refreshed', 'fictional-refreshed']);
    expect(fake.refresh).toHaveBeenCalledTimes(1);
    expect(fake.refresh.mock.calls[0][1]).toBe('fictional-refresh-token');
});

it('rejects encrypted-token tampering and key changes', async () => {
    const start = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(start.authorizationUrl));
    const envelope = JSON.parse(fake.connection.encrypted_tokens); envelope.tag = Buffer.alloc(16).toString('base64');
    fake.connection.encrypted_tokens = JSON.stringify(envelope);
    await expect(getGoogleAccessToken(OWNER)).rejects.toMatchObject({ status: 401 });
    expect(fake.refresh).not.toHaveBeenCalled();
});
it('requires reconnecting when Google refresh removes essential permissions', async () => {
    fake.grant.mockImplementation(async () => ({ ...authorized(), expires_in: 0 }));
    const start = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(start.authorizationUrl));
    fake.refresh.mockResolvedValue({ ...authorized(), scope: 'openid email' });
    await expect(getGoogleAccessToken(OWNER)).rejects.toMatchObject({ status: 401 });
});
it('clears cached mailbox data when optional Gmail permission is removed during refresh', async () => {
    fake.grant.mockImplementation(async () => ({ ...authorized(), scope: `${fake.scope} https://www.googleapis.com/auth/gmail.readonly`, expires_in: 0 }));
    const start = await startGoogleConnection(OWNER, OWNER, true); await finishGoogleConnection(callback(start.authorizationUrl));
    fake.query.mockClear();
    expect(await getGoogleAccessToken(OWNER)).toBe('fictional-refreshed');
    expect(fake.query).toHaveBeenCalledWith('DELETE FROM familyhub_google_snapshots WHERE family_id = $1', [OWNER]);
    expect((await googleStatus(OWNER)).gmail).toBe(false);
});

it('disconnects locally even with missing encryption configuration and cancels pending flows', async () => {
    const start = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(start.authorizationUrl));
    await startGoogleConnection(OWNER, OWNER); delete process.env.FAMILYHUB_TOKEN_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await disconnectGoogle(OWNER);
    expect(fake.connection).toBeUndefined(); expect(fake.flows.size).toBe(0); expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
});

it('revokes through a fixed endpoint and form body, while tolerating an unavailable Google service', async () => {
    const start = await startGoogleConnection(OWNER, OWNER); await finishGoogleConnection(callback(start.authorizationUrl));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fictional transport failure'));
    await disconnectGoogle(OWNER);
    expect(fetchSpy).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({ method: 'POST', redirect: 'error' }));
    expect((fetchSpy.mock.calls[0][1]!.body as URLSearchParams).get('token')).toBe('fictional-refresh-token');
    expect(fake.connection).toBeUndefined(); fetchSpy.mockRestore();
});
