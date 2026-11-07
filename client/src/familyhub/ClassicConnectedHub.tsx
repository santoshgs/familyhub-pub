import { useEffect, useState, useContext, type ReactNode } from 'react';
import { CalendarDays, CheckCheck, StickyNote, Flower2, GraduationCap, House, Plus, Settings2, LogOut, RefreshCw, ArrowRight, Check, Trash2, Monitor, Pencil, WifiOff } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { FamilyHubNav } from './ClassicNav';
import { FullCalendar } from './FullCalendar';
import { CardLayout, DashboardGrid, OrderedCard, ArrangeCards, CalendarLegend, useDashboardAppearance } from './DashboardAppearance';
import { moveCard } from './appearance';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { api } from '../lib/api';
import { MagicInputButton } from '../components/app/MagicInput';
import { HubDialog } from './FamilyHub';
import { EventDetail, EventForm } from './EventEditor';
import { DaycareSummary, DaycareTimeline, type DaycareUpdate } from './DaycareUpdates';
import './familyhub.css';
import { familyHubVersionLabel } from './version';
interface Event { id: string; title: string; location?: string; color?: string; colorId?: string; allDay: boolean; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } }
interface Task { id: string; title: string; completed: boolean; dueDate: string | null }
interface Note { id: string; content: string; author_name: string; color: string; pinned: boolean }

interface Source { state: string; lastSuccess?: string; message?: string }
interface Snapshot { notes: Note[]; events: Event[]; tasks: Task[]; daycare: DaycareUpdate[]; readOnly: boolean; connected: boolean; timeZone: string; sources: Record<string, Source> }
interface GoogleStatus { configured: boolean; connected: boolean; email?: string; gmail: boolean; missingConfiguration?: string[]; selection?: { calendarId: string; taskListId: string; timeZone: string } }
interface Sources { calendars: { id: string; summary: string; accessRole: string }[]; taskLists: { id: string; title: string }[] }
type Panel = 'note' | 'google' | 'event' | 'task' | 'daycare' | 'display' | null;
function Card({ icon: Icon, label, title, className, children }: { icon: typeof House; label: string; title: string; className: string; children: ReactNode }) {
    const layout = useContext(CardLayout);
    return <OrderedCard card={className.replace('fh-', '')}><div className="fh-card-heading" draggable={layout.editable} onDragStart={(event) => { event.dataTransfer.setData('text/plain', className.replace('fh-', '')); event.dataTransfer.effectAllowed = 'move'; }}><div className="fh-card-title"><span className="fh-card-icon fh-tint-sage"><Icon size={20} /></span><div><p className="fh-eyebrow">{label}</p><h2>{title}</h2></div></div></div>{children}</OrderedCard>;
}
function Freshness({ source }: { source?: Source }) {
    return <div className="fh-card-footer" role="status"><span>{source?.state === 'fresh' ? 'Updated ' + (source.lastSuccess ? new Date(source.lastSuccess).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'just now') : source?.message ?? 'Not connected'}{source?.state === 'stale' && ' · showing saved data'}</span></div>;
}
export default function ConnectedHub() {
    const { user, logout, isModuleEnabled, isModuleShown } = useAuth();
    const preferences = useDashboardAppearance(user?.id);
    const [arranging, setArranging] = useState(false);
    const path = useLocation().pathname.slice(1);
    const view = ['calendar', 'tasks', 'daycare', 'classroom'].includes(path) ? path : 'overview';
    const [noteContent, setNoteContent] = useState('');
    const [noteColor, setNoteColor] = useState('yellow');
    const [data, setData] = useState<Snapshot | null>(null);
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
    const readOnly = Boolean(user?.is_display || data?.readOnly);
    const canWrite = !readOnly && Boolean(user?.is_owner || user?.role === 'parent');
    const load = async () => {
        try { const response = await api.get<{ data: Snapshot }>('/api/familyhub'); setData(response.data); }
        catch { setError('Family Hub could not be refreshed. Check the server connection.'); }
    };
    useEffect(() => { document.title = 'Family Hub'; void load(); const id = window.setInterval(() => void load(), 60000); return () => window.clearInterval(id); }, []);
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
    const eventWhen = (event: Event) => event.allDay ? `${event.start.date} · all day (ends before ${event.end.date})`
        : `${new Date(event.start.dateTime!).toLocaleString([], { timeZone: data?.timeZone ?? timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const saveTask = () => action(() => editingTask
        ? api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(editingTask.id)}`, { title, dueDate: due || null })
        : api.post('/api/familyhub/google/tasks', { title, dueDate: due || null }));
    const connect = () => action(async () => {
        const response = await api.post<{ data: { authorizationUrl: string } }>('/api/familyhub/google/connect', { includeGmail: includeGmail || Boolean(status?.gmail) });
        window.location.assign(response.data.authorizationUrl);
    }, false);
    const titleForPanel = panel === 'note' ? 'Leave a little note' : panel === 'google' ? 'Connect your family’s Google account' : panel === 'event' ? editingEvent ? 'Change this plan' : 'Make a little plan' : panel === 'task' ? editingTask ? 'Edit your Google task' : 'One less thing to remember' : panel === 'daycare' ? 'Daycare updates' : 'Use this browser as a display?';
    // Overview cards follow each member's Show choice; a card's own page still shows it.
    const CARD_MODULES: Record<string, string> = { tasks: 'todos', notes: 'notes', daycare: 'daycare', classroom: 'classroom' };
    const hiddenCards = view === 'overview' && !readOnly ? Object.entries(CARD_MODULES).filter(([, mod]) => !isModuleShown(mod)).map(([card]) => card) : [];
    return <CardLayout.Provider value={{ order: preferences.order, hidden: hiddenCards, editable: !readOnly && view === 'overview', move: (card, target) => { if (!preferences.saving) void preferences.save('order', moveCard(preferences.order, card, target)); } }}><div className="fh-scope fh-app fh-connected" data-view={view} data-notes-enabled={isModuleEnabled('notes')}><header className="fh-header"><a className="fh-brand" href="/"><span className="fh-brand-icon"><House size={23} /></span><span>family<span className="fh-brand-hub">hub</span><small>A LITTLE MORE TOGETHER</small></span></a><div className="fh-header-actions">{canWrite && <><MagicInputButton google={{ timeZone: data?.timeZone ?? timeZone }} onSaved={() => void load()} /><button className="fh-icon-button" aria-label="Google connection settings" onClick={() => void settings()}><Settings2 size={19} /></button><button className="fh-icon-button" aria-label="Use as protected display" onClick={() => setPanel('display')}><Monitor size={19} /></button></>}<button className="fh-icon-button" aria-label="Refresh dashboard" onClick={() => { setError(''); void load(); }}><RefreshCw size={19} /></button><button className="fh-icon-button" aria-label="Sign out" onClick={logout}><LogOut size={19} /></button></div></header><FamilyHubNav /><main className="fh-main">{preferences.error && <p className="fh-callout" role="alert">{preferences.error}</p>}{!readOnly && view === 'overview' && <button className="fh-button fh-secondary fh-arrange-trigger" onClick={() => setArranging(true)}>Arrange cards</button>}<div className="fh-greeting"><div><p className="fh-eyebrow">{today}</p><h1>{view === 'overview' ? <>Your day, <em>a little lighter.</em></> : view === 'calendar' ? <>Your family <em>calendar.</em></> : view === 'tasks' ? <>The little <em>to-dos.</em></> : view === 'daycare' ? <>Little moments, <em>big days.</em></> : <>After <em>the bell.</em></>}</h1><p className="fh-greeting-copy">{readOnly ? 'Protected family display · editing is disabled by the server.' : `Welcome home, ${user?.name ?? 'everyone'}.`}</p></div>{canWrite && <button className="fh-button fh-primary" onClick={() => void settings()}><Settings2 size={16} />{data?.connected ? 'Manage connection' : 'Connect Google'}</button>}</div>{error && !panel && <div className="fh-callout" role="alert"><WifiOff size={18} /><p>{error} Changes may have reached Google if a request timed out; refresh before retrying.</p></div>}{!data ? <div className="fh-state-panel" role="status">Loading your family dashboard…</div> : <DashboardGrid>
    <Card icon={CalendarDays} label={view === 'calendar' ? 'Google Calendar · full calendar' : 'Google Calendar · next seven days'} title="A little room for everything" className="fh-calendar">{view === 'calendar' ? <FullCalendar timeZone={data.timeZone} connected={data.connected} onSelect={setEventDetail} refreshKey={data} /> : <><div className="fh-event-list">{data.events.map((event) => <button className="fh-event" style={{ borderLeft: `6px solid ${event.color ?? '#547b4d'}` }} key={event.id} onClick={() => setEventDetail(event)}><div className="fh-event-copy"><h3>{event.title}</h3><p>{eventWhen(event)}</p>{event.location && <p>{event.location}</p>}</div><ArrowRight size={17} /></button>)}</div>{!data.events.length && <div className="fh-empty"><p>{data.sources.calendar.state === 'fresh' ? 'A little breathing room. Nothing coming up.' : data.sources.calendar.message}</p></div>}</>}{canWrite && <button className="fh-add-row" disabled={!data.connected} onClick={() => openEvent()}><Plus size={17} />Add an event to Google Calendar</button>}{view !== 'calendar' && <><a className="fh-text-button" href="/calendar">Open full calendar</a><Freshness source={data.sources.calendar} /></>}<CalendarLegend events={data.events} labels={preferences.legend} editable={canWrite} saving={preferences.saving} error={preferences.error} onSave={(legend) => preferences.save('legend', legend)} /></Card>
    <Card icon={CheckCheck} label="Google Tasks" title="The little to-dos" className="fh-tasks"><div className="fh-task-summary"><div><strong>{data.tasks.filter((task) => !task.completed).length}</strong><span>things on our list</span></div></div><div className="fh-task-list">{data.tasks.filter((task) => !task.completed).map((task) => <div className="fh-task-row" key={task.id}><button className="fh-check" role="checkbox" aria-checked={false} aria-label={`Complete ${task.title}`} disabled={!canWrite || busy} onClick={() => void action(() => api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`, { completed: true }), false)} /><div className="fh-task-copy"><button className="fh-task-name" disabled={!canWrite} onClick={() => openTask(task)}>{task.title}</button><span className="fh-due">{task.dueDate ?? 'No due date'}</span></div>{canWrite && <button className="fh-icon-button" aria-label={`Delete ${task.title}`} disabled={busy} onClick={() => void action(() => api.delete(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`), false)}><Trash2 size={15} /></button>}</div>)}</div>{!data.tasks.length && <div className="fh-empty"><p>{data.sources.tasks.state === 'fresh' ? 'Your shared list is clear.' : data.sources.tasks.message}</p></div>}{canWrite && <button className="fh-add-row" disabled={!data.connected} onClick={() => openTask()}><Plus size={17} />Add a Google task</button>}<details className="fh-completed"><summary>Completed ({data.tasks.filter((task) => task.completed).length})</summary>{data.tasks.filter((task) => task.completed).map((task) => <div className="fh-task-row is-completed" key={task.id}><span className="fh-task-name">{task.title}</span>{canWrite && <button className="fh-text-button" disabled={busy} onClick={() => void action(() => api.patch(`/api/familyhub/google/tasks/${encodeURIComponent(task.id)}`, { completed: false }), false)}>Reopen</button>}</div>)}</details><Freshness source={data.sources.tasks} /></Card>
    <Card icon={StickyNote} label="On our fridge · stored locally" title="Notes from home" className="fh-notes"><div className="fh-notes-list">{data.notes.slice(0, 3).map((note) => <article className={`fh-note fh-note-${note.color === 'pink' ? 'rose' : note.color === 'green' ? 'sage' : 'butter'}`} key={note.id}><p style={{ whiteSpace: 'pre-wrap' }}>{note.content}</p><footer>{note.author_name}{note.pinned && <span> · Pinned</span>}</footer></article>)}</div>{!data.notes.length && <div className="fh-empty"><p>A fresh space for a reminder or a kind word.</p></div>}{canWrite && <button className="fh-note-add" onClick={() => { setNoteContent(''); setPanel('note'); }}><Pencil size={15} />Leave a note</button>}<a className="fh-text-button" href="/notes">{readOnly ? 'Read all notes' : 'Manage all notes'}</a></Card>
    <Card icon={Flower2} label="From no-reply@himama.com" title="Little moments, big days" className="fh-daycare">{view === 'daycare' ? <DaycareTimeline updates={data.daycare} /> : <DaycareSummary updates={data.daycare} emptyMessage={data.sources.daycare.state === 'fresh' ? 'No daycare emails in the last 30 days.' : data.sources.daycare.message} onOpen={() => setPanel('daycare')} />}<Freshness source={data.sources.daycare} /></Card>
    <Card icon={GraduationCap} label="Future connection" title="After the bell" className="fh-classroom"><div className="fh-empty"><GraduationCap size={30} /><h3>Room to learn.</h3><p>Google Classroom is a future integration. School permissions will be checked before connecting.</p></div><div className="fh-card-footer">No school account connected</div></Card></DashboardGrid>}<footer className="fh-page-footer"><span>A little more together.</span>{canWrite && <a href="/settings">OpenFamily & AI settings</a>}<span>{familyHubVersionLabel} · Built on OpenFamily</span></footer></main>
    <HubDialog open={Boolean(panel || eventDetail)} onClose={() => { setPanel(null); setEventDetail(null); setError(''); }} title={eventDetail?.title ?? titleForPanel} description={panel === 'google' ? 'Calendar, Tasks and Gmail use the same verified family account.' : panel === 'daycare' ? 'Up to 100 daycare emails from the last 30 days; attachments and photos are ignored.' : 'Changes are saved to the selected source.'}>{error && <div className="fh-callout" role="alert"><p>{error}</p></div>}
    {panel === 'note' ? <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void action(() => api.post('/api/notes', { content: noteContent.trim(), color: noteColor })); }}><label>Message<textarea autoFocus required maxLength={500} rows={4} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} /></label><label>Colour<select value={noteColor} onChange={(e) => setNoteColor(e.target.value)}><option value="yellow">Butter</option><option value="pink">Rose</option><option value="green">Sage</option></select></label><button className="fh-button fh-primary" disabled={busy || !canWrite || !noteContent.trim()}>Save note</button></form> : eventDetail ? <EventDetail event={eventDetail} when={eventWhen(eventDetail)} legend={preferences.legend} canWrite={canWrite && Boolean(data?.connected)} onEdit={() => openEvent(eventDetail)} />
    : panel === 'event' ? <EventForm key={editingEvent?.id ?? 'new'} event={editingEvent} timeZone={timeZone} legend={preferences.legend} busy={busy} canWrite={canWrite} run={(task) => action(task)} />
    : panel === 'task' ? <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void saveTask(); }}><label>What needs doing?<input required autoFocus maxLength={1024} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label><p className="fh-fine-print">Saved directly to Google Tasks. The API supports dates, not precise reminder times.</p><button className="fh-button fh-primary" disabled={busy || !canWrite}>Save to Google Tasks</button></form>
    : panel === 'daycare' ? <DaycareTimeline updates={data?.daycare ?? []} />
    : panel === 'display' ? <div className="fh-form"><p>This replaces the editing session in this browser with server-enforced read-only access. Sign in again to return to editing.</p><button className="fh-button fh-primary" disabled={busy} onClick={() => void action(async () => { const response = await api.post<{ data: { token: string } }>('/api/familyhub/display-session', {}); api.setToken(response.data.token); localStorage.removeItem('user'); window.location.reload(); })}>Start protected display</button></div>
    : panel === 'google' ? <div className="fh-form">{!status ? <p>Loading Google configuration…</p> : <><div className="fh-callout"><p>{status.connected ? `Connected to ${status.email}.` : status.configured ? 'The server is ready. Authorize the dedicated family Google account to continue.' : 'Google Cloud setup is needed. Configure the server using docs/familyhub/GOOGLE_SETUP.md, then restart it.'}</p></div>{!status.configured && status.missingConfiguration?.length ? <p className="fh-fine-print">Missing server settings: {status.missingConfiguration.join(', ')}</p> : null}<label className="fh-toggle-row"><span>Also authorize daycare email reading</span><input type="checkbox" checked={includeGmail || status.gmail} disabled={status.gmail} onChange={(e) => setIncludeGmail(e.target.checked)} /></label><p className="fh-fine-print">Gmail permission allows mailbox reading; Family Hub processes only messages from no-reply@himama.com. Email contents are not sent to AI.</p><button className="fh-button fh-primary" disabled={busy || !status.configured} onClick={() => void connect()}>{status.connected ? 'Reconnect / grant Gmail access' : 'Connect family Google account'}<ArrowRight size={15} /></button>{sources && <form className="fh-form" onSubmit={(e) => { e.preventDefault(); void action(() => api.put('/api/familyhub/google/sources', { calendarId, taskListId, timeZone })); }}><label>Shared Google Calendar<select required value={calendarId} onChange={(e) => setCalendarId(e.target.value)}><option value="">Choose an editable calendar</option>{sources.calendars.filter((calendar) => ['owner', 'writer'].includes(calendar.accessRole)).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label><label>Google Tasks list<select required value={taskListId} onChange={(e) => setTaskListId(e.target.value)}><option value="">Choose a task list</option>{sources.taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><label>Household timezone<input required value={timeZone} onChange={(e) => setTimeZone(e.target.value)} /></label><button className="fh-button fh-primary" disabled={busy}>Use these sources<Check size={16} /></button></form>}{status.connected && <button className="fh-button fh-secondary" disabled={busy} onClick={() => void action(async () => { await api.delete('/api/familyhub/google/connection'); setStatus({ ...status, connected: false }); setSources(null); }, false)}>Disconnect Google and clear cached data</button>}</>}</div> : null}</HubDialog>{arranging && <ArrangeCards order={preferences.order} saving={preferences.saving} error={preferences.error} onSave={async (order) => { if (await preferences.save('order', order)) setArranging(false); }} onClose={() => setArranging(false)} />}</div></CardLayout.Provider>;
}
