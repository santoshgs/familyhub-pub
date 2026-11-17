import { describe, expect, it, vi } from 'vitest';
import { GoogleAdapters } from '../../src/services/familyhub/google/adapters';
import type { GmailMessage } from '../../src/services/familyhub/google/daycare';
import { formatEmailText, gmailVerified, normalizeFamilySettings, parseLabelEmail, parseSender, type LabelSource } from '../../src/services/familyhub/google/familyUpdates';

// Fictional school board mail, shaped like a mass-notification service's message:
// Gmail's own Authentication-Results first, the sending service's own further down.
const encode = (value: string) => Buffer.from(value).toString('base64url');
const now = new Date('2026-11-16T12:00:00Z');
const GOOGLE_AUTH = 'mx.google.com; dkim=pass header.i=@notify.example header.s=s1; spf=pass smtp.mailfrom=bounces@maplegrove.example; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=maplegrove.example';
const SCHOOL_HTML = `<html><head><style>p{color:red}</style></head><body>
<p>Dear Families,</p><p>Progress reports for Term 1 go home on <b>Thursday, November 26</b>.</p>
<ul><li>Parent&ndash;teacher interviews: December 3, 4:00&ndash;7:00 pm</li><li>Book a time online</li></ul>
<p><a href="https://www.maplegrove.example/interviews">Booking page</a></p>
<p>https://click.notify.example/track?u=abc</p>
<p>You are receiving this message because you are subscribed to Fictional Public School.</p>
<p><a href="https://unsub.notify.example/u/1">Unsubscribe</a></p><script>alert(1)</script></body></html>`;
const school = (overrides: Partial<{ from: string; auth: string[]; html: string; subject: string }> = {}): GmailMessage => ({
    id: 'fictional-school-1', internalDate: String(now.getTime() - 86_400_000),
    payload: {
        mimeType: 'text/html',
        headers: [
            ...(overrides.auth ?? [GOOGLE_AUTH]).map((value) => ({ name: 'Authentication-Results', value })),
            { name: 'From', value: overrides.from ?? 'Avery Example <office.fictional@maplegrove.example>' },
            { name: 'Subject', value: overrides.subject ?? 'Information Regarding Progress Reports' },
            { name: 'List-Id', value: '<shared.1.2.notify.example>' },
        ],
        body: { data: encode(overrides.html ?? SCHOOL_HTML) },
    },
});
const label: LabelSource = { labelId: 'Label_12', name: 'School', display: true, verifiedOnly: true };

describe('Family Updates label emails', () => {
    it('formats a school email as clean text with a sender name and a link only to the sender\'s domain', () => {
        const parsed = parseLabelEmail(school(), label);
        expect(parsed).toHaveProperty('update');
        const update = (parsed as { update: any }).update;
        expect(update).toMatchObject({ title: 'Information Regarding Progress Reports', kind: 'message', sender: 'Avery Example',
            source: { id: 'Label_12', name: 'School' }, display: true, link: 'https://www.maplegrove.example/interviews' });
        expect(update.text).toContain('Progress reports for Term 1 go home on Thursday, November 26.');
        expect(update.text).toContain('• Parent–teacher interviews: December 3, 4:00–7:00 pm');
        expect(update.text).not.toMatch(/<|alert|color:red|click\.notify|Unsubscribe|receiving this message/i);
        expect(update.text).toMatch(/Dear Families,\n\nProgress reports/);
    });
    it('hides emails that fail Gmail\'s check when the label asks for verified senders', () => {
        const spoofed = school({ auth: ['mx.google.com; dkim=none; spf=softfail; dmarc=fail header.from=maplegrove.example'] });
        expect(parseLabelEmail(spoofed, label)).toEqual({ hidden: 'unverified' });
        expect(parseLabelEmail(spoofed, { ...label, verifiedOnly: false })).toHaveProperty('update');
    });
    it('trusts only the first Authentication-Results header, written by Gmail, for the From domain', () => {
        // A sender-written header below Gmail's cannot vouch for itself.
        const forged = school({ auth: ['mx.google.com; dmarc=fail header.from=maplegrove.example', GOOGLE_AUTH] });
        expect(parseLabelEmail(forged, label)).toEqual({ hidden: 'unverified' });
        expect(gmailVerified([{ name: 'Authentication-Results', value: 'relay.example; dmarc=pass header.from=maplegrove.example' }], 'maplegrove.example')).toBe(false);
        // Passing for another domain does not count.
        expect(parseLabelEmail(school({ from: 'Office <office@lookalike.example>' }), label)).toEqual({ hidden: 'unverified' });
    });
    it('refuses malformed or multiple senders', () => {
        expect(parseSender('a@one.example, b@two.example')).toBeNull();
        expect(parseSender('Name <a@one.example>\r\nBcc: x@two.example')).toBeNull();
        expect(parseSender('"Office, Main" <Office@School.Example>')).toEqual({ name: 'Office, Main', address: 'office@school.example', domain: 'school.example' });
        expect(parseLabelEmail(school({ from: 'not an address' }), label)).toEqual({ hidden: 'invalid' });
    });
    it('keeps plain-text emails readable and drops bare links and footers', () => {
        expect(formatEmailText(['Hello,\r\n\r\n\r\n- Bring boots\n* Bring mittens\nhttps://tracking.example/x\nUnsubscribe here\n\nThanks'], []))
            .toBe('Hello,\n\n• Bring boots\n• Bring mittens\n\nThanks');
    });
});

describe('Family Updates settings', () => {
    it('accepts Lillio and up to eight named labels', () => {
        expect(normalizeFamilySettings({ lillio: { enabled: false, display: true }, labels: [{ labelId: 'Label_1', name: '  School  board ', display: false, verifiedOnly: true }] }))
            .toEqual({ lillio: { enabled: false, name: 'Daycare', display: true, ai: false }, labels: [{ labelId: 'Label_1', name: 'School board', display: false, verifiedOnly: true, ai: false }] });
    });
    it('rejects bad label ids, duplicates, blank names and too many labels', () => {
        const base = { lillio: { enabled: true, display: true } };
        const item = (labelId: string, name = 'School') => ({ labelId, name, display: true, verifiedOnly: true });
        for (const labels of [[item('../x')], [item('Label_1'), item('Label_1')], [item('Label_1', '   ')], Array.from({ length: 9 }, (_, i) => item(`Label_${i}`))])
            expect(() => normalizeFamilySettings({ ...base, labels })).toThrow();
        expect(() => normalizeFamilySettings({ labels: [] })).toThrow();
    });
});

describe('Family Updates from Gmail', () => {
    it('reads each chosen label for the last 30 days, reuses known emails and counts hidden ones', async () => {
        const unverified = { ...school({ auth: [] }), id: 'fictional-school-2' };
        const send = vi.fn()
            .mockResolvedValueOnce(Response.json({ messages: [{ id: 'fictional-school-1' }, { id: 'fictional-school-2' }, { id: 'fictional-known' }] }))
            .mockResolvedValueOnce(Response.json(school()))
            .mockResolvedValueOnce(Response.json(unverified));
        const known = new Map([['fictional-known', { id: 'fictional-known', title: 'Earlier', text: 'Already read.', receivedAt: new Date(now.getTime() - 3_600_000).toISOString(),
            kind: 'message' as const, hasDetails: true, source: { id: 'Label_12', name: 'Old name' }, display: true }]]);
        const result = await new GoogleAdapters(async () => 'fictional-token', send)
            .familyUpdates({ lillio: { enabled: false, name: 'Daycare', display: true, ai: false }, labels: [{ ...label, display: false }] }, now, known);
        const list = new URL(send.mock.calls[0][0]);
        expect(list.searchParams.get('labelIds')).toBe('Label_12');
        expect(list.searchParams.get('q')).toBe(`after:${Math.floor((now.getTime() - 30 * 86_400_000) / 1000)}`);
        expect(send).toHaveBeenCalledTimes(3); // the known email is not downloaded again
        expect(result.updates.map((update) => update.id)).toEqual(['fictional-known', 'fictional-school-1']);
        expect(result.updates.every((update) => update.display === false && update.source?.name === 'School')).toBe(true);
        expect(result.stats).toEqual({ Label_12: { shown: 2, hidden: 1 } });
    });
    it('shows an email in two sources once and lists only user labels', async () => {
        const send = vi.fn()
            .mockResolvedValueOnce(Response.json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_2', name: 'Kids/School', type: 'user' }, { id: 'bad id', name: 'x', type: 'user' }] }));
        expect(await new GoogleAdapters(async () => 'fictional-token', send).gmailLabels()).toEqual([{ id: 'Label_2', name: 'Kids/School' }]);
        const twice = vi.fn()
            .mockResolvedValueOnce(Response.json({ messages: [{ id: 'fictional-school-1' }] }))
            .mockResolvedValueOnce(Response.json({ messages: [{ id: 'fictional-school-1' }] }))
            .mockResolvedValueOnce(Response.json(school()));
        const result = await new GoogleAdapters(async () => 'fictional-token', twice)
            .familyUpdates({ lillio: { enabled: false, name: 'Daycare', display: true, ai: false }, labels: [label, { ...label, labelId: 'Label_13', name: 'Class' }] }, now);
        expect(result.updates).toHaveLength(1);
        expect(result.updates[0].source?.name).toBe('School');
    });
});
