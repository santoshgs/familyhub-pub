import { useEffect, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { loadPalette, type Palette } from './colourLabels';
import { defaultEnd, defaultStart, loadEventDefaults } from './eventDefaults';

/**
 * Add or edit one Google Calendar event from Family Hub (v1.5): title, time,
 * location and Google's own event colour. Colour labels ("Blue = Alex") are
 * Family Hub's legend; Google has no API for the names you give colours there.
 */
export interface EditableEvent {
    id: string; title: string; location?: string; color?: string; colorId?: string; allDay: boolean;
    start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string };
}
/** "2026-11-06T15:00:00-05:00" → "2026-11-06T15:00" in the household timezone. */
export function localInput(dateTime: string | undefined, timeZone: string) {
    if (!dateTime) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(dateTime)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function EventForm({ event, timeZone, legend, busy, canWrite, run, initialDate }: {
    event: EditableEvent | null; timeZone: string; legend: Record<string, string>; busy: boolean; canWrite: boolean;
    /** The hub's action runner: shows errors, closes the dialog and reloads. */
    run: (task: () => Promise<unknown>) => Promise<void>;
    /** For a new event: the day the calendar was showing (YYYY-MM-DD). */
    initialDate?: string;
}) {
    const [title, setTitle] = useState(event?.title ?? '');
    const [allDay, setAllDay] = useState(event?.allDay ?? false);
    const [minutes, setMinutes] = useState(60);
    const [start, setStart] = useState(() => event ? event.allDay ? event.start.date ?? '' : localInput(event.start.dateTime, timeZone) : defaultStart(initialDate, timeZone));
    const [end, setEnd] = useState(() => event ? event.allDay ? event.end.date ?? '' : localInput(event.end.dateTime, timeZone) : defaultEnd(start, false, 60));
    // A new event's end follows its start until someone picks the end by hand.
    const [endChosen, setEndChosen] = useState(Boolean(event));
    useEffect(() => {
        if (event) return;
        let live = true;
        loadEventDefaults().then((value) => { if (live && value.eventMinutes) setMinutes(value.eventMinutes); }).catch(() => undefined);
        return () => { live = false; };
    }, [event]);
    useEffect(() => { if (!endChosen) setEnd(defaultEnd(start, allDay, minutes)); }, [start, allDay, minutes, endChosen]);
    const [location, setLocation] = useState(event?.location ?? '');
    const [colorId, setColorId] = useState(event?.colorId ?? '');
    const [colors, setColors] = useState<Palette | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    // A new event gets a Google id up front so an ambiguous failure can be reconciled.
    const [newId] = useState(() => crypto.randomUUID().replace(/-/g, ''));
    useEffect(() => { let live = true; loadPalette().then((value) => { if (live) setColors(value); }).catch(() => undefined); return () => { live = false; }; }, []);

    const body = { title, location, colorId: colorId || null,
        start: allDay ? { date: start } : { dateTime: start, timeZone }, end: allDay ? { date: end } : { dateTime: end, timeZone } };
    const save = () => run(() => event
        ? api.patch(`/api/familyhub/google/events/${encodeURIComponent(event.id)}`, body)
        : api.post('/api/familyhub/google/events', { ...body, id: newId }));
    const swatches = colors ? [{ id: '', color: colors.calendar ?? '#7986cb' }, ...colors.colors] : [];

    return <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>Event title<input autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="fh-toggle-row">All-day event<input type="checkbox" checked={allDay} onChange={(e) => {
            // Keep the day; the end follows again unless it was picked by hand.
            const day = start.slice(0, 10);
            setAllDay(e.target.checked);
            setStart(day ? e.target.checked ? day : defaultStart(day, timeZone) : '');
            if (endChosen) { setEnd(''); setEndChosen(false); }
        }} /></label>
        <div className="fh-form-row fh-event-times">
            <label>Starts<input required type={allDay ? 'date' : 'datetime-local'} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>{allDay ? 'Ends before (exclusive)' : 'Ends'}<input required type={allDay ? 'date' : 'datetime-local'} value={end} onChange={(e) => { setEnd(e.target.value); setEndChosen(true); }} /></label>
        </div>
        <label>Location<input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        {swatches.length > 0 && <fieldset className="fh-event-colours">
            <legend>Colour</legend>
            <div role="radiogroup" aria-label="Event colour">{swatches.map((swatch) => {
                const label = legend[swatch.color] || (swatch.id ? '' : 'Calendar');
                return <button type="button" role="radio" aria-checked={colorId === swatch.id} key={swatch.id || 'calendar'} className={colorId === swatch.id ? 'is-on' : ''}
                    title={label || swatch.color} onClick={() => setColorId(swatch.id)}>
                    <i style={{ background: swatch.color }}>{colorId === swatch.id && <Check size={14} strokeWidth={3} />}</i>
                    <small>{label || ' '}</small>
                </button>;
            })}</div>
            <p className="fh-fine-print">The colour is saved in Google Calendar. Name colours under Calendar colours to show who an event is for.</p>
        </fieldset>}
        <p className="fh-fine-print">{event ? 'For a repeating event, this changes only this occurrence.' : 'For an all-day event on one day, choose the following day as the exclusive end.'} Timezone: {timeZone}.</p>
        <div className="bb-hello-acts">
            {event && <button type="button" className="fh-button fh-secondary" disabled={busy || !canWrite}
                onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } void run(() => api.delete(`/api/familyhub/google/events/${encodeURIComponent(event.id)}`)); }}>
                <Trash2 size={16} />{confirmDelete ? 'Tap again to delete' : 'Delete'}</button>}
            <button className="fh-button fh-primary" disabled={busy || !canWrite}>{event ? 'Save changes' : 'Save to Google Calendar'}</button>
        </div>
    </form>;
}

/** Read-only event details with the colour's label, and Edit for parents. */
export function EventDetail({ event, when, legend, canWrite, onEdit }: {
    event: EditableEvent; when: string; legend: Record<string, string>; canWrite: boolean; onEdit: () => void;
}) {
    const color = (event.color ?? '').toLowerCase();
    const label = legend[color];
    return <div className="fh-form">
        <p>{when}</p>
        {event.location && <p>{event.location}</p>}
        {color && <p className="fh-colour-caption"><i style={{ background: color }} aria-hidden="true" />{label || 'No label for this colour yet'}</p>}
        <p className="fh-fine-print">Google Calendar is the source of truth.</p>
        {canWrite && <button type="button" className="fh-button fh-primary" onClick={onEdit}><Pencil size={16} />Edit event</button>}
    </div>;
}
