import { expect, it, vi } from 'vitest';
import { GoogleAdapters } from '../../src/services/familyhub/google/adapters';
import { parseDaycareEmail, type GmailMessage } from '../../src/services/familyhub/google/daycare';
const now = new Date('2026-10-29T18:00:00Z');
const encode = (text: string) => Buffer.from(text).toString('base64url');
const email = (body: string, subject = 'Daycare activity', mimeType = 'text/plain'): GmailMessage => ({
    id: 'fictional-one', internalDate: String(now.getTime() - 60_000),
    payload: { mimeType, headers: [{ name: 'From', value: 'Fictional daycare <no-reply@himama.com>' }, { name: 'Subject', value: subject }], body: { data: encode(body) } },
});
it('retains actual milk activity and parent messages without inventing fields', () => {
    expect(parseDaycareEmail(email('Rowan drank 120 ml of milk at 11:30.'))).toMatchObject({ kind: 'activity', activityType: 'feeding', hasDetails: true, text: 'Rowan drank 120 ml of milk at 11:30.' });
    const result = parseDaycareEmail(email('Please bring spare clothes tomorrow.', 'Message from the fictional educator'));
    expect(result).toMatchObject({ kind: 'message', hasDetails: true });
    expect(result).not.toHaveProperty('activityType');
    expect(result).not.toHaveProperty('meals');
    expect(parseDaycareEmail(email('Need diapers.', 'Message from the fictional educator'))).toMatchObject({ kind: 'message', hasDetails: true });
});
it('classifies link-only notices honestly and allows only trusted HTTPS daycare links', () => {
    expect(parseDaycareEmail(email('A new daily report is available.\nView report\nhttps://app.himama.com/report/demo', 'New report'))).toMatchObject({ kind: 'notification', hasDetails: false, link: 'https://app.himama.com/report/demo' });
    expect(parseDaycareEmail(email('Rowan has a new activity.\nPlease check the app for details.\nhttps://app.himama.com/report/demo', 'Activity update'))).toMatchObject({ kind: 'notification', hasDetails: false });
    for (const url of ['https://himama.com.evil.test/demo', 'https://himama.com@evil.test/demo', 'http://himama.com/demo', 'javascript:alert(1)']) {
        expect(parseDaycareEmail(email(url, 'New report'))).not.toHaveProperty('link');
    }
});
it('extracts HTML as inert text, drops scripts/styles and never returns raw HTML or attachments', () => {
    const message = email('<style>secret-style</style><script>secret-script()</script><p>Rowan slept for 45 minutes.</p><a href="https://www.lillio.com/report/demo">View report</a>', 'Nap update', 'text/html');
    const parsed = parseDaycareEmail(message);
    expect(parsed).toMatchObject({ kind: 'activity', activityType: 'sleep', link: 'https://www.lillio.com/report/demo' });
    expect(parsed?.text).toBe('Rowan slept for 45 minutes.\nView report');
    expect(JSON.stringify(parsed)).not.toContain('secret-');
    expect(parsed).not.toHaveProperty('payload');
});
it('handles nested MIME, prefers plain text and skips attachment parts', () => {
    const message = email('unused');
    message.payload = { ...message.payload, mimeType: 'multipart/mixed', body: undefined, parts: [
        { mimeType: 'text/plain', filename: 'private.txt', body: { data: encode('Private attachment should stay hidden.') } },
        { mimeType: 'multipart/alternative', parts: [
            { mimeType: 'text/plain', body: { data: encode('Please bring a blue hat tomorrow.') } },
            { mimeType: 'text/html', body: { data: encode('<p>Alternative version must not duplicate.</p>') } },
        ] },
    ] };
    expect(parseDaycareEmail(message)?.text).toBe('Please bring a blue hat tomorrow.');
});
it('rejects lookalike, multiple, malformed and missing From addresses', () => {
    for (const sender of ['no-reply@himama.com.evil.test', 'other@himama.com', 'no-reply@himama.com, evil@test.com', 'Name <no-reply@himama.com', 'no-reply@himama.com>']) {
        const message = email('Please bring a spare coat tomorrow.'); message.payload!.headers![0].value = sender;
        expect(parseDaycareEmail(message)).toBeNull();
    }
    const message = email('Please bring a spare coat tomorrow.'); message.payload!.headers!.push({ name: 'From', value: 'no-reply@himama.com' });
    expect(parseDaycareEmail(message)).toBeNull();
});
it('caps decoded body content at 64KB and rejects invalid received dates', () => {
    const result = parseDaycareEmail(email('a'.repeat(100_000)));
    expect(Buffer.byteLength(result!.text)).toBeLessThanOrEqual(64 * 1024);
    const message = email('Demo'); message.internalDate = 'not-a-date'; expect(parseDaycareEmail(message)).toBeNull();
});
it('queries only fixed sender/recent window, paginates, fetches full MIME and exposes minimal records', async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: 'fictional-one' }], nextPageToken: 'next' }))
        .mockResolvedValueOnce(Response.json({ messages: [{ id: 'fictional-two' }] }))
        .mockResolvedValueOnce(Response.json(email('Rowan drank 120 ml of milk.')))
        .mockResolvedValueOnce(Response.json({ ...email('Please bring spare clothes tomorrow.', 'New message'), id: 'fictional-two' }));
    const result = await new GoogleAdapters(async () => 'fictional-token', send).daycare(now);
    expect(result).toHaveLength(2);
    const first = new URL(send.mock.calls[0][0]);
    expect(first.origin).toBe('https://gmail.googleapis.com');
    expect(first.searchParams.get('q')).toBe(`from:no-reply@himama.com after:${Math.floor((now.getTime() - 30 * 86_400_000) / 1000)}`);
    expect(send.mock.calls[1][0]).toContain('pageToken=next');
    expect(send.mock.calls[2][0]).toContain('format=full');
    expect(send.mock.calls[2][1].redirect).toBe('error');
    expect(JSON.stringify(result)).not.toContain('headers');
});
it('caps retrieval at 100 emails and never requests attachment content', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => ({ id: `demo${index}` }));
    const send = vi.fn().mockResolvedValueOnce(Response.json({ messages: ids, nextPageToken: 'unused' }))
        .mockImplementation(async () => Response.json(email('A new report is available.')));
    await new GoogleAdapters(async () => 'fictional-token', send).daycare(now);
    expect(send).toHaveBeenCalledTimes(101);
    expect(send.mock.calls.every(([url]) => !url.includes('/attachments/'))).toBe(true);
});
it('filters sender mismatches and old records even if Google returns them', async () => {
    const wrong = email('Please bring spare clothes tomorrow.'); wrong.payload!.headers![0].value = 'lookalike@himama.com';
    const old = { ...email('Rowan slept for 45 minutes.'), internalDate: String(now.getTime() - 31 * 86_400_000) };
    const send = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: 'wrong' }, { id: 'old' }] }))
        .mockResolvedValueOnce(Response.json(wrong)).mockResolvedValueOnce(Response.json(old));
    expect(await new GoogleAdapters(async () => 'fictional-token', send).daycare(now)).toEqual([]);
});
it('fails closed on Gmail errors and repeated page tokens without exposing message bodies', async () => {
    const send = vi.fn().mockResolvedValue(new Response('private fictional email', { status: 403 }));
    await expect(new GoogleAdapters(async () => 'fictional-token', send).daycare(now)).rejects.toMatchObject({ status: 403, message: 'Google request failed.' });
    expect(send).toHaveBeenCalledTimes(1);
    const repeated = vi.fn().mockImplementation(async () => Response.json({ nextPageToken: 'repeat' }));
    await expect(new GoogleAdapters(async () => 'fictional-token', repeated).daycare(now)).rejects.toThrow('Repeated Gmail');
});
