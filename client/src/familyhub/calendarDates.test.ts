import { expect, it } from 'vitest';
import { monthDays, dateInZone, eventsOnDay, type HubCalendarEvent } from './calendarDates';
const timed: HubCalendarEvent = { id: 'fictional', title: 'Fictional late event', allDay: false,
    start: { dateTime: '2026-11-01T03:30:00Z' }, end: { dateTime: '2026-11-01T04:00:00Z' } };
it('groups timed events in the household zone and treats midnight end as exclusive', () => {
    expect(dateInZone(new Date(timed.start.dateTime!), 'America/New_York')).toBe('2026-10-31');
    expect(eventsOnDay([timed], '2026-10-31', 'America/New_York')).toEqual([timed]);
    expect(eventsOnDay([timed], '2026-11-01', 'America/New_York')).toEqual([]);
});
it('shows multi-day all-day events on each included date, without shifting date-only values', () => {
    const event = { ...timed, allDay: true, start: { date: '2026-10-30' }, end: { date: '2026-11-02' } };
    expect(eventsOnDay([event], '2026-11-01', 'Pacific/Kiritimati')).toEqual([event]);
    expect(eventsOnDay([event], '2026-11-02', 'America/New_York')).toEqual([]);
});
it('builds complete six-week grids across year boundaries', () => {
    const days = monthDays('2027-01-15');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-12-27');
    expect(days[41]).toBe('2027-02-06');
    expect(new Set(days).size).toBe(42);
    expect(monthDays('2027-01-15', 1)[0]).toBe('2026-12-28');
});
it('keeps events visible through a daylight-saving fallback', () => {
    const event = { ...timed, start: { dateTime: '2026-11-01T01:45:00-04:00' }, end: { dateTime: '2026-11-01T01:15:00-05:00' } };
    expect(eventsOnDay([event], '2026-11-01', 'America/New_York')).toEqual([event]);
});
