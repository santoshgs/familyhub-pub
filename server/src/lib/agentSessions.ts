import { createHash, randomBytes } from 'crypto';
import { PAYLOAD_CONTRACTS } from './payloadContracts';

/**
 * Connected apps (agent sessions): what an outside tool's token may call.
 *
 * This file is the whole permission model. authMiddleware asks agentMayCall
 * for every request made with an agent token, before any route runs, so no
 * route file needs to know about agents. The usual checks (parent, module,
 * family ownership) still run afterwards.
 *
 * Read docs/familyhub/AGENT_API.md before changing it.
 */

export interface AgentPermissions {
    /** GET grants: "/api/budget/*" covers that path and everything below it; "/api/familyhub" covers that exact path. */
    read: string[];
    /** Write grants: keys of PAYLOAD_CONTRACTS, e.g. "POST /api/budget/entries". */
    write: string[];
}

export const AGENT_TOKEN_PREFIX = 'fha_';
export const MAX_AGENT_SESSIONS = 10;
export const DEFAULT_AGENT_DAYS = 90;
export const MAX_AGENT_DAYS = 365;

/** A new token (shown once, never stored) and the hash that is stored. */
export const newAgentToken = (): { token: string; hash: string } => {
    const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    return { token, hash: hashAgentToken(token) };
};
export const hashAgentToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const isAgentToken = (token: string): boolean => token.startsWith(AGENT_TOKEN_PREFIX);

/** Every agent token may read the API description and who it is. */
const ALWAYS_ALLOWED = new Set(['GET /api/schema', 'GET /api/auth/me']);

/**
 * Never available to an agent, whatever its session grants: sign-in and
 * account settings, the whole-family export and import, invites, server
 * administration, display pairing and sessions, the Google connection, the
 * calendar feed credential and followed calendar addresses, outbound
 * integrations and AI, push devices, the weather place search, and connected-app
 * management itself (an agent cannot create or widen an agent).
 */
export const AGENT_DENIED_PREFIXES: readonly string[] = [
    '/api/auth', '/api/data', '/api/invites', '/api/integrations', '/api/ai', '/api/notifications', '/api/calendar',
    '/api/familyhub/admin', '/api/familyhub/agent-sessions',
    '/api/familyhub/display', '/api/familyhub/display-session', '/api/familyhub/ambient/display-session',
    '/api/familyhub/google/status', '/api/familyhub/google/sources', '/api/familyhub/google/connect',
    '/api/familyhub/google/connection', '/api/familyhub/google/callback',
    // Looks a place name up at an outside weather service for every call.
    '/api/familyhub/ambient/locations',
];

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);
export const agentDenied = (path: string): boolean => AGENT_DENIED_PREFIXES.some((prefix) => under(path, prefix));

/** "/api/x/:id" as a pattern for one concrete path (or for the template itself). */
const templatePattern = (template: string): RegExp =>
    new RegExp(`^${template.split('/').map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);

const readGrantCovers = (grant: string, path: string): boolean =>
    grant.endsWith('/*') ? under(path, grant.slice(0, -2)) : path === grant;

/**
 * May a session with these permissions make this request? `path` has no query
 * string and no trailing slash. A route template ("/api/family/:id") may be
 * passed in place of a concrete path, to ask whether a route is in reach.
 */
export const agentMayCall = (permissions: AgentPermissions, method: string, rawPath: string): boolean => {
    // Express matches paths without regard to case; compare the same way, or
    // "/api/familyhub/ADMIN/…" would slip past the denied list.
    const path = rawPath.toLowerCase();
    // Nothing an agent needs is spelt with these; refusing them keeps this
    // check and Express's own path matching from ever disagreeing.
    if (!path.startsWith('/api/') || /[%\\;]|\/\/|\/\.\.?(\/|$)/.test(path)) return false;
    const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
    if (ALWAYS_ALLOWED.has(`${verb} ${path}`)) return true;
    if (agentDenied(path)) return false;
    if (verb === 'GET') return permissions.read.some((grant) => readGrantCovers(grant, path));
    return permissions.write.some((grant) => {
        if (!(grant in PAYLOAD_CONTRACTS)) return false;
        const [grantVerb, template] = grant.split(' ');
        return grantVerb === verb && templatePattern(template.toLowerCase()).test(path);
    });
};

export class AgentPermissionError extends Error {}

const READ_GRANT = /^\/api\/[a-z0-9_-]+(\/[a-z0-9_-]+)*(\/\*)?$/;

/**
 * Checks permissions sent by a parent creating a session. `getRoutes` are the
 * GET route paths the server has. Throws AgentPermissionError with a message
 * fit to show.
 */
export const cleanAgentPermissions = (input: unknown, getRoutes: readonly string[]): AgentPermissions => {
    const value = (input ?? {}) as { read?: unknown; write?: unknown };
    const list = (entries: unknown, label: string): string[] => {
        if (entries === undefined) return [];
        if (!Array.isArray(entries) || entries.length > 40 || entries.some((entry) => typeof entry !== 'string')) throw new AgentPermissionError(`Choose up to 40 ${label} permissions.`);
        return [...new Set(entries as string[])];
    };
    const read = list(value.read, 'read'), write = list(value.write, 'write');
    for (const grant of read) {
        const base = grant.endsWith('/*') ? grant.slice(0, -2) : grant;
        if (!READ_GRANT.test(grant) || agentDenied(base)) throw new AgentPermissionError(`"${grant}" cannot be shared with a connected app.`);
        if (!getRoutes.some((route) => readGrantCovers(grant, route.toLowerCase()))) throw new AgentPermissionError(`"${grant}" matches nothing Family Hub can read.`);
    }
    for (const grant of write) {
        if (!(grant in PAYLOAD_CONTRACTS) || agentDenied(grant.split(' ')[1] ?? '')) throw new AgentPermissionError(`"${grant}" is not something a connected app can change.`);
    }
    return { read, write };
};

/** Permissions as stored, tolerating a row written by an older or newer build. */
export const storedAgentPermissions = (value: unknown): AgentPermissions => {
    const row = (value ?? {}) as { read?: unknown; write?: unknown };
    const strings = (entries: unknown): string[] => (Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === 'string') : []);
    return { read: strings(row.read), write: strings(row.write) };
};
