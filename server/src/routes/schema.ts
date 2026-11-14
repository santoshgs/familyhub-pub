import { Router, type Express } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { agentMayCall } from '../lib/agentSessions';
import { PAYLOAD_CONTRACTS } from '../lib/payloadContracts';

export { PAYLOAD_CONTRACTS };

/**
 * GET /api/schema: a self-description of the HTTP API for external clients
 * (MCP servers, agents, scripts), so they discover routes and write payloads
 * here and keep no hard-coded copy of them.
 *
 * Everything in the response comes from code: the routes Express has mounted
 * and the hand-written contracts below. It never reads the database, the
 * environment or anything about a household, so the same build answers the
 * same way for every family. Keep it that way.
 *
 * Read docs/familyhub/AGENT_API.md before changing this file.
 */

export interface RouteEntry { method: string; path: string }

interface Layer {
    name?: string;
    route?: { path?: unknown; methods?: Record<string, boolean> };
    handle?: { stack?: Layer[] };
    regexp?: RegExp & { fast_slash?: boolean };
    keys?: { name: string | number }[];
}

/**
 * The path a router was mounted on. Express 4 keeps only the compiled pattern,
 * e.g. /^\/api\/budget\/?(?=\/|$)/i, so the text is recovered from it. Returns
 * null for a pattern this cannot read, so a path is never guessed.
 */
const mountPath = (layer: Layer): string | null => {
    if (!layer.regexp) return null;
    if (layer.regexp.fast_slash) return '';
    let index = 0;
    const text = layer.regexp.source
        .replace(/^\^/, '')
        .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
        .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys?.[index++]?.name ?? 'param'}`)
        .replace(/\\(.)/g, '$1');
    return /[()[\]?*+^$|\\]/.test(text) ? null : text;
};

const join = (prefix: string, path: string): string => `${prefix}${path === '/' ? '' : path}` || '/';

const walk = (stack: Layer[], prefix: string, out: RouteEntry[], unresolved: { count: number }): void => {
    for (const layer of stack) {
        if (layer.route) {
            const paths = (Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path])
                .filter((path): path is string => typeof path === 'string');
            const methods = Object.entries(layer.route.methods ?? {}).filter(([, on]) => on)
                .map(([method]) => (method === '_all' ? 'ALL' : method.toUpperCase()));
            for (const path of paths) for (const method of methods) out.push({ method, path: join(prefix, path) });
        } else if (layer.name === 'router' && Array.isArray(layer.handle?.stack)) {
            const mounted = mountPath(layer);
            if (mounted === null) unresolved.count += 1;
            else walk(layer.handle.stack, `${prefix}${mounted}`, out, unresolved);
        }
    }
};

/**
 * Every { method, path } registered under /api on this app, sorted. Routers
 * mounted later appear with no change here. `unresolvedMounts` counts routers
 * whose mount pattern could not be read (expected: 0).
 */
export const listRoutes = (app: Express): { routes: RouteEntry[]; unresolvedMounts: number } => {
    // Express 4: app._router. Express 5 renames it app.router.
    const root = (app as unknown as { _router?: { stack?: Layer[] }; router?: { stack?: Layer[] } });
    const stack = root._router?.stack ?? root.router?.stack ?? [];
    const found: RouteEntry[] = [], unresolved = { count: 0 };
    walk(stack, '', found, unresolved);
    const seen = new Set<string>();
    const routes = found
        .filter((route) => route.path.startsWith('/api/'))
        .filter((route) => { const key = `${route.method} ${route.path}`; if (seen.has(key)) return false; seen.add(key); return true; })
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return { routes, unresolvedMounts: unresolved.count };
};

export function createSchemaRouter(app: Express): Router {
    const router = Router();
    // Routes are fixed once the server has started, so the list is built on the
    // first request (when every router is mounted) and kept.
    let cached: ReturnType<typeof listRoutes> | undefined;

    // A full session only: read-only display tokens are refused by
    // authMiddleware, whose allowlist does not include this path.
    router.get('/', authMiddleware, (req: AuthRequest, res) => {
        cached ??= listRoutes(app);
        // A connected app is told only about what its session may call.
        const agent = req.agentPermissions;
        const routes = agent ? cached.routes.filter((route) => agentMayCall(agent, route.method, route.path)) : cached.routes;
        const payloadContracts = agent
            ? Object.fromEntries(Object.entries(PAYLOAD_CONTRACTS).filter(([key]) => agent.write.includes(key)))
            : PAYLOAD_CONTRACTS;
        res.json({
            success: true,
            data: {
                schemaVersion: 1,
                authentication: { scheme: 'bearer', header: 'Authorization: Bearer <access token>' },
                responseEnvelope: { ok: '{ "success": true, "data": … }', error: '{ "success": false, "error": "…" }' },
                access: {
                    parent: 'The signed-in account must be a parent or the family owner.',
                    modules: 'A route whose module is switched off answers 403 MODULE_DISABLED; GET /api/familyhub/modules lists what is on.',
                },
                routes,
                unresolvedMounts: cached.unresolvedMounts,
                payloadContracts,
            },
        });
    });
    return router;
}
