// API and WebSocket base resolution.
//
// Family Hub is a web app served by its own server, so the API/WebSocket origin
// is same-origin in production (empty base). Development points at the local
// backend unless VITE_API_URL / VITE_WS_URL override it (scripts/familyhub-local.mjs).

const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_BASE = rawApiUrl !== undefined
    ? rawApiUrl
    : (import.meta.env.PROD ? '' : 'http://localhost:3001');

const rawWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
const WS_BASE = rawWsUrl !== undefined
    ? rawWsUrl
    : (import.meta.env.PROD ? '' : 'ws://localhost:3001');

/** Base URL for HTTP API calls ('' = same origin). */
export function apiBase(): string {
    return API_BASE;
}

/** Base URL for the WebSocket; same-origin ws:/wss: when not configured. */
export function wsBase(): string {
    if (WS_BASE) return WS_BASE;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
}
