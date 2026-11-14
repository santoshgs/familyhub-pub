import { BUDGET_CATEGORIES } from './budgetCategories';

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
 * longer exists. A connected app (agent session) can be granted a write only
 * on an endpoint listed here.
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
            required: ['title', 'start'],
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 1024, description: 'Event title (Google calls it "summary"; the field here is title).' },
                start: EVENT_POINT,
                end: { ...EVENT_POINT, description: 'Same kind as start, and later than it. Optional: without it a timed event lasts the household\'s default event length (Settings, 60 minutes unless changed) and an all-day event lasts one day.' },
                description: { type: 'string', maxLength: 8192 },
                location: { type: ['string', 'null'], maxLength: 1024 },
                colorId: { type: ['string', 'null'], pattern: '^([1-9]|1[01])?$', description: 'Google event colour "1" to "11" (GET /api/familyhub/google/colors); empty or null for the calendar\'s own colour.' },
                id: { type: 'string', pattern: '^[a-v0-9]{5,1024}$', description: 'Optional event id chosen by the client (base32hex, e.g. a UUID without dashes). Send one so a retry cannot create a duplicate.' },
            },
        },
        notes: [
            'start and end are objects, not strings: { "dateTime": "2031-05-14T09:30:00-04:00" } or { "date": "2031-05-14" }.',
            'The server does not retry Google writes. After a timeout or 502, read the calendar (or retry with the same id) before creating again.',
            'Timed events get the household\'s notification setting: the calendar\'s own Google default, else the main calendar\'s, unless Settings chooses a fixed time or none.',
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
