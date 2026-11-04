import { useEffect, useMemo, useState } from 'react';
import { loadCalendarRange } from './calendarApi';
import { weekStartsOn } from '../i18n/format';
import { dateInZone, shiftDay, monthDays, eventsOnDay, type HubCalendarEvent } from './calendarDates';

export function FullCalendar({ timeZone, connected, onSelect, refreshKey, loadEvents = loadCalendarRange }: {
    timeZone: string; connected: boolean; onSelect: (event: HubCalendarEvent) => void; refreshKey: unknown;
    loadEvents?: typeof loadCalendarRange;
}) {
    const today = dateInZone(new Date(), timeZone);
    const weekStart = weekStartsOn();
    const [date, setDate] = useState(today);
    const [mode, setMode] = useState<'month' | 'week' | 'day'>('month');
    const [events, setEvents] = useState<HubCalendarEvent[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const days = useMemo(() => mode === 'month' ? monthDays(date, weekStart) : mode === 'day' ? [date]
        : Array.from({ length: 7 }, (_, i) => shiftDay(date, i - (new Date(date + 'T12:00:00Z').getUTCDay() - weekStart + 7) % 7)), [date, mode, weekStart]);
    const first = days[0], last = days[days.length - 1];
    useEffect(() => {
        let active = true;
        setEvents([]); setError('');
        if (!connected) return;
        setBusy(true);
        // Pad UTC bounds so every household-zone day is included, including DST.
        void loadEvents(shiftDay(first, -1) + 'T00:00:00Z', shiftDay(last, 2) + 'T00:00:00Z')
            .then((items) => { if (active) setEvents(items); })
            .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Calendar unavailable.'); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [first, last, connected, timeZone, refreshKey, retry, loadEvents]);
    const move = (direction: number) => {
        if (mode !== 'month') { setDate(shiftDay(date, direction * (mode === 'week' ? 7 : 1))); return; }
        const value = new Date(date.slice(0, 7) + '-01T12:00:00Z');
        value.setUTCMonth(value.getUTCMonth() + direction); setDate(value.toISOString().slice(0, 10));
    };
    const heading = new Date(date + 'T12:00:00Z').toLocaleDateString([], { timeZone: 'UTC', month: 'long', year: 'numeric', ...(mode === 'day' ? { day: 'numeric' } : {}) });
    return <div className="fh-full-calendar"><div className="fh-calendar-toolbar">
        <div className="fh-calendar-actions"><button className="fh-button fh-secondary" aria-label="Previous period" onClick={() => move(-1)}>←</button><h3>{heading}</h3><button className="fh-button fh-secondary" aria-label="Next period" onClick={() => move(1)}>→</button></div>
        <div className="fh-calendar-actions"><button className="fh-button fh-secondary" onClick={() => setDate(today)}>Today</button>{(['day', 'week', 'month'] as const).map((value) => <button className="fh-button fh-secondary" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}<button className="fh-button fh-secondary" aria-label="Refresh full calendar" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh</button></div>
    </div><p className="fh-fine-print">Selected shared Google calendar · {timeZone}</p>
    {!connected ? <p role="status">Connect Google and choose the shared calendar first.</p> : busy ? <p role="status">Loading calendar…</p> : error ? <p className="fh-callout" role="alert">{error}</p> : <>
        {mode === 'month' && <div className="fh-month-grid" aria-label={heading}>{Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + (weekStart + i) % 7)).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' })).map((day) => <div className="fh-weekday" key={day}>{day}</div>)}{days.map((day) => {
            const items = eventsOnDay(events, day, timeZone);
            return <div className={`fh-month-day ${day.slice(0, 7) === date.slice(0, 7) ? '' : 'is-outside'}`} key={day}>
                <button className="fh-date-button" aria-label={`Show ${day}, ${items.length} events`} aria-current={day === today ? 'date' : undefined} onClick={() => { setDate(day); setMode('day'); }}>{Number(day.slice(8))}</button>
                {items.slice(0, 3).map((event) => <button className="fh-calendar-chip" key={event.id} title={event.title} style={{ borderLeftColor: event.color ?? '#547b4d' }} onClick={() => onSelect(event)}>{event.title}</button>)}
                {items.length > 3 && <button className="fh-text-button" onClick={() => { setDate(day); setMode('day'); }}>+{items.length - 3} more</button>}
            </div>;
        })}</div>}
        {mode !== 'month' && days.map((day) => { const items = eventsOnDay(events, day, timeZone); return <section className="fh-calendar-agenda" key={day}><h3>{new Date(day + 'T12:00:00Z').toLocaleDateString([], { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })}</h3>{!items.length && <p>No events.</p>}{items.map((event) => <button className="fh-event" style={{ borderLeft: `6px solid ${event.color ?? '#547b4d'}` }} key={event.id} onClick={() => onSelect(event)}><span><strong>{event.title}</strong><small>{event.allDay ? 'All day' : new Date(event.start.dateTime!).toLocaleTimeString([], { timeZone, hour: 'numeric', minute: '2-digit' })}{event.location ? ` · ${event.location}` : ''}</small></span></button>)}</section>; })}
        {!events.length && mode === 'month' && <p role="status">No events in this calendar period.</p>}
    </>}
    </div>;
}
