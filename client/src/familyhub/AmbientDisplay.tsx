import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, ArrowUpRight, Baby, CalendarDays, Check, CheckCheck, Image as ImageIcon, Newspaper, CloudSun, LogOut, MapPin, Moon, Plane, RefreshCw, Settings2, Sun, TrendingUp, Wifi, X,
} from 'lucide-react';
import { dateFormat, weatherGlyph, weatherLabel } from './ambientFormat';
import {
    CountdownCard, CountdownDetails, Formula1Details, MarketsCard, MarketsDetails, PhotoSlideshow, PhotosCard, QuickPills, SetupCard, WeatherDetails, WifiCard, WifiDetails,
    ScreenSaver, extraPill, type Extras, type QuickPanel,
} from './AmbientExtras';
import { displayLayout, gridPlaces } from './ambientLayout';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import './ambient.css';
import { familyHubVersionLabel } from './version';

type EventTime = { date?: string; dateTime?: string };
type EventItem = { id?: string; title?: string; location?: string; start?: EventTime; end?: EventTime; allDay?: boolean; color?: string; colorLabel?: string };

/** Google Calendar's colour for an event, as a small box (like the F1 team colours). */
function EventSwatch({ event }: { event: EventItem }) {
    if (!event.color || !/^#[0-9a-f]{6}$/i.test(event.color)) return null;
    return <i className="ambient-event-swatch" style={{ background: event.color }} title={event.colorLabel} aria-label={event.colorLabel ? `Colour: ${event.colorLabel}` : undefined} role={event.colorLabel ? 'img' : undefined} aria-hidden={event.colorLabel ? undefined : true} />;
}
type GoogleTask = { id?: string; title?: string; completed?: boolean; dueDate?: string | null };
type Chore = { id: string; title: string; dueDate: string; completed: boolean; points: number; members: { id: string; name: string; color?: string }[] };
type Notification = { id: string; title: string; summary: string; details?: string; receivedAt: string; kind: string };
type NightDimming = { enabled: boolean; start: string; end: string; brightness: number; mode?: 'dim' | 'off' };
type NewsItem = { id: string; title: string; snippet: string; source: string; publishedAt: string | null };
type NewsArticle = { id: string; title: string; byline: string | null; source: string; publishedAt: string | null; blocks: { kind: 'p' | 'h' | 'li' | 'quote'; text: string }[]; complete: boolean };
type AmbientData = {
    generatedAt: string; timeZone: string; today: string;
    settings: { location: { city: string; country: string } | null; widgets: string[]; night?: NightDimming; layout?: { cards: string[]; pills: string[] }; screensaver?: { enabled: boolean; idleMinutes: number } };
    events: EventItem[]; tasks: GoogleTask[]; chores: Chore[]; notifications: Notification[];
    weather: { data: null | { temperature: number; weatherCode: number; high: number; low: number; fetchedAt: string; unit?: 'celsius' | 'fahrenheit'; tomorrow?: { weatherCode: number; high: number; low: number } }; state: string; place: string | null };
    news?: { items: NewsItem[]; state: string; label?: string };
    formula1: { data: null | { name: string; circuit: string; location: string; country: string; raceDateTime: string; sessions: { name: string; dateTime: string }[] }; state: string };
    sources: Record<string, { state?: string; message?: string; lastSuccess?: string }>;
    lastSuccessfulRefresh: string | null;
    /** v1.2 quick bar and detail panels; absent from older servers. */
    extras?: Extras;
};

const formatTime = (value: string, zone: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(date) : '';
};
const formatDay = (value: string, zone: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(date) : '';
};
const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const minutesInZone = (date: Date, zone: string) => {
    const parts = dateFormat('en', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
};
/** True while the household clock is inside the dimming window; a window may span midnight. */
export const isNightTime = (night: NightDimming | undefined, date: Date, zone: string) => {
    if (!night?.enabled) return false;
    const now = minutesInZone(date, zone), start = clockMinutes(night.start), end = clockMinutes(night.end);
    return start < end ? now >= start && now < end : now >= start || now < end;
};
const zoneDay = (date: Date, zone: string) => dateFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const eventDay = (event: EventItem, zone: string) => event.start?.date ?? (event.start?.dateTime ? zoneDay(new Date(event.start.dateTime), zone) : '');
const dayHeading = (key: string, today: string) => {
    if (key === today) return 'Today';
    const date = new Date(`${key}T12:00:00Z`);
    const tomorrow = zoneDay(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000), 'UTC');
    if (key === tomorrow) return 'Tomorrow';
    return dateFormat(undefined, { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(date);
};
const eventTimeRange = (event: EventItem, zone: string) => {
    if (!event.start?.dateTime) return 'All day';
    const start = formatTime(event.start.dateTime, zone);
    return event.end?.dateTime ? `${start} – ${formatTime(event.end.dateTime, zone)}` : start;
};
/**
 * Logo images supplied by the household (see docs/familyhub/AMBIENT_DISPLAY.md):
 * tries each source in turn and falls back to `fallback` when none loads.
 */
function BrandImage({ sources, alt, className, fallback, onShown }: { sources: string[]; alt: string; className?: string; fallback: React.ReactNode; onShown?: (source: string | null) => void }) {
    const [index, setIndex] = useState(0);
    useEffect(() => { if (index >= sources.length) onShown?.(null); }, [index, sources.length, onShown]);
    if (index >= sources.length) return <>{fallback}</>;
    return <img key={sources[index]} src={sources[index]} alt={alt} className={className} decoding="async" referrerPolicy="no-referrer"
        onLoad={() => onShown?.(sources[index])} onError={() => setIndex(index + 1)} />;
}
const WIKIMEDIA_SHIELD = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Scuderia_Ferrari_%284484419145%29.jpg/120px-Scuderia_Ferrari_%284484419145%29.jpg';
const BRAND = '/assets/familyhub-brand';
const UP_NEXT_COUNT = 3;
const TASKS_ON_CARD = 4;
const NOTICES_ON_CARD = 3;
function MoreLine({ text }: { text: string }) {
    return <div className="ambient-more-line"><span>{text}</span><span>Details ›</span></div>;
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const HEADLINES_ON_CARD = 3;
const relativeTime = (value: string | null, now: Date) => {
    const at = value ? Date.parse(value) : NaN;
    if (!Number.isFinite(at)) return '';
    const minutes = Math.max(0, Math.round((now.getTime() - at) / 60_000));
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};
const RENEW_EVERY_MS = 6 * 60 * 60_000;
const WAKE_FOR_MS = 2 * 60_000;
const greeting = (hour: number) => hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
/**
 * The panel's frame and title paint first; its contents follow on the next
 * frame, so a tap shows a response at once even when the contents are heavy.
 */
function DetailSheet({ title, kicker, wide, onClose, children }: { title: string; kicker?: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let timer = 0;
        const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setReady(true), 0); });
        return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
    }, []);
    return <div className="ambient-detail-backdrop" role="presentation" onClick={onClose}><section role="dialog" aria-modal="true" aria-label={title} className={`ambient-detail${wide ? ' is-wide' : ''}`} onClick={(event) => event.stopPropagation()}><header><div>{kicker && <small className="ambient-detail-kicker">{kicker}</small>}<h2>{title}</h2></div><button className="ambient-icon-button" onClick={onClose} aria-label="Close details"><X /></button></header>{ready ? <div>{children}</div> : <div className="ambient-detail-placeholder" />}</section></div>;
}

/**
 * Light or dark, chosen on the frame itself and remembered by this browser only
 * (a display session cannot write settings). Dark is the default.
 */
type AmbientTheme = 'dark' | 'light';
const THEME_KEY = 'familyhub.ambient.theme';
const readTheme = (): AmbientTheme => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const saveTheme = (theme: AmbientTheme) => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* the choice lasts until reload */ } };

const HOLD_TO_EXIT_MS = 2_000;
/**
 * Leaves display mode only after a 2-second press, so a passing tap on a photo
 * frame does nothing. A full page load follows: on a management browser that
 * reaches sign-in; on the LAN listener every page leads back to /display, where
 * an unpaired frame shows its pairing screen.
 */
function HoldToExit({ onExit }: { onExit: () => void }) {
    const timer = useRef<number | null>(null);
    const [holding, setHolding] = useState(false);
    const cancel = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setHolding(false); };
    const start = () => { cancel(); setHolding(true); timer.current = window.setTimeout(() => { timer.current = null; onExit(); }, HOLD_TO_EXIT_MS); };
    useEffect(() => cancel, []);
    return <button type="button" className={`ambient-manage ambient-hold-exit${holding ? ' is-holding' : ''}`} aria-label="Exit display mode: press and hold for two seconds"
        onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) start(); }} onKeyUp={cancel}>
        <LogOut size={16} /><span>{holding ? 'Keep holding…' : 'Hold to exit'}</span><i aria-hidden="true" />
    </button>;
}

export default function AmbientDisplay() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState<AmbientData | null>(null);
    const [now, setNow] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [theme, setTheme] = useState<AmbientTheme>(readTheme);
    const toggleTheme = () => setTheme((current) => { const next = current === 'dark' ? 'light' : 'dark'; saveTheme(next); return next; });
    const [detail, setDetail] = useState<'calendar' | 'tasks' | 'daycare' | 'news' | 'chores' | 'weather' | 'formula1' | QuickPanel | null>(null);
    const [article, setArticle] = useState<{ id: string; data: NewsArticle | null; error: string } | null>(null);
    const openArticle = async (id: string) => {
        setArticle({ id, data: null, error: '' });
        try {
            const response = await api.get<{ success: boolean; data: NewsArticle }>(`/api/familyhub/ambient/article?id=${encodeURIComponent(id)}`);
            setArticle((current) => current?.id === id ? { id, data: response.data, error: '' } : current);
        } catch (cause) {
            setArticle((current) => current?.id === id ? { id, data: null, error: cause instanceof Error ? cause.message : 'The story could not be loaded.' } : current);
        }
    };
    const closeDetail = () => { setDetail(null); setArticle(null); };
    const [awakeUntil, setAwakeUntil] = useState(0);
    const [shieldSource, setShieldSource] = useState<string | null>(null);
    const load = useCallback(async (manual = false) => {
        if (manual) setRefreshing(true);
        try {
            const response = await api.get<{ success: boolean; data: AmbientData }>('/api/familyhub/ambient');
            if (response.success) { setData(response.data); setError(''); }
            else setError('Family information is temporarily unavailable.');
        } catch { setError('Family information is temporarily unavailable. Check the Wi-Fi connection.'); }
        finally { setLoading(false); setRefreshing(false); }
    }, []);

    useEffect(() => {
        document.title = 'FamilyHub · Ambient display';
        void load();
        const refresh = window.setInterval(() => void load(), 60_000);
        const clock = window.setInterval(() => setNow(new Date()), 15_000);
        return () => { window.clearInterval(refresh); window.clearInterval(clock); };
    }, [load]);

    // v1.5.4: the screensaver starts after the frame has been left alone, never
    // during the night window; any touch counts as activity. While the night
    // window is active and the frame has been woken, touches keep it awake.
    const [saver, setSaver] = useState(false);
    const lastActivity = useRef(Date.now());
    const lastNightTap = useRef(0);
    const swallowClicksUntil = useRef(0);
    useEffect(() => {
        const touched = () => {
            lastActivity.current = Date.now();
            setAwakeUntil((until) => until > Date.now() ? Date.now() + WAKE_FOR_MS : until);
        };
        // The touch that wakes the screen (or ends the screensaver) removes the
        // overlay on pointerdown; its click must not then open the card underneath.
        const swallow = (event: MouseEvent) => { if (Date.now() < swallowClicksUntil.current) { event.preventDefault(); event.stopPropagation(); } };
        window.addEventListener('pointerdown', touched, true);
        window.addEventListener('keydown', touched, true);
        window.addEventListener('click', swallow, true);
        return () => { window.removeEventListener('pointerdown', touched, true); window.removeEventListener('keydown', touched, true); window.removeEventListener('click', swallow, true); };
    }, []);
    const saverSettings = data?.settings.screensaver;
    const saverPhotos = data?.extras?.photos;
    const nightNow = isNightTime(data?.settings.night, now, data?.timeZone ?? 'America/New_York');
    useEffect(() => {
        if (!saverSettings?.enabled || !saverPhotos?.ids.length || nightNow) { setSaver(false); return; }
        const idleMs = saverSettings.idleMinutes * 60_000;
        const check = () => {
            if (Date.now() - lastActivity.current >= idleMs) { setSaver(true); setDetail(null); setArticle(null); }
        };
        const timer = window.setInterval(check, 5_000);
        return () => window.clearInterval(timer);
    }, [saverSettings?.enabled, saverSettings?.idleMinutes, saverPhotos?.ids.length, nightNow]);
    const exitSaver = () => { lastActivity.current = Date.now(); setSaver(false); };

    // The protected frame token is intentionally renewable, but remains read-only.
    // Renew on every load as well as periodically: frames reload, sleep and
    // reboot far more often than a 7-day token lasts, and a timer alone restarts
    // from zero on each reload.
    useEffect(() => {
        if (!user?.is_display) return;
        const renew = async () => {
            try {
                const response = await api.post<{ success: boolean; data: { token: string } }>('/api/familyhub/display/refresh', {});
                if (response.success && response.data?.token) api.setToken(response.data.token);
            } catch { /* Auth expiry returns the frame to pairing; no write token is ever substituted. */ }
        };
        void renew();
        const timer = window.setInterval(() => void renew(), RENEW_EVERY_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') void renew(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, [user?.is_display]);

    const zone = data?.timeZone || 'America/New_York';
    const hour = Number(dateFormat('en', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now));
    const weather = data?.weather.data;
    const WeatherIcon = weather ? weatherGlyph(weather.weatherCode, hour >= 6 && hour < 19) : CloudSun;
    const race = data?.formula1.data;
    const upcomingSessions = race?.sessions.filter((session) => Date.parse(session.dateTime) > now.getTime()) ?? [];
    const nextSession = upcomingSessions[0] ?? (race ? { name: 'Race', dateTime: race.raceDateTime } : null);
    const shortSessionName = (name: string) => name.replace('Practice ', 'FP').replace('Sprint qualifying', 'Sprint quali');
    const today = data?.today ?? zoneDay(now, zone);
    const eventsByDay = useMemo(() => {
        const groups = new Map<string, EventItem[]>();
        for (const event of data?.events ?? []) {
            const key = eventDay(event, zone);
            if (!key) continue;
            groups.set(key, [...(groups.get(key) ?? []), event]);
        }
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [data?.events, zone]);
    const events = data?.events ?? [];
    const shownToday = events.slice(0, UP_NEXT_COUNT).filter((event) => eventDay(event, zone) === today).length;
    const moreToday = events.filter((event) => eventDay(event, zone) === today).length - shownToday;
    const moreWeek = Math.max(0, events.length - UP_NEXT_COUNT);
    const calendarMore = moreToday > 0 ? `+${plural(moreToday, 'more event')} today` : moreWeek > 0 ? `${plural(moreWeek, 'more event')} this week` : 'Nothing else this week';
    const headlines = data?.news?.items ?? [];
    const night = data?.settings.night;
    const dimmed = isNightTime(night, now, zone) && now.getTime() > awakeUntil;
    const nightOpacity = night ? Math.min(1, Math.max(0, 1 - night.brightness / 100)) : 0;

    // The grid and quick bar are memoised so opening a detail panel re-renders
    // only the panel: on the frame's slow CPU a full re-render was the lag.
    const layout = useMemo(() => displayLayout(data), [data]);
    const dashboard = useMemo(() => {
        const card: Record<string, (style: React.CSSProperties) => React.ReactNode> = {
            calendar: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-calendar" onClick={() => setDetail('calendar')}><div className="ambient-card-heading"><span className="ambient-card-icon"><CalendarDays /></span><div><small>UP NEXT</small><h2>Family calendar</h2></div><ArrowUpRight /></div><div className="ambient-event-list">{data?.events.length ? data.events.slice(0, UP_NEXT_COUNT).map((event, index) => <div className="ambient-event" key={event.id ?? index}><time>{eventDay(event, zone) !== today && <small>{dayHeading(eventDay(event, zone), today) === 'Tomorrow' ? 'Tomorrow' : formatDay(`${eventDay(event, zone)}T12:00:00Z`, 'UTC').split(',')[0]}</small>}{event.start?.dateTime ? formatTime(event.start.dateTime, zone) : 'All day'}</time><div><strong><EventSwatch event={event} />{event.title || 'Family event'}</strong>{event.location && <span><MapPin size={13} />{event.location}</span>}</div></div>) : <p className="ambient-empty">No upcoming events on the selected calendar.</p>}</div>{data?.events.length ? <MoreLine text={calendarMore} /> : null}</button>,
            weather: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-weather" onClick={() => setDetail('weather')}><div className="ambient-weather-art" aria-hidden="true"><span className="ambient-weather-halo" /><WeatherIcon /></div><div className="ambient-card-heading"><span className="ambient-card-icon ambient-weather-icon"><WeatherIcon /></span><div><small>RIGHT NOW</small><h2>Weather</h2></div><ArrowUpRight /></div>{weather ? <><div className="ambient-temperature">{Math.round(weather.temperature)}<span>{weather.unit === 'fahrenheit' ? '°F' : '°C'}</span></div><p className="ambient-weather-condition">{weatherLabel(weather.weatherCode)}</p>{weather.tomorrow && <p className="ambient-weather-tomorrow">Tomorrow · {weatherLabel(weather.tomorrow.weatherCode)} · {Math.round(weather.tomorrow.high)}° / {Math.round(weather.tomorrow.low)}°</p>}<div className="ambient-weather-bottom"><span>{data?.weather.place}</span><span className="ambient-weather-range"><b>H {Math.round(weather.high)}°</b><i /><b>L {Math.round(weather.low)}°</b></span></div><small className="ambient-attribution">Weather data · Open-Meteo</small></> : <div className="ambient-empty">{data?.weather.state === 'unconfigured' ? 'Choose a location in Display setup.' : 'Weather data will return when the source is available.'}</div>}</button>,
            tasks: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-tasks" onClick={() => setDetail('tasks')}><div className="ambient-card-heading"><span className="ambient-card-icon ambient-task-icon"><CheckCheck /></span><div><small>GOOGLE TASKS</small><h2>To-dos</h2></div><ArrowUpRight /></div>{data?.tasks.length ? <div className="ambient-list">{data.tasks.slice(0, TASKS_ON_CARD).map((task, index) => <div className="ambient-list-row" key={task.id ?? index}><span className="ambient-checkbox" /><span>{task.title}</span>{task.dueDate && <time>{task.dueDate.slice(0, 10) === data.today ? 'Today' : formatDay(task.dueDate, 'UTC')}</time>}</div>)}</div> : <p className="ambient-empty">You're all caught up.</p>}{(data?.tasks.length ?? 0) > TASKS_ON_CARD && <MoreLine text={`+${plural((data?.tasks.length ?? 0) - TASKS_ON_CARD, 'more to-do')}`} />}</button>,
            chores: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-chores" onClick={() => setDetail('chores')}><div className="ambient-card-heading"><span className="ambient-card-icon ambient-chore-icon"><Check /></span><div><small>AT HOME TODAY</small><h2>Chores</h2></div><ArrowUpRight /></div>{data?.chores.length ? <><div className="ambient-progress"><strong>{data.chores.filter((chore) => chore.completed).length}<span> / {data.chores.length}</span></strong><span>done today</span></div><div className="ambient-list">{data.chores.slice(0, 4).map((chore) => <div className="ambient-list-row" key={chore.id}><span className={`ambient-checkbox${chore.completed ? ' is-done' : ''}`}>{chore.completed && <Check size={13} />}</span><span>{chore.title}</span><time>{chore.members.map((member) => member.name).join(', ') || 'Everyone'}</time></div>)}</div></> : <p className="ambient-empty">No assigned chores due today.</p>}</button>,
            news: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-news" onClick={() => setDetail('news')}><div className="ambient-card-heading"><span className="ambient-card-icon ambient-news-icon"><Newspaper /></span><div><small>{(data?.news?.label || 'Headlines').toUpperCase()}</small><h2>News</h2></div><ArrowUpRight /></div>{headlines.length ? <div className="ambient-list">{headlines.slice(0, HEADLINES_ON_CARD).map((item) => <div className="ambient-headline" key={item.id}><strong>{item.title}</strong><time>{relativeTime(item.publishedAt, now)}</time></div>)}</div> : <p className="ambient-empty">{data?.news?.state === 'unavailable' ? 'Headlines are temporarily unavailable.' : data?.news?.state === 'no-feeds' ? 'Choose news feeds in Settings → Display.' : 'Loading headlines…'}</p>}{headlines.length > HEADLINES_ON_CARD && <MoreLine text={`+${plural(headlines.length - HEADLINES_ON_CARD, 'more headline')}`} />}</button>,
            daycare: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-notifications" onClick={() => setDetail('daycare')}><div className="ambient-card-heading"><span className="ambient-card-icon ambient-notification-icon"><Baby /></span><div><small>FAMILY NOTES FROM SCHOOL</small><h2>Daycare updates</h2></div><ArrowUpRight /></div>{data?.notifications.length ? <div className="ambient-list">{data.notifications.slice(0, NOTICES_ON_CARD).map((notice) => <div className="ambient-notice" key={notice.id}><strong>{notice.title}</strong><span>{notice.summary || 'A new update is available.'}</span><time>{formatTime(notice.receivedAt, zone)}</time></div>)}</div> : <p className="ambient-empty">No new daycare updates.</p>}{(data?.notifications.length ?? 0) > NOTICES_ON_CARD && <MoreLine text={`+${plural((data?.notifications.length ?? 0) - NOTICES_ON_CARD, 'more update')}`} />}</button>,
            f1: (style: React.CSSProperties) => <button style={style} className="ambient-card ambient-race" onClick={() => setDetail('formula1')}><div className="ambient-race-art" aria-hidden="true"><span className="ambient-race-glow" /><svg viewBox="0 0 470 180" role="presentation"><path d="M28 133c45-4 74-20 105-31l34-11 40-34 43 3 25 26 47 2 31 18 58 6 28 14-20 9H62z" fill="url(#carBody)"/><path d="m199 89 25-28 42 2 19 28zm-24 3 23-10-4 12zm99 1 27 2-8 10h-17z" fill="#f9e8db"/><path d="M35 138h400M100 150h304" stroke="#ff6c63" strokeWidth="3" strokeLinecap="round" opacity=".68"/><path d="M33 124h82m240 15h90" stroke="#fff" strokeWidth="2" strokeDasharray="12 12" opacity=".3"/><defs><linearGradient id="carBody" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ff766f"/><stop offset=".52" stopColor="#d92c3b"/><stop offset="1" stopColor="#6d1228"/></linearGradient></defs></svg></div><div className="ambient-card-heading"><span className="ambient-card-icon ambient-f1-mark"><BrandImage sources={[`${BRAND}/f1-logo.svg`, `${BRAND}/f1-logo.png`, `${BRAND}/f1-logo.jpg`]} alt="Formula 1" className="ambient-f1-logo" fallback="F1" /></span><div><small>FORMULA 1 · NEXT GRAND PRIX</small><h2>{race?.name ?? 'Race weekend'}</h2></div><ArrowUpRight /></div>{race ? <><p className="ambient-race-place">{race.circuit}{race.location ? ` · ${race.location}` : ''}{race.country ? `, ${race.country}` : ''}</p>{nextSession ? <div className="ambient-next-session"><div><small>NEXT SESSION</small><strong>{nextSession.name}</strong><span>{formatDay(nextSession.dateTime, zone)}</span></div><time>{formatTime(nextSession.dateTime, zone)}</time></div> : <p className="ambient-empty">Session times are not available yet.</p>}<div className="ambient-session-strip" aria-label="Other upcoming sessions">{upcomingSessions.slice(1, 6).map((session) => <span className="ambient-session-pill" key={`${session.name}-${session.dateTime}`}><b>{shortSessionName(session.name)}</b><time>{formatTime(session.dateTime, zone)}</time></span>)}</div><div className="ambient-race-brand"><BrandImage sources={[`${BRAND}/team-shield.png`, `${BRAND}/team-shield.jpg`, WIKIMEDIA_SHIELD]} alt="Scuderia Ferrari shield" fallback={null} onShown={setShieldSource} /><span>SCUDERIA<br /><b>FERRARI</b></span><small>RACE · {formatTime(race.raceDateTime, zone)}</small></div><small className="ambient-attribution">Schedule · Jolpica F1{shieldSource === WIKIMEDIA_SHIELD ? ' · Ferrari shield photo by Damian Morys, CC BY 2.0' : ''}</small></> : <p className="ambient-empty">The next race schedule is temporarily unavailable.</p>}</button>,
            wifi: (style) => data?.extras?.wifi ? <WifiCard wifi={data.extras.wifi} style={style} onOpen={() => setDetail('wifi')} /> : <SetupCard style={style} icon={<Wifi />} title="Guest Wi-Fi" hint="Enter the guest network in Settings → Display → Guest Wi-Fi." />,
            countdown: (style) => data?.extras?.countdown ? <CountdownCard countdown={data.extras.countdown} style={style} onOpen={() => setDetail('countdown')} /> : <SetupCard style={style} icon={<Plane />} title="Countdown" hint="Give the countdown a title and a date in Settings → Display." />,
            markets: (style) => data?.extras?.markets ? <MarketsCard markets={data.extras.markets} style={style} onOpen={() => setDetail('markets')} /> : <SetupCard style={style} icon={<TrendingUp />} title="Stocks & crypto" hint="Choose symbols in Settings → Display → Stocks & crypto." />,
            photos: (style) => data?.extras?.photos ? <PhotosCard photos={data.extras.photos} style={style} onOpen={() => setDetail('photos')} /> : <SetupCard style={style} icon={<ImageIcon />} title="Family photos" hint="Add photos in Settings → Display → Family photos." />,
        };
        const pill: Record<string, () => React.ReactNode> = {
            calendar: () => { const next = data?.events[0]; return <button key="calendar" className="ambient-pill" onClick={() => setDetail('calendar')}><CalendarDays size={16} /><span>{next ? next.title || 'Family event' : 'Calendar'}</span>{next && <small>{eventDay(next, zone) === today ? (next.start?.dateTime ? formatTime(next.start.dateTime, zone) : 'Today') : formatDay(`${eventDay(next, zone)}T12:00:00Z`, 'UTC').split(',')[0]}</small>}</button>; },
            weather: () => <button key="weather" className="ambient-pill" onClick={() => setDetail('weather')}><WeatherIcon size={16} /><span>{weather ? `${Math.round(weather.temperature)}°` : 'Weather'}</span>{weather && <small>H {Math.round(weather.high)}° · L {Math.round(weather.low)}°</small>}</button>,
            tasks: () => <button key="tasks" className="ambient-pill" onClick={() => setDetail('tasks')}><CheckCheck size={16} /><span>To-dos</span><b className="ambient-pill-badge">{data?.tasks.length ?? 0}</b></button>,
            chores: () => <button key="chores" className="ambient-pill" onClick={() => setDetail('chores')}><Check size={16} /><span>Chores</span><small>{data?.chores.filter((chore) => chore.completed).length ?? 0} / {data?.chores.length ?? 0}</small></button>,
            news: () => <button key="news" className="ambient-pill" onClick={() => setDetail('news')}><Newspaper size={16} /><span>{headlines[0]?.title ?? 'News'}</span></button>,
            daycare: () => <button key="daycare" className="ambient-pill" onClick={() => setDetail('daycare')}><Baby size={16} /><span>Daycare</span>{(data?.notifications.length ?? 0) > 0 && <b className="ambient-pill-badge">{data?.notifications.length}</b>}</button>,
            f1: () => <button key="f1" className="ambient-pill" onClick={() => setDetail('formula1')}><span className="ambient-pill-f1">F1</span><span>{nextSession ? shortSessionName(nextSession.name) : race?.name ?? 'Formula 1'}</span>{nextSession && <small>{formatDay(nextSession.dateTime, zone).split(',')[0]} {formatTime(nextSession.dateTime, zone)}</small>}</button>,
        };
        const places = gridPlaces(layout.cards);
        return <>
            <section className={`ambient-grid${places.rows === 1 ? ' is-one-row' : ''}`} aria-label="Family dashboard">
                {layout.cards.map((key, index) => <Fragment key={key}>{card[key]?.({ '--span': places.spans[index], '--row': places.row[index] } as React.CSSProperties)}</Fragment>)}
            </section>
            <QuickPills pills={layout.pills.map((key) => pill[key] ? pill[key]() : extraPill(key as QuickPanel, data?.extras, setDetail))} />
        </>;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, now, layout, shieldSource]);

    return <main className={`ambient-screen${theme === 'light' ? ' is-light' : ''}`}>
        <header className="ambient-header">
            <div className="ambient-identity"><span className="ambient-mark"><CalendarDays size={22} /></span><div><p>FAMILYHUB</p><span>HOME, IN SYNC</span></div></div>
            <div className="ambient-welcome"><span>{greeting(hour)}, {user?.name?.split(/\s+/)[0] ?? 'family'}.</span><small>{dateFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</small></div>
            <div className="ambient-clock" aria-label={dateFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now)}>{dateFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now)}</div>
            <div className="ambient-toolbar">
                <button className="ambient-icon-button" onClick={() => void load(true)} disabled={refreshing} aria-label="Refresh display"><RefreshCw className={refreshing ? 'ambient-spin' : ''} /></button>
                {!user?.is_display && <button className="ambient-icon-button" onClick={() => navigate('/settings#display')} aria-label="Display settings"><Settings2 /></button>}
                <button type="button" className="ambient-manage ambient-theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
                {user?.is_display && <HoldToExit onExit={() => { logout(); window.location.assign('/'); }} />}
            </div>
        </header>


        {loading && !data ? <div className="ambient-loading"><span className="ambient-loader" />Connecting to home…</div> : dashboard}

        <footer className="ambient-footer">
            <span className="ambient-footer-status"><span className="ambient-live-dot" />{user?.is_display ? 'Protected display · read only' : 'Family overview'}<span className="ambient-status-divider" />{data?.lastSuccessfulRefresh ? `Updated ${formatTime(data.lastSuccessfulRefresh, zone)}` : loading ? 'Connecting…' : 'Waiting for first update'}{error && <span className="ambient-offline"> · {error}</span>}</span>
            <span className="ambient-footer-motto">ONE FAMILY · ONE SOURCE OF TRUTH</span>
            <span className="ambient-footer-meta">Automatic refresh every minute <i /> {data?.timeZone ?? 'America/New_York'} <i /> <span className="ambient-version">{familyHubVersionLabel}</span></span>
        </footer>

        {detail === 'calendar' && <DetailSheet title="Next 7 days" onClose={closeDetail}>{eventsByDay.length ? <div className="ambient-detail-days">{eventsByDay.map(([day, events]) => <section key={day}><h3>{dayHeading(day, today)}</h3><div className="ambient-detail-list">{events.map((event, index) => <article key={event.id || `${day}-${index}`}><time>{eventTimeRange(event, zone)}</time><div><strong><EventSwatch event={event} />{event.title || 'Family event'}</strong>{event.colorLabel && <span className="ambient-event-label">{event.colorLabel}</span>}{event.location && <span><MapPin size={13} /> {event.location}</span>}</div></article>)}</div></section>)}</div> : <p>No events on the family calendar in the next 7 days.</p>}</DetailSheet>}
        {detail === 'tasks' && <DetailSheet title="Open to-dos" onClose={closeDetail}>{data?.tasks.length ? <div className="ambient-detail-list">{data.tasks.map((task, index) => <article key={task.id || index}><span className="ambient-checkbox" /><div><strong>{task.title || 'Untitled to-do'}</strong>{task.dueDate && <span>Due {task.dueDate.slice(0, 10) === today ? 'today' : formatDay(task.dueDate, 'UTC')}</span>}</div></article>)}</div> : <p>You're all caught up.</p>}</DetailSheet>}
        {detail === 'daycare' && <DetailSheet title="Daycare updates" onClose={closeDetail}>{data?.notifications.length ? <div className="ambient-detail-list">{data.notifications.map((notice) => <article key={notice.id}><div><strong>{notice.title}</strong><span>{formatDay(notice.receivedAt, zone)} · {formatTime(notice.receivedAt, zone)}</span><p className="ambient-detail-text">{notice.details || notice.summary || 'A new update is available.'}</p></div></article>)}</div> : <p>No new daycare updates.</p>}</DetailSheet>}
        {detail === 'news' && <DetailSheet title={article ? 'Reader view' : 'Headlines'} onClose={closeDetail}>{article
            ? <div className="ambient-reader"><button className="ambient-reader-back" onClick={() => setArticle(null)}><ArrowLeft size={16} />All headlines</button>
                {article.data ? <article><h3>{article.data.title}</h3><p className="ambient-reader-meta">{[article.data.source, article.data.byline, relativeTime(article.data.publishedAt, now)].filter(Boolean).join(' · ')}</p>
                    {article.data.blocks.map((block, index) => block.kind === 'h' ? <h4 key={index}>{block.text}</h4> : block.kind === 'quote' ? <blockquote key={index}>{block.text}</blockquote> : block.kind === 'li' ? <p key={index} className="ambient-reader-li">• {block.text}</p> : <p key={index}>{block.text}</p>)}
                    {!article.data.complete && <p className="ambient-reader-note">The full story could not be shown in reader view.</p>}</article>
                : article.error ? <p className="ambient-reader-note">{article.error}</p> : <p className="ambient-reader-note">Loading the story…</p>}</div>
            : headlines.length ? <div className="ambient-detail-list ambient-news-list">{headlines.map((item) => <article key={item.id} role="button" tabIndex={0} onClick={() => void openArticle(item.id)} onKeyDown={(event) => { if (event.key === 'Enter') void openArticle(item.id); }}><div><strong>{item.title}</strong><span className="ambient-news-snippet">{item.snippet}</span><span>{[item.source, relativeTime(item.publishedAt, now)].filter(Boolean).join(' · ')}</span></div></article>)}</div> : <p>Headlines are temporarily unavailable.</p>}</DetailSheet>}
        {detail === 'chores' && <DetailSheet title="Today's chores" onClose={closeDetail}>{data?.chores.length ? <div className="ambient-detail-list">{data.chores.map((chore) => <article key={chore.id}><span className={`ambient-checkbox${chore.completed ? ' is-done' : ''}`}>{chore.completed && <Check size={13} />}</span><div><strong>{chore.title}</strong><span>{chore.members.map((member) => member.name).join(', ') || 'Everyone'}{chore.points > 0 ? ` · ${chore.points} points` : ''}</span></div></article>)}</div> : <p>Nothing is due today.</p>}{!user?.is_display && <p className="ambient-detail-manage"><a href="/chores">Manage chores</a> — the display shows chores that are due today.</p>}</DetailSheet>}
        {detail === 'weather' && (data?.extras?.weather
            ? <DetailSheet wide kicker={`${data.weather.place ?? 'WEATHER'} · OPEN-METEO`.toUpperCase()} title="Weather & sky" onClose={closeDetail}><WeatherDetails weather={data.extras.weather} place={data.weather.place} /></DetailSheet>
            : <DetailSheet title="Weather details" onClose={closeDetail}>{weather ? <div className="ambient-detail-copy"><p>{data?.weather.place}</p><p>{weatherLabel(weather.weatherCode)} · {Math.round(weather.temperature)}°</p><p>Today’s high {Math.round(weather.high)}° · low {Math.round(weather.low)}°</p><p>Forecast updated {formatTime(weather.fetchedAt, zone)}. Data supplied by Open-Meteo.</p></div> : <p>Choose a location in Display setup to add live weather.</p>}</DetailSheet>)}
        {detail === 'formula1' && <DetailSheet wide kicker="FORMULA 1 · STANDINGS & SCHEDULE" title={race?.name ?? 'Formula 1'} onClose={closeDetail}><Formula1Details standings={data?.extras?.formula1 ?? null} race={race} zone={zone} /></DetailSheet>}
        {detail === 'wifi' && data?.extras?.wifi && <DetailSheet kicker="HOME NETWORK" title="Guest Wi-Fi" wide onClose={closeDetail}><WifiDetails wifi={data.extras.wifi} /></DetailSheet>}
        {detail === 'countdown' && data?.extras?.countdown && <DetailSheet kicker="COUNTDOWN" title={data.extras.countdown.title} wide onClose={closeDetail}><CountdownDetails countdown={data.extras.countdown} serverTime={data.extras.serverTime} zone={zone} /></DetailSheet>}
        {detail === 'markets' && data?.extras?.markets && <DetailSheet kicker="MARKETS" title="Stocks & crypto" wide onClose={closeDetail}><MarketsDetails markets={data.extras.markets} zone={zone} /></DetailSheet>}
        {detail === 'photos' && data?.extras?.photos && <DetailSheet kicker="FAMILY PHOTOS" title="Slideshow" wide onClose={closeDetail}><PhotoSlideshow photos={data.extras.photos} /></DetailSheet>}
        {saver && saverPhotos && !dimmed && <ScreenSaver photos={saverPhotos} zone={zone} onExit={exitSaver} />}
        {dimmed && (() => {
            const off = night?.mode === 'off';
            const wake = () => { lastActivity.current = Date.now(); swallowClicksUntil.current = Date.now() + 700; setAwakeUntil(Date.now() + WAKE_FOR_MS); setNow(new Date()); };
            return <div className={`ambient-night${off ? ' is-off' : ''}`} style={{ opacity: off ? 1 : nightOpacity }} role="button" tabIndex={0}
                aria-label={off ? 'Display off for the night. Double-tap to wake it for two minutes.' : 'Display dimmed for the night. Tap to wake for two minutes.'}
                onPointerDown={(event) => {
                    event.preventDefault();
                    if (!off) { wake(); return; }
                    // Off: a double tap (two taps within half a second) wakes it.
                    const at = Date.now();
                    if (at - lastNightTap.current < 500) { lastNightTap.current = 0; wake(); } else lastNightTap.current = at;
                }}
                onClick={(event) => event.preventDefault()}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') wake(); }} />;
        })()}
    </main>;
}
