/** Server-only Google adapters. Credentials are supplied by the household connection. */
import { DAYCARE_SENDER, parseDaycareEmail, type DaycareUpdate, type GmailMessage } from './daycare';
export class GoogleApiError extends Error {
    constructor(public readonly status: number, public readonly retryAfter: string | null = null) {
        super(status === 401 ? 'Google authorization needs reconnecting.' : status === 429 ? 'Google is rate limiting requests.' : 'Google request failed.');
    }
}
export type Transport = (url: string, options: RequestInit) => Promise<Response>;
export type AccessToken = () => Promise<string>;
interface Page<T> { items?: T[]; nextPageToken?: string }
export interface GoogleEvent {
    id: string; status?: string; summary?: string; location?: string; colorId?: string;
    start?: { date?: string; dateTime?: string; timeZone?: string };
    end?: { date?: string; dateTime?: string; timeZone?: string };
    recurringEventId?: string; originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
}
export interface CalendarEvent {
    source: 'google-calendar'; calendarId: string; id: string; title: string; location?: string; colorId?: string; color?: string;
    start: NonNullable<GoogleEvent['start']>; end: NonNullable<GoogleEvent['end']>;
    allDay: boolean; recurringEventId?: string; originalStartTime?: GoogleEvent['originalStartTime'];
}
export interface GoogleTask { id: string; title: string; status: 'needsAction' | 'completed'; due?: string; deleted?: boolean; etag?: string }
export interface Task { source: 'google-tasks'; listId: string; id: string; title: string; completed: boolean; dueDate: string | null; etag?: string }
export interface CalendarList { id: string; summary: string; accessRole: string }
export interface TaskList { id: string; title: string }
export interface CreateEventInput {
    title: string; location?: string; id?: string; description?: string;
    start: NonNullable<GoogleEvent['start']>; end: NonNullable<GoogleEvent['end']>;
}
type Service = 'calendar' | 'tasks' | 'gmail';

function validDate(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
function timedPoint(point: CreateEventInput['start']): { value: CreateEventInput['start']; instant: number } {
    if (point.date || typeof point.dateTime !== 'string') throw new Error('Timed events need dateTime values.');
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(point.dateTime);
    if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59
        || (match[6] && match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4)) > 59))) throw new Error('Event date and time must be valid.');
    const local = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}${match[5] ?? ''}`;
    let formatter: Intl.DateTimeFormat | undefined;
    if (point.timeZone !== undefined) {
        if (typeof point.timeZone !== 'string' || !point.timeZone) throw new Error('A valid IANA time zone is required.');
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone: point.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    if (match[6]) {
        const value = { dateTime: `${local}${match[6]}`, ...(point.timeZone ? { timeZone: point.timeZone } : {}) };
        return { value, instant: Date.parse(value.dateTime) };
    }
    if (!formatter) throw new Error('Timed events require a UTC offset or IANA time zone.');
    // Find zone offsets around this wall time, including either side of DST.
    // A gap or overlap is rejected so creation never silently shifts a meeting.
    const wall = Date.parse(`${local}Z`), offsets = new Set<number>();
    const wallAt = (instant: number) => {
        const parts = Object.fromEntries(formatter!.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
        return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    };
    for (const hours of [-36, -12, 0, 12, 36]) {
        const sample = Math.floor((wall + hours * 3_600_000) / 1000) * 1000;
        offsets.add(wallAt(sample) - sample);
    }
    const seconds = Math.floor(wall / 1000) * 1000;
    const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => wallAt(instant) === seconds);
    if (candidates.length !== 1) throw new Error('This local time is missing or ambiguous during a clock change; supply an explicit UTC offset.');
    return { value: { dateTime: local, timeZone: point.timeZone }, instant: candidates[0] };
}

export class GoogleAdapters {
    constructor(private readonly token: AccessToken, private readonly transport: Transport = fetch) {}

    private async request<T>(service: Service, path: string, params = new URLSearchParams(), method = 'GET', body?: unknown): Promise<T> {
        const origin = service === 'calendar' ? 'https://www.googleapis.com/calendar/v3/' : service === 'tasks' ? 'https://tasks.googleapis.com/tasks/v1/' : 'https://gmail.googleapis.com/gmail/v1/';
        const response = await this.transport(`${origin}${path}${params.size ? `?${params}` : ''}`, {
            method, headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        // Never include Google's response body in errors: it may contain private data.
        if (!response.ok) throw new GoogleApiError(response.status, response.headers.get('retry-after'));
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
    }

    async calendarLists(): Promise<CalendarList[]> {
        const values = await this.pages<CalendarList>('calendar', 'users/me/calendarList', new URLSearchParams({ maxResults: '250' }));
        return values.map(({ id, summary, accessRole }) => {
            if (!id || typeof summary !== 'string' || !['freeBusyReader', 'reader', 'writer', 'owner'].includes(accessRole)) throw new Error('Invalid Google calendar list response.');
            return { id, summary, accessRole };
        });
    }

    async taskLists(): Promise<TaskList[]> {
        const values = await this.pages<TaskList>('tasks', 'users/@me/lists', new URLSearchParams({ maxResults: '100' }));
        return values.map(({ id, title }) => {
            if (!id || typeof title !== 'string') throw new Error('Invalid Google task list response.');
            return { id, title };
        });
    }

    async createEvent(calendarId: string, input: CreateEventInput): Promise<CalendarEvent> {
        if (!calendarId || !input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 1024 || !input.start || !input.end) throw new Error('An event title, calendar, start and end are required.');
        if (input.location !== undefined && (typeof input.location !== 'string' || input.location.length > 1024)) throw new Error('Event location must be at most 1024 characters.');
        if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 8192)) throw new Error('Event description is too long.');
        // Google custom IDs use base32hex (a-v, 0-9), 5–1024 chars. A UUID
        // stripped of dashes fits and lets callers reconcile ambiguous failures.
        if (input.id !== undefined && !/^[a-v0-9]{5,1024}$/.test(input.id)) throw new Error('Invalid Google event identifier.');
        let start: CreateEventInput['start'], end: CreateEventInput['end'];
        if (input.start.date !== undefined || input.end.date !== undefined) {
            if (typeof input.start.date !== 'string' || typeof input.end.date !== 'string' || !validDate(input.start.date) || !validDate(input.end.date)
                || input.start.dateTime || input.end.dateTime || input.start.timeZone || input.end.timeZone || input.start.date >= input.end.date) throw new Error('All-day events require valid dates and an exclusive later end date.');
            start = { date: input.start.date }; end = { date: input.end.date };
        } else {
            const from = timedPoint(input.start), to = timedPoint(input.end);
            if (!(from.instant < to.instant)) throw new Error('The event must end after it starts.');
            start = from.value; end = to.value;
        }
        const value = await this.request<GoogleEvent>('calendar', `calendars/${encodeURIComponent(calendarId)}/events`, undefined, 'POST', {
            summary: input.title.trim(), start, end, ...(input.location ? { location: input.location.trim() } : {}), ...(input.id ? { id: input.id } : {}),
            ...(input.description ? { description: input.description } : {}),
        });
        if (!value.id || !value.start || !value.end) throw new Error('Invalid Google event response.');
        return { source: 'google-calendar', calendarId, id: value.id, title: value.summary || input.title.trim(), location: value.location,
            start: value.start, end: value.end, allDay: Boolean(value.start.date) };
    }

    async daycare(now = new Date()): Promise<DaycareUpdate[]> {
        if (!Number.isFinite(now.getTime())) throw new Error('A valid synchronization time is required.');
        const after = Math.floor((now.getTime() - 30 * 86_400_000) / 1000);
        const deadline = Date.now() + 45_000;
        const params = new URLSearchParams({ q: `from:${DAYCARE_SENDER} after:${after}`, maxResults: '100', includeSpamTrash: 'false' });
        const ids = new Set<string>(), tokens = new Set<string>();
        for (let page = 0; page < 100; page++) {
            if (Date.now() >= deadline) throw new Error('Daycare refresh timed out.');
            params.set('maxResults', String(100 - ids.size));
            const response = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>('gmail', 'users/me/messages', params);
            if (response.messages !== undefined && !Array.isArray(response.messages)) throw new Error('Invalid Gmail list response.');
            for (const message of response.messages ?? []) {
                if (typeof message.id !== 'string' || !message.id) throw new Error('Invalid Gmail message identifier.');
                ids.add(message.id);
                if (ids.size === 100) break;
            }
            if (!response.nextPageToken || ids.size === 100) break;
            if (tokens.has(response.nextPageToken)) throw new Error('Repeated Gmail page token.');
            if (page === 99) throw new Error('Gmail pagination limit reached.');
            tokens.add(response.nextPageToken); params.set('pageToken', response.nextPageToken);
        }
        const updates: DaycareUpdate[] = [];
        // Sequential, capped fetches avoid a mailbox-wide burst; never request attachments.
        for (const id of ids) {
            if (Date.now() >= deadline) throw new Error('Daycare refresh timed out.');
            const raw = await this.request<GmailMessage>('gmail', `users/me/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'full' }));
            const update = parseDaycareEmail(raw);
            if (update && Date.parse(update.receivedAt) >= after * 1000 && Date.parse(update.receivedAt) <= now.getTime()) updates.push(update);
        }
        return updates.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
    }

    private async pages<T>(service: 'calendar' | 'tasks', path: string, initial: URLSearchParams): Promise<T[]> {
        const params = new URLSearchParams(initial);
        const result: T[] = [];
        const seen = new Set<string>();
        for (let page = 0; page < 100; page++) {
            const response = await this.request<Page<T>>(service, path, params);
            if (response.items !== undefined && !Array.isArray(response.items)) throw new Error('Invalid Google list response.');
            result.push(...(response.items ?? []));
            if (!response.nextPageToken) return result;
            if (seen.has(response.nextPageToken)) throw new Error('Repeated Google page token.');
            seen.add(response.nextPageToken);
            params.set('pageToken', response.nextPageToken);
        }
        throw new Error('Google pagination limit reached; no partial snapshot returned.');
    }

    async calendar(calendarId: string, timeMin: string, timeMax: string, timeZone: string): Promise<CalendarEvent[]> {
        const from = Date.parse(timeMin), to = Date.parse(timeMax);
        if (!calendarId || !Number.isFinite(from) || !Number.isFinite(to) || from >= to
            || !/(Z|[+-]\d\d:\d\d)$/.test(timeMin) || !/(Z|[+-]\d\d:\d\d)$/.test(timeMax)) throw new Error('A calendar and bounded, timezone-aware range are required.');
        new Intl.DateTimeFormat('en', { timeZone });
        const events = await this.pages<GoogleEvent>('calendar', `calendars/${encodeURIComponent(calendarId)}/events`, new URLSearchParams({
            timeMin, timeMax, timeZone, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', showDeleted: 'false',
        }));
        const unique = new Map<string, CalendarEvent>();
        // Calendar colours belong to this Google account; event overrides use
        // Google's event palette. A metadata failure must not hide appointments.
        const hex = (value: unknown): string | undefined => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
        let calendarColor: string | undefined;
        let palette: Record<string, { background?: string }> = {};
        if (events.length) {
            const [entry, colors] = await Promise.allSettled([
                this.request<{ backgroundColor?: string }>('calendar', `users/me/calendarList/${encodeURIComponent(calendarId)}`),
                this.request<{ event?: Record<string, { background?: string }> }>('calendar', 'colors'),
            ]);
            if (entry.status === 'fulfilled') calendarColor = hex(entry.value.backgroundColor);
            if (colors.status === 'fulfilled') palette = colors.value.event ?? {};
        }
        for (const event of events) {
            if (event.status === 'cancelled') continue;
            if (!event.id || !event.start || !event.end || !(event.start.date || event.start.dateTime) || !(event.end.date || event.end.dateTime)) throw new Error('Invalid Google event response.');
            // Date-only end is exclusive. Preserve it, its time zone and instance
            // identity; never reinterpret all-day events as UTC midnights.
            unique.set(event.id, { source: 'google-calendar', calendarId, id: event.id,
                title: event.summary || 'Untitled event', location: event.location,
                colorId: event.colorId, color: hex(palette[event.colorId ?? '']?.background) ?? calendarColor ?? '#547b4d',
                start: event.start, end: event.end, allDay: Boolean(event.start.date),
                recurringEventId: event.recurringEventId, originalStartTime: event.originalStartTime });
        }
        return [...unique.values()];
    }

    private task(listId: string, value: GoogleTask): Task {
        if (!value.id || typeof value.title !== 'string' || !['needsAction', 'completed'].includes(value.status)) throw new Error('Invalid Google task response.');
        return { source: 'google-tasks', listId, id: value.id, title: value.title,
            completed: value.status === 'completed', dueDate: value.due?.slice(0, 10) ?? null, etag: value.etag };
    }
    private path(listId: string, id?: string): string {
        if (!listId || id === '') throw new Error('A Google task list and task identifier are required.');
        return `lists/${encodeURIComponent(listId)}/tasks${id === undefined ? '' : `/${encodeURIComponent(id)}`}`;
    }
    async tasks(listId: string): Promise<Task[]> {
        // Hidden includes tasks completed in Google's own applications.
        const values = await this.pages<GoogleTask>('tasks', this.path(listId), new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'false' }));
        return [...new Map(values.filter((value) => !value.deleted).map((value) => [value.id, this.task(listId, value)])).values()];
    }
    private fields(input: { title?: string; description?: string; dueDate?: string | null; completed?: boolean }): Record<string, unknown> {
        const body: Record<string, unknown> = {};
        if (input.title !== undefined) {
            if (!input.title.trim() || input.title.length > 1024) throw new Error('Task title must contain 1–1024 characters.');
            body.title = input.title.trim();
        }
        if (input.dueDate !== undefined) {
            if (input.dueDate === null) body.due = null;
            else {
                const date = input.dueDate;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Task due dates must be valid date-only values.');
                body.due = `${date}T00:00:00.000Z`;
            }
        }
        if (input.description !== undefined) {
            if (typeof input.description !== 'string' || input.description.length > 8192) throw new Error('Task description is too long.');
            body.notes = input.description;
        }
        if (input.completed !== undefined) { body.status = input.completed ? 'completed' : 'needsAction'; if (!input.completed) body.completed = null; }
        return body;
    }
    async createTask(listId: string, input: { title: string; description?: string; dueDate?: string | null }): Promise<Task> {
        const body = this.fields({ title: input.title, description: input.description, dueDate: input.dueDate });
        return this.task(listId, await this.request<GoogleTask>('tasks', this.path(listId), undefined, 'POST', body));
    }
    async updateTask(listId: string, id: string, input: { title?: string; dueDate?: string | null; completed?: boolean }): Promise<Task> {
        const body = this.fields(input);
        if (!Object.keys(body).length) throw new Error('No task changes provided.');
        // No automatic write retries: ambiguous failures require reconciliation.
        return this.task(listId, await this.request<GoogleTask>('tasks', this.path(listId, id), undefined, 'PATCH', body));
    }
    async deleteTask(listId: string, id: string): Promise<void> {
        await this.request('tasks', this.path(listId, id), undefined, 'DELETE');
    }
}
