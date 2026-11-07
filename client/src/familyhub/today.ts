import { dateInZone, shiftDay } from './calendarDates';

/** YYYY-MM-DD for an instant in the household time zone. */
export const dayKey = (value: Date, timeZone: string) => dateInZone(value, timeZone);

/** "Today", "Tomorrow", or a short weekday for days within the coming week. */
export function describeDay(day: string, today: string, _timeZone?: string): string {
    if (day === today) return 'Today';
    if (day === shiftDay(today, 1)) return 'Tomorrow';
    if (day === shiftDay(today, -1)) return 'Yesterday';
    return new Date(`${day}T12:00:00Z`).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short', ...(day > shiftDay(today, 6) || day < today ? { day: 'numeric', month: 'short' } : {}) });
}

/** A due date as the to-do list says it. */
export function dueLabel(due: string, today: string, timeZone?: string): string {
    const day = due.slice(0, 10);
    if (day < today) return 'Overdue';
    return describeDay(day, today, timeZone);
}

/** The clock time split from its day period, so "8:30" can be set large and "AM" small. */
export function splitTime(value: Date, timeZone: string): { time: string; period: string } {
    const parts = new Intl.DateTimeFormat([], { timeZone, hour: 'numeric', minute: '2-digit' }).formatToParts(value);
    const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? '';
    const time = parts.filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('').trim();
    return { time, period };
}

const luminance = (hex: string) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0').slice(0, 6);
    const channel = (i: number) => { const c = parseInt(full.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};
/** Ink or white, whichever reads better on a member or event colour. */
export function onColour(background: string): string {
    if (!/^#?[0-9a-f]{3,8}$/i.test(background)) return '#1B1B1F';
    const l = luminance(background);
    const withInk = (l + 0.05) / (luminance('#1B1B1F') + 0.05);
    const withWhite = 1.05 / (l + 0.05);
    return withInk >= withWhite ? '#1B1B1F' : '#FFFFFF';
}

/** Daycare email text without the banner rules (rows of *, -, =) the emails use as decoration. */
export function cleanDaycareText(text: string, max?: number): string {
    const clean = text.replace(/[*=_~-]{3,}/g, ' ').replace(/\s+/g, ' ').trim();
    return max && clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, '') + '…' : clean;
}

/** Board Book's four flat hues; Google's muted calendar colours map to the nearest one. */
export const WORLD_HUES = { cobalt: '#1F4FD8', tomato: '#D4381F', sun: '#F7C21B', grass: '#2E9E4F' } as const;
export function worldHue(colour: string): string {
    const value = colour.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return WORLD_HUES.cobalt;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (delta < 0.12) return '#5A5A66'; // greys (graphite) stay neutral
    const h = (max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    const hue = (h + 360) % 360;
    if (hue < 35 || hue >= 320) return WORLD_HUES.tomato;
    if (hue < 70) return WORLD_HUES.sun;
    if (hue < 170) return WORLD_HUES.grass;
    return WORLD_HUES.cobalt;
}
