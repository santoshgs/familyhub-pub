import { query } from '../../../db';
import { clean, entities, htmlText, messageBodies, type DaycareUpdate, type GmailMessage } from './daycare';

/**
 * Family Updates (v2.2, formerly Daycare): which emails the module shows.
 *
 * Two kinds of source. The built-in Lillio source reads the daycare app's
 * fixed sender, as before. Label sources show the emails a parent has put in
 * a Gmail label (usually with a Gmail filter), so what lands in a label is
 * managed in Gmail and Family Hub only chooses which labels to show. Sender
 * addresses never live in code or the repository: the household's choices are
 * a row in familyhub_family_update_settings.
 *
 * Everything here is text. No HTML leaves the parser and model output is not
 * involved: emails are formatted deterministically.
 */
export interface LabelSource {
    /** Gmail label id, e.g. "Label_123". */
    labelId: string;
    /** Shown on the card and the frame, e.g. "School". */
    name: string;
    /** false: kept off the kitchen display. */
    display: boolean;
    /** true: only emails that pass Gmail's DMARC check for the sender's domain. */
    verifiedOnly: boolean;
    /** v2.3: send this source's emails to the household's AI provider for a summary and suggestions. */
    ai: boolean;
}
export interface FamilyUpdateSettings { lillio: { enabled: boolean; name: string; display: boolean; ai: boolean }; labels: LabelSource[] }
export const DEFAULT_FAMILY_SETTINGS: FamilyUpdateSettings = { lillio: { enabled: true, name: 'Daycare', display: true, ai: false }, labels: [] };
export const MAX_LABEL_SOURCES = 8;
export const LILLIO_SOURCE_ID = 'lillio';

export class FamilyUpdatesError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

const LABEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const displayName = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const name = clean(value).replace(/\s+/g, ' ').slice(0, 40);
    return name || null;
};

/** Validates and normalizes a settings body; throws FamilyUpdatesError(400) with a readable message. */
export function normalizeFamilySettings(input: unknown): FamilyUpdateSettings {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
    const lillio = body.lillio && typeof body.lillio === 'object' ? body.lillio : {};
    if (typeof lillio.enabled !== 'boolean' || typeof lillio.display !== 'boolean') throw new FamilyUpdatesError(400, 'Choose whether to show Lillio emails.');
    const lillioName = lillio.name === undefined ? DEFAULT_FAMILY_SETTINGS.lillio.name : displayName(lillio.name);
    if (!lillioName) throw new FamilyUpdatesError(400, 'Give the Lillio source a name.');
    if (!Array.isArray(body.labels)) throw new FamilyUpdatesError(400, 'Labels must be a list.');
    if (body.labels.length > MAX_LABEL_SOURCES) throw new FamilyUpdatesError(400, `Choose at most ${MAX_LABEL_SOURCES} labels.`);
    const seen = new Set<string>();
    const labels = body.labels.map((raw: any): LabelSource => {
        if (!raw || typeof raw !== 'object' || typeof raw.labelId !== 'string' || !LABEL_ID.test(raw.labelId)) throw new FamilyUpdatesError(400, 'A chosen label is not a Gmail label.');
        if (seen.has(raw.labelId)) throw new FamilyUpdatesError(400, 'Each label can be chosen once.');
        seen.add(raw.labelId);
        const name = displayName(raw.name);
        if (!name) throw new FamilyUpdatesError(400, 'Give each label a name.');
        if (typeof raw.display !== 'boolean' || typeof raw.verifiedOnly !== 'boolean') throw new FamilyUpdatesError(400, 'Choose the display and sender-check options for each label.');
        if (raw.ai !== undefined && typeof raw.ai !== 'boolean') throw new FamilyUpdatesError(400, 'Choose whether AI reads each label.');
        return { labelId: raw.labelId, name, display: raw.display, verifiedOnly: raw.verifiedOnly, ai: raw.ai === true };
    });
    if (lillio.ai !== undefined && typeof lillio.ai !== 'boolean') throw new FamilyUpdatesError(400, 'Choose whether AI reads Lillio emails.');
    // `ai` is optional so settings saved by v2.2 still load, with AI off.
    return { lillio: { enabled: lillio.enabled, name: lillioName, display: lillio.display, ai: lillio.ai === true }, labels };
}

export async function readFamilySettings(familyId: string): Promise<FamilyUpdateSettings> {
    const row = (await query('SELECT settings FROM familyhub_family_update_settings WHERE family_id=$1', [familyId])).rows[0];
    if (!row) return structuredClone(DEFAULT_FAMILY_SETTINGS);
    try { return normalizeFamilySettings(row.settings); } catch { return structuredClone(DEFAULT_FAMILY_SETTINGS); }
}

/** Saves the household's choice and drops the cached emails so the next refresh uses it. */
export async function saveFamilySettings(familyId: string, input: unknown): Promise<FamilyUpdateSettings> {
    const settings = normalizeFamilySettings(input);
    await query(`INSERT INTO familyhub_family_update_settings (family_id, settings, updated_at) VALUES ($1, $2, now())
        ON CONFLICT (family_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`, [familyId, JSON.stringify(settings)]);
    await query(`DELETE FROM familyhub_google_snapshots WHERE family_id=$1 AND kind='daycare'`, [familyId]);
    return settings;
}

export const hasFamilySources = (settings: FamilyUpdateSettings) => settings.lillio.enabled || settings.labels.length > 0;

/** Counts from the last refresh, per source, for the settings screen. In memory: a restart clears them. */
export interface SourceStats { shown: number; hidden: number }
const lastStats = new Map<string, Record<string, SourceStats>>();
export const recordFamilyStats = (familyId: string, stats: Record<string, SourceStats>) => { lastStats.set(familyId, stats); };
export const familyStats = (familyId: string): Record<string, SourceStats> => lastStats.get(familyId) ?? {};

// ---- Parsing a label email ------------------------------------------------

export interface Sender { name: string; address: string; domain: string }

/** "Ms Example <office@school.example>" or "office@school.example". One address only. */
export function parseSender(value: string): Sender | null {
    const text = value.trim();
    if (/[\r\n]/.test(text) || text.length > 400) return null;
    const angled = /^(?:"?([^"<>]*?)"?\s*)?<([^<>\s@,;]+@[^<>\s@,;]+)>$/.exec(text);
    const bare = angled ? null : /^([^<>\s@,;"]+@[^<>\s@,;"]+)$/.exec(text);
    const address = (angled?.[2] ?? bare?.[1])?.toLowerCase();
    if (!address) return null;
    const domain = address.slice(address.lastIndexOf('@') + 1);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
    const name = clean(entities(angled?.[1] ?? '')).replace(/\s+/g, ' ').slice(0, 80);
    return { name, address, domain };
}

/**
 * Did Gmail's own check pass for this sender? Gmail adds its
 * Authentication-Results header above everything the sender wrote, so only the
 * first such header counts, and only when Gmail (mx.google.com) wrote it.
 * DMARC pass means the visible From domain was authenticated by SPF or DKIM.
 */
export function gmailVerified(headers: { name: string; value: string }[], domain: string): boolean {
    const first = headers.find((header) => header.name.toLowerCase() === 'authentication-results');
    if (!first || !/^\s*mx\.google\.com\s*;/i.test(first.value)) return false;
    const dmarc = /\bdmarc=pass\b[^;]*?\bheader\.from=([A-Za-z0-9.-]+)/i.exec(first.value);
    return Boolean(dmarc && dmarc[1].toLowerCase() === domain.toLowerCase());
}

/** Lines that are mail-program furniture rather than the message. */
const FURNITURE = [
    /\bunsubscribe\b/i, /\bopt[- ]out\b/i, /\bmanage (?:your )?(?:preferences|subscriptions?|notification settings)\b/i,
    /\bview (?:this|it|the) (?:email|message) (?:in|on) (?:a|your)? ?(?:web )?browser\b/i, /^view (?:online|in browser)\b/i,
    /\bprivacy (?:policy|statement)\b/i, /^(?:this (?:email|message) was sent|you (?:are )?receiv(?:e|ing) this)\b/i,
    /^(?:sent (?:by|from|via))\b/i, /^(?:copyright|©)/i, /^powered by\b/i, /^(?:please )?do not reply\b/i,
];

/**
 * Plain, tidy text from an email: paragraphs separated by a blank line, list
 * items as "• ", no links on their own line, no footer furniture. Never HTML.
 */
export function formatEmailText(plain: string[], html: string[]): string {
    const source = html.length
        // Mark list items and block ends before the shared extractor drops the tags.
        ? htmlText(html.join('\n').replace(/<li\b[^>]*>/gi, '\n• ').replace(/<(?:p|div|h[1-6]|tr|table|ul|ol|blockquote)\b[^>]*>/gi, '\n\n'))
        : plain.join('\n');
    const lines = source.replace(/\r\n?/g, '\n').split('\n').map((line) => clean(line.replace(/[\t  ]+/g, ' ')).replace(/^[-*·]\s+/, '• '));
    const kept: string[] = [];
    for (const line of lines) {
        if (!line) { if (kept.length && kept[kept.length - 1] !== '') kept.push(''); continue; }
        if (/^<?https?:\/\/\S+>?$/i.test(line) || /^\[(?:image|cid:)[^\]]*\]$/i.test(line)) continue;
        if (line.length < 240 && FURNITURE.some((pattern) => pattern.test(line))) continue;
        if (line === '•') continue;
        // Consecutive list items stay together, without a blank line between them.
        if (line.startsWith('• ') && kept.length >= 2 && kept[kept.length - 1] === '' && kept[kept.length - 2].startsWith('• ')) kept.pop();
        kept.push(line);
    }
    while (kept[kept.length - 1] === '') kept.pop();
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 4000).trim();
}

/** The first HTTPS link to the sender's own domain (or a subdomain); other links are dropped. */
function senderLink(text: string, domain: string): string | undefined {
    for (const match of text.matchAll(/https:\/\/[^\s<>"']+/gi)) {
        try {
            const url = new URL(entities(match[0]).replace(/[).,;]+$/, ''));
            if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue;
            const host = url.hostname.toLowerCase();
            if (host === domain || host.endsWith(`.${domain}`)) return url.href;
        } catch { /* Untrusted message URLs are never followed. */ }
    }
    return undefined;
}

export type LabelParse = { update: DaycareUpdate } | { hidden: 'unverified' | 'invalid' };

/** One email from a label source, or why it is not shown. */
export function parseLabelEmail(message: GmailMessage, source: LabelSource): LabelParse {
    const headers = message.payload?.headers ?? [];
    const from = headers.filter((header) => header.name.toLowerCase() === 'from');
    const sender = from.length === 1 ? parseSender(from[0].value) : null;
    const received = Number(message.internalDate);
    if (!sender || !message.id || !Number.isFinite(received) || received <= 0 || !Number.isFinite(new Date(received).getTime())) return { hidden: 'invalid' };
    if (source.verifiedOnly && !gmailVerified(headers, sender.domain)) return { hidden: 'unverified' };
    const subject = headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? '';
    const { plain, html } = messageBodies(message.payload);
    const text = formatEmailText(plain, html);
    const link = senderLink(`${plain.join('\n')}\n${html.join('\n')}`, sender.domain);
    return { update: {
        id: message.id, title: clean(entities(subject)).replace(/\s+/g, ' ').slice(0, 300) || `${source.name} update`,
        text, receivedAt: new Date(received).toISOString(), kind: 'message', hasDetails: text.length > 0,
        source: { id: source.labelId, name: source.name }, display: source.display,
        ...(sender.name ? { sender: sender.name } : {}), ...(link ? { link } : {}),
    } };
}
