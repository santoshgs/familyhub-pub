import { api } from '../lib/api';
import { dateInZone, shiftDay } from './calendarDates';

/** How new events are filled in (Settings → Household → Calendar events). */
export interface EventDefaults { eventMinutes: number; reminderMode: 'google' | 'custom' | 'none'; reminderMinutes: number; configured: boolean }
let defaults: Promise<EventDefaults> | null = null;
export const loadEventDefaults = () => {
    defaults ??= api.get<{ data: EventDefaults }>('/api/familyhub/google/event-defaults').then((response) => response.data).catch((error) => { defaults = null; throw error; });
    return defaults;
};
/** Settings calls this after a change so the next form uses the new length. */
export const forgetEventDefaults = () => { defaults = null; };

const pad = (value: number) => String(value).padStart(2, '0');
/** "2026-11-14T15:00" plus minutes, on the wall clock (a datetime-local value). */
export function addLocalMinutes(value: string, minutes: number): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (!match) return '';
    const time = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) + minutes * 60_000);
    return `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}`;
}
/**
 * Where a new event starts: on the day being looked at, at the next whole hour
 * when that day is today (until 11 pm), otherwise at 9 am.
 */
export function defaultStart(day: string | undefined, timeZone: string, now = new Date()): string {
    const today = dateInZone(now, timeZone);
    const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
    if (date === today) {
        const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now)) + 1;
        if (hour <= 23) return `${date}T${pad(hour)}:00`;
    }
    return `${date}T09:00`;
}
/** The end that goes with a start when the end has not been chosen by hand. */
export function defaultEnd(start: string, allDay: boolean, eventMinutes: number): string {
    if (!start) return '';
    return allDay ? shiftDay(start.slice(0, 10), 1) : addLocalMinutes(start, eventMinutes);
}
