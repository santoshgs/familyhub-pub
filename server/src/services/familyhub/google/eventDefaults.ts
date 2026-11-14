import { query } from '../../../db';
import { GoogleConnectionError } from './connection';
import type { CreateEventInput, EventReminders, GoogleAdapters, Reminder } from './adapters';

/**
 * How Family Hub fills in what a new Google Calendar event leaves out (v2.0.1):
 * the end of an event given only a start, and its notification.
 *
 * Google applies a calendar's default notifications only to events on that
 * calendar, and a shared family calendar usually has none of its own: the
 * owner's "15 minutes before" lives on their main calendar. So 'google' mode
 * uses the chosen calendar's defaults when it has some, and otherwise copies
 * the main calendar's onto the event. Google's default event length is in
 * Calendar settings, which need a permission Family Hub does not ask for, so
 * the length is a household setting.
 */
export type ReminderMode = 'google' | 'custom' | 'none';
export interface EventDefaults { eventMinutes: number; reminderMode: ReminderMode; reminderMinutes: number }
export const EVENT_DEFAULTS: EventDefaults = { eventMinutes: 60, reminderMode: 'google', reminderMinutes: 15 };
const MODES: readonly ReminderMode[] = ['google', 'custom', 'none'];

export class EventDefaultsError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

export async function readEventDefaults(familyId: string): Promise<EventDefaults> {
    const row = (await query('SELECT event_minutes, reminder_mode, reminder_minutes FROM familyhub_google_settings WHERE family_id=$1', [familyId])).rows[0];
    return row ? { eventMinutes: Number(row.event_minutes), reminderMode: row.reminder_mode, reminderMinutes: Number(row.reminder_minutes) } : { ...EVENT_DEFAULTS };
}

const whole = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export async function saveEventDefaults(familyId: string, input: unknown): Promise<EventDefaults> {
    const body = (input ?? {}) as Partial<EventDefaults>;
    if (!whole(body.eventMinutes, 5, 1440)) throw new EventDefaultsError(400, 'Choose an event length from 5 minutes to 24 hours.');
    if (!MODES.includes(body.reminderMode as ReminderMode)) throw new EventDefaultsError(400, 'Choose how notifications are set.');
    if (!whole(body.reminderMinutes, 0, 40320)) throw new EventDefaultsError(400, 'Choose a notification from 0 minutes to 4 weeks before.');
    const result = await query(`UPDATE familyhub_google_settings SET event_minutes=$2, reminder_mode=$3, reminder_minutes=$4 WHERE family_id=$1`,
        [familyId, body.eventMinutes, body.reminderMode, body.reminderMinutes]);
    if (!result.rowCount) throw new GoogleConnectionError(409, 'Choose your shared calendar and task list first.');
    return { eventMinutes: body.eventMinutes!, reminderMode: body.reminderMode!, reminderMinutes: body.reminderMinutes! };
}

const pad = (value: number) => String(value).padStart(2, '0');
/** "2026-11-14" plus days, as a calendar date. */
export function addDays(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}
/**
 * Adds minutes to a dateTime on its own wall clock and keeps its offset or
 * time zone, so "2026-11-14T15:00" in America/New_York becomes "2026-11-14T16:00".
 * Returns null when the value is not a dateTime the adapter would accept.
 */
export function addMinutes(dateTime: string, minutes: number): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(dateTime);
    if (!match) return null;
    const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
    if (!Number.isFinite(wall)) return null;
    const end = new Date(wall + minutes * 60_000);
    return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}:${pad(end.getUTCSeconds())}${match[7] ?? ''}`;
}

/** An event body with its end filled in when the caller sent only a start. */
export function withDefaultEnd(input: unknown, eventMinutes: number): CreateEventInput {
    const body = (input && typeof input === 'object' ? input : {}) as CreateEventInput & { end?: CreateEventInput['end'] | null };
    const end = body.end;
    const missing = end === undefined || end === null || (typeof end === 'object' && !end.date && !end.dateTime);
    if (!missing || !body.start || typeof body.start !== 'object') return body as CreateEventInput;
    if (typeof body.start.date === 'string' && !body.start.dateTime) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start.date)) return body as CreateEventInput;
        return { ...body, end: { date: addDays(body.start.date, 1) } };
    }
    if (typeof body.start.dateTime === 'string') {
        const dateTime = addMinutes(body.start.dateTime, eventMinutes);
        if (!dateTime) return body as CreateEventInput;
        return { ...body, end: { dateTime, ...(body.start.timeZone ? { timeZone: body.start.timeZone } : {}) } };
    }
    return body as CreateEventInput;
}

/**
 * The notification to put on a new timed event. All-day events keep Google's
 * behaviour (its all-day defaults are not readable through the API). A failed
 * lookup never blocks the event: it is created with Google's own default.
 */
export async function remindersFor(api: GoogleAdapters, calendarId: string, defaults: EventDefaults, input: CreateEventInput): Promise<EventReminders | undefined> {
    if (!input?.start || typeof input.start.dateTime !== 'string' || input.start.date) return undefined;
    if (defaults.reminderMode === 'none') return { useDefault: false, overrides: [] };
    if (defaults.reminderMode === 'custom') return { useDefault: false, overrides: [{ method: 'popup', minutes: defaults.reminderMinutes }] };
    try {
        const own = await api.defaultReminders(calendarId);
        if (own.length) return { useDefault: true };
        if (calendarId === 'primary') return undefined;
        const main = await api.defaultReminders('primary');
        return main.length ? { useDefault: false, overrides: main } : undefined;
    } catch { return undefined; }
}

/** What 'google' mode would use, for the Settings screen. */
export async function googleReminderPreview(api: GoogleAdapters, calendarId: string | null): Promise<{ source: 'calendar' | 'main' | 'none'; reminders: Reminder[] } | null> {
    try {
        const own = calendarId ? await api.defaultReminders(calendarId) : [];
        if (own.length) return { source: 'calendar', reminders: own };
        const main = calendarId === 'primary' ? [] : await api.defaultReminders('primary');
        return main.length ? { source: 'main', reminders: main } : { source: 'none', reminders: [] };
    } catch { return null; }
}
