import { useEffect, useState, type CSSProperties, type ReactNode, type DragEvent } from 'react';
import { Plus, Settings2, RefreshCw, ArrowRight, Check, Trash2, Monitor, Pencil, WifiOff, LayoutList } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { AppShell } from './FamilyHubNav';
import { FullCalendar } from './FullCalendar';
import { ArrangeCards, CalendarLegend, useDashboardAppearance } from './DashboardAppearance';
import { moveCard } from './appearance';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { api } from '../lib/api';
import { MagicInputButton } from '../components/app/MagicInput';
import { HubDialog } from './FamilyHub';
import { EventDetail, EventForm } from './EventEditor';
import { DaycareTimeline, type DaycareUpdate } from './DaycareUpdates';
import { dayKey, describeDay, onColour, splitTime, cleanDaycareText, dueLabel, worldHue } from './today';
import { shiftDay } from './calendarDates';
import './familyhub.css';
import './board.css';
interface Event { id: string; title: string; location?: string; color?: string; colorId?: string; allDay: boolean; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } }
interface Task { id: string; title: string; completed: boolean; dueDate: string | null; completedAt?: string | null }
interface Note { id: string; content: string; author_name: string; color: string; pinned: boolean }
interface Chore { id: string; title: string; points?: number; pending_approval?: boolean; assigned_to_members?: { id: string; name: string; color: string }[] }

interface Source { state: string; lastSuccess?: string; message?: string }
interface Snapshot { notes: Note[]; events: Event[]; tasks: Task[]; daycare: DaycareUpdate[]; readOnly: boolean; connected: boolean; timeZone: string; sources: Record<string, Source> }
interface GoogleStatus { configured: boolean; connected: boolean; email?: string; gmail: boolean; missingConfiguration?: string[]; selection?: { calendarId: string; taskListId: string; timeZone: string } }
interface Sources { calendars: { id: string; summary: string; accessRole: string }[]; taskLists: { id: string; title: string }[] }
type Panel = 'note' | 'google' | 'event' | 'task' | 'daycare' | 'display' | null;
const FALLBACK_COLOUR = '#7986cb';
const VIEW_TITLES: Record<string, string> = { calendar: 'Calendar', tasks: 'To-dos', daycare: 'Daycare', classroom: 'School' };

function Freshness({ source }: { source?: Source }) {
    // A source that is not set up already says so in its empty state.
    if (source?.state !== 'fresh' && source?.state !== 'stale') return null;
    return <p className="bb-foot" role="status">{source?.state === 'fresh' ? 'Updated ' + (source.lastSuccess ? new Date(source.lastSuccess).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'just now') : source?.message ?? 'Not connected'}{source?.state === 'stale' && ' · showing saved data'}</p>;
}
const greetingFor = (hour: number) => hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

export default function ConnectedHub() {
    const { user, isModuleEnabled, isModuleShown } = useAuth();
    const preferences = useDashboardAppearance(user?.id);
    const [arranging, setArranging] = useState(false);
    const path = useLocation().pathname.slice(1);
    const view = ['calendar', 'tasks', 'daycare', 'classroom'].includes(path) ? path : 'overview';
    const [noteContent, setNoteContent] = useState('');
    const [noteColor, setNoteColor] = useState('yellow');
    const [data, setData] = useState<Snapshot | null>(null);
    const [chores, setChores] = useState<Chore[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [panel, setPanel] = useState<Panel>(null);
    const [eventDetail, setEventDetail] = useState<Event | null>(null);
    const [editingEvent, setEditingEvent] = useState<Event | null>(null);
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    const [sources, setSources] = useState<Sources | null>(null);
    const [calendarId, setCalendarId] = useState('');
    const [taskListId, setTaskListId] = useState('');
    const [timeZone, setTimeZone] = useState('America/New_York');
    const [includeGmail, setIncludeGmail] = useState(false);
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [now, setNow] = useState(() => new Date());
    const readOnly = Boolean(user?.is_display || data?.readOnly);
    const canWrite = !readOnly && Boolean(user?.is_owner || user?.role === 'parent');
    const showApprovals = canWrite && (isModuleEnabled('chores') || isModuleEnabled('rewards'));
    const load = async () => {
        try { const response = await api.get<{ data: Snapshot }>('/api/familyhub'); setData(response.data); setNow(new Date()); }
        catch { setError('Family Hub could not be refreshed. Check the server connection.'); }
        if (showApprovals) {
            try { const response = await api.get<{ data: Chore[] }>('/api/tasks'); setChores(response.data.filter((chore) => chore.pending_approval)); }
            catch { setChores([]); }
        }
    };
    useEffect(() => { document.title = 'Family Hub'; void load(); const id = window.setInterval(() => void load(), 60000); return () => window.clearInterval(id); }, [showApprovals]);
    useWebSocketUpdates('notes', () => void load());
    const action = async (run: () => Promise<unknown>, close = true) => {
        if (busy || !canWrite) return;
        setBusy(true); setError('');
        try { await run(); if (close) setPanel(null); await load(); }
        catch (e) { setError(e instanceof Error ? e.message : 'That action could not be completed.'); }
        finally { setBusy(false); }
    };
    const settings = async () => {
        setPanel('google'); setError(''); setSources(null);
        try {
            const result = await api.get<{ data: GoogleStatus }>('/api/familyhub/google/status'); setStatus(result.data);
            if (result.data.selection) { setCalendarId(result.data.selection.calendarId); setTaskListId(result.data.selection.taskListId); setTimeZone(result.data.selection.timeZone); }
            if (result.data.connected) { const response = await api.get<{ data: Sources }>('/api/familyhub/google/sources'); setSources(response.data); }
        } catch (e) { setError(e instanceof Error ? e.message : 'Google settings could not be loaded.'); }
    };
    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const outcome = query.get('google');
        if (outcome === 'connected') void settings();
        if (outcome === 'connection-failed') setError('Google authorization did not finish. Use the configured family account, grant the requested permissions, and try connecting again.');
        if (outcome) { query.delete('google'); window.history.replaceState(null, '', window.location.pathname + (query.size ? '?' + query : '') + window.location.hash); }
    }, []);
    const openTask = (task?: Task) => { setTitle(task?.title ?? ''); setDue(task?.dueDate ?? ''); setEditingTask(task ?? null); setPanel('task'); };
    const openEvent = (event: Event | null = null) => { setEditingEvent(event); setEventDetail(null); setTimeZone(data?.timeZone ?? 'America/New_York'); setPanel('event'); };
    const openNote = () => { setNoteContent(''); setPanel('note'); };
    const tz = data?.timeZone ?? timeZone;
    const eventWhen = (event: Event) => event.allDay ? `${event.start.date} · all day (ends before ${event.end.date})`
        : `${new Date(event.start.dateTime!).toLocaleString([], { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const today = now.toLocaleDateString([], { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
    const firstName = user?.name?.trim().split(/\s+/)[0];
    const hour = Number(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }));
    const greeting = `${greetingFor(hour)}${firstName ? `, ${firstName}` : ''}`;
    const saveTask = () => action(() => editingTask
        ? api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(editingTask.id)}`, { title, dueDate: due || null })
        : api.post('/api/familyhub/google/tasks', { title, dueDate: due || null }));
    const connect = () => action(async () => {
        const response = await api.post<{ data: { authorizationUrl: string } }>('/api/familyhub/google/connect', { includeGmail: includeGmail || Boolean(status?.gmail) });
        window.location.assign(response.data.authorizationUrl);
    }, false);
    const titleForPanel = panel === 'note' ? 'Leave a note' : panel === 'google' ? 'Connect your family’s Google account' : panel === 'event' ? editingEvent ? 'Edit event' : 'Add an event' : panel === 'task' ? editingTask ? 'Edit to-do' : 'Add a to-do' : panel === 'daycare' ? 'Daycare updates' : 'Use this browser as a display?';
    const legendFor = (colour?: string) => preferences.legend[(colour ?? FALLBACK_COLOUR).toLowerCase()];

    // ----- Today: the next event, the rest of today, and tomorrow's first -----
    const todayKey = dayKey(now, tz);
    const tomorrowKey = shiftDay(todayKey, 1);
    const startOf = (event: Event) => event.allDay ? new Date(`${event.start.date}T00:00:00`) : new Date(event.start.dateTime!);
    const endOf = (event: Event) => event.allDay ? new Date(`${event.end.date}T00:00:00`) : new Date(event.end.dateTime ?? event.start.dateTime!);
    const keyOf = (event: Event) => event.allDay ? event.start.date! : dayKey(new Date(event.start.dateTime!), tz);
    const events = [...(data?.events ?? [])].sort((a, b) => Number(a.allDay) - Number(b.allDay) || startOf(a).getTime() - startOf(b).getTime());
    const todayLeft = events.filter((event) => (event.allDay ? event.start.date! <= todayKey && event.end.date! > todayKey : keyOf(event) === todayKey && endOf(event) > now));
    const timedToday = todayLeft.filter((event) => !event.allDay);
    const next = timedToday[0] ?? todayLeft[0];
    const later = todayLeft.filter((event) => event !== next);
    const tomorrow = events.find((event) => keyOf(event) === tomorrowKey || (event.allDay && event.start.date! <= tomorrowKey && event.end.date! > tomorrowKey && !todayLeft.includes(event)));
    const upcoming = !next ? events.find((event) => keyOf(event) > todayKey) : undefined;
    const timeOf = (event: Event) => event.allDay ? { time: 'All day', period: '' } : splitTime(new Date(event.start.dateTime!), tz);
    const whenLabel = (event: Event) => {
        if (event.allDay) return 'today';
        const startsIn = Math.round((startOf(event).getTime() - now.getTime()) / 60000);
        if (startsIn <= 0) return 'now';
        if (startsIn < 60) return `in ${startsIn} min`;
        const h = Math.floor(startsIn / 60), m = startsIn % 60;
        return `in ${h} h${m ? ` ${m} min` : ''}`;
    };
    const hue = (event?: Event) => worldHue(event?.color ?? FALLBACK_COLOUR);
    const nextTone = (event?: Event) => { const colour = hue(event); const on = onColour(colour); return { '--m': colour, '--on': on, '--on-soft': on } as CSSProperties; };
    const row = (event: Event, isTomorrow = false) => { const { time, period } = timeOf(event); const who = legendFor(event.color); return <button type="button" key={event.id} className={`bb-row${isTomorrow ? ' is-tomorrow' : ''}`} style={{ '--m': hue(event) } as CSSProperties} onClick={() => setEventDetail(event)}><b>{isTomorrow ? new Date(`${keyOf(event)}T12:00:00Z`).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short' }) : time}{!isTomorrow && period && <small>{period}</small>}</b><i aria-hidden="true" /><span>{event.title}<small>{[isTomorrow ? describeDay(keyOf(event), todayKey, tz) : '', isTomorrow ? (event.allDay ? 'all day' : `${time} ${period}`.trim()) : '', who, event.location].filter(Boolean).join(' · ')}</small></span></button>; };

    const todaySection = data && <div className="bb-today">
        {next ? <button type="button" className="bb-next" style={nextTone(next)} onClick={() => setEventDetail(next)}>
            <span className="t">{timeOf(next).time}{timeOf(next).period && <small>{timeOf(next).period}</small>}</span><span className="bb-when">{whenLabel(next)}</span>
            <h3>{next.title}</h3>
            <p>{[legendFor(next.color), next.location].filter(Boolean).join(' · ') || 'Today'}</p>
        </button> : <div className="bb-next is-empty"><h3>{data.sources.calendar?.state === 'fresh' ? 'Nothing else today' : data.connected ? 'Calendar not set up' : 'Calendar not connected'}</h3><p>{upcoming ? `Next: ${upcoming.title}, ${describeDay(keyOf(upcoming), todayKey, tz).toLowerCase()}` : data.sources.calendar?.state === 'fresh' ? 'A little breathing room.' : data.sources.calendar?.message ?? 'Connect Google to see your calendar.'}</p></div>}
        {canWrite && <div className="bb-quick"><button className="bb-btn is-primary" disabled={!data.connected} onClick={() => openTask()}><Plus size={16} strokeWidth={2.8} />To-do</button><button className="bb-btn" onClick={openNote}><Plus size={16} strokeWidth={2.8} />Note</button><button className="bb-btn" disabled={!data.connected} onClick={() => openEvent()}><Plus size={16} strokeWidth={2.8} />Event</button></div>}
        {next && (later.length > 0 || tomorrow) && <>
            <div className="bb-strip" aria-hidden="true"><i className="bb-dot is-next" style={{ '--m': hue(next) } as CSSProperties} />{later.slice(0, 4).map((event) => <i key={event.id} className="bb-dot is-later" style={{ '--m': hue(event) } as CSSProperties} />)}{tomorrow && <i className="bb-dot is-tomorrow" />}</div>
            <div className="bb-dotlabels" aria-hidden="true"><span>{timeOf(next).time}</span>{later.slice(0, 4).map((event) => <span key={event.id}>{timeOf(event).time}</span>)}{tomorrow && <span>{describeDay(keyOf(tomorrow), todayKey, tz)}</span>}</div>
        </>}
        <div className="bb-rows" aria-label="Later">{later.map((event) => row(event))}{tomorrow && row(tomorrow, true)}</div>
        <div className="bb-today-tools">{canWrite && <button className="fh-text-button" disabled={!data.connected} onClick={() => openEvent()}><Plus size={16} />Add an event</button>}<a className="fh-text-button" href="/calendar">Open calendar</a></div>
        {data.events.length > 0 && <CalendarLegend compact events={data.events} labels={preferences.legend} editable={canWrite} saving={preferences.saving} error={preferences.error} onSave={(legend) => preferences.save('legend', legend)} />}
        {data.sources.calendar?.state === 'stale' && <Freshness source={data.sources.calendar} />}
    </div>;

    // ----- Sections -----
    const openTasks = data?.tasks.filter((task) => !task.completed) ?? [];
    const doneToday = data?.tasks.filter((task) => task.completed && task.completedAt && dayKey(new Date(task.completedAt), tz) === todayKey) ?? [];
    const doneTasks = data?.tasks.filter((task) => task.completed && !doneToday.includes(task)) ?? [];
    const reopen = (task: Task) => void action(() => api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`, { completed: false }), false);
    const taskList = (limit?: number) => data && <>
        {openTasks.slice(0, limit).map((task) => <div className="bb-task" key={task.id}><button className="bb-check" role="checkbox" aria-checked={false} aria-label={`Complete ${task.title}`} disabled={!canWrite || busy} onClick={() => void action(() => api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`, { completed: true }), false)} /><button className="bb-task-name" disabled={!canWrite} onClick={() => openTask(task)}>{task.title}{task.dueDate && <small>{dueLabel(task.dueDate, todayKey, tz)}</small>}</button>{canWrite && view !== 'overview' && <button className="fh-icon-button" aria-label={`Delete ${task.title}`} disabled={busy} onClick={() => void action(() => api.delete(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`), false)}><Trash2 size={16} /></button>}</div>)}
        {doneToday.map((task) => <div className="bb-task is-done" key={task.id}><button className="bb-check" role="checkbox" aria-checked={true} aria-label={`Reopen ${task.title}`} disabled={!canWrite || busy} onClick={() => reopen(task)} /><span className="bb-task-name"><s>{task.title}</s><small>Done today</small></span></div>)}
        {limit && openTasks.length > limit && <p className="bb-foot">{openTasks.length - limit} more on the list</p>}
        {!data.tasks.length && <p className="bb-empty">{data.sources.tasks?.state === 'fresh' ? 'The shared list is clear.' : data.sources.tasks?.message}</p>}
        {canWrite && <button className="bb-add" disabled={!data.connected} onClick={() => openTask()}><Plus size={17} />Add a to-do</button>}
        {doneTasks.length > 0 && <details className="bb-done"><summary>Done earlier ({doneTasks.length})</summary>{doneTasks.map((task) => <div className="bb-task" key={task.id}><span className="bb-check" aria-hidden="true" /><span className="bb-task-name">{task.title}</span>{canWrite && <button className="fh-text-button" disabled={busy} onClick={() => reopen(task)}>Reopen</button>}</div>)}</details>}
        <Freshness source={data.sources.tasks} />
    </>;
    const notesList = data && <>
        {data.notes.slice(0, 3).map((note) => <article className={`bb-note${note.color === 'pink' ? ' is-pink' : note.color === 'green' ? ' is-green' : ''}`} key={note.id}><p>{note.content}</p><footer>{note.author_name}{note.pinned && ' · Pinned'}</footer></article>)}
        {!data.notes.length && <p className="bb-empty">A space for a reminder or a kind word.</p>}
        {canWrite && <button className="bb-add" onClick={openNote}><Pencil size={16} />Leave a note</button>}
    </>;
    const daycareList = data && <>
        {data.daycare.length ? <div className="bb-dc">{data.daycare.slice(0, 3).map((update) => <button type="button" className="bb-dc-row" key={update.id} onClick={() => setPanel('daycare')}><h3>{update.title}</h3><p>{cleanDaycareText(update.text, 90)}</p><time>{[update.kind === 'activity' ? update.activityType ?? 'Activity' : update.kind === 'message' ? 'Message from daycare' : 'Notification', new Date(update.receivedAt).toLocaleString([], { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })].join(' · ')}</time></button>)}</div>
            : <p className="bb-empty">{data.sources.daycare?.state === 'fresh' ? 'No daycare emails in the last 30 days.' : data.sources.daycare?.message}</p>}
        <Freshness source={data.sources.daycare} />
    </>;
    const schoolEmpty = <p className="bb-empty">Google Classroom isn’t connected yet. School permissions will be checked before connecting.</p>;
    const approvals = showApprovals && chores.length > 0 && <section className="bb-sec" aria-labelledby="bb-approvals" style={{ order: preferences.order.indexOf('tasks') * 2 + 1 }}>
        <header><h2 id="bb-approvals">Chores to approve</h2><a href="/chores">All chores</a></header>
        {chores.map((chore) => { const member = chore.assigned_to_members?.[0]; return <div className="bb-ap" key={chore.id}><i className="bb-disc" style={{ '--m': member ? worldHue(member.color) : '#E4E5EA', '--on': onColour(member ? worldHue(member.color) : '#E4E5EA') } as CSSProperties} aria-hidden="true">{member?.name.trim()[0]?.toUpperCase() ?? '?'}</i><span>{chore.title}<small>{[chore.assigned_to_members?.map((m) => m.name).join(', '), chore.points ? `${chore.points} points` : ''].filter(Boolean).join(' · ')}</small></span><button className="bb-btn is-small is-primary" disabled={busy} onClick={() => void action(() => api.post(`/api/tasks/${chore.id}/approve`, {}), false)}>Approve</button></div>; })}
    </section>;

    // Overview sections follow each member's order and Show choices.
    const CARD_MODULES: Record<string, string> = { tasks: 'todos', notes: 'notes', daycare: 'daycare', classroom: 'classroom' };
    const visible = preferences.order.filter((card) => card === 'calendar' || !CARD_MODULES[card] || (isModuleShown(CARD_MODULES[card]) && isModuleEnabled(CARD_MODULES[card])));
    const editable = !readOnly && view === 'overview';
    const section = (card: string, heading: string, link: ReactNode, body: ReactNode) => <section key={card} className="bb-sec" aria-labelledby={`bb-${card}`} style={{ order: preferences.order.indexOf(card) * 2 }}
        onDragOver={(event: DragEvent) => { if (editable) event.preventDefault(); }}
        onDrop={(event: DragEvent) => { event.preventDefault(); if (editable && !preferences.saving) void preferences.save('order', moveCard(preferences.order, event.dataTransfer.getData('text/plain'), card)); }}>
        <header draggable={editable} onDragStart={(event) => { event.dataTransfer.setData('text/plain', card); event.dataTransfer.effectAllowed = 'move'; }}><h2 id={`bb-${card}`}>{heading}</h2>{link}</header>{body}
    </section>;
    const SECTIONS: Record<string, () => ReactNode> = {
        calendar: () => section('calendar', 'Today', null, todaySection),
        tasks: () => section('tasks', openTasks.length === 1 ? '1 to-do' : `${openTasks.length} to-dos`, <a href="/tasks">Open list</a>, taskList(5)),
        notes: () => section('notes', 'Notes', <a href="/notes">All notes</a>, notesList),
        daycare: () => section('daycare', 'Daycare', <button type="button" onClick={() => setPanel('daycare')}>All updates</button>, daycareList),
        classroom: () => section('classroom', 'School', null, schoolEmpty),
    };
    const left = visible.filter((_, index) => index % 2 === 0);
    const right = visible.filter((_, index) => index % 2 === 1);
    const tasksRight = right.includes('tasks');

    const tools = canWrite && <><MagicInputButton google={{ timeZone: tz }} onSaved={() => void load()} /></>;
    const refresh = <button className="fh-icon-button" aria-label="Refresh" title="Refresh" onClick={() => { setError(''); void load(); }}><RefreshCw size={19} /></button>;
    const homeOptions = <div className="bb-today-tools" aria-label="Home options">{canWrite && <button className="fh-text-button" onClick={() => void settings()}><Settings2 size={16} />{data?.connected ? 'Google connection' : 'Connect Google'}</button>}{editable && <button className="fh-text-button" onClick={() => setArranging(true)}><LayoutList size={16} />Arrange Home</button>}{canWrite && <button className="fh-text-button" onClick={() => setPanel('display')}><Monitor size={16} />Use as display</button>}</div>;

    return <AppShell title={view === 'overview' ? greeting : VIEW_TITLES[view]} subtitle={view === 'overview' ? today : undefined} tools={<>{tools}{refresh}</>} deskTitle={view !== 'overview'}>
        {view === 'overview' && <div className="bb-hello"><div><p>{today}</p><h1>{greeting}</h1></div><div className="bb-hello-acts">{canWrite && data && <><button className="bb-btn is-primary" disabled={!data.connected} onClick={() => openTask()}><Plus size={16} strokeWidth={2.8} />To-do</button><button className="bb-btn" onClick={openNote}><Plus size={16} strokeWidth={2.8} />Note</button><button className="bb-btn" disabled={!data.connected} onClick={() => openEvent()}><Plus size={16} strokeWidth={2.8} />Event</button></>}{tools}{refresh}</div></div>}
        <div className="bb-callouts">
            {preferences.error && <p className="fh-callout" role="alert">{preferences.error}</p>}
            {readOnly && <p className="fh-callout">Protected family display · editing is disabled by the server.</p>}
            {error && !panel && (/needs reconnecting/i.test(error)
                ? <div className="fh-callout" role="alert"><p>Google needs to be reconnected before the calendar and to-dos can load. This does not affect your Family Hub sign-in.</p>{canWrite && <button className="fh-text-button" onClick={() => void settings()}>Reconnect Google<ArrowRight size={15} /></button>}</div>
                : <div className="fh-callout" role="alert"><WifiOff size={18} /><p>{error} Changes may have reached Google if a request timed out; refresh before retrying.</p></div>)}
            {data && !data.connected && canWrite && view === 'overview' && <div className="fh-callout"><p>Google isn’t connected, so the calendar and to-dos are empty.</p><button className="fh-text-button" onClick={() => void settings()}>Connect Google<ArrowRight size={15} /></button></div>}
        </div>
        {!data ? <p className="bb-empty" role="status">Loading your family’s day…</p>
            : view === 'overview' ? <>
                <div className="bb-cols">
                    <div className="bb-col">{left.map((card) => SECTIONS[card]?.())}{!tasksRight && approvals}</div>
                    <div className="bb-col">{right.map((card) => SECTIONS[card]?.())}{tasksRight && approvals}</div>
                </div>
                {homeOptions}
            </>
            : view === 'calendar' ? <section className="bb-sec"><FullCalendar timeZone={data.timeZone} connected={data.connected} onSelect={setEventDetail} refreshKey={data} />{canWrite && <button className="bb-add" disabled={!data.connected} onClick={() => openEvent()}><Plus size={17} />Add an event to Google Calendar</button>}<CalendarLegend events={data.events} labels={preferences.legend} editable={canWrite} saving={preferences.saving} error={preferences.error} onSave={(legend) => preferences.save('legend', legend)} /></section>
            : view === 'tasks' ? <section className="bb-sec">{taskList()}</section>
            : view === 'daycare' ? <section className="bb-sec"><DaycareTimeline updates={data.daycare} /><Freshness source={data.sources.daycare} /></section>
            : <section className="bb-sec">{schoolEmpty}</section>}
        <HubDialog open={Boolean(panel || eventDetail)} onClose={() => { setPanel(null); setEventDetail(null); setError(''); }} title={eventDetail?.title ?? titleForPanel} description={panel === 'google' ? 'Calendar, Tasks and Gmail use the same verified family account.' : panel === 'daycare' ? 'Up to 100 daycare emails from the last 30 days; attachments and photos are ignored.' : 'Changes are saved to the selected source.'}>{error && <div className="fh-callout" role="alert"><p>{error}</p></div>}
    {panel === 'note' ? <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void action(() => api.post('/api/notes', { content: noteContent.trim(), color: noteColor })); }}><label>Message<textarea autoFocus required maxLength={500} rows={4} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} /></label><label>Colour<select value={noteColor} onChange={(e) => setNoteColor(e.target.value)}><option value="yellow">Yellow</option><option value="pink">Red</option><option value="green">Green</option></select></label><button className="fh-button fh-primary" disabled={busy || !canWrite || !noteContent.trim()}>Save note</button></form> : eventDetail ? <EventDetail event={eventDetail} when={eventWhen(eventDetail)} legend={preferences.legend} canWrite={canWrite && Boolean(data?.connected)} onEdit={() => openEvent(eventDetail)} />
    : panel === 'event' ? <EventForm key={editingEvent?.id ?? 'new'} event={editingEvent} timeZone={timeZone} legend={preferences.legend} busy={busy} canWrite={canWrite} run={(task) => action(task)} />
    : panel === 'task' ? <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void saveTask(); }}><label>What needs doing?<input required autoFocus maxLength={1024} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label><p className="fh-fine-print">Saved directly to Google Tasks. The API supports dates, not precise reminder times.</p><div className="bb-hello-acts">{editingTask && <button type="button" className="fh-button fh-secondary" disabled={busy} onClick={() => void action(() => api.delete(`/api/familyhub/google/tasks/${encodeURIComponent(editingTask.id)}`))}><Trash2 size={16} />Delete</button>}<button className="fh-button fh-primary" disabled={busy || !canWrite}>Save to Google Tasks</button></div></form>
    : panel === 'daycare' ? <DaycareTimeline updates={data?.daycare ?? []} />
    : panel === 'display' ? <div className="fh-form"><p>This replaces the editing session in this browser with server-enforced read-only access. Sign in again to return to editing.</p><button className="fh-button fh-primary" disabled={busy} onClick={() => void action(async () => { const response = await api.post<{ data: { token: string } }>('/api/familyhub/display-session', {}); api.setToken(response.data.token); localStorage.removeItem('user'); window.location.reload(); })}>Start protected display</button></div>
    : panel === 'google' ? <div className="fh-form">{!status ? <p>Loading Google configuration…</p> : <><div className="fh-callout"><p>{status.connected ? `Connected to ${status.email}.` : status.configured ? 'The server is ready. Authorize the dedicated family Google account to continue.' : 'Google Cloud setup is needed. Configure the server using docs/familyhub/GOOGLE_SETUP.md, then restart it.'}</p></div>{!status.configured && status.missingConfiguration?.length ? <p className="fh-fine-print">Missing server settings: {status.missingConfiguration.join(', ')}</p> : null}<label className="fh-toggle-row"><span>Also authorize daycare email reading</span><input type="checkbox" checked={includeGmail || status.gmail} disabled={status.gmail} onChange={(e) => setIncludeGmail(e.target.checked)} /></label><p className="fh-fine-print">Gmail permission allows mailbox reading; Family Hub processes only messages from no-reply@himama.com. Email contents are not sent to AI.</p><button className="fh-button fh-primary" disabled={busy || !status.configured} onClick={() => void connect()}>{status.connected ? 'Reconnect / grant Gmail access' : 'Connect family Google account'}<ArrowRight size={15} /></button>{sources && <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void action(() => api.put('/api/familyhub/google/sources', { calendarId, taskListId, timeZone })); }}><label>Shared Google Calendar<select required value={calendarId} onChange={(e) => setCalendarId(e.target.value)}><option value="">Choose an editable calendar</option>{sources.calendars.filter((calendar) => ['owner', 'writer'].includes(calendar.accessRole)).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label><label>Google Tasks list<select required value={taskListId} onChange={(e) => setTaskListId(e.target.value)}><option value="">Choose a task list</option>{sources.taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><label>Household timezone<input required value={timeZone} onChange={(e) => setTimeZone(e.target.value)} /></label><button className="fh-button fh-primary" disabled={busy}>Use these sources<Check size={16} /></button></form>}{status.connected && <button className="fh-button fh-secondary" disabled={busy} onClick={() => void action(async () => { await api.delete('/api/familyhub/google/connection'); setStatus({ ...status, connected: false }); setSources(null); }, false)}>Disconnect Google and clear cached data</button>}</>}</div> : null}</HubDialog>
        {arranging && <ArrangeCards order={preferences.order} saving={preferences.saving} error={preferences.error} onSave={async (order) => { if (await preferences.save('order', order)) setArranging(false); }} onClose={() => setArranging(false)} />}
    </AppShell>;
}
