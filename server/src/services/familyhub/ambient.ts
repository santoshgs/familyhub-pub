import { query } from '../../db';
import logger from '../../lib/logger';
import { readCappedText, safeFetch } from '../../lib/safeFetch';
import { syncGoogle } from './google/runtime';
import { getNews } from './news';
import { readExtras } from './extras/settings';
import { buildWeatherPanel, getAirQuality } from './extras/weatherPanel';
import { getStandings } from './extras/formula1';
import { buildCountdown, buildWifi } from './extras/wifiCountdown';
import { getMarkets } from './extras/markets';
import { listPhotos } from './extras/photos';
import { BASE_MODULES, legacyLayout, parseLayout, readLayout, shownModules, type DisplayLayout } from './ambientLayout';

export const AMBIENT_WIDGETS = ['calendar', 'weather', 'tasks', 'chores', 'news', 'daycare', 'f1'] as const;
/** Cards shown when a household has not chosen any yet (News is opt-in). */
export const DEFAULT_AMBIENT_WIDGETS: readonly AmbientWidget[] = ['calendar', 'weather', 'tasks', 'chores', 'daycare', 'f1'];
export type AmbientWidget = typeof AMBIENT_WIDGETS[number];

export interface NightDimming {
    enabled: boolean;
    /** Household-local 24-hour clock times, HH:MM. A start after the end spans midnight. */
    start: string;
    end: string;
    /** Display brightness while dimmed, as a percentage; 0 shows a black screen. */
    brightness: number;
    /**
     * v1.5.4: 'dim' darkens the screen (a tap wakes it); 'off' blacks it out
     * completely and needs a double tap to wake. The page cannot switch the
     * frame's backlight off; 'off' is a fully black screen.
     */
    mode: 'dim' | 'off';
}
/** v1.5.4: photos full screen after the frame has been left alone (not during night hours). */
export interface Screensaver { enabled: boolean; idleMinutes: number }
export const SCREENSAVER_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const;
export interface AmbientSettings {
    location: null | { city: string; country: string; latitude: number; longitude: number };
    /** The base modules shown anywhere on the display (cards or pills). */
    widgets: AmbientWidget[];
    night: NightDimming;
    /** v1.6: cards (ordered, at most six) and quick pills. */
    layout: DisplayLayout;
    screensaver: Screensaver;
}
const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DEFAULT_NIGHT: NightDimming = { enabled: false, start: '22:00', end: '07:00', brightness: 15, mode: 'dim' };
const DEFAULT_SCREENSAVER: Screensaver = { enabled: false, idleMinutes: 10 };

interface CacheEntry<T> { expiresAt: number; value: T }
const weatherCache = new Map<string, CacheEntry<AmbientWeather | null>>();
const scheduleCache = new Map<string, CacheEntry<FormulaRace | null>>();
const pendingWeather = new Map<string, Promise<AmbientWeather | null>>();
const pendingSchedule = new Map<string, Promise<FormulaRace | null>>();

export interface WeatherDay { date: string; weatherCode: number; high: number; low: number; precipitation: number | null }
export interface AmbientWeather {
    temperature: number;
    weatherCode: number;
    high: number;
    low: number;
    timezone: string;
    fetchedAt: string;
    unit: 'celsius' | 'fahrenheit';
    tomorrow?: { weatherCode: number; high: number; low: number };
    /** Extra fields for the weather detail panel (v1.2). */
    details?: {
        apparent: number | null; humidity: number | null; windSpeed: number | null; windDirection: number | null;
        gusts: number | null; isDay: boolean; sunrise: string | null; sunset: string | null; days: WeatherDay[];
    };
}

export interface FormulaSession { name: string; dateTime: string }
export interface FormulaRace {
    name: string;
    circuit: string;
    location: string;
    country: string;
    raceDateTime: string;
    sessions: FormulaSession[];
}

interface JolpicaRace {
    raceName?: unknown;
    date?: unknown;
    time?: unknown;
    Circuit?: { circuitName?: unknown; Location?: { locality?: unknown; country?: unknown } };
    [key: string]: unknown;
}

const asString = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validCoordinate = (lat: number, lon: number) => Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;

export async function readAmbientSettings(familyId: string): Promise<AmbientSettings> {
    const result = await query(`SELECT weather_city, weather_country, weather_latitude, weather_longitude, enabled_widgets,
        night_enabled, night_start, night_end, night_brightness, layout, night_mode, screensaver_enabled, screensaver_minutes
        FROM familyhub_ambient_settings WHERE family_id=$1`, [familyId]);
    const row = result.rows[0];
    const rawWidgets = Array.isArray(row?.enabled_widgets) ? row.enabled_widgets : DEFAULT_AMBIENT_WIDGETS;
    const widgets = AMBIENT_WIDGETS.filter((widget) => rawWidgets.includes(widget));
    const lat = row?.weather_latitude === null || row?.weather_latitude === undefined ? null : Number(row.weather_latitude);
    const lon = row?.weather_longitude === null || row?.weather_longitude === undefined ? null : Number(row.weather_longitude);
    const location = lat !== null && lon !== null && validCoordinate(lat, lon)
        ? { city: asString(row.weather_city, 100), country: asString(row.weather_country, 100), latitude: lat, longitude: lon }
        : null;
    const night: NightDimming = row ? {
        enabled: Boolean(row.night_enabled),
        start: CLOCK_TIME.test(String(row.night_start)) ? String(row.night_start) : DEFAULT_NIGHT.start,
        end: CLOCK_TIME.test(String(row.night_end)) ? String(row.night_end) : DEFAULT_NIGHT.end,
        brightness: Math.min(80, Math.max(0, Number(row.night_brightness) || 0)),
        mode: row.night_mode === 'off' ? 'off' : 'dim',
    } : { ...DEFAULT_NIGHT };
    const minutes = Number(row?.screensaver_minutes);
    const screensaver: Screensaver = { enabled: Boolean(row?.screensaver_enabled),
        idleMinutes: (SCREENSAVER_MINUTES as readonly number[]).includes(minutes) ? minutes : DEFAULT_SCREENSAVER.idleMinutes };
    let layout = readLayout(row?.layout);
    if (!layout) {
        // Before v1.6: the enabled cards in their fixed order, and the quick cards switched on.
        const extras = (await readExtras(familyId)).settings;
        layout = legacyLayout(widgets.length ? widgets : DEFAULT_AMBIENT_WIDGETS,
            { wifi: extras.wifi.enabled, countdown: extras.countdown.enabled, markets: extras.markets.enabled, photos: extras.photos.enabled });
    }
    const shown = shownModules(layout);
    return { location, widgets: BASE_MODULES.filter((module) => shown.has(module)), night, layout, screensaver };
}

function parseNight(input: unknown): NightDimming {
    if (input === undefined) return { ...DEFAULT_NIGHT };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid night dimming settings.');
    const night = input as Record<string, unknown>;
    const brightness = night.brightness;
    if (typeof night.enabled !== 'boolean' || typeof night.start !== 'string' || typeof night.end !== 'string'
        || !CLOCK_TIME.test(night.start) || !CLOCK_TIME.test(night.end)) throw new Error('Choose valid night dimming start and end times.');
    if (night.start === night.end) throw new Error('Night dimming start and end times must differ.');
    if (typeof brightness !== 'number' || !Number.isInteger(brightness) || brightness < 0 || brightness > 80) throw new Error('Night brightness must be between 0 and 80 percent.');
    if (night.mode !== undefined && night.mode !== 'dim' && night.mode !== 'off') throw new Error('Choose to dim the display or turn it off at night.');
    return { enabled: night.enabled, start: night.start, end: night.end, brightness, mode: night.mode === 'off' ? 'off' : 'dim' };
}

function parseScreensaver(input: unknown): Screensaver {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid screensaver settings.');
    const value = input as Record<string, unknown>;
    if (typeof value.enabled !== 'boolean' || typeof value.idleMinutes !== 'number' || !(SCREENSAVER_MINUTES as readonly number[]).includes(value.idleMinutes)) {
        throw new Error(`Choose when the screensaver starts: after ${SCREENSAVER_MINUTES.join(', ')} minutes.`);
    }
    return { enabled: value.enabled, idleMinutes: value.idleMinutes };
}

export async function saveAmbientSettings(familyId: string, input: unknown): Promise<AmbientSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid display settings.');
    const value = input as { location?: unknown; widgets?: unknown; night?: unknown; layout?: unknown; screensaver?: unknown };
    let city: string | null = null, country: string | null = null, lat: number | null = null, lon: number | null = null;
    if (value.location !== null && value.location !== undefined) {
        if (!value.location || typeof value.location !== 'object' || Array.isArray(value.location)) throw new Error('Choose a weather location from the list.');
        const selected = value.location as Record<string, unknown>;
        city = asString(selected.city, 100); country = asString(selected.country, 100);
        lat = typeof selected.latitude === 'number' ? selected.latitude : Number.NaN;
        lon = typeof selected.longitude === 'number' ? selected.longitude : Number.NaN;
        if (!city || !country || !validCoordinate(lat, lon)) throw new Error('Choose a valid weather location.');
    }
    // v1.6 sends a layout; an older page sends only the list of cards.
    let layout: DisplayLayout | null = null;
    let widgets: unknown[];
    if (value.layout !== undefined) {
        layout = parseLayout(value.layout);
        const shown = shownModules(layout);
        widgets = BASE_MODULES.filter((module) => shown.has(module));
    } else {
        if (!Array.isArray(value.widgets) || value.widgets.length < 1 || value.widgets.length > AMBIENT_WIDGETS.length
            || value.widgets.some((widget) => typeof widget !== 'string' || !AMBIENT_WIDGETS.includes(widget as AmbientWidget))
            || new Set(value.widgets).size !== value.widgets.length) throw new Error('Choose one or more available display cards.');
        widgets = value.widgets;
    }
    // An older page sends night without a mode, or no screensaver: keep what is stored.
    const nightMode = value.night && typeof value.night === 'object' ? (value.night as Record<string, unknown>).mode : undefined;
    const stored = value.night === undefined || value.screensaver === undefined || nightMode === undefined ? await readAmbientSettings(familyId) : null;
    const night = value.night === undefined ? stored!.night : { ...parseNight(value.night), ...(nightMode === undefined ? { mode: stored!.night.mode } : {}) };
    const screensaver = value.screensaver === undefined ? stored!.screensaver : parseScreensaver(value.screensaver);
    // Without a layout (an older page), the stored one is dropped so it is derived from the cards again.
    await query(`INSERT INTO familyhub_ambient_settings (family_id,weather_city,weather_country,weather_latitude,weather_longitude,enabled_widgets,
            night_enabled,night_start,night_end,night_brightness,layout,night_mode,screensaver_enabled,screensaver_minutes,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,now())
        ON CONFLICT (family_id) DO UPDATE SET weather_city=$2,weather_country=$3,weather_latitude=$4,weather_longitude=$5,enabled_widgets=$6::jsonb,
            night_enabled=$7,night_start=$8,night_end=$9,night_brightness=$10,layout=$11::jsonb,night_mode=$12,screensaver_enabled=$13,screensaver_minutes=$14,updated_at=now()`,
    [familyId, city, country, lat, lon, JSON.stringify(widgets), night.enabled, night.start, night.end, night.brightness, layout ? JSON.stringify(layout) : null,
        night.mode, screensaver.enabled, screensaver.idleMinutes]);
    return readAmbientSettings(familyId);
}

export async function searchWeatherLocations(search: string): Promise<Array<{ id: number; city: string; region: string; country: string; latitude: number; longitude: number }>> {
    const term = search.trim().slice(0, 80);
    if (term.length < 2) return [];
    const params = new URLSearchParams({ name: term, count: '6', language: 'en', format: 'json' });
    const response = await safeFetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { timeoutMs: 8_000, maxBytes: 128 * 1024 });
    if (!response.ok) throw new Error('Weather location search is unavailable.');
    const json = JSON.parse(await readCappedText(response, 128 * 1024)) as { results?: unknown };
    if (!Array.isArray(json.results)) return [];
    return json.results.slice(0, 6).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const result = entry as Record<string, unknown>;
        const latitude = Number(result.latitude), longitude = Number(result.longitude);
        const city = asString(result.name, 100), country = asString(result.country, 100);
        if (!Number.isInteger(Number(result.id)) || !city || !country || !validCoordinate(latitude, longitude)) return [];
        return [{ id: Number(result.id), city, region: asString(result.admin1, 100), country, latitude, longitude }];
    });
}

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const localStamp = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : null);

export async function getAmbientWeather(location: AmbientSettings['location'], unit: 'celsius' | 'fahrenheit' = 'celsius'): Promise<AmbientWeather | null> {
    if (!location) return null;
    const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)},${unit}`;
    const cached = weatherCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingWeather.get(key);
    if (pending) return pending;
    const work = (async () => {
        try {
            const params = new URLSearchParams({
                latitude: String(location.latitude), longitude: String(location.longitude),
                current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
                forecast_days: '16', timezone: 'auto', temperature_unit: unit, wind_speed_unit: unit === 'fahrenheit' ? 'mph' : 'kmh',
            });
            const response = await safeFetch(`https://api.open-meteo.com/v1/forecast?${params}`, { timeoutMs: 8_000, maxBytes: 256 * 1024 });
            if (!response.ok) throw new Error('Weather service unavailable.');
            const data = JSON.parse(await readCappedText(response, 256 * 1024)) as {
                current?: Record<string, unknown>;
                daily?: Record<string, unknown[] | undefined>;
                timezone?: unknown;
            };
            const temperature = Number(data.current?.temperature_2m), weatherCode = Number(data.current?.weather_code);
            const daily = data.daily ?? {};
            const high = Number(daily.temperature_2m_max?.[0]), low = Number(daily.temperature_2m_min?.[0]);
            if (![temperature, weatherCode, high, low].every(Number.isFinite)) throw new Error('Invalid weather response.');
            const next = { weatherCode: Number(daily.weather_code?.[1]), high: Number(daily.temperature_2m_max?.[1]), low: Number(daily.temperature_2m_min?.[1]) };
            const dates = Array.isArray(daily.time) ? daily.time : [];
            const days: WeatherDay[] = dates.slice(0, 16).flatMap((date, index) => {
                const day = { date: asString(date, 10), weatherCode: Number(daily.weather_code?.[index]),
                    high: Number(daily.temperature_2m_max?.[index]), low: Number(daily.temperature_2m_min?.[index]),
                    precipitation: numberOrNull(daily.precipitation_probability_max?.[index]) };
                return /^\d{4}-\d{2}-\d{2}$/.test(day.date) && [day.weatherCode, day.high, day.low].every(Number.isFinite) ? [day] : [];
            });
            const current = data.current ?? {};
            const value: AmbientWeather = { temperature, weatherCode, high, low, timezone: asString(data.timezone, 80) || 'UTC', fetchedAt: new Date().toISOString(), unit,
                ...([next.weatherCode, next.high, next.low].every(Number.isFinite) ? { tomorrow: next } : {}),
                details: {
                    apparent: numberOrNull(current.apparent_temperature), humidity: numberOrNull(current.relative_humidity_2m),
                    windSpeed: numberOrNull(current.wind_speed_10m), windDirection: numberOrNull(current.wind_direction_10m),
                    gusts: numberOrNull(current.wind_gusts_10m), isDay: current.is_day !== 0,
                    sunrise: localStamp(daily.sunrise?.[0]), sunset: localStamp(daily.sunset?.[0]), days,
                } };
            weatherCache.set(key, { value, expiresAt: Date.now() + 20 * 60_000 });
            return value;
        } catch {
            // Keep a short negative cache to avoid retry storms; the UI reports unavailable.
            weatherCache.set(key, { value: null, expiresAt: Date.now() + 2 * 60_000 });
            return null;
        } finally { pendingWeather.delete(key); }
    })();
    pendingWeather.set(key, work);
    return work;
}

const SESSION_NAMES: Record<string, string> = {
    FirstPractice: 'Practice 1', SecondPractice: 'Practice 2', ThirdPractice: 'Practice 3',
    SprintQualifying: 'Sprint qualifying', Sprint: 'Sprint', Qualifying: 'Qualifying', Race: 'Race',
};

export function normalizeRaceSchedule(races: unknown, now = new Date()): FormulaRace | null {
    if (!Array.isArray(races)) return null;
    const options: FormulaRace[] = [];
    for (const entry of races as JolpicaRace[]) {
        const raceDate = asString(entry?.date, 10), raceTime = asString(entry?.time, 20) || '00:00:00Z';
        const raceDateTime = `${raceDate}T${raceTime}`;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raceDateTime) || Date.parse(raceDateTime) <= now.getTime()) continue;
        const circuit = entry.Circuit ?? {}, place = circuit.Location ?? {};
        const sessions = Object.entries(SESSION_NAMES).flatMap(([key, name]) => {
            const session = entry[key];
            if (!session || typeof session !== 'object') return [];
            const value = session as { date?: unknown; time?: unknown };
            const date = asString(value.date, 10), time = asString(value.time, 20);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}Z$/.test(time)) return [];
            const dateTime = `${date}T${time}`;
            return Number.isFinite(Date.parse(dateTime)) ? [{ name, dateTime }] : [];
        }).sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
        options.push({ name: asString(entry.raceName, 120) || 'Formula 1 Grand Prix',
            circuit: asString(circuit.circuitName, 120), location: asString(place.locality, 100), country: asString(place.country, 100),
            raceDateTime, sessions });
    }
    return options.sort((a, b) => Date.parse(a.raceDateTime) - Date.parse(b.raceDateTime))[0] ?? null;
}

/** The last schedule that loaded, kept through failed refreshes (like the standings). */
const lastGoodSchedule = new Map<string, FormulaRace>();
const upcoming = (race: FormulaRace | null | undefined, now: Date) => race && Date.parse(race.raceDateTime) > now.getTime() ? race : null;

export async function getNextFormulaRace(now = new Date()): Promise<FormulaRace | null> {
    const year = now.getUTCFullYear();
    const key = String(year);
    const cached = scheduleCache.get(key);
    // A cached race that has since started is stale: look for the next one.
    if (cached && cached.expiresAt > Date.now() && (cached.value === null || upcoming(cached.value, now))) return cached.value;
    const pending = pendingSchedule.get(key);
    if (pending) return pending;
    const work = (async () => {
        let failure = '';
        try {
            for (const season of [year, year + 1]) {
                const response = await safeFetch(`https://api.jolpi.ca/ergast/f1/${season}/races.json?limit=100`, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
                if (!response.ok) { failure = `HTTP ${response.status}`; await response.body?.cancel().catch(() => undefined); continue; }
                // The fetch timeout covers the headers only; bound the body read too.
                let timer: NodeJS.Timeout | undefined;
                const text = await Promise.race([readCappedText(response, 512 * 1024),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Schedule body timed out')), 10_000); })])
                    .finally(() => clearTimeout(timer));
                const data = JSON.parse(text) as { MRData?: { RaceTable?: { Races?: unknown } } };
                const race = normalizeRaceSchedule(data.MRData?.RaceTable?.Races, now);
                if (race) {
                    scheduleCache.set(key, { value: race, expiresAt: Date.now() + 6 * 60 * 60_000 });
                    lastGoodSchedule.set(key, race);
                    return race;
                }
            }
            if (!failure) {
                // Both seasons answered and neither has a race to come.
                scheduleCache.set(key, { value: null, expiresAt: Date.now() + 60 * 60_000 });
                return null;
            }
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
        } finally { pendingSchedule.delete(key); }
        // A failed refresh (rate limit, timeout, network) keeps the last good
        // schedule and tries again in 5 minutes, instead of blanking the card.
        logger.warn('familyhub.f1_schedule_failed', { error: failure });
        const stale = upcoming(lastGoodSchedule.get(key), now);
        scheduleCache.set(key, { value: stale, expiresAt: Date.now() + 5 * 60_000 });
        return stale;
    })();
    pendingSchedule.set(key, work);
    return work;
}

const familyDate = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dayKey = (value: unknown) => typeof value === 'string' ? value.slice(0, 10) : '';

export async function loadAmbientSnapshot(familyId: string) {
    const [settings, google, noteResult, timeZoneResult, legendResult] = await Promise.all([
        readAmbientSettings(familyId), syncGoogle(familyId),
        query('SELECT id FROM users WHERE id=$1', [familyId]),
        query('SELECT time_zone FROM familyhub_google_settings WHERE family_id=$1', [familyId]),
        query('SELECT labels FROM familyhub_calendar_legend WHERE family_id=$1', [familyId]),
    ]);
    if (!noteResult.rows.length) throw new Error('Family is unavailable.');
    const timeZone = asString(timeZoneResult.rows[0]?.time_zone, 80) || 'America/New_York';
    const legendRow = legendResult.rows[0]?.labels;
    const legend: Record<string, unknown> = legendRow && typeof legendRow === 'object' && !Array.isArray(legendRow) ? legendRow : {};
    const today = familyDate(new Date(), timeZone);
    const choresResult = await query(`SELECT t.id, t.title, t.due_date, t.is_completed, t.points,
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'name',m.name,'color',m.color))
            FROM family_members m WHERE m.user_id=t.user_id
              AND m.id::text IN (SELECT jsonb_array_elements_text(COALESCE(t.assigned_to,'[]'::jsonb)))), '[]'::json) AS members
        FROM tasks t WHERE t.user_id=$1 AND t.due_date::date=$2::date
        ORDER BY t.is_completed ASC, t.due_date ASC, t.created_at DESC LIMIT 10`, [familyId, today]);
    const extras = await readExtras(familyId);
    const shown = shownModules(settings.layout);
    // The layout decides what the display shows; each quick card still needs its own setup.
    const extraSettings = { ...extras.settings,
        wifi: { ...extras.settings.wifi, enabled: shown.has('wifi') }, countdown: { ...extras.settings.countdown, enabled: shown.has('countdown') },
        markets: { ...extras.settings.markets, enabled: shown.has('markets') }, photos: { ...extras.settings.photos, enabled: shown.has('photos') || settings.screensaver.enabled } };
    // The screensaver shows the same uploaded photos, so they are sent when it is on even if Family photos is not on the display.
    const [weather, race, news, aqi, standings, markets, photoRows] = await Promise.all([
        getAmbientWeather(settings.location, extraSettings.weather.unit), getNextFormulaRace(),
        settings.widgets.includes('news') ? getNews(extraSettings.news.feeds) : Promise.resolve(null),
        settings.widgets.includes('weather') && extraSettings.weather.showAqi ? getAirQuality(settings.location) : Promise.resolve(null),
        settings.widgets.includes('f1') && (extraSettings.formula1.showDrivers || extraSettings.formula1.showConstructors)
            ? getStandings(extraSettings.formula1.season, extraSettings.formula1.pollMinutes,
                { team: extraSettings.formula1.favoriteTeam, driver: extraSettings.formula1.favoriteDriver })
            : Promise.resolve(null),
        getMarkets(familyId, extraSettings.markets, extras.secrets),
        extraSettings.photos.enabled ? listPhotos(familyId) : Promise.resolve([]),
    ]);
    // The display receives only the fields it renders: the next 7 days of
    // events (the Google loader's window) and open tasks, for its detail panels.
    const events = (Array.isArray(google.events) ? google.events : []).slice(0, 80).map((item) => {
        const event = item as Record<string, any>;
        const time = (value: any) => value && typeof value === 'object'
            ? { ...(typeof value.date === 'string' ? { date: value.date.slice(0, 10) } : {}), ...(typeof value.dateTime === 'string' ? { dateTime: value.dateTime.slice(0, 40) } : {}) }
            : {};
        // Google's event colour (or the calendar's), shown as a small box beside the
        // event, with the household's colour-legend label when one is set.
        const color = typeof event.color === 'string' && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color.toLowerCase() : undefined;
        const colorLabel = color && typeof legend[color] === 'string' ? asString(legend[color], 60) || undefined : undefined;
        return { id: asString(event.id, 200), title: asString(event.title, 160), location: asString(event.location, 160) || undefined,
            start: time(event.start), end: time(event.end), allDay: Boolean(event.allDay), color, colorLabel };
    });
    const tasks = (Array.isArray(google.tasks) ? google.tasks : []).filter((item) => {
        const task = item as Record<string, unknown>;
        return task.completed !== true;
    }).slice(0, 40).map((item) => {
        const task = item as Record<string, unknown>;
        return { id: asString(task.id, 200), title: asString(task.title, 200), completed: false, dueDate: asString(task.dueDate, 40) || null };
    });
    const notifications = (Array.isArray(google.daycare) ? google.daycare : []).slice(0, 5).map((item) => {
        const update = item as Record<string, unknown>;
        return { id: asString(update.id, 160), title: asString(update.title, 120) || 'Daycare update',
            summary: asString(update.text, 500).split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 110) || '',
            details: asString(update.text, 1200).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n').slice(0, 900),
            receivedAt: asString(update.receivedAt, 40), kind: asString(update.kind, 30), hasDetails: Boolean(update.hasDetails) };
    });
    const sourceTimes = Object.values(google.sources ?? {}).flatMap((source: any) => source.lastSuccess ? [source.lastSuccess] : []);
    if (weather?.fetchedAt) sourceTimes.push(weather.fetchedAt);
    return {
        generatedAt: new Date().toISOString(), timeZone, today,
        settings, events, tasks,
        chores: choresResult.rows.map((row) => ({ id: String(row.id), title: asString(row.title, 160), dueDate: dayKey(row.due_date), completed: Boolean(row.is_completed), points: Number(row.points) || 0, members: row.members ?? [] })),
        notifications,
        weather: { data: weather, state: weather ? 'fresh' : settings.location ? 'unavailable' : 'unconfigured', place: settings.location ? `${settings.location.city}, ${settings.location.country}` : null },
        formula1: { data: race, state: race ? 'fresh' : 'unavailable' },
        news: news ?? { items: [], state: 'disabled', label: '' },
        // v1.2: detail panels and the quick bar. Everything here is computed on
        // the Pi; the display only lays it out (and ticks the countdown seconds).
        extras: {
            weather: buildWeatherPanel(weather, aqi, extraSettings.weather),
            formula1: standings ? { ...standings, showDrivers: extraSettings.formula1.showDrivers, showConstructors: extraSettings.formula1.showConstructors } : null,
            wifi: buildWifi(extraSettings.wifi, extras.secrets),
            countdown: buildCountdown(extraSettings.countdown, timeZone),
            markets: markets ? { ...markets, enabled: true } : null,
            photos: extraSettings.photos.enabled && photoRows.length
                ? { intervalSeconds: extraSettings.photos.intervalSeconds, ids: photoRows.map((row) => row.id) }
                : null,
            serverTime: new Date().toISOString(),
        },
        sources: google.sources,
        lastSuccessfulRefresh: sourceTimes.sort().at(-1) ?? null,
    };
}
