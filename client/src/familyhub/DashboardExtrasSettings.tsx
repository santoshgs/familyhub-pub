import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CalendarClock, CloudSun, Flag, Image as ImageIcon, Newspaper, Plus, Rss, Trash2, TrendingUp, Upload, SlidersHorizontal, Wifi } from 'lucide-react';
import { api } from '../lib/api';
import { apiBase } from '../lib/serverConfig';
import './dashboardExtras.css';

/**
 * Settings → Display: one collapsible section per dashboard addition (v1.2).
 * The server validates everything; secrets (Wi-Fi password, API keys) are
 * write-only here: the page only learns whether one is saved.
 */

type Settings = {
    weather: { forecastDays: 7 | 14; unit: 'celsius' | 'fahrenheit'; showAqi: boolean; showMoon: boolean };
    formula1: { season: string; pollMinutes: number; showDrivers: boolean; showConstructors: boolean; favoriteTeam: string; favoriteDriver: string };
    wifi: { enabled: boolean; ssid: string; encryption: 'WPA' | 'WEP' | 'nopass'; hidden: boolean };
    countdown: { enabled: boolean; title: string; target: string; checklist: Array<{ text: string; done: boolean }> };
    markets: { enabled: boolean; stocks: string[]; crypto: string[]; currency: 'USD' | 'CAD' | 'INR' };
    photos: { enabled: boolean; intervalSeconds: number };
    news: { feeds: Feed[] };
    secrets: { wifiPassword: boolean; finnhubKey: boolean; coingeckoKey: boolean };
    indexTrackers: Array<{ symbol: string; name: string }>;
};
type Feed = { url: string; name: string };
type Photo = { id: string; width: number; height: number; bytes: number; createdAt: string };
type SecretDraft = { wifiPassword?: string | null; finnhubKey?: string | null; coingeckoKey?: string | null };

const TEAMS = [
    ['', 'No favourite'], ['ferrari', 'Ferrari'], ['mclaren', 'McLaren'], ['red_bull', 'Red Bull Racing'], ['mercedes', 'Mercedes'],
    ['aston_martin', 'Aston Martin'], ['alpine', 'Alpine'], ['williams', 'Williams'], ['rb', 'Racing Bulls'], ['sauber', 'Kick Sauber'],
    ['audi', 'Audi'], ['haas', 'Haas'], ['cadillac', 'Cadillac'],
] as const;
/** Suggestions only: each is checked on the home server before it is added. */
const FEED_SUGGESTIONS: Feed[] = [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    { name: 'CBC Top Stories', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
    { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];
const MAX_FEEDS = 8;
const POLL_CHOICES = [[30, 'Every 30 minutes'], [60, 'Every hour'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Twice a day'], [1440, 'Once a day']] as const;

function Section({ icon, title, summary, children }: { icon: React.ReactNode; title: string; summary: string; children: React.ReactNode }) {
    return <details className="fh-extras-section"><summary><span className="fh-extras-icon">{icon}</span><span><strong>{title}</strong><small>{summary}</small></span></summary><div className="fh-extras-body">{children}</div></details>;
}
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
    return <label className="fh-extras-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span></label>;
}
function SecretField({ label, saved, value, onChange, placeholder, type = 'password' }: { label: string; saved: boolean; value: string | null | undefined; onChange: (value: string | null | undefined) => void; placeholder: string; type?: string }) {
    return <label className="fh-extras-field">{label}
        <span className="fh-extras-secret">
            <input type={type} autoComplete="off" spellCheck={false} value={value ?? ''} placeholder={saved && value !== null ? 'Saved · type to replace' : placeholder}
                onChange={(event) => onChange(event.target.value || undefined)} />
            {saved && value !== null && <button type="button" className="fh-button fh-secondary" onClick={() => onChange(null)}>Remove</button>}
            {value === null && <small>Will be removed when you save.</small>}
        </span></label>;
}

function Thumb({ id }: { id: string }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let created: string | null = null, cancelled = false;
        const token = api.getToken();
        fetch(`${apiBase()}/api/familyhub/photos/${id}/thumb`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
            .then((response) => (response.ok ? response.blob() : Promise.reject()))
            .then((blob) => { if (!cancelled) { created = URL.createObjectURL(blob); setUrl(created); } })
            .catch(() => undefined);
        return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
    }, [id]);
    return url ? <img src={url} alt="" /> : <span className="fh-extras-thumb-empty" />;
}

function PhotoManager() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [max, setMax] = useState(200);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const input = useRef<HTMLInputElement>(null);
    const load = useCallback(async () => {
        try {
            const response = await api.get<{ success: boolean; data: { photos: Photo[]; max: number } }>('/api/familyhub/photos');
            setPhotos(response.data.photos); setMax(response.data.max);
        } catch { setError('Photos could not be loaded.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const upload = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!files.length) return;
        setError('');
        const token = api.getToken();
        let done = 0;
        for (const file of files) {
            setBusy(`Uploading ${done + 1} of ${files.length}…`);
            try {
                const response = await fetch(`${apiBase()}/api/familyhub/photos`, {
                    method: 'POST', body: file,
                    headers: { 'Content-Type': file.type || 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => null) as { error?: string } | null;
                    setError(`${file.name}: ${body?.error ?? 'could not be uploaded.'}`);
                    if (response.status === 409) break;
                }
            } catch { setError(`${file.name}: could not be uploaded. Check the connection.`); }
            done += 1;
        }
        setBusy('');
        await load();
    };
    const remove = async (photo: Photo) => {
        if (!window.confirm('Delete this photo from the slideshow? This cannot be undone.')) return;
        try { await api.delete(`/api/familyhub/photos/${photo.id}`); setPhotos((list) => list.filter((item) => item.id !== photo.id)); }
        catch { setError('That photo could not be deleted.'); }
    };

    return <div className="fh-extras-photos">
        <div className="fh-extras-row">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" multiple hidden onChange={(event) => void upload(event)} />
            <button type="button" className="fh-button fh-primary" onClick={() => input.current?.click()} disabled={Boolean(busy) || photos.length >= max}><Upload size={16} />Add photos</button>
            <span className="ambient-settings-help">{busy || `${photos.length} of ${max} photos. They are resized to the frame (1280 × 800) on the home server; location and camera details are removed.`}</span>
        </div>
        {error && <p className="fh-callout" role="alert">{error}</p>}
        {photos.length ? <ul className="fh-extras-thumbs">{photos.map((photo) => <li key={photo.id}><Thumb id={photo.id} />
            <button type="button" onClick={() => void remove(photo)} aria-label="Delete photo"><Trash2 size={15} /></button></li>)}</ul>
            : <p className="ambient-settings-help">No photos yet. Choose some from your phone or computer.</p>}
    </div>;
}

function NewsFeeds({ feeds, onChange }: { feeds: Feed[]; onChange: (feeds: Feed[]) => void }) {
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [checking, setChecking] = useState('');
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const full = feeds.length >= MAX_FEEDS;
    const add = async (candidate: Feed) => {
        const address = candidate.url.trim();
        if (!address || full) return;
        setChecking(address); setMessage(null);
        try {
            const response = await api.post<{ success: boolean; data: { url: string; title: string; count: number; latest: string[] } }>('/api/familyhub/dashboard/news/preview', { url: address });
            const found = response.data;
            if (feeds.some((feed) => feed.url === found.url)) { setMessage({ ok: false, text: 'That feed is already in the list.' }); return; }
            const label = candidate.name.trim() || found.title || new URL(found.url).hostname;
            onChange([...feeds, { url: found.url, name: label.slice(0, 40) }]);
            setUrl(''); setName('');
            setMessage({ ok: true, text: `Added ${label}: ${found.count} headlines, newest “${found.latest[0] ?? ''}”. Save to use it on the frame.` });
        } catch (cause) { setMessage({ ok: false, text: cause instanceof Error ? cause.message : 'That feed could not be checked.' }); }
        finally { setChecking(''); }
    };
    const suggestions = FEED_SUGGESTIONS.filter((suggestion) => !feeds.some((feed) => feed.url === suggestion.url));
    return <>
        <p className="ambient-settings-help">Headlines from these RSS or Atom feeds are merged, newest first, on the News card. The home server fetches them every 15 minutes; the frame never contacts the news sites. Place the News card or pill under Display layout above.</p>
        {feeds.length ? <ul className="fh-extras-feeds">{feeds.map((feed, index) => <li key={feed.url}>
            <Rss size={15} aria-hidden="true" />
            <span><input value={feed.name} maxLength={40} aria-label="Feed name shown on the frame" onChange={(event) => onChange(feeds.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))} /><small>{feed.url}</small></span>
            <button type="button" aria-label={`Remove ${feed.name}`} onClick={() => onChange(feeds.filter((_, i) => i !== index))}><Trash2 size={15} /></button></li>)}</ul>
            : <p className="fh-callout">No feeds chosen: the News card will ask you to add one.</p>}
        <div className="fh-extras-grid fh-extras-feed-add">
            <label className="fh-extras-field">Feed address<input type="url" inputMode="url" value={url} placeholder="https://example.com/rss.xml" onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add({ url, name }); } }} /></label>
            <label className="fh-extras-field">Name on the frame (optional)<input value={name} maxLength={40} placeholder="Uses the feed's own title" onChange={(event) => setName(event.target.value)} /></label>
        </div>
        <div className="fh-extras-row"><button type="button" className="fh-button fh-secondary" disabled={!url.trim() || Boolean(checking) || full} onClick={() => void add({ url, name })}><Plus size={15} />{checking === url.trim() && checking ? 'Checking…' : 'Check and add'}</button>
            <span className="ambient-settings-help">{full ? `At most ${MAX_FEEDS} feeds.` : `${feeds.length} of ${MAX_FEEDS} feeds.`}</span></div>
        {message && <p className={message.ok ? 'fh-extras-ok' : 'fh-callout'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
        {suggestions.length > 0 && !full && <div className="fh-extras-suggestions"><span className="fh-extras-label">Suggestions</span>
            <div>{suggestions.map((suggestion) => <button type="button" key={suggestion.url} className="fh-extras-chip" disabled={Boolean(checking)} onClick={() => void add(suggestion)}><Plus size={13} />{checking === suggestion.url ? 'Checking…' : suggestion.name}</button>)}</div></div>}
    </>;
}

export default function DashboardExtrasSettings() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [secrets, setSecrets] = useState<SecretDraft>({});
    const [newItem, setNewItem] = useState('');
    const [stocksText, setStocksText] = useState('');
    const [cryptoText, setCryptoText] = useState('');
    const [state, setState] = useState<{ saving: boolean; saved: boolean; error: string }>({ saving: false, saved: false, error: '' });

    const accept = (data: Settings) => { setSettings(data); setStocksText(data.markets.stocks.join(', ')); setCryptoText(data.markets.crypto.join(', ')); setSecrets({}); };
    useEffect(() => {
        api.get<{ success: boolean; data: Settings }>('/api/familyhub/dashboard/settings').then((response) => accept(response.data))
            .catch(() => setState((s) => ({ ...s, error: 'Display settings could not be loaded.' })));
    }, []);
    if (!settings) return state.error ? <p className="fh-callout" role="alert">{state.error}</p> : <p role="status">Loading display options…</p>;

    const patch = <K extends keyof Settings>(section: K, value: Partial<Settings[K]>) => {
        setState((s) => ({ ...s, saved: false }));
        setSettings({ ...settings, [section]: { ...(settings[section] as object), ...value } });
    };
    const save = async () => {
        setState({ saving: true, saved: false, error: '' });
        try {
            const { secrets: _flags, indexTrackers: _trackers, ...body } = settings;
            const payload = { ...body, markets: { ...body.markets, stocks: stocksText, crypto: cryptoText }, secrets };
            const response = await api.put<{ success: boolean; data: Settings }>('/api/familyhub/dashboard/settings', payload);
            accept(response.data);
            setState({ saving: false, saved: true, error: '' });
        } catch (cause) {
            setState({ saving: false, saved: false, error: cause instanceof Error ? cause.message : 'Settings could not be saved.' });
        }
    };
    const { weather, formula1, wifi, countdown, markets, photos, news } = settings;

    return <section className="fh-card ambient-settings-card fh-extras" aria-label="Card and panel details">
        <div className="fh-card-heading"><span className="fh-card-icon fh-tint-sage"><SlidersHorizontal size={20} /></span><div><p className="fh-eyebrow">WHAT EACH CARD SHOWS</p><h2>Card and panel details</h2></div></div>
        <p className="ambient-settings-help">What the cards, pills and the panels that open from them show: forecast length, Formula 1 standings, the guest network, the countdown, market symbols, photos and news feeds.</p>

        <Section icon={<CloudSun size={18} />} title="Weather" summary={`${weather.forecastDays}-day forecast · ${weather.unit === 'celsius' ? '°C' : '°F'}`}>
            <div className="fh-extras-grid">
                <label className="fh-extras-field">Forecast length<select value={weather.forecastDays} onChange={(event) => patch('weather', { forecastDays: Number(event.target.value) === 14 ? 14 : 7 })}><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
                <label className="fh-extras-field">Temperature unit<select value={weather.unit} onChange={(event) => patch('weather', { unit: event.target.value === 'fahrenheit' ? 'fahrenheit' : 'celsius' })}><option value="celsius">Celsius (°C)</option><option value="fahrenheit">Fahrenheit (°F)</option></select></label>
            </div>
            <Toggle checked={weather.showAqi} onChange={(value) => patch('weather', { showAqi: value })} label="Show air quality (US AQI)" />
            <Toggle checked={weather.showMoon} onChange={(value) => patch('weather', { showMoon: value })} label="Show the moon phase" />
        </Section>

        <Section icon={<Flag size={18} />} title="Formula 1" summary={`${formula1.season === 'current' ? 'Current season' : formula1.season} · ${formula1.favoriteTeam ? TEAMS.find(([id]) => id === formula1.favoriteTeam)?.[1] ?? formula1.favoriteTeam : 'no favourite'}`}>
            <div className="fh-extras-grid">
                <label className="fh-extras-field">Season<input value={formula1.season} maxLength={7} onChange={(event) => patch('formula1', { season: event.target.value })} placeholder="current" /></label>
                <label className="fh-extras-field">Refresh standings<select value={formula1.pollMinutes} onChange={(event) => patch('formula1', { pollMinutes: Number(event.target.value) })}>{POLL_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="fh-extras-field">Favourite team<select value={formula1.favoriteTeam} onChange={(event) => patch('formula1', { favoriteTeam: event.target.value })}>{TEAMS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                <label className="fh-extras-field">Favourite driver (optional)<input value={formula1.favoriteDriver} maxLength={40} onChange={(event) => patch('formula1', { favoriteDriver: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="driver id, e.g. leclerc" /></label>
            </div>
            <Toggle checked={formula1.showDrivers} onChange={(value) => patch('formula1', { showDrivers: value })} label="Show driver standings" />
            <Toggle checked={formula1.showConstructors} onChange={(value) => patch('formula1', { showConstructors: value })} label="Show constructor standings" />
        </Section>

        <Section icon={<Wifi size={18} />} title="Guest Wi-Fi" summary={wifi.ssid || 'Not set up'}>
            <p className="ambient-settings-help">The frame shows the network name, the password and a QR code that phones can scan to join. Choose where it appears under Display layout above.</p>
            <div className="fh-extras-grid">
                <label className="fh-extras-field">Network name (SSID)<input value={wifi.ssid} maxLength={32} onChange={(event) => patch('wifi', { ssid: event.target.value })} /></label>
                <label className="fh-extras-field">Security<select value={wifi.encryption} onChange={(event) => patch('wifi', { encryption: event.target.value as Settings['wifi']['encryption'] })}><option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">Open (no password)</option></select></label>
            </div>
            {wifi.encryption !== 'nopass' && <SecretField label="Password" type="text" saved={settings.secrets.wifiPassword} value={secrets.wifiPassword} onChange={(value) => setSecrets({ ...secrets, wifiPassword: value })} placeholder="Guest network password" />}
            <Toggle checked={wifi.hidden} onChange={(value) => patch('wifi', { hidden: value })} label="The network is hidden" />
        </Section>

        <Section icon={<CalendarClock size={18} />} title="Countdown" summary={countdown.title || 'Not set up'}>
            <p className="ambient-settings-help">Choose where it appears under Display layout above.</p>
            <div className="fh-extras-grid">
                <label className="fh-extras-field">Event<input value={countdown.title} maxLength={60} placeholder="e.g. Trip to the coast" onChange={(event) => patch('countdown', { title: event.target.value })} /></label>
                <label className="fh-extras-field">Date and time (household time)<input type="datetime-local" value={countdown.target} onChange={(event) => patch('countdown', { target: event.target.value.slice(0, 16) })} /></label>
            </div>
            <p className="fh-extras-label">Checklist</p>
            <ul className="fh-extras-checklist">{countdown.checklist.map((item, index) => <li key={index}>
                <input type="checkbox" checked={item.done} aria-label="Done" onChange={(event) => patch('countdown', { checklist: countdown.checklist.map((entry, i) => (i === index ? { ...entry, done: event.target.checked } : entry)) })} />
                <input value={item.text} maxLength={120} onChange={(event) => patch('countdown', { checklist: countdown.checklist.map((entry, i) => (i === index ? { ...entry, text: event.target.value } : entry)) })} />
                <button type="button" aria-label="Remove item" onClick={() => patch('countdown', { checklist: countdown.checklist.filter((_, i) => i !== index) })}><Trash2 size={15} /></button></li>)}</ul>
            <div className="fh-extras-row"><input value={newItem} maxLength={120} placeholder="Add an item, e.g. Book the airport taxi" onChange={(event) => setNewItem(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && newItem.trim()) { event.preventDefault(); patch('countdown', { checklist: [...countdown.checklist, { text: newItem.trim(), done: false }] }); setNewItem(''); } }} />
                <button type="button" className="fh-button fh-secondary" disabled={!newItem.trim() || countdown.checklist.length >= 20} onClick={() => { patch('countdown', { checklist: [...countdown.checklist, { text: newItem.trim(), done: false }] }); setNewItem(''); }}><Plus size={15} />Add</button></div>
        </Section>

        <Section icon={<TrendingUp size={18} />} title="Stocks & crypto" summary={markets.stocks.length || markets.crypto.length ? markets.currency : 'Not set up'}>
            <p className="ambient-settings-help">Prices update at the market open, mid-day and the close (New York time), not continuously. Choose where they appear under Display layout above.</p>
            <p className="ambient-settings-help">Always shown: {settings.indexTrackers.map((tracker) => `${tracker.name} (${tracker.symbol})`).join(', ')}. Free plans quote these ETF trackers rather than the indices themselves.</p>
            <div className="fh-extras-grid">
                <label className="fh-extras-field">Stock tickers<input value={stocksText} placeholder="AAPL, MSFT, NVDA" onChange={(event) => { setStocksText(event.target.value.toUpperCase()); setState((s) => ({ ...s, saved: false })); }} /></label>
                <label className="fh-extras-field">Crypto<input value={cryptoText} placeholder="BTC, ETH, SOL" onChange={(event) => { setCryptoText(event.target.value.toUpperCase()); setState((s) => ({ ...s, saved: false })); }} /></label>
                <label className="fh-extras-field">Currency<select value={markets.currency} onChange={(event) => patch('markets', { currency: event.target.value as Settings['markets']['currency'] })}><option value="USD">USD</option><option value="CAD">CAD</option><option value="INR">INR</option></select></label>
            </div>
            <SecretField label="Finnhub API key (stocks)" saved={settings.secrets.finnhubKey} value={secrets.finnhubKey} onChange={(value) => setSecrets({ ...secrets, finnhubKey: value })} placeholder="Free key from finnhub.io" />
            <SecretField label="CoinGecko demo key (optional)" saved={settings.secrets.coingeckoKey} value={secrets.coingeckoKey} onChange={(value) => setSecrets({ ...secrets, coingeckoKey: value })} placeholder="Only needed if crypto prices are rate limited" />
        </Section>

        <Section icon={<ImageIcon size={18} />} title="Photo slideshow" summary={`Every ${photos.intervalSeconds} s`}>
            <p className="ambient-settings-help">Uploaded photos stay on the home server; the frame loads one at a time. Choose where they appear under Display layout above.</p>
            <label className="fh-extras-field">Change photo every <strong>{photos.intervalSeconds} s</strong><input type="range" min={5} max={60} step={1} value={photos.intervalSeconds} onChange={(event) => patch('photos', { intervalSeconds: Number(event.target.value) })} /></label>
            <PhotoManager />
        </Section>

        <Section icon={<Newspaper size={18} />} title="News" summary={news.feeds.length ? news.feeds.map((feed) => feed.name).join(' · ').slice(0, 70) : 'No feeds'}>
            <NewsFeeds feeds={news.feeds} onChange={(feeds) => patch('news', { feeds })} />
        </Section>

        {state.error && <p className="fh-callout" role="alert">{state.error}</p>}
        <div className="ambient-settings-actions"><button className="fh-button fh-primary" onClick={() => void save()} disabled={state.saving}>{state.saving ? 'Saving…' : state.saved ? 'Saved' : 'Save display options'}</button></div>
    </section>;
}
