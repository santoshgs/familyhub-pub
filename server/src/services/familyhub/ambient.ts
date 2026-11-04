import { query } from '../../db';
import { readCappedText, safeFetch } from '../../lib/safeFetch';
import { syncGoogle } from './google/runtime';
import { getNews } from './news';

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
}
export interface AmbientSettings {
    location: null | { city: string; country: string; latitude: number; longitude: number };
    widgets: AmbientWidget[];
    night: NightDimming;
}
const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DEFAULT_NIGHT: NightDimming = { enabled: false, start: '22:00', end: '07:00', brightness: 15 };

interface CacheEntry<T> { expiresAt: number; value: T }
const weatherCache = new Map<string, CacheEntry<AmbientWeather | null>>();
const scheduleCache = new Map<string, CacheEntry<FormulaRace | null>>();
const pendingWeather = new Map<string, Promise<AmbientWeather | null>>();
const pendingSchedule = new Map<string, Promise<FormulaRace | null>>();

export interface AmbientWeather {
    temperature: number;
    weatherCode: number;
    high: number;
    low: number;
    timezone: string;
    fetchedAt: string;
    tomorrow?: { weatherCode: number; high: number; low: number };
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
        night_enabled, night_start, night_end, night_brightness
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
    } : { ...DEFAULT_NIGHT };
    return { location, widgets: widgets.length ? widgets : [...DEFAULT_AMBIENT_WIDGETS], night };
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
    return { enabled: night.enabled, start: night.start, end: night.end, brightness };
}

export async function saveAmbientSettings(familyId: string, input: unknown): Promise<AmbientSettings> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid display settings.');
    const value = input as { location?: unknown; widgets?: unknown; night?: unknown };
    let city: string | null = null, country: string | null = null, lat: number | null = null, lon: number | null = null;
    if (value.location !== null && value.location !== undefined) {
        if (!value.location || typeof value.location !== 'object' || Array.isArray(value.location)) throw new Error('Choose a weather location from the list.');
        const selected = value.location as Record<string, unknown>;
        city = asString(selected.city, 100); country = asString(selected.country, 100);
        lat = typeof selected.latitude === 'number' ? selected.latitude : Number.NaN;
        lon = typeof selected.longitude === 'number' ? selected.longitude : Number.NaN;
        if (!city || !country || !validCoordinate(lat, lon)) throw new Error('Choose a valid weather location.');
    }
    if (!Array.isArray(value.widgets) || value.widgets.length < 1 || value.widgets.length > AMBIENT_WIDGETS.length
        || value.widgets.some((widget) => typeof widget !== 'string' || !AMBIENT_WIDGETS.includes(widget as AmbientWidget))
        || new Set(value.widgets).size !== value.widgets.length) throw new Error('Choose one or more available display cards.');
    const night = value.night === undefined ? (await readAmbientSettings(familyId)).night : parseNight(value.night);
    await query(`INSERT INTO familyhub_ambient_settings (family_id,weather_city,weather_country,weather_latitude,weather_longitude,enabled_widgets,
            night_enabled,night_start,night_end,night_brightness,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now())
        ON CONFLICT (family_id) DO UPDATE SET weather_city=$2,weather_country=$3,weather_latitude=$4,weather_longitude=$5,enabled_widgets=$6::jsonb,
            night_enabled=$7,night_start=$8,night_end=$9,night_brightness=$10,updated_at=now()`,
    [familyId, city, country, lat, lon, JSON.stringify(value.widgets), night.enabled, night.start, night.end, night.brightness]);
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

export async function getAmbientWeather(location: AmbientSettings['location']): Promise<AmbientWeather | null> {
    if (!location) return null;
    const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const cached = weatherCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingWeather.get(key);
    if (pending) return pending;
    const work = (async () => {
        try {
            const params = new URLSearchParams({
                latitude: String(location.latitude), longitude: String(location.longitude),
                current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
                forecast_days: '2', timezone: 'auto', temperature_unit: 'celsius',
            });
            const response = await safeFetch(`https://api.open-meteo.com/v1/forecast?${params}`, { timeoutMs: 8_000, maxBytes: 128 * 1024 });
            if (!response.ok) throw new Error('Weather service unavailable.');
            const data = JSON.parse(await readCappedText(response, 128 * 1024)) as {
                current?: { temperature_2m?: unknown; weather_code?: unknown };
                daily?: { weather_code?: unknown[]; temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[] };
                timezone?: unknown;
            };
            const temperature = Number(data.current?.temperature_2m), weatherCode = Number(data.current?.weather_code);
            const high = Number(data.daily?.temperature_2m_max?.[0]), low = Number(data.daily?.temperature_2m_min?.[0]);
            if (![temperature, weatherCode, high, low].every(Number.isFinite)) throw new Error('Invalid weather response.');
            const next = { weatherCode: Number(data.daily?.weather_code?.[1]), high: Number(data.daily?.temperature_2m_max?.[1]), low: Number(data.daily?.temperature_2m_min?.[1]) };
            const value: AmbientWeather = { temperature, weatherCode, high, low, timezone: asString(data.timezone, 80) || 'UTC', fetchedAt: new Date().toISOString(),
                ...([next.weatherCode, next.high, next.low].every(Number.isFinite) ? { tomorrow: next } : {}) };
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

export async function getNextFormulaRace(now = new Date()): Promise<FormulaRace | null> {
    const year = now.getUTCFullYear();
    const key = String(year);
    const cached = scheduleCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingSchedule.get(key);
    if (pending) return pending;
    const work = (async () => {
        try {
            for (const season of [year, year + 1]) {
                const response = await safeFetch(`https://api.jolpi.ca/ergast/f1/${season}/races.json?limit=100`, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
                if (!response.ok) continue;
                const data = JSON.parse(await readCappedText(response, 512 * 1024)) as { MRData?: { RaceTable?: { Races?: unknown } } };
                const race = normalizeRaceSchedule(data.MRData?.RaceTable?.Races, now);
                if (race) {
                    scheduleCache.set(key, { value: race, expiresAt: Date.now() + 6 * 60 * 60_000 });
                    return race;
                }
            }
            scheduleCache.set(key, { value: null, expiresAt: Date.now() + 60 * 60_000 });
            return null;
        } catch {
            scheduleCache.set(key, { value: null, expiresAt: Date.now() + 10 * 60_000 });
            return null;
        } finally { pendingSchedule.delete(key); }
    })();
    pendingSchedule.set(key, work);
    return work;
}

const familyDate = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dayKey = (value: unknown) => typeof value === 'string' ? value.slice(0, 10) : '';

export async function loadAmbientSnapshot(familyId: string) {
    const [settings, google, noteResult, timeZoneResult] = await Promise.all([
        readAmbientSettings(familyId), syncGoogle(familyId),
        query('SELECT id FROM users WHERE id=$1', [familyId]),
        query('SELECT time_zone FROM familyhub_google_settings WHERE family_id=$1', [familyId]),
    ]);
    if (!noteResult.rows.length) throw new Error('Family is unavailable.');
    const timeZone = asString(timeZoneResult.rows[0]?.time_zone, 80) || 'America/New_York';
    const today = familyDate(new Date(), timeZone);
    const choresResult = await query(`SELECT t.id, t.title, t.due_date, t.is_completed, t.points,
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'name',m.name,'color',m.color))
            FROM family_members m WHERE m.user_id=t.user_id
              AND m.id::text IN (SELECT jsonb_array_elements_text(COALESCE(t.assigned_to,'[]'::jsonb)))), '[]'::json) AS members
        FROM tasks t WHERE t.user_id=$1 AND t.due_date::date=$2::date
        ORDER BY t.is_completed ASC, t.due_date ASC, t.created_at DESC LIMIT 10`, [familyId, today]);
    const [weather, race, news] = await Promise.all([getAmbientWeather(settings.location), getNextFormulaRace(),
        settings.widgets.includes('news') ? getNews() : Promise.resolve(null)]);
    // The display receives only the fields it renders: the next 7 days of
    // events (the Google loader's window) and open tasks, for its detail panels.
    const events = (Array.isArray(google.events) ? google.events : []).slice(0, 80).map((item) => {
        const event = item as Record<string, any>;
        const time = (value: any) => value && typeof value === 'object'
            ? { ...(typeof value.date === 'string' ? { date: value.date.slice(0, 10) } : {}), ...(typeof value.dateTime === 'string' ? { dateTime: value.dateTime.slice(0, 40) } : {}) }
            : {};
        return { id: asString(event.id, 200), title: asString(event.title, 160), location: asString(event.location, 160) || undefined,
            start: time(event.start), end: time(event.end), allDay: Boolean(event.allDay) };
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
        news: news ?? { items: [], state: 'disabled' },
        sources: google.sources,
        lastSuccessfulRefresh: sourceTimes.sort().at(-1) ?? null,
    };
}
