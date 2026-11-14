import { stripTrailingSlashes } from '../lib/asyncRoutes';
import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import logger from '../lib/logger';
import { InvalidTokenError, verifyAccessToken } from '../lib/authTokens';
import { agentMayCall, type AgentPermissions } from '../lib/agentSessions';
import { agentRateLimiter } from '../lib/agentRateLimit';

export interface AuthRequest extends Request {
    /** Effective family-owner user ID — used by all data queries */
    userId?: string;
    /** Actual logged-in user's ID (may differ from userId when the user is a family member) */
    actualUserId?: string;
    /** True when the logged-in user IS the family owner (or a standalone user) */
    isOwner?: boolean;
    readOnly?: boolean;
    ambientOnly?: boolean;
    displaySessionId?: string;
    /** Set when the request comes from a connected app (agent session). */
    agentSessionId?: string;
    agentPermissions?: AgentPermissions;
}

/** The token in the Authorization header, or '' when there is none. */
export const bearerToken = (req: Request): string => {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

const AMBIENT_PHOTO_PATH = /^\/api\/familyhub\/ambient\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_WRITE_DAYS = 90;
const AGENT_WRITE_ROWS = 1000;

/**
 * The agent write record: one row for each change a connected app makes or
 * attempts, with its session id, the parent it acts as, the call and the
 * answer. No request body is kept. Rows older than 90 days, or beyond the
 * newest 1000 of a session, are dropped as new ones arrive.
 */
const recordAgentWrite = async (sessionId: string, familyId: string, userId: string, method: string, path: string, status: number): Promise<void> => {
    await query(
        'INSERT INTO familyhub_agent_writes (session_id, family_id, user_id, method, path, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [sessionId, familyId, userId, method.slice(0, 10), path.slice(0, 300), status],
    );
    await query(
        `DELETE FROM familyhub_agent_writes WHERE session_id = $1 AND (created_at < now() - make_interval(days => $2)
            OR id <= (SELECT id FROM familyhub_agent_writes WHERE session_id = $1 ORDER BY id DESC OFFSET $3 LIMIT 1))`,
        [sessionId, AGENT_WRITE_DAYS, AGENT_WRITE_ROWS],
    );
};

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = bearerToken(req);

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const verified = await verifyAccessToken(token);
        req.readOnly = verified.readOnly;
        req.ambientOnly = verified.ambientOnly;
        req.displaySessionId = verified.displaySessionId;
        if (verified.readOnly) {
            const path = stripTrailingSlashes(req.originalUrl.split('?')[0]);
            // Ambient tokens are narrower than the older protected overview
            // scope: they cannot read notes, the general snapshot or Google API.
            const allowed = verified.ambientOnly
                ? ['/api/familyhub/ambient', '/api/familyhub/ambient/article', '/api/familyhub/modules', '/api/auth/me', '/api/auth/dashboard-prefs']
                : ['/api/familyhub', '/api/familyhub/modules', '/api/familyhub/preferences', '/api/familyhub/ambient', '/api/familyhub/google/calendar', '/api/notes', '/api/auth/me', '/api/auth/modules', '/api/auth/dashboard-prefs'];
            const canRefreshDisplay = verified.ambientOnly && req.method === 'POST' && path === '/api/familyhub/display/refresh';
            // Slideshow photos: one pre-scaled JPEG per request, by id.
            const isSlideshowPhoto = req.method === 'GET' && AMBIENT_PHOTO_PATH.test(path);
            if ((req.method !== 'GET' || !(allowed.includes(path) || isSlideshowPhoto)) && !canRefreshDisplay) {
                return res.status(403).json({ success: false, error: 'This display session is read-only.' });
            }
        }
        if (verified.agent) {
            // A connected app reaches only what its session grants; the route's
            // own checks (parent, module, family) still run after this.
            const path = stripTrailingSlashes(req.originalUrl.split('?')[0]);
            // Each session has its own allowance, with a tighter one for changes.
            // Counted before the grants are checked, so refused attempts count too.
            const rate = agentRateLimiter.check(verified.agent.sessionId, req.method);
            res.setHeader('RateLimit-Limit', String(rate.limit));
            res.setHeader('RateLimit-Remaining', String(rate.remaining));
            res.setHeader('RateLimit-Reset', String(rate.resetSeconds));
            if (!rate.allowed && rate.firstRefusal) logger.warn('agent.rate_limited', { sessionId: verified.agent.sessionId, method: req.method });
            // A change is logged when the answer is sent, refused attempts
            // included. Of the changes refused for rate, only the first in a
            // window is logged, so a flood cannot become a flood of rows.
            if (req.method !== 'GET' && req.method !== 'HEAD' && (rate.allowed || rate.firstRefusal)) {
                const { sessionId } = verified.agent;
                res.on('finish', () => {
                    recordAgentWrite(sessionId, verified.ownerId, verified.userId, req.method, path, res.statusCode)
                        .catch((error) => logger.error('agent.write_record_failed', { sessionId, error: error instanceof Error ? error.message : String(error) }));
                });
            }
            if (!rate.allowed) {
                res.setHeader('Retry-After', String(rate.resetSeconds));
                return res.status(429).json({ success: false, error: 'This connected app is making too many requests. Try again shortly.', code: 'AGENT_RATE_LIMITED', retryAfterSeconds: rate.resetSeconds });
            }
            if (!agentMayCall(verified.agent.permissions, req.method, path)) {
                return res.status(403).json({ success: false, error: 'This connected app is not allowed to do that.', code: 'AGENT_FORBIDDEN' });
            }
            req.agentSessionId = verified.agent.sessionId;
            req.agentPermissions = verified.agent.permissions;
        }
        req.actualUserId = verified.userId;
        req.userId = verified.ownerId;
        req.isOwner = verified.ownerId === verified.userId;
    } catch (error) {
        if (error instanceof InvalidTokenError) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        // The session check needs the database: never let a request through
        // when it cannot be made.
        return res.status(503).json({ success: false, error: 'Service unavailable' });
    }
    return next();
};

/**
 * Authoritative (DB-backed) check: is the logged-in account a parent or the
 * family owner? Used by routes that change behaviour for child accounts
 * without rejecting the request outright (e.g. task completion → approval).
 */
export const isParentAccount = async (actualUserId: string | undefined): Promise<boolean> => {
    const result = await query(
        'SELECT role, (family_owner_id IS NULL) AS is_owner FROM users WHERE id = $1',
        [actualUserId]
    );
    const row = result.rows[0] as { role?: string; is_owner?: boolean } | undefined;
    if (!row) return false;
    if (row.is_owner) return true;
    return row.role !== 'enfant';
};

/**
 * Restrict a route to "parent" (or owner) accounts. Accounts with the "enfant"
 * role get read-only access and are rejected on write operations guarded by this.
 * Must run after authMiddleware.
 */
export const requireParent = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        // Authoritative check: read the CURRENT owner status and role from the DB,
        // never from (potentially stale) JWT claims.
        const result = await query(
            'SELECT role, (family_owner_id IS NULL) AS is_owner FROM users WHERE id = $1',
            [req.actualUserId]
        );
        const row = result.rows[0] as { role?: string; is_owner?: boolean } | undefined;

        if (!row) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        // The family owner always has full rights.
        if (row.is_owner) {
            return next();
        }

        if (row.role === 'enfant') {
            return res.status(403).json({
                success: false,
                error: 'Action réservée aux parents.',
            });
        }

        return next();
    } catch {
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
