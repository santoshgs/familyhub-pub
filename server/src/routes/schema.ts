import { Router, type Express } from 'express';
import { authMiddleware } from '../middleware/auth';
import { BUDGET_CATEGORIES } from '../lib/budgetCategories';

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

const DATE = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Calendar date, YYYY-MM-DD.' };
const MEMBER_ID = { type: 'string', format: 'uuid', description: 'A family member id from GET /api/family.' };
const EVENT_POINT = {
    description: 'A timed point or an all-day date. Start and end must be the same kind.',
    oneOf: [
        {
            type: 'object', required: ['dateTime'], additionalProperties: false,
            properties: {
                dateTime: {
                    type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})?$',
                    description: 'ISO 8601 with a "T", e.g. 2031-05-14T09:30:00-04:00. Without an offset, timeZone is required.',
                },
                timeZone: { type: 'string', description: 'IANA zone, e.g. Europe/Paris. Required when dateTime has no offset; a wall time that does not exist or is ambiguous in that zone is rejected.' },
            },
        },
        {
            type: 'object', required: ['date'], additionalProperties: false,
            properties: { date: { ...DATE, description: 'All-day event date, YYYY-MM-DD. The end date is exclusive and must be later than the start date.' } },
        },
    ],
};

/**
 * Request bodies of the write endpoints external clients use, as JSON Schema
 * (the dialect MCP tool inputs use, so a contract can become a tool's
 * inputSchema as it is). Each mirrors what its handler validates: change both
 * together. test/schemaRoute.test.ts fails if a key names a route that no
 * longer exists.
 */
export const PAYLOAD_CONTRACTS = {
    'POST /api/budget/entries': {
        summary: 'Add one budget entry (an expense or an income).',
        access: 'parent',
        module: 'budget',
        contentType: 'application/json',
        body: {
            type: 'object',
            required: ['category', 'amount', 'date'],
            properties: {
                category: { type: 'string', enum: [...BUDGET_CATEGORIES], description: 'One of the fixed category keys. Free text such as "Dining" is rejected.' },
                amount: { type: ['number', 'string'], description: 'A finite number (a numeric string is accepted). Whether it is an expense is set by is_expense, not by the sign.' },
                date: DATE,
                description: { type: ['string', 'null'], description: 'Merchant or note.' },
                is_expense: { type: 'boolean', default: false, description: 'true for an expense. When omitted the entry is recorded as income.' },
                assigned_to: { ...MEMBER_ID, type: ['string', 'null'], description: 'Family member the entry is for (an id from GET /api/family).' },
                add_to_calendar: { type: 'boolean', default: false, description: 'Also create a linked all-day calendar entry in Family Hub.' },
                paid_by: { ...MEMBER_ID, type: ['string', 'null'], description: 'Family member who paid (an id from GET /api/family).' },
                split_with: { type: 'array', maxItems: 20, uniqueItems: true, items: MEMBER_ID, description: 'Family members the expense is split between, in equal shares.' },
                group_id: { type: ['string', 'null'], format: 'uuid', description: 'Expense group id (groups are listed by GET /api/budget/sharing).' },
            },
        },
        notes: [
            'Field names are snake_case. paidBy, groupId, splitType and splits are not read: unknown fields are ignored without an error.',
            'Splits are always equal between split_with; there is no split type or per-person amount.',
        ],
        errors: { 400: 'A required field is missing, or the category, member or group is not valid.', 403: 'Not a parent account, or the budget module is off.' },
    },
    'POST /api/familyhub/google/events': {
        summary: "Create one event in the household's Google Calendar.",
        access: 'parent',
        module: null,
        contentType: 'application/json',
        body: {
            type: 'object',
            required: ['title', 'start', 'end'],
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 1024, description: 'Event title (Google calls it "summary"; the field here is title).' },
                start: EVENT_POINT,
                end: { ...EVENT_POINT, description: 'Same kind as start, and later than it.' },
                description: { type: 'string', maxLength: 8192 },
                location: { type: ['string', 'null'], maxLength: 1024 },
                colorId: { type: ['string', 'null'], pattern: '^([1-9]|1[01])?$', description: 'Google event colour "1" to "11" (GET /api/familyhub/google/colors); empty or null for the calendar\'s own colour.' },
                id: { type: 'string', pattern: '^[a-v0-9]{5,1024}$', description: 'Optional event id chosen by the client (base32hex, e.g. a UUID without dashes). Send one so a retry cannot create a duplicate.' },
            },
        },
        notes: [
            'start and end are objects, not strings: { "dateTime": "2031-05-14T09:30:00-04:00" } or { "date": "2031-05-14" }.',
            'The server does not retry Google writes. After a timeout or 502, read the calendar (or retry with the same id) before creating again.',
        ],
        errors: { 400: 'A field is missing or not valid.', 403: 'Not a parent account.', 409: 'Google is not connected, no shared calendar is chosen, or the grant lapsed (code GOOGLE_RECONNECT).', 502: 'Google refused or failed the request.' },
    },
    'POST /api/familyhub/google/tasks': {
        summary: "Add one to-do to the household's Google Tasks list.",
        access: 'parent',
        module: 'todos',
        contentType: 'application/json',
        body: {
            type: 'object',
            required: ['title'],
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 1024 },
                description: { type: 'string', maxLength: 8192, description: 'Free text (Google calls it "notes"; the field here is description).' },
                dueDate: { ...DATE, type: ['string', 'null'], description: 'Due date, YYYY-MM-DD, with no time (Google Tasks stores only the day). The field is dueDate, not due.' },
            },
        },
        notes: ['notes and due are not read: use description and dueDate.'],
        errors: { 400: 'A field is missing or not valid.', 403: 'Not a parent account, or the to-dos module is off.', 409: 'Google is not connected, no task list is chosen, or the grant lapsed (code GOOGLE_RECONNECT).', 502: 'Google refused or failed the request.' },
    },
} as const;

export function createSchemaRouter(app: Express): Router {
    const router = Router();
    // Routes are fixed once the server has started, so the list is built on the
    // first request (when every router is mounted) and kept.
    let cached: ReturnType<typeof listRoutes> | undefined;

    // A full session only: read-only display tokens are refused by
    // authMiddleware, whose allowlist does not include this path.
    router.get('/', authMiddleware, (_req, res) => {
        cached ??= listRoutes(app);
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
                routes: cached.routes,
                unresolvedMounts: cached.unresolvedMounts,
                payloadContracts: PAYLOAD_CONTRACTS,
            },
        });
    });
    return router;
}
