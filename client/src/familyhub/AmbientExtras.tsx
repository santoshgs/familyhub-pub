import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Droplets, Expand, Image as ImageIcon, Maximize2, Minimize2, Pause, Play, Plane, Shrink, Sunrise, Sunset, TrendingUp, Wifi, Wind } from 'lucide-react';
import { api } from '../lib/api';
import { apiBase } from '../lib/serverConfig';
import { dateFormat, weatherGlyph, weatherLabel } from './ambientFormat';

/**
 * v1.2 display additions: the quick bar and the detail panels for weather,
 * Formula 1, guest Wi-Fi, countdown, markets and photos. Everything arrives
 * computed from the Pi (see server/src/services/familyhub/extras); these
 * components only lay it out. The countdown seconds are the one thing ticked
 * here, from a target instant and the server's clock.
 */

export type Quote = { symbol: string; name: string; price: number; change: number; changePercent: number; kind: 'index' | 'stock' | 'crypto' };
export type Extras = {
    weather: null | {
        unit: string; windUnit: string;
        current: { temperature: number; apparent: number | null; humidity: number | null; windSpeed: number | null; windCompass: string | null; gusts: number | null; weatherCode: number; high: number; low: number; isDay: boolean };
        sun: null | { sunrise: string; sunset: string; daylight: string; progress: number; isUp: boolean };
        aqi: null | { usAqi: number; pm25: number | null; level: string; tone: string };
        moon: null | { ageDays: number; illumination: number; waxing: boolean; name: string; nextFullMoon: string; litPath: string };
        days: Array<{ date: string; weatherCode: number; high: number; low: number; precipitation: number | null; barLeft: number; barWidth: number }>;
        forecastDays: number;
    };
    formula1: null | {
        season: string; round: string; showDrivers: boolean; showConstructors: boolean; fetchedAt: string;
        drivers: Array<{ position: number; driverId: string; name: string; number: string; team: string; colour: string; points: number; wins: number; favorite: boolean }>;
        constructors: Array<{ position: number; teamId: string; name: string; colour: string; points: number; wins: number; gap: number; favorite: boolean }>;
    };
    wifi: null | { ssid: string; password: string | null; security: string; qr: { size: number; path: string } };
    countdown: null | { title: string; targetAt: string; targetLocal: string; daysLeft: number; passed: boolean; checklist: Array<{ text: string; done: boolean }> };
    markets: null | { currency: string; stocks: Quote[]; crypto: Quote[]; fetchedAt: string; notes: string[] };
    photos: null | { intervalSeconds: number; ids: string[] };
    serverTime: string;
};
export type QuickPanel = 'wifi' | 'countdown' | 'markets' | 'photos';

const timeOfStamp = (stamp: string) => {
    // "2026-11-05T06:58" in the forecast location's own time: show as typed.
    const [hours, minutes] = stamp.slice(11, 16).split(':').map(Number);
    return dateFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
};
const shortDay = (date: string) => dateFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const money = (value: number, currency: string, compact = false) => {
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: compact ? 'compact' : 'standard',
            maximumFractionDigits: compact ? 1 : Math.abs(value) < 10 ? 4 : 2 }).format(value);
    } catch { return value.toFixed(2); }
};
const signedPercent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
const trendClass = (value: number) => (value >= 0 ? 'is-up' : 'is-down');

// ── Quick bar ────────────────────────────────────────────────────────────────

// ── Weather ──────────────────────────────────────────────────────────────────

export function WeatherDetails({ weather, place }: { weather: NonNullable<Extras['weather']>; place: string | null }) {
    const { current, sun, aqi, moon } = weather;
    return <div className="ambient-panel">
        <div className="ambient-stat-grid">
            <div className="ambient-stat"><small>TEMPERATURE</small><strong>{current.temperature}{weather.unit}</strong>
                <span>{weatherLabel(current.weatherCode)}{current.apparent !== null ? ` · feels ${current.apparent}°` : ''}</span><span>H {current.high}° · L {current.low}°</span></div>
            <div className="ambient-stat"><small>WIND &amp; HUMIDITY</small><strong><Wind size={18} /> {current.windSpeed ?? '—'} <em>{weather.windUnit} {current.windCompass ?? ''}</em></strong>
                <span>{current.gusts !== null ? `Gusts ${current.gusts} ${weather.windUnit}` : ''}</span><span><Droplets size={13} /> {current.humidity !== null ? `${current.humidity}% humidity` : '—'}</span></div>
            {aqi && <div className="ambient-stat"><small>AIR QUALITY</small><strong>{aqi.usAqi} <b className={`ambient-aqi is-${aqi.tone}`}>{aqi.level}</b></strong>
                <span>US AQI{aqi.pm25 !== null ? ` · PM2.5 ${aqi.pm25} µg/m³` : ''}</span></div>}
            {sun && <div className="ambient-stat"><small>SUN</small><strong className="ambient-sun-times"><span><Sunrise size={15} /> {timeOfStamp(sun.sunrise)}</span><span><Sunset size={15} /> {timeOfStamp(sun.sunset)}</span></strong>
                <div className="ambient-sun-track" aria-label={`Daylight ${Math.round(sun.progress * 100)}% through`}><i style={{ width: `${sun.progress * 100}%` }} /><b style={{ left: `${sun.progress * 100}%` }} className={sun.isUp ? 'is-up' : ''} /></div>
                <span>{sun.daylight} of daylight</span></div>}
        </div>
        {moon && <div className="ambient-moon">
            <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="#1e293b" stroke="#475569" strokeWidth="1.2" />{moon.litPath && <path d={moon.litPath} fill="#f7e7a1" />}</svg>
            <div><small>MOON</small><strong>{moon.name} · {Math.round(moon.illumination * 100)}% lit</strong>
                <span>Next full moon {shortDay(moon.nextFullMoon.slice(0, 10))}</span></div>
        </div>}
        <h3 className="ambient-panel-heading">{weather.forecastDays}-day forecast{place ? ` · ${place}` : ''}</h3>
        <div className="ambient-forecast">{weather.days.map((day) => {
            const Glyph = weatherGlyph(day.weatherCode, true);
            return <div className="ambient-forecast-row" key={day.date}>
                <span className="ambient-forecast-day">{shortDay(day.date)}</span>
                <span className="ambient-forecast-cond"><Glyph size={17} />{weatherLabel(day.weatherCode)}</span>
                <span className="ambient-forecast-rain"><Droplets size={12} />{day.precipitation ?? '—'}{day.precipitation !== null ? '%' : ''}</span>
                <span className="ambient-forecast-low">{day.low}°</span>
                <span className="ambient-range"><i style={{ left: `${day.barLeft}%`, width: `${day.barWidth}%` }} /></span>
                <span className="ambient-forecast-high">{day.high}°</span>
            </div>;
        })}</div>
        <p className="ambient-panel-note">Forecast and air quality by Open-Meteo. Moon phase computed on the home server.</p>
    </div>;
}

// ── Formula 1 ────────────────────────────────────────────────────────────────

type RaceSchedule = { name: string; circuit: string; location: string; country: string; raceDateTime: string; sessions: { name: string; dateTime: string }[] } | null | undefined;

export function Formula1Details({ standings, race, zone }: { standings: Extras['formula1']; race: RaceSchedule; zone: string }) {
    const when = (value: string) => dateFormat(undefined, { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
    return <div className="ambient-panel">
        {race && <section className="ambient-f1-schedule"><h3 className="ambient-panel-heading">{race.name} · weekend schedule</h3>
            <p className="ambient-panel-sub">{[race.circuit, race.location, race.country].filter(Boolean).join(' · ')}</p>
            <div className="ambient-f1-sessions">{race.sessions.map((session) => <div key={`${session.name}-${session.dateTime}`} className={Date.parse(session.dateTime) < Date.now() ? 'is-past' : ''}>
                <span>{session.name}</span><time>{when(session.dateTime)}</time></div>)}</div></section>}
        {standings ? <div className={`ambient-f1-tables${standings.showDrivers && standings.showConstructors ? ' is-split' : ''}`}>
            {standings.showDrivers && <section><h3 className="ambient-panel-heading">Drivers · {standings.season}{standings.round ? `, after round ${standings.round}` : ''}</h3>
                <div className="ambient-table">{standings.drivers.slice(0, 12).map((driver) => <div key={driver.driverId} className={`ambient-table-row${driver.favorite ? ' is-favorite' : ''}`}>
                    <span className="ambient-pos">{driver.position}</span><i className="ambient-team-stripe" style={{ background: driver.colour }} />
                    <span className="ambient-table-name"><span>{driver.number && <em>#{driver.number}</em>} {driver.name}</span><small>{driver.team}</small></span>
                    <span className="ambient-wins">{driver.wins ? `${driver.wins} W` : ''}</span><b>{driver.points}</b></div>)}</div></section>}
            {standings.showConstructors && <section><h3 className="ambient-panel-heading">Constructors</h3>
                <div className="ambient-table">{standings.constructors.map((team) => <div key={team.teamId} className={`ambient-table-row${team.favorite ? ' is-favorite' : ''}`}>
                    <span className="ambient-pos">{team.position}</span><i className="ambient-team-stripe" style={{ background: team.colour }} />
                    <span className="ambient-table-name">{team.name}<small>{team.position === 1 ? 'Leader' : `−${team.gap} pts`}</small></span>
                    <span className="ambient-wins">{team.wins ? `${team.wins} W` : ''}</span><b>{team.points}</b></div>)}</div></section>}
        </div> : <p className="ambient-panel-note">Standings are not available right now.</p>}
        <p className="ambient-panel-note">Schedule and standings by Jolpica F1. Times shown in {zone}.</p>
    </div>;
}

// ── Guest Wi-Fi ──────────────────────────────────────────────────────────────

export function WifiDetails({ wifi }: { wifi: NonNullable<Extras['wifi']> }) {
    const { size, path } = wifi.qr;
    return <div className="ambient-panel ambient-wifi">
        <div className="ambient-qr"><svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} shapeRendering="crispEdges" role="img" aria-label={`QR code to join ${wifi.ssid}`}>
            <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" /><path d={path} fill="#000" /></svg></div>
        <div className="ambient-wifi-copy">
            <div><small>NETWORK</small><strong>{wifi.ssid}</strong></div>
            {wifi.password && <div><small>PASSWORD</small><strong className="ambient-wifi-password">{wifi.password}</strong></div>}
            <span>Security · {wifi.security}</span>
            <p>Point a phone camera at the code to join without typing the password.</p>
        </div>
    </div>;
}

// ── Countdown ────────────────────────────────────────────────────────────────

export function CountdownDetails({ countdown, serverTime, zone }: { countdown: NonNullable<Extras['countdown']>; serverTime: string; zone: string }) {
    const [now, setNow] = useState(Date.now());
    // The server's clock, not the frame's: the frame's own clock may drift.
    const offset = useRef(Date.parse(serverTime) - Date.now());
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
    const left = Math.max(0, Date.parse(countdown.targetAt) - (now + (Number.isFinite(offset.current) ? offset.current : 0)));
    const units = [['DAYS', Math.floor(left / 86_400_000)], ['HOURS', Math.floor(left / 3_600_000) % 24], ['MINUTES', Math.floor(left / 60_000) % 60], ['SECONDS', Math.floor(left / 1000) % 60]] as const;
    const target = dateFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(countdown.targetAt));
    return <div className="ambient-panel">
        <div className="ambient-countdown">{units.map(([label, value], index) => <div key={label} className={index === 0 ? 'is-days' : index === 3 ? 'is-seconds' : ''}>
            <strong>{index === 0 ? value : String(value).padStart(2, '0')}</strong><small>{label}</small></div>)}</div>
        <p className="ambient-countdown-target">{left === 0 ? 'It’s here!' : target}</p>
        {countdown.checklist.length > 0 && <><h3 className="ambient-panel-heading">Checklist</h3><div className="ambient-checklist">{countdown.checklist.map((item, index) =>
            <div key={index} className={item.done ? 'is-done' : ''}><span className={`ambient-checkbox${item.done ? ' is-done' : ''}`}>{item.done ? '✓' : ''}</span>{item.text}</div>)}</div></>}
    </div>;
}

// ── Markets ──────────────────────────────────────────────────────────────────

function QuoteRows({ quotes, currency }: { quotes: Quote[]; currency: string }) {
    return <div className="ambient-table">{quotes.map((quote) => <div className="ambient-table-row" key={quote.symbol}>
        <span className="ambient-table-name">{quote.kind === 'index' ? quote.name : quote.symbol}<small>{quote.kind === 'index' ? `${quote.symbol} tracker` : quote.kind === 'crypto' ? '24 h' : 'Stock'}</small></span>
        <span className="ambient-quote-price">{money(quote.price, currency)}</span>
        <b className={`ambient-quote-change ${trendClass(quote.change)}`}>{quote.change >= 0 ? '▲' : '▼'} {money(Math.abs(quote.change), currency)}<small>{signedPercent(quote.changePercent)}</small></b>
    </div>)}</div>;
}

export function MarketsDetails({ markets, zone }: { markets: NonNullable<Extras['markets']>; zone: string }) {
    return <div className="ambient-panel">
        <div className="ambient-f1-tables is-split">
            <section><h3 className="ambient-panel-heading">Stocks · {markets.currency}</h3>{markets.stocks.length ? <QuoteRows quotes={markets.stocks} currency={markets.currency} /> : <p className="ambient-panel-note">No stock prices yet.</p>}</section>
            <section><h3 className="ambient-panel-heading">Crypto · {markets.currency}</h3>{markets.crypto.length ? <QuoteRows quotes={markets.crypto} currency={markets.currency} /> : <p className="ambient-panel-note">No crypto prices yet.</p>}</section>
        </div>
        {markets.notes.map((note) => <p key={note} className="ambient-panel-note is-warning">{note}</p>)}
        <p className="ambient-panel-note">Prices as of {dateFormat(undefined, { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(markets.fetchedAt))}; refreshed at the market open, mid-day and the close. Stocks by Finnhub, crypto and exchange rates by CoinGecko. Index values are their ETF trackers.</p>
    </div>;
}

// ── Photos ───────────────────────────────────────────────────────────────────

/** Loads one photo with the display's token (an <img> cannot send it) as an object URL. */
async function photoUrl(id: string): Promise<string> {
    const token = api.getToken();
    const response = await fetch(`${apiBase()}/api/familyhub/ambient/photos/${encodeURIComponent(id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error('Photo unavailable');
    return URL.createObjectURL(await response.blob());
}

export function PhotoSlideshow({ photos }: { photos: NonNullable<Extras['photos']> }) {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [full, setFull] = useState(false);
    const [fill, setFill] = useState(false);
    const count = photos.ids.length;
    const id = photos.ids[index % count];

    // One photo in memory at a time (the frame has little to spare): the previous
    // object URL is released as soon as the next photo has replaced it.
    const shown = useRef<string | null>(null);
    useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);
    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        photoUrl(id).then((next) => {
            if (cancelled) { URL.revokeObjectURL(next); return; }
            const previous = shown.current;
            shown.current = next;
            setUrl(next);
            if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
        }).catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [id]);
    useEffect(() => {
        if (!playing || count < 2) return;
        const timer = window.setTimeout(() => setIndex((value) => (value + 1) % count), photos.intervalSeconds * 1000);
        return () => window.clearTimeout(timer);
    }, [playing, index, count, photos.intervalSeconds]);

    const previous = () => setIndex((index - 1 + count) % count);
    const next = () => setIndex((index + 1) % count);
    const image = (className?: string) => failed ? <p>This photo could not be loaded.</p>
        : url ? <img className={className} src={url} alt={`Family photo ${index + 1} of ${count}`} /> : <span className="ambient-loader" />;

    return <div className="ambient-panel ambient-slideshow">
        <div className="ambient-photo">{image()}<span className="ambient-photo-count">{index + 1} / {count}</span></div>
        <div className="ambient-photo-controls">
            <button className="ambient-manage" onClick={previous} disabled={count < 2}><ChevronLeft size={16} />Previous</button>
            <button className="ambient-manage" onClick={() => setPlaying(!playing)} disabled={count < 2}>{playing ? <><Pause size={16} />Every {photos.intervalSeconds} s</> : <><Play size={16} />Resume</>}</button>
            <button className="ambient-manage" onClick={next} disabled={count < 2}>Next<ChevronRight size={16} /></button>
            <button className="ambient-manage" onClick={() => setFull(true)}><Maximize2 size={16} />Full screen</button>
        </div>
        {full && createPortal(<FullScreenPhoto image={image} fill={fill} onFill={() => setFill(!fill)} count={count} index={index}
            playing={playing} onPlay={() => setPlaying(!playing)} onPrevious={previous} onNext={next} onClose={() => setFull(false)} />, document.body)}
    </div>;
}

/**
 * The slideshow edge to edge. It is a page overlay rather than the browser's
 * fullscreen mode, which the frame's kiosk already is. Tapping shows the
 * controls for a few seconds; the night dimmer still covers it.
 */
function FullScreenPhoto({ image, fill, onFill, count, index, playing, onPlay, onPrevious, onNext, onClose }: {
    image: (className?: string) => React.ReactNode; fill: boolean; onFill: () => void; count: number; index: number;
    playing: boolean; onPlay: () => void; onPrevious: () => void; onNext: () => void; onClose: () => void;
}) {
    const [controls, setControls] = useState(true);
    const hide = useRef<number | null>(null);
    const wake = () => {
        setControls(true);
        if (hide.current) window.clearTimeout(hide.current);
        hide.current = window.setTimeout(() => setControls(false), 4000);
    };
    useEffect(() => { wake(); return () => { if (hide.current) window.clearTimeout(hide.current); }; }, []);
    useEffect(() => {
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); if (event.key === 'ArrowLeft') onPrevious(); if (event.key === 'ArrowRight') onNext(); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onClose, onPrevious, onNext]);
    const act = (action: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); action(); wake(); };
    return <div className={`ambient-photo-full${fill ? ' is-fill' : ''}${controls ? ' has-controls' : ''}`} role="dialog" aria-modal="true" aria-label="Photo slideshow, full screen" onClick={wake}>
        {image('ambient-photo-full-image')}
        <div className="ambient-photo-full-bar ambient-photo-full-top">
            <span>{index + 1} / {count}</span>
            <button className="ambient-manage" onClick={act(onFill)}>{fill ? <><Shrink size={16} />Fit</> : <><Expand size={16} />Fill screen</>}</button>
            <button className="ambient-manage" onClick={act(onClose)}><Minimize2 size={16} />Exit full screen</button>
        </div>
        {count > 1 && <div className="ambient-photo-full-bar ambient-photo-full-bottom">
            <button className="ambient-manage" onClick={act(onPrevious)}><ChevronLeft size={16} />Previous</button>
            <button className="ambient-manage" onClick={act(onPlay)}>{playing ? <><Pause size={16} />Pause</> : <><Play size={16} />Resume</>}</button>
            <button className="ambient-manage" onClick={act(onNext)}>Next<ChevronRight size={16} /></button>
        </div>}
    </div>;
}

// ── Cards (v1.6): the quick cards can also sit in the 3 × 2 grid ─────────────

type CardProps = { style: React.CSSProperties; onOpen: () => void };
const CardHeading = ({ icon, kicker, title }: { icon: React.ReactNode; kicker: string; title: string }) =>
    <div className="ambient-card-heading"><span className="ambient-card-icon ambient-extra-icon">{icon}</span><div><small>{kicker}</small><h2>{title}</h2></div></div>;

export function WifiCard({ wifi, style, onOpen }: CardProps & { wifi: NonNullable<Extras['wifi']> }) {
    const { size, path } = wifi.qr;
    return <button className="ambient-card ambient-extra-card ambient-wifi-card" style={style} onClick={onOpen}>
        <CardHeading icon={<Wifi />} kicker="HOME NETWORK" title="Guest Wi-Fi" />
        <div className="ambient-wifi-card-body">
            <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} shapeRendering="crispEdges" role="img" aria-label={`QR code to join ${wifi.ssid}`}><rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" /><path d={path} fill="#000" /></svg>
            <div><small>NETWORK</small><strong>{wifi.ssid}</strong><span>Scan with a phone camera to join</span></div>
        </div>
    </button>;
}

export function CountdownCard({ countdown, style, onOpen }: CardProps & { countdown: NonNullable<Extras['countdown']> }) {
    const done = countdown.checklist.filter((item) => item.done).length;
    return <button className="ambient-card ambient-extra-card ambient-countdown-card" style={style} onClick={onOpen}>
        <CardHeading icon={<Plane />} kicker="COUNTDOWN" title={countdown.title} />
        <div className="ambient-countdown-big"><strong>{countdown.passed ? 'Today' : countdown.daysLeft}</strong>{!countdown.passed && <span>{countdown.daysLeft === 1 ? 'day to go' : 'days to go'}</span>}</div>
        <p className="ambient-extra-note">{shortDay(countdown.targetLocal.slice(0, 10))}{countdown.checklist.length ? ` · ${done} of ${countdown.checklist.length} ready` : ''}</p>
    </button>;
}

export function MarketsCard({ markets, style, onOpen }: CardProps & { markets: NonNullable<Extras['markets']> }) {
    const quotes = [...markets.stocks.filter((quote) => quote.kind === 'index'), ...markets.stocks.filter((quote) => quote.kind !== 'index'), ...markets.crypto].slice(0, 5);
    return <button className="ambient-card ambient-extra-card ambient-markets-card" style={style} onClick={onOpen}>
        <CardHeading icon={<TrendingUp />} kicker={`MARKETS · ${markets.currency}`} title="Stocks & crypto" />
        {quotes.length ? <div className="ambient-list">{quotes.map((quote) => <div className="ambient-list-row ambient-quote-row" key={`${quote.kind}-${quote.symbol}`}>
            <span>{quote.kind === 'index' ? quote.name : quote.symbol}</span><b>{money(quote.price, markets.currency, quote.price >= 10_000)}</b><em className={trendClass(quote.changePercent)}>{signedPercent(quote.changePercent)}</em>
        </div>)}</div> : <p className="ambient-empty">No prices yet.</p>}
    </button>;
}

/** One photo at a time, changing at the slideshow interval; tap for the full slideshow. */
export function PhotosCard({ photos, style, onOpen }: CardProps & { photos: NonNullable<Extras['photos']> }) {
    const [index, setIndex] = useState(0);
    const [url, setUrl] = useState<string | null>(null);
    const shown = useRef<string | null>(null);
    const id = photos.ids[index % photos.ids.length];
    useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);
    useEffect(() => {
        let cancelled = false;
        photoUrl(id).then((next) => {
            if (cancelled) { URL.revokeObjectURL(next); return; }
            const previous = shown.current;
            shown.current = next; setUrl(next);
            if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [id]);
    useEffect(() => {
        if (photos.ids.length < 2) return;
        const timer = window.setTimeout(() => setIndex((value) => (value + 1) % photos.ids.length), Math.max(8, photos.intervalSeconds) * 1000);
        return () => window.clearTimeout(timer);
    }, [index, photos.ids.length, photos.intervalSeconds]);
    return <button className="ambient-card ambient-extra-card ambient-photos-card" style={style} onClick={onOpen} aria-label="Family photos: open the slideshow">
        {url && <img src={url} alt="" decoding="async" />}
        <span className="ambient-photos-card-label"><ImageIcon size={15} />Family photos<small>{photos.ids.length} {photos.ids.length === 1 ? 'photo' : 'photos'}</small></span>
    </button>;
}

/** A card the household placed on the display but has not set up yet. */
export function SetupCard({ title, hint, icon, style }: { title: string; hint: string; icon: React.ReactNode; style: React.CSSProperties }) {
    return <div className="ambient-card ambient-extra-card is-unset" style={style}><CardHeading icon={icon} kicker="NOT SET UP" title={title} /><p className="ambient-empty">{hint}</p></div>;
}

/** The pills for the quick cards; the display adds pills for the other modules. */
export function extraPill(key: QuickPanel, extras: Extras | undefined, onOpen: (panel: QuickPanel) => void) {
    if (!extras) return null;
    if (key === 'wifi' && extras.wifi) return <button key="wifi" className="ambient-pill" onClick={() => onOpen('wifi')}><Wifi size={16} /><span>Guest Wi-Fi</span><small>{extras.wifi.ssid}</small></button>;
    if (key === 'countdown' && extras.countdown) return <button key="countdown" className="ambient-pill" onClick={() => onOpen('countdown')}><Plane size={16} /><span>{extras.countdown.title}</span>
        <b className="ambient-pill-badge">{extras.countdown.passed ? 'Today' : extras.countdown.daysLeft === 0 ? '< 1 day' : `${extras.countdown.daysLeft} d`}</b></button>;
    if (key === 'markets' && extras.markets) {
        const index = extras.markets.stocks.find((quote) => quote.kind === 'index') ?? extras.markets.stocks[0];
        const coin = extras.markets.crypto[0];
        return <button key="markets" className="ambient-pill" onClick={() => onOpen('markets')}><TrendingUp size={16} />
            {index || coin ? <span>
                {index && <>{index.kind === 'index' ? index.name.replace(' 500', '') : index.symbol} <b className={trendClass(index.changePercent)}>{signedPercent(index.changePercent)}</b></>}
                {index && coin && ' · '}
                {coin && <>{coin.symbol} <b>{money(coin.price, extras.markets.currency, true)}</b></>}
            </span> : <span>Markets</span>}</button>;
    }
    if (key === 'photos' && extras.photos) return <button key="photos" className="ambient-pill" onClick={() => onOpen('photos')}><ImageIcon size={16} /><span>Family photos</span><small>Slideshow</small></button>;
    return null;
}

export function QuickPills({ pills }: { pills: React.ReactNode[] }) {
    const shown = pills.filter(Boolean);
    if (!shown.length) return null;
    return <nav className={`ambient-quickbar${shown.length > 4 ? ' is-crowded' : ''}`} aria-label="Quick cards"><span className="ambient-quickbar-label"><i />QUICK CARDS</span><div className="ambient-quickbar-pills">{shown}</div></nav>;
}

/**
 * v1.5.4: the screensaver. Family photos full screen with a small clock, one
 * photo at a time at the slideshow interval. Touching anywhere ends it; the
 * touch is used up so it does not also open the card underneath.
 */
export function ScreenSaver({ photos, zone, onExit }: { photos: NonNullable<Extras['photos']>; zone: string; onExit: () => void }) {
    const [index, setIndex] = useState(() => Math.floor(Math.random() * photos.ids.length));
    const [url, setUrl] = useState<string | null>(null);
    const [clock, setClock] = useState(() => new Date());
    const shown = useRef<string | null>(null);
    const id = photos.ids[index % photos.ids.length];
    useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);
    useEffect(() => {
        let cancelled = false;
        photoUrl(id).then((next) => {
            if (cancelled) { URL.revokeObjectURL(next); return; }
            const previous = shown.current;
            shown.current = next; setUrl(next);
            if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1500);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [id]);
    useEffect(() => {
        const timer = window.setTimeout(() => setIndex((value) => (value + 1) % photos.ids.length), Math.max(8, photos.intervalSeconds) * 1000);
        return () => window.clearTimeout(timer);
    }, [index, photos.ids.length, photos.intervalSeconds]);
    useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 15_000); return () => window.clearInterval(timer); }, []);
    return <div className="ambient-screensaver" role="button" tabIndex={0} aria-label="Screensaver. Touch anywhere to return to the dashboard."
        onPointerDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onExit(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') onExit(); }}>
        {url && <img key={url} src={url} alt="" decoding="async" />}
        <span className="ambient-screensaver-clock">{dateFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(clock)}</span>
    </div>;
}
