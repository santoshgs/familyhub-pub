import { readCappedText, safeFetch } from '../../../lib/safeFetch';
import logger from '../../../lib/logger';
import { INDEX_TRACKERS, type DashboardExtrasSettings, type DashboardSecrets, type MarketCurrency } from './settings';

/**
 * Stocks and crypto for the quick bar and the markets panel.
 *
 * Prices are fetched three times per US trading day (around the open, mid-day
 * and the close, New York time) and once when the settings change, not on every
 * display refresh: a wall frame does not need tick data, and free plans stay far
 * below their limits. Stocks come from Finnhub (the household's API key) and
 * crypto from CoinGecko (keyless, or with a demo key). CoinGecko's BTC-based
 * exchange rates convert US-dollar stock prices to CAD or INR.
 */

const MARKET_ZONE = 'America/New_York';
/** Minutes after midnight, New York time: 9:35, 12:30, 16:05. */
export const MARKET_SLOTS = [9 * 60 + 35, 12 * 60 + 30, 16 * 60 + 5];
const RETRY_AFTER_FAILURE_MS = 20 * 60_000;

export interface Quote { symbol: string; name: string; price: number; change: number; changePercent: number; kind: 'index' | 'stock' | 'crypto' }
export interface MarketData {
    currency: MarketCurrency;
    stocks: Quote[];
    crypto: Quote[];
    fetchedAt: string;
    /** Which part could not be loaded and why, in plain words. */
    notes: string[];
}

const nyParts = (date: Date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: MARKET_ZONE, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

/**
 * The most recent scheduled fetch time at or before `now`, as "<NY date> <minutes>",
 * comparable as a string key. Weekends roll back to Friday's close.
 */
export function latestSlot(now: Date): string {
    for (let back = 0; back < 8; back++) {
        const probe = new Date(now.getTime() - back * 86_400_000);
        const { day, weekday, minutes } = nyParts(probe);
        if (weekday === 'Sat' || weekday === 'Sun') continue;
        const slots = back === 0 ? MARKET_SLOTS.filter((slot) => slot <= minutes) : MARKET_SLOTS;
        if (slots.length) return `${day} ${String(slots[slots.length - 1]).padStart(4, '0')}`;
    }
    return 'none';
}

const COMPANY_NAMES: Record<string, string> = Object.fromEntries(INDEX_TRACKERS.map((tracker) => [tracker.symbol, tracker.name]));

async function finnhubQuote(symbol: string, key: string): Promise<{ price: number; change: number; changePercent: number } | null> {
    const response = await safeFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`, {
        timeoutMs: 8_000, maxBytes: 16 * 1024, headers: { 'X-Finnhub-Token': key },
    });
    if (response.status === 401 || response.status === 403) throw new Error('The Finnhub API key was not accepted.');
    if (!response.ok) return null;
    const data = JSON.parse(await readCappedText(response, 16 * 1024)) as { c?: unknown; d?: unknown; dp?: unknown };
    const price = Number(data.c), change = Number(data.d), changePercent = Number(data.dp);
    // Finnhub answers 0 for an unknown symbol.
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, change: Number.isFinite(change) ? change : 0, changePercent: Number.isFinite(changePercent) ? changePercent : 0 };
}

const coingeckoHeaders = (key?: string): Record<string, string> => (key ? { 'x-cg-demo-api-key': key } : {});

/** USD → currency multiplier from CoinGecko's BTC-based reference rates. */
async function usdTo(currency: MarketCurrency, key?: string): Promise<number | null> {
    if (currency === 'USD') return 1;
    const response = await safeFetch('https://api.coingecko.com/api/v3/exchange_rates', { timeoutMs: 8_000, maxBytes: 64 * 1024, headers: coingeckoHeaders(key) });
    if (!response.ok) return null;
    const data = JSON.parse(await readCappedText(response, 64 * 1024)) as { rates?: Record<string, { value?: unknown }> };
    const usd = Number(data.rates?.usd?.value), target = Number(data.rates?.[currency.toLowerCase()]?.value);
    return usd > 0 && target > 0 ? target / usd : null;
}

async function cryptoQuotes(symbols: string[], currency: MarketCurrency, key?: string): Promise<Quote[]> {
    if (!symbols.length) return [];
    const vs = currency.toLowerCase();
    const params = new URLSearchParams({ symbols: symbols.map((s) => s.toLowerCase()).join(','), vs_currencies: vs, include_24hr_change: 'true', include_tokens: 'top' });
    const response = await safeFetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, { timeoutMs: 8_000, maxBytes: 64 * 1024, headers: coingeckoHeaders(key) });
    if (!response.ok) throw new Error(response.status === 429 ? 'CoinGecko is rate limiting requests; add a free demo key.' : 'Crypto prices are unavailable.');
    const data = JSON.parse(await readCappedText(response, 64 * 1024)) as Record<string, Record<string, unknown>>;
    return symbols.flatMap((symbol) => {
        const row = data[symbol.toLowerCase()];
        const price = Number(row?.[vs]), changePercent = Number(row?.[`${vs}_24h_change`]);
        if (!Number.isFinite(price) || price <= 0) return [];
        const pct = Number.isFinite(changePercent) ? changePercent : 0;
        // Change in money over 24 h, from the percentage: price − price / (1 + pct).
        const change = price - price / (1 + pct / 100);
        return [{ symbol, name: symbol, price, change, changePercent: pct, kind: 'crypto' as const }];
    });
}

export async function fetchMarkets(settings: DashboardExtrasSettings['markets'], secrets: DashboardSecrets): Promise<MarketData> {
    const notes: string[] = [];
    const stocks: Quote[] = [];
    let crypto: Quote[] = [];
    const symbols = [...INDEX_TRACKERS.map((tracker) => tracker.symbol), ...settings.stocks];
    if (!secrets.finnhubKey) {
        notes.push('Add a Finnhub API key in Settings → Display → Markets to show stock prices.');
    } else {
        try {
            const rate = await usdTo(settings.currency, secrets.coingeckoKey);
            if (rate === null) notes.push(`Stock prices are shown in USD: no ${settings.currency} exchange rate was available.`);
            const multiplier = rate ?? 1;
            for (const symbol of symbols) {
                const quote = await finnhubQuote(symbol, secrets.finnhubKey);
                if (!quote) { notes.push(`No quote for ${symbol}.`); continue; }
                stocks.push({ symbol, name: COMPANY_NAMES[symbol] ?? symbol, price: quote.price * multiplier, change: quote.change * multiplier,
                    changePercent: quote.changePercent, kind: COMPANY_NAMES[symbol] ? 'index' : 'stock' });
            }
        } catch (error) {
            notes.push(error instanceof Error ? error.message : 'Stock prices are unavailable.');
        }
    }
    try {
        crypto = await cryptoQuotes(settings.crypto, settings.currency, secrets.coingeckoKey);
        const missing = settings.crypto.filter((symbol) => !crypto.some((quote) => quote.symbol === symbol));
        if (missing.length) notes.push(`No price for ${missing.join(', ')}.`);
    } catch (error) {
        notes.push(error instanceof Error ? error.message : 'Crypto prices are unavailable.');
    }
    return { currency: settings.currency, stocks, crypto, fetchedAt: new Date().toISOString(), notes };
}

interface CacheEntry { signature: string; slot: string; data: MarketData | null; retryAt: number }
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<MarketData | null>>();

export const clearMarketCache = (familyId: string) => cache.delete(familyId);

/** Cached market data for a family, refreshed only when a new slot has passed or the settings changed. */
export async function getMarkets(familyId: string, settings: DashboardExtrasSettings['markets'], secrets: DashboardSecrets, now = new Date()): Promise<MarketData | null> {
    if (!settings.enabled) return null;
    const signature = JSON.stringify([settings.stocks, settings.crypto, settings.currency, Boolean(secrets.finnhubKey), Boolean(secrets.coingeckoKey)]);
    const slot = latestSlot(now);
    const hit = cache.get(familyId);
    if (hit && hit.signature === signature && (hit.slot === slot || Date.now() < hit.retryAt)) return hit.data;
    const inFlight = pending.get(familyId);
    if (inFlight) return inFlight;
    const work = (async () => {
        try {
            const data = await fetchMarkets(settings, secrets);
            const failed = !data.stocks.length && !data.crypto.length;
            cache.set(familyId, { signature, slot: failed ? '' : slot, data: failed && hit?.signature === signature ? hit.data ?? data : data,
                retryAt: failed ? Date.now() + RETRY_AFTER_FAILURE_MS : 0 });
            return cache.get(familyId)!.data;
        } catch (error) {
            logger.warn('familyhub.markets_failed', { error: error instanceof Error ? error.message : String(error) });
            cache.set(familyId, { signature, slot: '', data: hit?.data ?? null, retryAt: Date.now() + RETRY_AFTER_FAILURE_MS });
            return hit?.data ?? null;
        } finally { pending.delete(familyId); }
    })();
    pending.set(familyId, work);
    return work;
}
