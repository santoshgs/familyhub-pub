export interface HubCalendarEvent {
    id: string; title: string; location?: string; color?: string; allDay: boolean;
    start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string };
}
export function dateInZone(value: Date, timeZone: string): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
export const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function monthDays(date: string, weekStart = 0): string[] {
    const first = date.slice(0, 7) + '-01';
    const start = shiftDay(first, -(new Date(first + 'T12:00:00Z').getUTCDay() - weekStart + 7) % 7);
    return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}
export function eventsOnDay(events: HubCalendarEvent[], day: string, timeZone: string) {
    return events.filter((event) => {
        if (event.allDay) return Boolean(event.start.date && event.end.date && event.start.date <= day && day < event.end.date);
        if (!event.start.dateTime || !event.end.dateTime) return false;
        const first = dateInZone(new Date(event.start.dateTime), timeZone);
        const last = dateInZone(new Date(Date.parse(event.end.dateTime) - 1), timeZone);
        return first <= day && day <= last;
    }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start.dateTime ?? a.start.date ?? '').localeCompare(b.start.dateTime ?? b.start.date ?? ''));
}
