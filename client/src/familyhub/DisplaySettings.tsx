import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, MapPin, Monitor, Moon, Search, ShieldCheck, Tablet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { FamilyHubNav } from './FamilyHubNav';
import './familyhub.css';
import './ambient.css';

type Location = { id: number; city: string; region: string; country: string; latitude: number; longitude: number };
type NightDimming = { enabled: boolean; start: string; end: string; brightness: number };
type Settings = { location: { city: string; country: string; latitude: number; longitude: number } | null; widgets: string[]; night: NightDimming };
type PairedDisplay = { id: string; name: string; createdAt: string; lastSeenAt: string };
const DEFAULT_NIGHT: NightDimming = { enabled: false, start: '22:00', end: '07:00', brightness: 15 };
const formatWhen = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : '—';
};
const WIDGETS = [
    ['calendar', 'Family calendar', 'Next appointments from the connected Google Calendar.'],
    ['weather', 'Weather', 'Live conditions for a city you choose.'],
    ['tasks', 'To-dos', 'Outstanding items from the selected Google Tasks list.'],
    ['chores', 'Chores', 'Chores due today. Add and assign them under Chores.'],
    ['news', 'News', 'Top world and technology headlines from BBC News; tap a story for a reader view.'],
    ['daycare', 'Daycare updates', 'Short summaries of recent Lillio emails.'],
    ['f1', 'Formula 1', 'Upcoming sessions converted to your household time zone.'],
] as const;

export default function DisplaySettings() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [settings, setSettings] = useState<Settings>({ location: null, widgets: WIDGETS.map(([key]) => key).filter((key) => key !== 'news'), night: DEFAULT_NIGHT });
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<Location[]>([]);
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [pairingName, setPairingName] = useState('Photo frame');
    const [pairingExpires, setPairingExpires] = useState(0);
    const [pairingError, setPairingError] = useState('');
    const [displays, setDisplays] = useState<PairedDisplay[]>([]);
    const [displaysError, setDisplaysError] = useState('');

    useEffect(() => {
        document.title = 'FamilyHub · Display setup';
        api.get<{ success: boolean; data: Settings }>('/api/familyhub/ambient/settings')
            .then((response) => { setSettings({ ...response.data, night: response.data.night ?? DEFAULT_NIGHT }); setError(''); })
            .catch(() => setError('Display settings could not be loaded.'))
            .finally(() => setLoading(false));
    }, []);

    const searchCity = async (event: FormEvent) => {
        event.preventDefault();
        if (search.trim().length < 2) return;
        setSearching(true); setError(''); setResults([]);
        try {
            const response = await api.get<{ success: boolean; data: Location[] }>(`/api/familyhub/ambient/locations?q=${encodeURIComponent(search.trim())}`);
            setResults(response.data);
            if (!response.data.length) setError('No matching locations. Try a nearby city or include the region.');
        } catch { setError('Location search is unavailable right now.'); }
        finally { setSearching(false); }
    };

    const save = async () => {
        setSaving(true); setSaved(false); setError('');
        try {
            const response = await api.put<{ success: boolean; data: Settings }>('/api/familyhub/ambient/settings', settings);
            setSettings({ ...response.data, night: response.data.night ?? DEFAULT_NIGHT }); setSaved(true);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved.'); }
        finally { setSaving(false); }
    };

    const activateDisplay = async () => {
        if (!window.confirm('Start protected read-only display mode in this browser? You will need to sign in again to return to management.')) return;
        setSaving(true);
        try {
            const response = await api.post<{ success: boolean; data: { token: string } }>('/api/familyhub/ambient/display-session', {});
            api.setToken(response.data.token);
            localStorage.removeItem('user');
            window.location.assign('/display');
        } catch { setError('Protected display access could not be started.'); setSaving(false); }
    };

    const isParent = Boolean(user?.is_owner || user?.role === 'parent');
    const loadDisplays = useCallback(async () => {
        try {
            const response = await api.get<{ success: boolean; data: PairedDisplay[] }>('/api/familyhub/display/sessions');
            setDisplays(response.data); setDisplaysError('');
        } catch { setDisplaysError('Paired displays could not be loaded.'); }
    }, []);
    useEffect(() => { if (isParent) void loadDisplays(); }, [isParent, loadDisplays]);
    // While a code is showing, watch for the frame to appear, then clear the code.
    useEffect(() => {
        if (!pairingCode) return;
        const timer = window.setInterval(() => {
            if (Date.now() > pairingExpires) { setPairingCode(''); return; }
            void loadDisplays();
        }, 5_000);
        return () => window.clearInterval(timer);
    }, [pairingCode, pairingExpires, loadDisplays]);
    const createPairingCode = async () => {
        setPairingError('');
        try {
            const result = await api.post<{ success: boolean; data: { code: string; expiresInSeconds: number } }>('/api/familyhub/display/pairing-code', { name: pairingName });
            setPairingCode(result.data.code);
            setPairingExpires(Date.now() + result.data.expiresInSeconds * 1000);
        } catch { setPairingError('A frame pairing code could not be created.'); }
    };
    const revokeDisplay = async (display: PairedDisplay) => {
        if (!window.confirm(`Remove “${display.name}”? It will return to its pairing screen and need a new code.`)) return;
        try { await api.delete(`/api/familyhub/display/sessions/${display.id}`); await loadDisplays(); }
        catch { setDisplaysError('That display could not be removed.'); }
    };
    const night = settings.night;
    const setNight = (patch: Partial<NightDimming>) => { setSaved(false); setSettings({ ...settings, night: { ...night, ...patch } }); };
    return <div className="fh-scope fh-app ambient-settings-app">
        <header className="fh-header"><a href="/" className="fh-brand"><span className="fh-brand-icon"><Monitor size={22} /></span><span>family<span className="fh-brand-hub">hub</span><small>AMBIENT DISPLAY</small></span></a><button className="fh-button fh-secondary" onClick={() => navigate('/display')}><Monitor size={17} />Preview display</button></header>
        <FamilyHubNav />
        <main className="fh-main ambient-settings-main">
            <button className="fh-text-button" onClick={() => navigate('/')}><ArrowLeft size={16} />Back to Home</button>
            <div className="fh-greeting"><div><p className="fh-eyebrow">One display, same family data</p><h1>Make it <em>yours.</em></h1><p className="fh-greeting-copy">Choose what the photo frame shows and set its live weather location.</p></div></div>
            {error && <p className="fh-callout" role="alert">{error}</p>}
            {loading ? <p role="status">Loading display settings…</p> : <>
                <section className="fh-card ambient-settings-card"><div className="fh-card-heading"><span className="fh-card-icon fh-tint-blue"><MapPin size={20} /></span><div><p className="fh-eyebrow">LOCAL FORECAST</p><h2>Weather location</h2></div></div>
                    {settings.location ? <div className="ambient-selected-location"><div><strong>{settings.location.city}, {settings.location.country}</strong><span>Weather is requested for this city only. Coordinates are stored with your FamilyHub household settings.</span></div><button className="fh-button fh-secondary" onClick={() => setSettings({ ...settings, location: null })}>Change</button></div> : <p className="ambient-settings-help">Search for a city. Weather uses current conditions and today’s high and low from Open-Meteo. No weather API key is needed.</p>}
                    <form className="ambient-search" onSubmit={(event) => void searchCity(event)}><label htmlFor="ambient-location">City or town</label><div><input id="ambient-location" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. Springfield" maxLength={80} /><button className="fh-button fh-primary" disabled={searching || search.trim().length < 2}><Search size={16} />{searching ? 'Searching…' : 'Search'}</button></div></form>
                    {results.length > 0 && <div className="ambient-location-results" aria-label="Location results">{results.map((location) => <button key={location.id} onClick={() => { setSettings({ ...settings, location: { city: location.city, country: location.country, latitude: location.latitude, longitude: location.longitude } }); setResults([]); setSearch(''); }}><MapPin size={17} /><span><strong>{location.city}</strong><small>{[location.region, location.country].filter(Boolean).join(', ')}</small></span></button>)}</div>}
                    <small className="ambient-attribution-settings">Weather service: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>. Attribution shown on the display.</small>
                </section>
                <section className="fh-card ambient-settings-card"><div className="fh-card-heading"><span className="fh-card-icon fh-tint-sage"><Check size={20} /></span><div><p className="fh-eyebrow">AMBIENT WIDGETS</p><h2>Display cards</h2></div></div><div className="ambient-widget-choices">{WIDGETS.map(([key, title, description]) => { const checked = settings.widgets.includes(key); return <label key={key}><input type="checkbox" checked={checked} onChange={() => setSettings({ ...settings, widgets: checked ? settings.widgets.filter((widget) => widget !== key) : [...settings.widgets, key] })} /><span><strong>{title}</strong><small>{description}</small></span></label>; })}</div><p className="ambient-settings-help">The bottom row shares its width between To-dos, Chores, News and Daycare, so it fits best with three of them.</p></section>
                <section className="fh-card ambient-settings-card"><div className="fh-card-heading"><span className="fh-card-icon fh-tint-blue"><Moon size={20} /></span><div><p className="fh-eyebrow">NIGHT MODE</p><h2>Dim the display at night</h2></div></div>
                    <label className="ambient-night-toggle"><input type="checkbox" checked={night.enabled} onChange={(event) => setNight({ enabled: event.target.checked })} /><span><strong>Dim on a schedule</strong><small>Uses the household time zone. A tap on the frame wakes it for two minutes.</small></span></label>
                    <div className="ambient-night-fields" aria-disabled={!night.enabled}>
                        <label>Dim from<input type="time" value={night.start} disabled={!night.enabled} onChange={(event) => setNight({ start: event.target.value })} /></label>
                        <label>Until<input type="time" value={night.end} disabled={!night.enabled} onChange={(event) => setNight({ end: event.target.value })} /></label>
                        <label>Night brightness <strong>{night.brightness === 0 ? 'Screen black' : `${night.brightness}%`}</strong><input type="range" min={0} max={80} step={5} value={night.brightness} disabled={!night.enabled} onChange={(event) => setNight({ brightness: Number(event.target.value) })} /></label>
                    </div>
                    <p className="ambient-settings-help">Dimming darkens the dashboard itself. The frame’s backlight level is set separately in the frame’s own settings.</p>
                </section>
                <div className="ambient-settings-actions"><button className="fh-button fh-primary" onClick={() => void save()} disabled={saving || !settings.widgets.length}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save display settings'}</button>{isParent && <button className="fh-button fh-secondary" onClick={() => void activateDisplay()} disabled={saving}><ShieldCheck size={17} />Start protected display on this device</button>}</div>
                {isParent && <section className="fh-card ambient-settings-card"><div className="fh-card-heading"><span className="fh-card-icon fh-tint-sage"><Tablet size={20} /></span><div><p className="fh-eyebrow">PHOTO FRAMES</p><h2>Paired displays</h2></div></div>
                    {displaysError && <p role="alert">{displaysError}</p>}
                    {displays.length ? <ul className="ambient-paired-list">{displays.map((display) => <li key={display.id}><div><strong>{display.name}</strong><small>Paired {formatWhen(display.createdAt)} · last seen {formatWhen(display.lastSeenAt)}</small></div><button className="fh-button fh-secondary" onClick={() => void revokeDisplay(display)}>Remove</button></li>)}</ul> : <p className="ambient-settings-help">No displays are paired yet.</p>}
                    <h3 className="ambient-subheading">Pair a frame</h3>
                    <p className="ambient-settings-help">Create a one-time code here, then type it on the frame’s pairing screen. Codes work once and expire after five minutes. A frame never needs a parent password.</p>
                    <div className="ambient-pairing-row"><label>Display name<input value={pairingName} maxLength={40} onChange={(event) => setPairingName(event.target.value)} /></label><button className="fh-button fh-primary" onClick={() => void createPairingCode()} disabled={!pairingName.trim()}>Create pairing code</button></div>
                    {pairingCode && <p className="ambient-pairing-code" aria-live="polite">{pairingCode.slice(0, 4)} {pairingCode.slice(4)}</p>}
                    {pairingError && <p role="alert">{pairingError}</p>}
                </section>}
                <p className="fh-fine-print">Display sessions are read-only and renew automatically while the frame is in use. They can read only the approved FamilyHub display endpoints, and removing a display here signs out that frame alone.</p>
            </>}
            <footer className="fh-page-footer"><a href="/">Management home</a><span>Same backend, same authoritative family data.</span></footer>
        </main>
    </div>;
}
