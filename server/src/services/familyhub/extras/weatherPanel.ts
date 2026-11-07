import { readCappedText, safeFetch } from '../../../lib/safeFetch';
import type { AmbientWeather } from '../ambient';
import { moonPhase, type MoonPhase } from './astronomy';
import type { DashboardExtrasSettings } from './settings';

/**
 * Everything the weather detail panel shows, computed on the Pi: AQI level and
 * colour, the sun's progress through the day, compass wind direction, the moon,
 * and each forecast day's temperature bar position on a shared scale.
 */

interface CacheEntry<T> { value: T; expiresAt: number }
const aqiCache = new Map<string, CacheEntry<AirQuality | null>>();
const pendingAqi = new Map<string, Promise<AirQuality | null>>();

export interface AirQuality { usAqi: number; pm25: number | null; level: string; tone: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very' | 'hazardous' }

/** US EPA AQI categories. */
export function aqiLevel(value: number): Pick<AirQuality, 'level' | 'tone'> {
    if (value <= 50) return { level: 'Good', tone: 'good' };
    if (value <= 100) return { level: 'Moderate', tone: 'moderate' };
    if (value <= 150) return { level: 'Unhealthy for sensitive groups', tone: 'sensitive' };
    if (value <= 200) return { level: 'Unhealthy', tone: 'unhealthy' };
    if (value <= 300) return { level: 'Very unhealthy', tone: 'very' };
    return { level: 'Hazardous', tone: 'hazardous' };
}

export async function getAirQuality(location: { latitude: number; longitude: number } | null): Promise<AirQuality | null> {
    if (!location) return null;
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    const cached = aqiCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = pendingAqi.get(key);
    if (pending) return pending;
    const work = (async () => {
        try {
            const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'us_aqi,pm2_5', timezone: 'auto' });
            const response = await safeFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, { timeoutMs: 8_000, maxBytes: 64 * 1024 });
            if (!response.ok) throw new Error('Air quality unavailable.');
            const data = JSON.parse(await readCappedText(response, 64 * 1024)) as { current?: { us_aqi?: unknown; pm2_5?: unknown } };
            const usAqi = Number(data.current?.us_aqi);
            if (!Number.isFinite(usAqi)) throw new Error('Invalid air quality response.');
            const pm = Number(data.current?.pm2_5);
            const value: AirQuality = { usAqi: Math.round(usAqi), pm25: Number.isFinite(pm) ? Math.round(pm * 10) / 10 : null, ...aqiLevel(usAqi) };
            aqiCache.set(key, { value, expiresAt: Date.now() + 30 * 60_000 });
            return value;
        } catch {
            aqiCache.set(key, { value: null, expiresAt: Date.now() + 5 * 60_000 });
            return null;
        } finally { pendingAqi.delete(key); }
    })();
    pendingAqi.set(key, work);
    return work;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (degrees: number | null): string | null =>
    degrees === null ? null : COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

/** "YYYY-MM-DDTHH:MM" for the current time in a time zone. */
const localNow = (now: Date, timeZone: string): string => {
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            .formatToParts(now).map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    } catch {
        return now.toISOString().slice(0, 16);
    }
};
const minutesOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));

export interface WeatherPanel {
    unit: '°C' | '°F';
    windUnit: 'km/h' | 'mph';
    current: { temperature: number; apparent: number | null; humidity: number | null; windSpeed: number | null; windCompass: string | null; gusts: number | null; weatherCode: number; high: number; low: number; isDay: boolean };
    sun: null | { sunrise: string; sunset: string; daylight: string; progress: number; isUp: boolean };
    aqi: AirQuality | null;
    moon: MoonPhase | null;
    days: Array<{ date: string; weatherCode: number; high: number; low: number; precipitation: number | null; barLeft: number; barWidth: number }>;
    forecastDays: number;
}

export function buildWeatherPanel(weather: AmbientWeather | null, aqi: AirQuality | null, settings: DashboardExtrasSettings['weather'], now = new Date()): WeatherPanel | null {
    if (!weather) return null;
    const details = weather.details;
    const days = (details?.days ?? []).slice(0, settings.forecastDays);
    const lowest = Math.min(...days.map((day) => day.low)), highest = Math.max(...days.map((day) => day.high));
    const span = Math.max(1, highest - lowest);
    let sun: WeatherPanel['sun'] = null;
    if (details?.sunrise && details.sunset) {
        const rise = minutesOf(details.sunrise), set = minutesOf(details.sunset), current = minutesOf(localNow(now, weather.timezone));
        const length = Math.max(1, set - rise);
        sun = {
            sunrise: details.sunrise, sunset: details.sunset,
            daylight: `${Math.floor(length / 60)} h ${String(length % 60).padStart(2, '0')} min`,
            progress: Math.round(Math.min(1, Math.max(0, (current - rise) / length)) * 100) / 100,
            isUp: current >= rise && current < set,
        };
    }
    const round = (n: number) => Math.round(n);
    return {
        unit: weather.unit === 'fahrenheit' ? '°F' : '°C',
        windUnit: weather.unit === 'fahrenheit' ? 'mph' : 'km/h',
        current: {
            temperature: round(weather.temperature), apparent: details?.apparent === null || details?.apparent === undefined ? null : round(details.apparent),
            humidity: details?.humidity ?? null, windSpeed: details?.windSpeed === null || details?.windSpeed === undefined ? null : round(details.windSpeed),
            windCompass: compass(details?.windDirection ?? null), gusts: details?.gusts === null || details?.gusts === undefined ? null : round(details.gusts),
            weatherCode: weather.weatherCode, high: round(weather.high), low: round(weather.low), isDay: details?.isDay ?? true,
        },
        sun,
        aqi: settings.showAqi ? aqi : null,
        moon: settings.showMoon ? moonPhase(now) : null,
        days: days.map((day) => ({
            ...day, high: round(day.high), low: round(day.low),
            barLeft: Math.round(((day.low - lowest) / span) * 100),
            barWidth: Math.max(4, Math.round(((day.high - day.low) / span) * 100)),
        })),
        forecastDays: settings.forecastDays,
    };
}
