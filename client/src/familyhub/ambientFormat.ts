import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Moon, Sun } from 'lucide-react';

/** WMO weather codes (Open-Meteo) as words and icons, shared by the display's card and panels. */
export const weatherLabel = (code: number) => code === 0 ? 'Clear sky' : code <= 3 ? 'Partly cloudy' : code === 45 || code === 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 || (code >= 80 && code <= 82) ? 'Rain' : code <= 77 || code === 85 || code === 86 ? 'Snow' : code >= 95 ? 'Thunderstorms' : 'Current conditions';
export const weatherGlyph = (code: number, isDay: boolean) => {
    if (code === 0) return isDay ? Sun : Moon;
    if (code <= 3) return CloudSun;
    if (code === 45 || code === 48) return CloudFog;
    if (code <= 57) return CloudDrizzle;
    if (code <= 67 || (code >= 80 && code <= 82)) return CloudRain;
    if (code <= 77 || code === 85 || code === 86) return CloudSnow;
    if (code >= 95) return CloudLightning;
    return Cloud;
};

/**
 * Cached date formatters. Building an Intl.DateTimeFormat is slow on the frame's
 * Android 6 WebView, and the display formats dozens of times per render (every
 * detail panel opening re-rendered them all), so each locale/options pair is
 * built once.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        if (formatters.size > 200) formatters.clear();
        formatters.set(key, formatter);
    }
    return formatter;
}
