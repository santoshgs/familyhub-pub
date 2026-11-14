import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/loadEnv';
import { query, Transaction } from '../db';
import { clients } from './broadcaster';
import logger from './logger';
import { hashAgentToken, isAgentToken, storedAgentPermissions, type AgentPermissions } from './agentSessions';

/**
 * The only place login tokens are signed and checked. Every sign-in method
 * (password, SSO) and every route that hands out a fresh token goes through
 * issueAccessToken; every authenticated request and WebSocket goes through
 * verifyAccessToken.
 *
 * A token carries the account's token_version (tv). Raising the version in the
 * database, with revokeUserSessions, invalidates every token issued before, on
 * every device. Tokens from before versions existed have no tv and count as 0.
 */

export interface TokenUser {
    id: string;
    family_owner_id: string | null;
    token_version: number;
}

export interface VerifiedToken {
    /** The signed-in account. */
    userId: string;
    /** The family owner whose data the account works on (itself when standalone). */
    ownerId: string;
    readOnly: boolean;
    ambientOnly: boolean;
    /** The revocable display session behind an ambient token, when it has one. */
    displaySessionId?: string;
    /** Set for a connected app's token: its session and what that session may call. */
    agent?: { sessionId: string; permissions: AgentPermissions };
}

export type ReadOnlyTokenScope = 'display' | 'ambient';

interface TokenClaims {
    userId: string;
    ownerId?: string;
    tv?: number;
    scope?: ReadOnlyTokenScope;
    sid?: string;
}

export const issueAccessToken = (user: TokenUser, scope?: ReadOnlyTokenScope, displaySessionId?: string): string => {
    if (displaySessionId && scope !== 'ambient') throw new Error('Display sessions are only valid for ambient tokens.');
    const claims: TokenClaims = {
        userId: user.id,
        ownerId: user.family_owner_id ?? user.id,
        tv: user.token_version,
        ...(scope ? { scope } : {}),
        ...(displaySessionId ? { sid: displaySessionId } : {}),
    };
    return jwt.sign(claims, getJwtSecret(), { expiresIn: '7d' });
};

export class InvalidTokenError extends Error {}

/**
 * Checks the signature and expiry, then that the account still exists and has
 * not been signed out since the token was issued. Throws InvalidTokenError for
 * a token that must be refused; database errors propagate as they are, so the
 * caller can answer 503 instead of letting the request through.
 */
export const verifyAccessToken = async (token: string): Promise<VerifiedToken> => {
    if (isAgentToken(token)) return verifyAgentToken(token);
    let claims: TokenClaims;
    try {
        claims = jwt.verify(token, getJwtSecret()) as TokenClaims;
    } catch {
        throw new InvalidTokenError('Invalid token');
    }
    if (typeof claims.userId !== 'string') {
        throw new InvalidTokenError('Invalid token');
    }

    const result = await query('SELECT token_version FROM users WHERE id = $1', [claims.userId]);
    const row = result.rows[0] as { token_version: number } | undefined;
    if (!row || (claims.tv ?? 0) !== row.token_version) {
        throw new InvalidTokenError('Invalid token');
    }

    if (claims.sid !== undefined) {
        // A paired frame stays valid only while its display session exists and
        // has not been revoked from Management.
        if (claims.scope !== 'ambient' || typeof claims.sid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sid)) throw new InvalidTokenError('Invalid token');
        const session = await query('SELECT 1 FROM familyhub_display_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL', [claims.sid, claims.userId]);
        if (!session.rows.length) throw new InvalidTokenError('Invalid token');
    }

    return { userId: claims.userId, ownerId: claims.ownerId ?? claims.userId, readOnly: claims.scope === 'display' || claims.scope === 'ambient', ambientOnly: claims.scope === 'ambient', ...(claims.sid ? { displaySessionId: claims.sid } : {}) };
};

/**
 * A connected app's token ("fha_…"). Valid while its session is neither revoked
 * nor expired, the parent who created it is still in the same family, and that
 * parent has not signed out everywhere since (which ends their apps too).
 * The caller must then limit the request to the session's permissions:
 * authMiddleware does; nothing else may accept one.
 */
const verifyAgentToken = async (token: string): Promise<VerifiedToken> => {
    if (!/^fha_[A-Za-z0-9_-]{43}$/.test(token)) throw new InvalidTokenError('Invalid token');
    const result = await query(
        `SELECT s.id, s.user_id, s.family_id, s.permissions, (s.last_used_at IS NULL OR s.last_used_at < now() - interval '1 minute') AS stale
         FROM familyhub_agent_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND COALESCE(u.family_owner_id, u.id) = s.family_id AND u.token_version = s.creator_token_version`,
        [hashAgentToken(token)],
    );
    const row = result.rows[0] as { id: string; user_id: string; family_id: string; permissions: unknown; stale: boolean } | undefined;
    if (!row) throw new InvalidTokenError('Invalid token');
    if (row.stale) await query('UPDATE familyhub_agent_sessions SET last_used_at = now() WHERE id = $1', [row.id]);
    return { userId: row.user_id, ownerId: row.family_id, readOnly: false, ambientOnly: false, agent: { sessionId: row.id, permissions: storedAgentPermissions(row.permissions) } };
};

/** WebSocket close code telling the client its session ended. */
export const WS_SESSION_REVOKED = 4001;

/**
 * Signs the given accounts out everywhere. Runs inside the caller's
 * transaction, so the revocation commits or rolls back with the change that
 * caused it. Returns each account's new version, for a token that the caller
 * re-issues to the current session.
 */
export const revokeUserSessions = async (
    tx: Transaction,
    userIds: string[],
    reason: string,
): Promise<Map<string, number>> => {
    const versions = new Map<string, number>();
    if (userIds.length === 0) return versions;

    const result = await tx.query(
        'UPDATE users SET token_version = token_version + 1 WHERE id = ANY($1::uuid[]) RETURNING id, token_version',
        [userIds],
    );
    for (const row of result.rows as Array<{ id: string; token_version: number }>) {
        versions.set(row.id, row.token_version);
    }

    tx.afterCommit(() => {
        for (const userId of versions.keys()) {
            clients.get(userId)?.forEach((socket) => socket.close(WS_SESSION_REVOKED, 'Session revoked'));
            logger.info('auth.sessions_revoked', { userId, reason });
        }
    });

    return versions;
};
