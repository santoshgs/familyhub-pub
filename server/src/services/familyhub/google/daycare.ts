/** Deterministic, server-only email extraction. Never render these values as HTML. */
export interface GmailPart {
    mimeType?: string; filename?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string; attachmentId?: string; size?: number };
    parts?: GmailPart[];
}
export interface GmailMessage { id?: string; internalDate?: string; payload?: GmailPart }
export interface DaycareUpdate {
    id: string; title: string; text: string; receivedAt: string;
    kind: 'activity' | 'message' | 'notification';
    activityType?: 'feeding' | 'sleep' | 'other';
    hasDetails: boolean; link?: string;
}
export const DAYCARE_SENDER = 'no-reply@himama.com';
const MAX_BODY = 64 * 1024;
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

function entities(text: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, value: string) => {
        if (!value.startsWith('#')) return named[value.toLowerCase()] ?? whole;
        const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    });
}
function htmlText(html: string): string {
    // This is text extraction, not an HTML sanitizer. No HTML leaves this parser.
    return entities(html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
        .replace(/<(script|style|head|svg|iframe)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
        .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, ''));
}
function trustedLink(text: string): string | undefined {
    for (const match of text.matchAll(/https:\/\/[^\s<>"']+/gi)) {
        try {
            const url = new URL(entities(match[0]).replace(/[).,;]+$/, ''));
            if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue;
            const host = url.hostname.toLowerCase();
            if (host === 'himama.com' || host.endsWith('.himama.com') || host === 'lillio.com' || host.endsWith('.lillio.com')) return url.href;
        } catch { /* Untrusted message URLs are never followed. */ }
    }
    return undefined;
}

export function parseDaycareEmail(message: GmailMessage): DaycareUpdate | null {
    const headers = message.payload?.headers ?? [];
    const from = headers.filter((header) => header.name.toLowerCase() === 'from');
    if (from.length !== 1 || !/^(?:[^<>\r\n]*<)?no-reply@himama\.com>?$/i.test(from[0].value.trim())
        || (from[0].value.includes('<') !== from[0].value.includes('>'))) return null;
    const received = Number(message.internalDate);
    if (!message.id || !Number.isFinite(received) || received <= 0 || !Number.isFinite(new Date(received).getTime())) return null;
    const subject = headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? 'Daycare update';
    const plain: string[] = [], html: string[] = [];
    let remaining = MAX_BODY, visited = 0;
    const walk = (part: GmailPart, depth: number): void => {
        if (depth > 10 || ++visited > 100 || remaining <= 0 || part.filename || part.body?.attachmentId
            || part.headers?.some((header) => header.name.toLowerCase() === 'content-disposition' && /^attachment\b/i.test(header.value))) return;
        if (['text/plain', 'text/html'].includes(part.mimeType ?? '') && part.body?.data) {
            // Limit decoding before allocating a buffer, including malformed input.
            const raw = Buffer.from(part.body.data.slice(0, Math.ceil(remaining / 3) * 4), 'base64url').subarray(0, remaining);
            remaining -= raw.length;
            (part.mimeType === 'text/plain' ? plain : html).push(raw.toString('utf8'));
        }
        for (const child of part.parts ?? []) walk(child, depth + 1);
    };
    if (message.payload) walk(message.payload, 0);
    const rawHtml = html.join('\n');
    const body = clean((plain.length ? plain.join('\n') : htmlText(rawHtml)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n'));
    const title = clean(subject).slice(0, 300);
    const link = trustedLink(`${body}\n${rawHtml}`);
    const meaningful = body.split('\n').map((line) => line.trim())
        .filter((line) => line && !/^https?:\/\//i.test(line)
            && !/^(?:hi|hello|dear)\b.{0,50}[,!]?$/i.test(line)
            && !/^(?:view|open|click|log in|sign in|unsubscribe|manage preferences|sent (?:by|from)|download the app|copyright|©)\b/i.test(line)
            && !/^(?:please (?:view|open|click|check|log in)|to (?:view|read|see) (?:this|the|your)|check (?:the|your) app)\b/i.test(line)
            && !/^(?:(?:you have|there is|a|your child has)\s+)?(?:a\s+)?new\s+(?:daycare\s+)?(?:activity|update|message|notification|daily report|report|photo|announcement)\b.{0,70}$/i.test(line)
            && !/^.{0,60}\b(?:has|have|received|posted)\s+(?:a\s+)?new\s+(?:activity|update|message|notification|daily report|report|photo|announcement)\b.{0,60}$/i.test(line)
            && !/^(?:daily report|report|update|message|notification|activity)[.!:]?$/i.test(line)
            && !/^(?:a |your )?(?:daily )?(?:report|update|message|photo|activity) (?:is available|has been (?:posted|added)|is ready)\b/i.test(line));
    const hasDetails = meaningful.some((line) => /\b\d+\s*(?:ml|oz|minutes?|mins?|hours?|hrs?)\b|\b\d{1,2}:\d{2}\b/i.test(line) || line.split(/\s+/).length >= 2);
    const combined = `${title}\n${meaningful.join('\n')}`;
    const isMessage = /\b(?:message|announcement)\b/i.test(title);
    const activityType = /\b(?:milk|bottle|feeding|formula|breast\w*)\b/i.test(combined) ? 'feeding'
        : /\b(?:nap|sleep|slept)\b/i.test(combined) ? 'sleep'
            : /\b(?:activity|meal|lunch|breakfast|snack|play\w*|art|reading)\b/i.test(combined) ? 'other' : undefined;
    const kind = !hasDetails ? 'notification' : isMessage ? 'message' : activityType ? 'activity' : 'message';
    return { id: message.id, title, text: body, receivedAt: new Date(received).toISOString(), kind, hasDetails,
        ...(kind === 'activity' ? { activityType } : {}), ...(link ? { link } : {}) };
}
