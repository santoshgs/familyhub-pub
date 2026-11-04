import { GoogleAdapters } from '../../../src/services/familyhub/google/adapters';
import type { GmailMessage } from '../../../src/services/familyhub/google/daycare';
export const simulationTime = new Date('2026-10-29T18:00:00Z');
function message(id: string, subject: string, body: string, minutes: number, html = false): GmailMessage {
    return { id, internalDate: String(simulationTime.getTime() - minutes * 60_000), payload: {
        mimeType: html ? 'text/html' : 'text/plain',
        headers: [{ name: 'From', value: 'Fictional daycare <no-reply@himama.com>' }, { name: 'Subject', value: subject }],
        body: { data: Buffer.from(body).toString('base64url') },
    } };
}
export const daycareEmails = [
    message('milk', 'Milk update', 'Rowan drank 120 ml of milk at 11:30.', 5),
    message('nap', 'Nap update', '<script>BAD_SCRIPT()</script><p>Rowan slept for 45 minutes, from 12:00 to 12:45.</p>', 10, true),
    message('parent', 'Message from the educator', 'Please bring spare clothes tomorrow. Rowan enjoyed painting today.', 15),
    message('link', 'New report', 'A new daily report is available.\nView report\nhttps://app.himama.com/report/fictional-demo', 20),
    message('wrong-sender', 'Ignore this sender', 'This message must not appear.', 25),
];
daycareEmails[4].payload!.headers![0].value = 'other@himama.com';
daycareEmails[0].payload!.parts = [{ mimeType: 'image/jpeg', filename: 'fictional-photo.jpg', body: { attachmentId: 'ignored-photo' } }];
/** Exercises the real Gmail adapter and MIME parser with no network or database. */
export async function simulateDaycare() {
    const calls: string[] = [];
    const api = new GoogleAdapters(async () => 'fictional-token', async (url) => {
        calls.push(url);
        const path = new URL(url).pathname;
        if (path.endsWith('/messages')) return Response.json({ messages: [...daycareEmails.map(({ id }) => ({ id })), { id: 'milk' }] });
        const found = daycareEmails.find(({ id }) => path.endsWith('/' + id));
        if (!found) throw new Error('Unexpected simulation request');
        return Response.json(found);
    });
    return { updates: await api.daycare(simulationTime), calls };
}
