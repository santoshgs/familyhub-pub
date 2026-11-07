import { expect, it, vi } from 'vitest';
import { GoogleAdapters, GoogleApiError } from '../../src/services/familyhub/google/adapters';
const token = async () => 'fictional-token';
const json = (value: unknown) => Response.json(value);
it('uses Google event colours before the account calendar colour and tolerates metadata failures', async () => {
    const start = { date: '2026-11-01' }, end = { date: '2026-11-02' };
    const send = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/colors')) return json({ event: { '11': { background: '#dc2127' } } });
        if (url.includes('/calendarList/')) return json({ backgroundColor: '#9fe1e7' });
        return json({ items: [{ id: 'red', colorId: '11', start, end }, { id: 'default', start, end }] });
    });
    const events = await new GoogleAdapters(token, send).calendar('shared', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z', 'America/New_York');
    expect(events.map((event) => event.color)).toEqual(['#dc2127', '#9fe1e7']);
    send.mockImplementation(async (url: string) => url.includes('/events?') ? json({ items: [{ id: 'one', start, end }] }) : new Response(null, { status: 403 }));
    expect((await new GoogleAdapters(token, send).calendar('shared', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z', 'America/New_York'))[0].color).toBe('#547b4d');
});
it('preserves all-day boundaries, recurring instances, timezone and paginated events', async () => {
    const event = { id: 'one', start: { date: '2026-11-01' }, end: { date: '2026-11-02' }, recurringEventId: 'series' };
    const send = vi.fn().mockResolvedValueOnce(json({ items: [event], nextPageToken: 'next' })).mockResolvedValueOnce(json({ items: [{ ...event, id: 'two' }] }));
    const result = await new GoogleAdapters(token, send).calendar('shared/id', '2026-11-01T00:00:00-04:00', '2026-11-03T00:00:00-05:00', 'America/New_York');
    expect(result).toHaveLength(2); expect(result[0]).toMatchObject({ allDay: true, end: { date: '2026-11-02' } });
    expect(send.mock.calls[0][0]).toContain('shared%2Fid'); expect(send.mock.calls[1][0]).toContain('pageToken=next');
});
it('fetches hidden completions from native Google clients and filters deletions', async () => {
    const send = vi.fn().mockResolvedValue(json({ items: [{ id: 'one', title: 'Read', status: 'completed', due: '2026-11-01T00:00:00Z', completed: '2026-11-01T15:20:00.000Z' }, { id: 'gone', deleted: true }] }));
    const result = await new GoogleAdapters(token, send).tasks('family');
    expect(send.mock.calls[0][0]).toContain('showHidden=true'); expect(result).toEqual([expect.objectContaining({ completed: true, dueDate: '2026-11-01', completedAt: '2026-11-01T15:20:00.000Z' })]);
});
it('sends task mutations to Google with date-only meaning and no local writes', async () => {
    const send = vi.fn().mockImplementation(async () => json({ id: 'one', title: 'Read', status: 'needsAction' }));
    const api = new GoogleAdapters(token, send);
    await api.createTask('family', { title: 'Read', dueDate: '2026-11-01' });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ title: 'Read', due: '2026-11-01T00:00:00.000Z' });
    await api.updateTask('family', 'one', { completed: false });
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ status: 'needsAction', completed: null });
});
it('handles successful delete without attempting JSON parsing', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await new GoogleAdapters(token, send).deleteTask('family', 'one');
    expect(send.mock.calls[0][1].method).toBe('DELETE');
});
it('preserves reviewed AI descriptions in Google task notes and event descriptions', async () => {
    const send = vi.fn().mockImplementation(async (_url, options) => json({ id: 'demo1', status: 'needsAction', ...JSON.parse(options.body) }));
    const api = new GoogleAdapters(token, send);
    await api.createTask('family', { title: 'Fictional supplies', description: 'Bring the blue bag.' });
    await api.createEvent('shared', { title: 'Fictional picnic', description: 'Bring the blue bag.', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
    expect(JSON.parse(send.mock.calls[0][1].body).notes).toBe('Bring the blue bag.');
    expect(JSON.parse(send.mock.calls[1][1].body).description).toBe('Bring the blue bag.');
});
it('does not retry ambiguous task writes or expose private Google errors', async () => {
    const send = vi.fn().mockResolvedValue(new Response('private contents', { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(new GoogleAdapters(token, send).createTask('family', { title: 'Read' })).rejects.toMatchObject({ status: 429, retryAfter: '60' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(new GoogleApiError(401).message).not.toContain('token');
});
it('rejects invalid dates and empty patches before contacting Google', async () => {
    const send = vi.fn(); const api = new GoogleAdapters(token, send);
    await expect(api.createTask('family', { title: 'Read', dueDate: '2026-02-30' })).rejects.toThrow();
    await expect(api.updateTask('family', 'one', {})).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
});
it('rejects repeated pagination tokens without returning a partial snapshot', async () => {
    const send = vi.fn().mockImplementation(async () => json({ nextPageToken: 'same' }));
    await expect(new GoogleAdapters(token, send).tasks('family')).rejects.toThrow('Repeated');
});
it('lists selectable calendars and task lists with pagination and minimal fields', async () => {
    const send = vi.fn().mockResolvedValueOnce(json({ items: [{ id: 'shared', summary: 'Fictional family', accessRole: 'writer', private: 'discard' }], nextPageToken: 'two' }))
        .mockResolvedValueOnce(json({ items: [{ id: 'read', summary: 'School demo', accessRole: 'reader' }] }))
        .mockResolvedValueOnce(json({ items: [{ id: 'tasks', title: 'Demo tasks', updated: 'discard' }] }));
    const api = new GoogleAdapters(token, send);
    expect(await api.calendarLists()).toEqual([{ id: 'shared', summary: 'Fictional family', accessRole: 'writer' }, { id: 'read', summary: 'School demo', accessRole: 'reader' }]);
    expect(await api.taskLists()).toEqual([{ id: 'tasks', title: 'Demo tasks' }]);
    expect(send.mock.calls[1][0]).toContain('pageToken=two');
    expect(send.mock.calls[2][0]).toContain('users/@me/lists');
});
it('creates all-day events with exclusive ends and caller supplied Google idempotency IDs', async () => {
    const send = vi.fn().mockResolvedValue(json({ id: 'abc123', summary: 'Demo outing', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }));
    const result = await new GoogleAdapters(token, send).createEvent('shared/id', { id: 'abc123', title: ' Demo outing ', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
    expect(result).toMatchObject({ allDay: true, calendarId: 'shared/id' });
    expect(send.mock.calls[0][0]).toContain('calendars/shared%2Fid/events');
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ id: 'abc123', summary: 'Demo outing', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
});
it('creates timezone-aware local events and compares offset instants across DST', async () => {
    const send = vi.fn().mockImplementation(async (_url, options) => json({ id: 'one', ...JSON.parse(options.body) }));
    const api = new GoogleAdapters(token, send);
    await api.createEvent('shared', { title: 'Demo pickup', start: { dateTime: '2026-10-30T15:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-30T16:00', timeZone: 'America/New_York' } });
    expect(JSON.parse(send.mock.calls[0][1].body).start).toEqual({ dateTime: '2026-10-30T15:00:00', timeZone: 'America/New_York' });
    await api.createEvent('shared', { title: 'Demo DST event', start: { dateTime: '2026-11-01T01:45:00-04:00' }, end: { dateTime: '2026-11-01T01:15:00-05:00' } });
    expect(send).toHaveBeenCalledTimes(2);
});
it('rejects invalid dates, DST gaps/overlaps, mixed boundaries and invalid event IDs before writes', async () => {
    const send = vi.fn(); const api = new GoogleAdapters(token, send);
    const pairs = [
        [{ date: '2026-02-30' }, { date: '2026-03-01' }],
        [{ date: '2026-11-01' }, { date: '2026-11-01' }],
        [{ date: '2026-11-01' }, { dateTime: '2026-11-02T00:00:00Z' }],
        [{ dateTime: '2026-03-08T02:30', timeZone: 'America/New_York' }, { dateTime: '2026-03-08T04:00', timeZone: 'America/New_York' }],
        [{ dateTime: '2026-11-01T01:30', timeZone: 'America/New_York' }, { dateTime: '2026-11-01T03:00', timeZone: 'America/New_York' }],
        [{ dateTime: '2026-11-01T08:00' }, { dateTime: '2026-11-01T09:00' }],
        [{ dateTime: '2026-11-01T25:00Z' }, { dateTime: '2026-11-02T09:00Z' }],
    ];
    for (const [start, end] of pairs) await expect(api.createEvent('shared', { title: 'Demo', start, end })).rejects.toThrow();
    await expect(api.createEvent('shared', { id: 'not-valid-uuid', title: 'Demo', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } })).rejects.toThrow('identifier');
    expect(send).not.toHaveBeenCalled();
});
it('never retries ambiguous calendar writes', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Network interrupted'));
    await expect(new GoogleAdapters(token, send).createEvent('shared', { title: 'Demo', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } })).rejects.toThrow('Network');
    expect(send).toHaveBeenCalledTimes(1);
});
it('edits and deletes one event with a Google colour, and validates before writing', async () => {
    const send = vi.fn().mockImplementation(async (_url, options) => options.method === 'DELETE' ? new Response(null, { status: 204 })
        : json({ id: 'evt_20261101', start: { date: '2026-11-01' }, end: { date: '2026-11-02' }, ...JSON.parse(options.body) }));
    const api = new GoogleAdapters(token, send);
    const edited = await api.updateEvent('shared', 'evt_20261101', { title: 'Demo outing', colorId: '11', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
    expect(edited).toMatchObject({ id: 'evt_20261101', colorId: '11', allDay: true });
    expect(send.mock.calls[0][0]).toContain('calendars/shared/events/evt_20261101');
    expect(send.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({ summary: 'Demo outing', colorId: '11', location: '' });
    // Clearing the colour sends null so Google returns to the calendar colour.
    await api.updateEvent('shared', 'evt_20261101', { title: 'Demo', colorId: '', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
    expect(JSON.parse(send.mock.calls[1][1].body).colorId).toBeNull();
    await api.deleteEvent('shared', 'evt_20261101');
    expect(send.mock.calls[2][1].method).toBe('DELETE');
    send.mockClear();
    await expect(api.updateEvent('shared', '../other', { title: 'Demo', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } })).rejects.toThrow('identifier');
    await expect(api.updateEvent('shared', 'one', { title: 'Demo', colorId: '12', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } })).rejects.toThrow('colour');
    await expect(api.deleteEvent('shared', 'a/b')).rejects.toThrow('identifier');
    expect(send).not.toHaveBeenCalled();
});
