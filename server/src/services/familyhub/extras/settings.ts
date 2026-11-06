import { query } from '../../../db';
import { decryptCredentials, encryptCredentials } from '../../../utils/crypto';

/**
 * Settings for the v1.2 dashboard additions, one validated JSON document per
 * family (familyhub_dashboard_extras). Secrets live apart from it, encrypted.
 * Every field is validated here; the client never decides what is stored.
 */

export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type WifiEncryption = 'WPA' | 'WEP' | 'nopass';
export type MarketCurrency = 'USD' | 'CAD' | 'INR';

export interface ChecklistItem { text: string; done: boolean }

export interface DashboardExtrasSettings {
    weather: { forecastDays: 7 | 14; unit: TemperatureUnit; showAqi: boolean; showMoon: boolean };
    formula1: { season: string; pollMinutes: number; showDrivers: boolean; showConstructors: boolean; favoriteTeam: string; favoriteDriver: string };
    wifi: { enabled: boolean; ssid: string; encryption: WifiEncryption; hidden: boolean };
    countdown: { enabled: boolean; title: string; target: string; checklist: ChecklistItem[] };
    markets: { enabled: boolean; stocks: string[]; crypto: string[]; currency: MarketCurrency };
    photos: { enabled: boolean; intervalSeconds: number };
}

export interface DashboardSecrets { wifiPassword?: string; finnhubKey?: string; coingeckoKey?: string }

/** Index trackers always shown first (free market-data plans quote ETFs, not indices). */
export const INDEX_TRACKERS: ReadonlyArray<{ symbol: string; name: string }> = [
    { symbol: 'SPY', name: 'S&P 500' },
    { symbol: 'QQQ', name: 'NASDAQ-100' },
    { symbol: 'DIA', name: 'Dow Jones' },
];

export const DEFAULT_EXTRAS: DashboardExtrasSettings = {
    weather: { forecastDays: 7, unit: 'celsius', showAqi: true, showMoon: true },
    formula1: { season: 'current', pollMinutes: 360, showDrivers: true, showConstructors: true, favoriteTeam: 'ferrari', favoriteDriver: '' },
    wifi: { enabled: false, ssid: '', encryption: 'WPA', hidden: false },
    countdown: { enabled: false, title: '', target: '', checklist: [] },
    markets: { enabled: false, stocks: [], crypto: ['BTC', 'ETH'], currency: 'USD' },
    photos: { enabled: false, intervalSeconds: 12 },
};

export const LOCAL_DATETIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const STOCK_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const CRYPTO_SYMBOL = /^[A-Z0-9]{2,10}$/;
const ERGAST_ID = /^[a-z0-9_]{0,40}$/;
const MAX_SYMBOLS = 8;
const MAX_CHECKLIST = 20;

export class ExtrasValidationError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new ExtrasValidationError(message); };
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const cleanText = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

const symbolList = (value: unknown, pattern: RegExp, label: string): string[] => {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const symbols = [...new Set(raw.map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
    if (symbols.length > MAX_SYMBOLS) fail(`Choose at most ${MAX_SYMBOLS} ${label}.`);
    const bad = symbols.find((symbol) => !pattern.test(symbol));
    if (bad) fail(`“${bad.slice(0, 12)}” is not a valid ${label.replace(/s$/, '')} symbol.`);
    return symbols;
};

/**
 * Validates a settings document. Missing sections or fields keep their stored
 * (or default) values; present ones must be valid.
 */
export function parseExtrasSettings(input: unknown, base: DashboardExtrasSettings = DEFAULT_EXTRAS): DashboardExtrasSettings {
    if (!isRecord(input)) fail('Invalid dashboard settings.');
    const value = input as Record<string, unknown>;
    const out: DashboardExtrasSettings = JSON.parse(JSON.stringify(base));

    if (value.weather !== undefined) {
        if (!isRecord(value.weather)) fail('Invalid weather settings.');
        const w = value.weather as Record<string, unknown>;
        if (w.forecastDays !== undefined) out.weather.forecastDays = w.forecastDays === 14 ? 14 : w.forecastDays === 7 ? 7 : fail('Forecast length is 7 or 14 days.');
        if (w.unit !== undefined) out.weather.unit = w.unit === 'fahrenheit' ? 'fahrenheit' : w.unit === 'celsius' ? 'celsius' : fail('Choose Celsius or Fahrenheit.');
        out.weather.showAqi = bool(w.showAqi, out.weather.showAqi);
        out.weather.showMoon = bool(w.showMoon, out.weather.showMoon);
    }

    if (value.formula1 !== undefined) {
        if (!isRecord(value.formula1)) fail('Invalid Formula 1 settings.');
        const f = value.formula1 as Record<string, unknown>;
        if (f.season !== undefined) {
            const season = String(f.season).trim().toLowerCase();
            const year = Number(season);
            if (season === 'current') out.formula1.season = 'current';
            else if (/^\d{4}$/.test(season) && year >= 1950 && year <= new Date().getUTCFullYear() + 1) out.formula1.season = season;
            else fail('Season is “current” or a year from 1950.');
        }
        if (f.pollMinutes !== undefined) {
            const minutes = Number(f.pollMinutes);
            if (!Number.isInteger(minutes) || minutes < 30 || minutes > 1440) fail('Standings refresh between every 30 minutes and once a day.');
            out.formula1.pollMinutes = minutes;
        }
        out.formula1.showDrivers = bool(f.showDrivers, out.formula1.showDrivers);
        out.formula1.showConstructors = bool(f.showConstructors, out.formula1.showConstructors);
        for (const key of ['favoriteTeam', 'favoriteDriver'] as const) {
            if (f[key] === undefined) continue;
            const id = cleanText(f[key], 40).toLowerCase();
            if (!ERGAST_ID.test(id)) fail('Choose a team or driver from the list.');
            out.formula1[key] = id;
        }
    }

    if (value.wifi !== undefined) {
        if (!isRecord(value.wifi)) fail('Invalid guest Wi-Fi settings.');
        const w = value.wifi as Record<string, unknown>;
        out.wifi.enabled = bool(w.enabled, out.wifi.enabled);
        if (w.ssid !== undefined) {
            const ssid = cleanText(w.ssid, 64);
            if (Buffer.byteLength(ssid) > 32) fail('A network name is at most 32 bytes.');
            out.wifi.ssid = ssid;
        }
        if (w.encryption !== undefined) {
            out.wifi.encryption = w.encryption === 'WPA' || w.encryption === 'WEP' || w.encryption === 'nopass' ? w.encryption : fail('Choose WPA/WPA2, WEP or Open.');
        }
        out.wifi.hidden = bool(w.hidden, out.wifi.hidden);
        if (out.wifi.enabled && !out.wifi.ssid) fail('Enter the guest network name.');
    }

    if (value.countdown !== undefined) {
        if (!isRecord(value.countdown)) fail('Invalid countdown settings.');
        const c = value.countdown as Record<string, unknown>;
        out.countdown.enabled = bool(c.enabled, out.countdown.enabled);
        if (c.title !== undefined) out.countdown.title = cleanText(c.title, 60);
        if (c.target !== undefined) {
            const target = cleanText(c.target, 16);
            if (target && !LOCAL_DATETIME.test(target)) fail('Choose a valid target date and time.');
            out.countdown.target = target;
        }
        if (c.checklist !== undefined) {
            if (!Array.isArray(c.checklist) || c.checklist.length > MAX_CHECKLIST) fail(`A checklist has at most ${MAX_CHECKLIST} items.`);
            out.countdown.checklist = (c.checklist as unknown[]).flatMap((item) => {
                const entry = isRecord(item) ? item : { text: item, done: false };
                const text = cleanText(entry.text, 120);
                return text ? [{ text, done: entry.done === true }] : [];
            });
        }
        if (out.countdown.enabled && (!out.countdown.title || !out.countdown.target)) fail('Give the countdown a title and a date.');
    }

    if (value.markets !== undefined) {
        if (!isRecord(value.markets)) fail('Invalid market settings.');
        const m = value.markets as Record<string, unknown>;
        out.markets.enabled = bool(m.enabled, out.markets.enabled);
        if (m.stocks !== undefined) {
            const indexSymbols = new Set(INDEX_TRACKERS.map((tracker) => tracker.symbol));
            out.markets.stocks = symbolList(m.stocks, STOCK_SYMBOL, 'stocks').filter((symbol) => !indexSymbols.has(symbol));
        }
        if (m.crypto !== undefined) out.markets.crypto = symbolList(m.crypto, CRYPTO_SYMBOL, 'coins');
        if (m.currency !== undefined) {
            out.markets.currency = m.currency === 'USD' || m.currency === 'CAD' || m.currency === 'INR' ? m.currency : fail('Choose USD, CAD or INR.');
        }
    }

    if (value.photos !== undefined) {
        if (!isRecord(value.photos)) fail('Invalid photo settings.');
        const p = value.photos as Record<string, unknown>;
        out.photos.enabled = bool(p.enabled, out.photos.enabled);
        if (p.intervalSeconds !== undefined) {
            const seconds = Number(p.intervalSeconds);
            if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) fail('The slideshow interval is 5 to 60 seconds.');
            out.photos.intervalSeconds = seconds;
        }
    }
    return out;
}

/** Stored documents are re-validated on read, so an old or damaged row falls back to defaults. */
const fromStored = (stored: unknown): DashboardExtrasSettings => {
    if (!isRecord(stored)) return JSON.parse(JSON.stringify(DEFAULT_EXTRAS));
    let merged: DashboardExtrasSettings = JSON.parse(JSON.stringify(DEFAULT_EXTRAS));
    for (const section of Object.keys(DEFAULT_EXTRAS) as Array<keyof DashboardExtrasSettings>) {
        const part = stored[section];
        if (!isRecord(part)) continue;
        try {
            merged = parseExtrasSettings({ [section]: part }, merged);
        } catch {
            // A section that no longer validates as enabled is kept, switched off.
            try { merged = parseExtrasSettings({ [section]: { ...part, enabled: false } }, merged); } catch { /* default */ }
        }
    }
    return merged;
};

export async function readExtras(familyId: string): Promise<{ settings: DashboardExtrasSettings; secrets: DashboardSecrets }> {
    const result = await query('SELECT settings, encrypted_secrets FROM familyhub_dashboard_extras WHERE family_id = $1', [familyId]);
    const row = result.rows[0] as { settings?: unknown; encrypted_secrets?: string | null } | undefined;
    let secrets: DashboardSecrets = {};
    if (row?.encrypted_secrets) {
        try { secrets = decryptCredentials(row.encrypted_secrets) as DashboardSecrets; } catch { secrets = {}; }
    }
    return { settings: fromStored(row?.settings), secrets };
}

/** What management pages see: settings plus which secrets are set, never their values. */
export const publicView = (settings: DashboardExtrasSettings, secrets: DashboardSecrets) => ({
    ...settings,
    secrets: { wifiPassword: Boolean(secrets.wifiPassword), finnhubKey: Boolean(secrets.finnhubKey), coingeckoKey: Boolean(secrets.coingeckoKey) },
    indexTrackers: INDEX_TRACKERS,
});

const SECRET_LIMITS: Record<keyof DashboardSecrets, number> = { wifiPassword: 63, finnhubKey: 128, coingeckoKey: 128 };

/**
 * Saves settings and secret changes. For each secret: undefined keeps it, null
 * or '' clears it, a string replaces it.
 */
export async function saveExtras(familyId: string, input: unknown): Promise<{ settings: DashboardExtrasSettings; secrets: DashboardSecrets }> {
    if (!isRecord(input)) fail('Invalid dashboard settings.');
    const current = await readExtras(familyId);
    const { secrets: secretInput, ...rest } = input as Record<string, unknown>;
    const settings = parseExtrasSettings(rest, current.settings);
    const secrets: DashboardSecrets = { ...current.secrets };
    if (secretInput !== undefined) {
        if (!isRecord(secretInput)) fail('Invalid secrets.');
        for (const key of Object.keys(SECRET_LIMITS) as Array<keyof DashboardSecrets>) {
            const next = (secretInput as Record<string, unknown>)[key];
            if (next === undefined) continue;
            if (next === null || next === '') { delete secrets[key]; continue; }
            if (typeof next !== 'string' || next.length > SECRET_LIMITS[key] || /[\u0000-\u001f\u007f]/.test(next)) fail('A password or key has an invalid format.');
            if (key !== 'wifiPassword' && !/^[A-Za-z0-9_-]{8,128}$/.test(next as string)) fail('Paste the whole API key.');
            if (key === 'wifiPassword' && (next as string).length < 8 && settings.wifi.encryption === 'WPA') fail('A WPA password has at least 8 characters.');
            secrets[key] = next as string;
        }
    }
    if (settings.wifi.enabled && settings.wifi.encryption !== 'nopass' && !secrets.wifiPassword) fail('Enter the guest network password, or choose Open.');
    const encrypted = Object.keys(secrets).length ? encryptCredentials(secrets as Record<string, string>) : null;
    await query(`INSERT INTO familyhub_dashboard_extras (family_id, settings, encrypted_secrets, updated_at)
        VALUES ($1, $2::jsonb, $3, now())
        ON CONFLICT (family_id) DO UPDATE SET settings = $2::jsonb, encrypted_secrets = $3, updated_at = now()`,
    [familyId, JSON.stringify(settings), encrypted]);
    return { settings, secrets };
}
