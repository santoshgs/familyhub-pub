import QRCode from 'qrcode';
import type { DashboardExtrasSettings, DashboardSecrets } from './settings';

/**
 * Guest Wi-Fi QR code and the countdown target, prepared on the Pi.
 *
 * The QR code is sent as an SVG path (one "M x y h n v 1 h -n z" run per row of
 * dark modules) so the display draws it with a plain <path>, without parsing
 * markup. The payload follows the de-facto WIFI: URI format that phone cameras
 * read: WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;H:true;;
 */

/** Backslash-escapes the characters the WIFI: format reserves. */
export const escapeWifiValue = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');

export function wifiPayload(ssid: string, encryption: 'WPA' | 'WEP' | 'nopass', password: string, hidden: boolean): string {
    const parts = [`T:${encryption}`, `S:${escapeWifiValue(ssid)}`];
    if (encryption !== 'nopass') parts.push(`P:${escapeWifiValue(password)}`);
    if (hidden) parts.push('H:true');
    return `WIFI:${parts.join(';')};;`;
}

export function qrPath(text: string): { size: number; path: string } {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const { size, data } = qr.modules as unknown as { size: number; data: Uint8Array };
    const runs: string[] = [];
    for (let y = 0; y < size; y++) {
        let x = 0;
        while (x < size) {
            if (!data[y * size + x]) { x++; continue; }
            const start = x;
            while (x < size && data[y * size + x]) x++;
            runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
        }
    }
    return { size, path: runs.join('') };
}

export function buildWifi(settings: DashboardExtrasSettings['wifi'], secrets: DashboardSecrets) {
    if (!settings.enabled || !settings.ssid) return null;
    const password = settings.encryption === 'nopass' ? '' : secrets.wifiPassword ?? '';
    if (settings.encryption !== 'nopass' && !password) return null;
    const { size, path } = qrPath(wifiPayload(settings.ssid, settings.encryption, password, settings.hidden));
    return {
        ssid: settings.ssid,
        password: password || null,
        security: settings.encryption === 'WPA' ? 'WPA/WPA2' : settings.encryption === 'WEP' ? 'WEP' : 'Open',
        qr: { size, path },
    };
}

/**
 * Converts a wall-clock time in a time zone ("2026-11-16T07:00" in
 * America/New_York) to an instant, accounting for daylight saving time.
 */
export function zonedTimeToUtc(local: string, timeZone: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
    if (!match) return null;
    const [, y, mo, d, h, mi] = match.map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    const offsetAt = (instant: number) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
            .formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
        return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant;
    };
    try {
        let guess = wall - offsetAt(wall);
        guess = wall - offsetAt(guess);
        return new Date(guess);
    } catch {
        return null;
    }
}

export function buildCountdown(settings: DashboardExtrasSettings['countdown'], timeZone: string, now = new Date()) {
    if (!settings.enabled || !settings.title || !settings.target) return null;
    const target = zonedTimeToUtc(settings.target, timeZone);
    if (!target) return null;
    const remainingMs = Math.max(0, target.getTime() - now.getTime());
    return {
        title: settings.title,
        targetAt: target.toISOString(),
        targetLocal: settings.target,
        /** Whole days left, for the quick-bar badge; the panel ticks seconds itself. */
        daysLeft: Math.floor(remainingMs / 86_400_000),
        passed: remainingMs === 0,
        checklist: settings.checklist,
    };
}
