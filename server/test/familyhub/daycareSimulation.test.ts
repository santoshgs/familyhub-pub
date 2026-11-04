import { expect, it } from 'vitest';
import { simulateDaycare } from './fixtures/daycare';
it('simulates a mixed daycare inbox through the real adapter and parser', async () => {
    const { updates, calls } = await simulateDaycare();
    expect(updates.map(({ id, kind, activityType, hasDetails }) => ({ id, kind, activityType, hasDetails }))).toEqual([
        { id: 'milk', kind: 'activity', activityType: 'feeding', hasDetails: true },
        { id: 'nap', kind: 'activity', activityType: 'sleep', hasDetails: true },
        { id: 'parent', kind: 'message', activityType: undefined, hasDetails: true },
        { id: 'link', kind: 'notification', activityType: undefined, hasDetails: false },
    ]);
    expect(updates[0].text).toContain('120 ml');
    expect(updates[1].text).toContain('45 minutes');
    expect(updates[3].link).toBe('https://app.himama.com/report/fictional-demo');
    expect(JSON.stringify(updates)).not.toMatch(/BAD_SCRIPT|attachmentId|must not appear/);
    expect(calls).toHaveLength(6); // Duplicate ID fetched once; no attachment requests.
    expect(calls.every((url) => !url.includes('/attachments/'))).toBe(true);
});
