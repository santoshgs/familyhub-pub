import { randomUUID } from 'crypto';
import { Router, type Express } from 'express';
import { query } from '../db';
import { isUuid } from '../lib/asyncRoutes';
import {
    AgentPermissionError, DEFAULT_AGENT_DAYS, MAX_AGENT_DAYS, MAX_AGENT_SESSIONS,
    agentDenied, cleanAgentPermissions, newAgentToken, storedAgentPermissions,
} from '../lib/agentSessions';
import { PAYLOAD_CONTRACTS } from '../lib/payloadContracts';
import { authMiddleware, requireParent, type AuthRequest } from '../middleware/auth';
import { listRoutes } from './schema';

/**
 * Connected apps: a parent creates, lists, rotates and revokes the sessions
 * outside tools sign in with (docs/familyhub/AGENT_API.md). A token is returned
 * once, when it is made; only its hash is stored. Agent and display tokens
 * cannot reach these routes (authMiddleware refuses them first).
 */

const LIST = `SELECT s.id, s.name, s.permissions, s.created_at, s.last_used_at, s.expires_at,
        CASE WHEN s.expires_at <= now() THEN 'expired'
             WHEN u.id IS NULL OR COALESCE(u.family_owner_id, u.id) <> s.family_id OR u.token_version <> s.creator_token_version THEN 'signed-out'
             ELSE 'active' END AS status
    FROM familyhub_agent_sessions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.family_id = $1 AND s.revoked_at IS NULL`;
const view = (row: any) => ({ ...row, permissions: storedAgentPermissions(row.permissions) });

const cleanName = (value: unknown): string | null => {
    const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return name && name.length <= 40 ? name : null;
};
const cleanDays = (value: unknown): number | null => {
    if (value === undefined || value === null) return DEFAULT_AGENT_DAYS;
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AGENT_DAYS ? value : null;
};

export function createAgentSessionsRouter(app: Express): Router {
    const router = Router();
    const getRoutes = (): string[] => listRoutes(app).routes.filter((route) => route.method === 'GET').map((route) => route.path);

    router.use(authMiddleware, requireParent);

    router.get('/', async (req: AuthRequest, res) => {
        const rows = await query(`${LIST} ORDER BY s.created_at`, [req.userId]);
        res.json({ success: true, data: rows.rows.map(view) });
    });

    // The write record: the newest changes made or attempted by the family's
    // connected apps (removed ones included), or by one of them (?session=<id>).
    router.get('/writes', async (req: AuthRequest, res) => {
        const session = req.query.session;
        if (session !== undefined && !isUuid(session)) return res.status(400).json({ success: false, error: 'Unknown connected app.' });
        const rows = await query(
            `SELECT w.id, w.session_id, s.name AS session_name, (s.revoked_at IS NOT NULL) AS session_removed, w.user_id, w.method, w.path, w.status, w.created_at
             FROM familyhub_agent_writes w JOIN familyhub_agent_sessions s ON s.id = w.session_id
             WHERE w.family_id = $1 AND ($2::uuid IS NULL OR w.session_id = $2::uuid) ORDER BY w.id DESC LIMIT 200`,
            [req.userId, session ?? null],
        );
        res.json({ success: true, data: rows.rows });
    });

    // What a session can be given: read grants by area, and the endpoints with a payload contract.
    router.get('/grantable', (_req, res) => {
        const areas = new Map<string, string[]>();
        for (const path of getRoutes()) {
            if (agentDenied(path.toLowerCase()) || path === '/api/schema') continue;
            const parts = path.split('/');
            // Family Hub's own routes are grouped one level deeper than the rest.
            const depth = parts[2] === 'familyhub' ? 4 : 3;
            const grant = parts.length <= depth && parts[2] === 'familyhub' ? path : `${parts.slice(0, depth).join('/')}/*`;
            areas.set(grant, [...(areas.get(grant) ?? []), path]);
        }
        // "/api/x" and "/api/x/*" are offered as the one grant that covers both.
        for (const [grant, routes] of [...areas]) {
            const wide = `${grant}/*`;
            if (!grant.endsWith('/*') && areas.has(wide)) { areas.set(wide, [...routes, ...areas.get(wide)!]); areas.delete(grant); }
        }
        res.json({
            success: true,
            data: {
                read: [...areas].map(([grant, routes]) => ({ grant, routes })).sort((a, b) => a.grant.localeCompare(b.grant)),
                write: Object.entries(PAYLOAD_CONTRACTS).filter(([key]) => !agentDenied(key.split(' ')[1])).map(([endpoint, contract]) => ({ endpoint, summary: contract.summary })),
                defaultDays: DEFAULT_AGENT_DAYS, maxDays: MAX_AGENT_DAYS, maxSessions: MAX_AGENT_SESSIONS,
            },
        });
    });

    router.post('/', async (req: AuthRequest, res) => {
        const name = cleanName(req.body?.name), days = cleanDays(req.body?.expiresInDays);
        if (!name) return res.status(400).json({ success: false, error: 'Give the connected app a name of 1–40 characters.' });
        if (!days) return res.status(400).json({ success: false, error: `Choose an expiry of 1–${MAX_AGENT_DAYS} days.` });
        let permissions;
        try { permissions = cleanAgentPermissions(req.body?.permissions, getRoutes()); }
        catch (error) {
            if (error instanceof AgentPermissionError) return res.status(400).json({ success: false, error: error.message });
            throw error;
        }
        const count = await query('SELECT count(*)::int AS n FROM familyhub_agent_sessions WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now()', [req.userId]);
        if (count.rows[0].n >= MAX_AGENT_SESSIONS) return res.status(400).json({ success: false, error: `At most ${MAX_AGENT_SESSIONS} connected apps. Remove one first.` });
        const { token, hash } = newAgentToken();
        const id = randomUUID();
        // The session acts as the parent creating it, and ends if that parent signs out everywhere.
        const created = await query(
            `INSERT INTO familyhub_agent_sessions (id, family_id, user_id, name, token_hash, permissions, creator_token_version, expires_at)
             SELECT $1, $2, u.id, $4, $5, $6::jsonb, u.token_version, now() + make_interval(days => $7)
             FROM users u WHERE u.id = $3 AND COALESCE(u.family_owner_id, u.id) = $2 RETURNING id`,
            [id, req.userId, req.actualUserId, name, hash, JSON.stringify(permissions), days],
        );
        if (!created.rows.length) return res.status(401).json({ success: false, error: 'Invalid token' });
        const row = await query(`${LIST} AND s.id = $2`, [req.userId, id]);
        res.json({ success: true, data: { session: view(row.rows[0]), token } });
    });

    // A new token for the same session; the old one stops working at once.
    router.post('/:id/rotate', async (req: AuthRequest, res) => {
        if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'Connected app not found' });
        const { token, hash } = newAgentToken();
        const updated = await query('UPDATE familyhub_agent_sessions SET token_hash = $1 WHERE id = $2 AND family_id = $3 AND revoked_at IS NULL AND expires_at > now() RETURNING id', [hash, req.params.id, req.userId]);
        if (!updated.rows.length) return res.status(404).json({ success: false, error: 'Connected app not found' });
        const row = await query(`${LIST} AND s.id = $2`, [req.userId, req.params.id]);
        res.json({ success: true, data: { session: view(row.rows[0]), token } });
    });

    router.delete('/:id', async (req: AuthRequest, res) => {
        if (!isUuid(req.params.id)) return res.status(404).json({ success: false, error: 'Connected app not found' });
        const revoked = await query('UPDATE familyhub_agent_sessions SET revoked_at = now() WHERE id = $1 AND family_id = $2 AND revoked_at IS NULL RETURNING id', [req.params.id, req.userId]);
        if (!revoked.rows.length) return res.status(404).json({ success: false, error: 'Connected app not found' });
        res.json({ success: true });
    });

    return router;
}
